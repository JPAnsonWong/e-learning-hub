// 每日打卡同步的主流程（Notion ⇄ Firestore）。store 是資料庫介面，正式用 Firestore Admin，測試用記憶體。
//   store.getDoc(col, id) → 資料或 null
//   store.setDoc(col, id, data, { merge }) / store.deleteDoc(col, id) / store.listIds(col)
//   store.listByDates(col, dates) → [{id, ...data}]   （依 date 欄位）
//   store.listWhere(col, field, value) → [{id, ...data}]   （欄位等於某值）
//   store.ts() → 伺服器時間戳（測試用毫秒）
import { hkDate, addDays, mondayOf, lastEligible, planGeneration, mergeRow, quickIds, confirmedBetween, docIdFor, CHILD_NAME, rules } from './daily-sync.mjs';
import { locate, readPeople, readRoutine, readDailyRows, createDailyRow, patchDailyRow, readCountdowns, readRewards, createRedemptionRow, readRedemptionRow } from './daily-notion.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MISSING_GRACE_MS = 20 * 60 * 1000; // Notion 讀不到的文件，連續超過 20 分鐘才從網站移除（避免 Notion 查詢偶爾延遲而誤刪）

export async function runDailySync({ notion, store, parentId, now = Date.now(), log = () => {}, purgeOrphans = false }) {
  const summary = { generated: 0, created: 0, updated: 0, pushed: 0, flagged: 0, removed: 0, countdowns: 0, rewards: 0, redeemCreated: 0, redeemUpdated: 0, totalsChanged: 0 };
  const ids = await locate(notion, parentId);
  const today = hkDate(now), monday = mondayOf(today);
  const people = await readPeople(notion, ids.people);

  // ---------- 1) 每天（每週）只生成一次當日任務 ----------
  // 用「生成記號」而不是檢查列是否存在：爸爸在 Notion 刪掉的任務不會被重新生成。
  // 範本每次都讀（一次查詢）：用來生成任務，也用來帶出任務說明（Routine Items 的 Description）
  const routineRows = await readRoutine(notion, ids.routine, people.idToName);
  const descByTpl = new Map(routineRows.map((x) => [x.id, x.desc || '']));
  const needDay = !(await store.getDoc('daily_gen', 'D_' + today));
  const needWeek = !(await store.getDoc('daily_gen', 'W_' + monday));
  if (needDay || needWeek) {
    const plan = planGeneration({ routine: routineRows, today });
    const rows = [...(needDay ? plan.daily : []), ...(needWeek ? plan.weekly : [])];
    // 上一次生成到一半失敗時，已建立的列不要重複建立
    const existing = new Set((await readDailyRows(notion, ids.daily, [...new Set(rows.map((r) => r.date))])).map((r) => r.key));
    for (const r of rows) {
      if (existing.has(r.key)) continue;
      await createDailyRow(notion, ids.daily, r);
      summary.generated++;
    }
    if (needDay) await store.setDoc('daily_gen', 'D_' + today, { at: now, rows: plan.daily.length }, { merge: false });
    if (needWeek) await store.setDoc('daily_gen', 'W_' + monday, { at: now, rows: plan.weekly.length }, { merge: false });
    log(`生成：今日 ${plan.daily.length} 項、本週 ${plan.weekly.length} 項（新建 ${summary.generated} 列）`);
  }

  // ---------- 2) Notion ⇄ Firestore 雙向合併 ----------
  const nrows = await readDailyRows(notion, ids.daily, rules.watchDates(today));
  const byId = new Map(), docs = new Map();
  for (const n of nrows) {
    n.desc = descByTpl.get(n.tpl) || ''; // 手動新增的列沒有範本，就沒有說明
    const id = docIdFor(n.key);
    byId.set(id, n);
    const f = await store.getDoc('checkins', id);
    const d = mergeRow(n, f, now);
    if (d.create) {
      await store.setDoc('checkins', id, { ...d.create, updatedAt: store.ts() }, { merge: false });
      docs.set(id, { ...d.create, id });
      summary.created++;
      continue;
    }
    let update = d.update;
    if (d.notionPatch) {
      try { await patchDailyRow(notion, n.page, d.notionPatch); summary.pushed++; }
      catch (e) { // 推送失敗：不更新 notionDone，下一輪重試
        log(`推送打卡到 Notion 失敗（下次重試）：${e.message}`);
        if (update) { const { notionDone, ...rest } = update; update = Object.keys(rest).length ? rest : null; }
      }
    }
    if (update) { await store.setDoc('checkins', id, { ...update, updatedAt: store.ts() }, { merge: true }); summary.updated++; }
    docs.set(id, { ...f, ...(update || {}), id });
  }

  // ---------- 2b) 清除網站上多餘的文件 ----------
  // Notion 裡已刪除的任務（或舊版識別碼留下的殘留）不該繼續顯示。連續 20 分鐘都讀不到才移除；purgeOrphans 則立刻移除。
  for (const f of await store.listByDates('checkins', rules.watchDates(today))) {
    if (byId.has(f.id)) { if (f.missingSince) await store.setDoc('checkins', f.id, { missingSince: null }, { merge: true }); continue; }
    if (purgeOrphans || (f.missingSince && now - f.missingSince > MISSING_GRACE_MS)) { await store.deleteDoc('checkins', f.id); summary.removed++; }
    else if (!f.missingSince) await store.setDoc('checkins', f.id, { missingSince: now }, { merge: true });
  }

  // ---------- 3) 快速打卡標記（只標記，不清除） ----------
  for (const id of quickIds([...docs.values()])) {
    const n = byId.get(id);
    if (n && !n.quick) { await patchDailyRow(notion, n.page, { quick: true }); summary.flagged++; }
  }

  // ---------- 4) 倒數日 ----------
  const cds = await readCountdowns(notion, ids.days);
  const have = new Set(await store.listIds('countdowns'));
  for (const c of cds) {
    const cur = await store.getDoc('countdowns', c.id);
    if (!same(cur, c.data)) { await store.setDoc('countdowns', c.id, c.data, { merge: false }); summary.countdowns++; }
    have.delete(c.id);
  }
  for (const id of have) { await store.deleteDoc('countdowns', id); summary.countdowns++; }

  // ---------- 4b) 獎勵清單與兌換申請 ----------
  const rewardList = await readRewards(notion, ids.rewards);
  const haveRewards = new Set(await store.listIds('rewards'));
  for (const w of rewardList) {
    if (!same(await store.getDoc('rewards', w.id), w.data)) { await store.setDoc('rewards', w.id, w.data, { merge: false }); summary.rewards++; }
    haveRewards.delete(w.id);
  }
  for (const id of haveRewards) { await store.deleteDoc('rewards', id); summary.rewards++; }
  // 只追蹤「申請中」的兌換：新的在 Notion 建立一列；舊的讀取爸爸的批准或拒絕
  for (const rd of await store.listWhere('redemptions', 'status', 'pending')) {
    if (!rd.page) {
      const p = await createRedemptionRow(notion, ids.redemptions, rd, rd.id);
      await store.setDoc('redemptions', rd.id, { page: p.id }, { merge: true });
      summary.redeemCreated++;
      continue;
    }
    const nr = await readRedemptionRow(notion, rd.page);
    const status = nr.gone ? 'rejected' : nr.status === '已批准' ? 'approved' : nr.status === '已拒絕' ? 'rejected' : 'pending';
    const note = nr.gone ? '這筆申請已被爸爸刪除' : (nr.note || '');
    if (status !== rd.status || note !== (rd.note || '')) { await store.setDoc('redemptions', rd.id, { status, note }, { merge: true }); summary.redeemUpdated++; }
  }

  // ---------- 5) 已確認的打卡積分（次日 12:00 後才計入；起始總分只在第一次建立時凍結） ----------
  const last = lastEligible(now);
  for (const [student, name] of Object.entries(CHILD_NAME)) {
    let t = await store.getDoc('checkin_totals', student);
    const isNew = !t;
    if (isNew) t = { base: people.totals[name] ?? 0, confirmed: 0, upTo: last, baseFrom: 'Notion People.Total Points', createdAt: now };
    let changed = isNew;
    if (t.upTo < last) {
      const dates = new Set();
      for (let e = addDays(t.upTo, 1), g = 0; e <= last && g < 400; e = addDays(e, 1), g++) { dates.add(e); dates.add(addDays(e, -6)); }
      const rows = (await store.listByDates('checkins', [...dates])).filter((r) => r.student === student);
      const r = confirmedBetween(rows, t.upTo, now);
      t = { ...t, confirmed: t.confirmed + r.sum, upTo: r.upTo };
      changed = true;
    }
    if (changed) { await store.setDoc('checkin_totals', student, { ...t, updatedAt: store.ts() }, { merge: true }); summary.totalsChanged++; }
  }
  return summary;
}
