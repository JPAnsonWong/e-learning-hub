// Notion 讀寫（每日打卡專用）：把 Notion 的頁面屬性轉成程式用的物件，以及建立、更新每日任務列。
// 只讀寫每日打卡需要的資料庫與欄位；不讀 People 的「Goals」等自由文字欄位。
import { CHILD, CHILD_NAME } from './daily-sync.mjs';

const plain = (a) => (a || []).map((t) => t.plain_text).join('');
const sel = (p) => p?.select?.name ?? '';
const num = (p) => (typeof p?.number === 'number' ? p.number : null);
const chk = (p) => !!p?.checkbox;
const rich = (p) => plain(p?.rich_text);
const titleOf = (p) => plain(p?.title);
const msel = (p) => (p?.multi_select || []).map((x) => x.name);
const dateStart = (p) => p?.date?.start ?? null;
export const compactId = (id) => String(id || '').replace(/-/g, '');

export async function queryAll(notion, dbId, body = {}) {
  const out = [];
  let cursor;
  do {
    const r = await notion.call('POST', `/databases/${dbId}/query`, { page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out;
}

// 在上層頁面底下找到需要的資料庫（用標題；「棄用」的舊資料庫標題不同，不會被選中）
export async function locate(notion, parentId) {
  const dbs = await notion.findDatabases(parentId, 3);
  const get = (title) => {
    const hit = dbs.find((d) => d.title === title);
    if (!hit) throw new Error(`找不到資料庫「${title}」，請確認已分享給連線並執行過 notion-setup-daily`);
    return hit.id;
  };
  return { daily: get('每日任務'), days: get('重要日子'), routine: get('Routine Items'), people: get('People'), rewards: get('獎勵'), redemptions: get('兌換記錄') };
}

export async function readPeople(notion, dbId) {
  const pages = await queryAll(notion, dbId);
  const idToName = new Map(), totals = {};
  for (const p of pages) {
    const name = titleOf(p.properties.Name);
    idToName.set(compactId(p.id), name);
    if (CHILD[name]) totals[name] = num(p.properties['Total Points']) ?? 0;
  }
  return { idToName, totals };
}

export async function readRoutine(notion, dbId, idToName) {
  // 依建立時間排序：網站上任務的顯示順序就是你在 Routine Items 建立的順序（Notion 沒指定排序時，回傳順序不固定）
  const pages = await queryAll(notion, dbId, { sorts: [{ timestamp: 'created_time', direction: 'ascending' }] });
  return pages.map((p, order) => {
    const pr = p.properties;
    return {
      id: compactId(p.id), title: titleOf(pr.Title), order,
      persons: (pr.Person?.relation || []).map((r) => idToName.get(compactId(r.id))).filter(Boolean),
      category: sel(pr.Category), frequency: sel(pr.Frequency), points: num(pr.Points),
      active: chk(pr.Active), weekdays: msel(pr['適用星期']), optional: chk(pr['選填']), desc: rich(pr.Description),
    };
  });
}

export function toRow(p) {
  const pr = p.properties;
  const date = dateStart(pr['日期'])?.slice(0, 10);
  const student = CHILD[sel(pr['孩子'])];
  if (!date || !student) return null; // 缺日期或孩子的列沒辦法顯示，略過
  const at = dateStart(pr['打卡時間']);
  return {
    // 識別碼：日期＋孩子＋範本 Key（完整 ID）。爸爸手動新增的列沒有範本 Key，就用它自己的完整頁面 ID。不使用 Key 欄位（舊版本寫入的值可能被截短）
    page: p.id, key: `${date}|${student}|${rich(pr['範本 Key']) || 'm' + compactId(p.id)}`,
    date, student, tpl: rich(pr['範本 Key']), title: titleOf(pr['任務']) || '（無標題）', catName: sel(pr['分類']) || '日常習慣', optional: chk(pr['選填']),
    points: num(pr['積分']), note: rich(pr['備註']), order: num(pr['排序']),
    checked: chk(pr['打卡']), checkedAt: at ? Date.parse(at) : null, quick: chk(pr['⚠ 連續快速打卡']),
  };
}

export async function readDailyRows(notion, dbId, dates) {
  if (!dates.length) return [];
  const filter = dates.length === 1 ? { property: '日期', date: { equals: dates[0] } } : { or: dates.map((d) => ({ property: '日期', date: { equals: d } })) };
  return (await queryAll(notion, dbId, { filter })).map(toRow).filter(Boolean);
}

const t = (s) => [{ text: { content: String(s).slice(0, 1900) } }];
export async function createDailyRow(notion, dbId, r) {
  return notion.call('POST', '/pages', {
    parent: { database_id: dbId },
    properties: {
      任務: { title: t(r.title) }, 日期: { date: { start: r.date } }, 孩子: { select: { name: r.childName } }, 分類: { select: { name: r.catName } },
      選填: { checkbox: !!r.optional }, 排序: { number: r.order }, '範本 Key': { rich_text: t(r.templateId) }, Key: { rich_text: t(r.key) },
      ...(r.points != null ? { 積分: { number: r.points } } : {}), // 沒有分數的任務留空＝待評分
    },
  });
}

export async function patchDailyRow(notion, page, { checked, checkedAt, quick }) {
  const properties = {};
  if (checked !== undefined) {
    properties['打卡'] = { checkbox: !!checked };
    properties['打卡時間'] = { date: checked && checkedAt ? { start: new Date(checkedAt).toISOString() } : null };
  }
  if (quick) properties['⚠ 連續快速打卡'] = { checkbox: true };
  return notion.call('PATCH', `/pages/${page}`, { properties });
}

// 倒數日：只回傳要顯示的（沒有被「隱藏」、有日期的）
export async function readCountdowns(notion, dbId) {
  const out = [];
  for (const p of await queryAll(notion, dbId)) {
    const pr = p.properties;
    const date = dateStart(pr['日期'])?.slice(0, 10);
    if (!date || chk(pr['隱藏'])) continue;
    const who = sel(pr['對象']);
    out.push({
      id: compactId(p.id),
      data: { title: titleOf(pr['事項']) || '（未命名）', date, note: rich(pr['說明']), type: sel(pr['類型']) || '其他',
        who: who === '女兒' ? ['daughter'] : who === '兒子' ? ['son'] : ['daughter', 'son'] },
    });
  }
  return out;
}

// ---------- 獎勵與兌換 ----------
// 獎勵清單：略過「停用」的、沒有名稱或所需積分的
export async function readRewards(notion, dbId) {
  const out = [];
  for (const p of await queryAll(notion, dbId)) {
    const pr = p.properties;
    const name = titleOf(pr['名稱']), cost = num(pr['所需積分']);
    if (!name || cost == null || cost <= 0 || chk(pr['停用'])) continue;
    out.push({ id: compactId(p.id), data: { name, cost, icon: rich(pr['圖示']) || '🎁', limit: num(pr['每週上限']) || null, desc: rich(pr['說明']) } });
  }
  return out;
}
// 孩子在網站提出的兌換申請 → 在 Notion「兌換記錄」建立一列（狀態：申請中），爸爸在 Notion 改成「已批准」或「已拒絕」
export async function createRedemptionRow(notion, dbId, d, docId) {
  return notion.call('POST', '/pages', {
    parent: { database_id: dbId },
    properties: {
      獎勵: { title: t(d.name) }, 孩子: { select: { name: CHILD_NAME[d.student] || d.student } }, 日期: { date: { start: d.date } },
      扣除積分: { number: d.cost }, 狀態: { select: { name: '申請中' } }, Key: { rich_text: t(docId) },
    },
  });
}
// 讀取兌換列的目前狀態；爸爸把整列刪掉（或封存）視為拒絕
export async function readRedemptionRow(notion, page) {
  try {
    const p = await notion.call('GET', `/pages/${page}`);
    if (p.archived) return { gone: true };
    return { status: sel(p.properties['狀態']), note: rich(p.properties['備註']) };
  } catch (e) {
    if (e.status === 404 || e.status === 400) return { gone: true };
    throw e;
  }
}
