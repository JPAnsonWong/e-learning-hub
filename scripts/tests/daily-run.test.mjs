// 每日打卡同步的整合測試：模擬的 Notion（本機 HTTP）加記憶體資料庫，把整個流程跑一遍。
// 執行：node scripts/tests/daily-run.test.mjs（不需要網絡、不需要任何密鑰）
import http from 'node:http';
import { createNotion } from '../lib/notion.mjs';
import { runDailySync } from '../lib/daily-run.mjs';
import { docIdFor, keyFor } from '../lib/daily-sync.mjs';
import { DAILY_SCHEMAS } from '../lib/daily-schema.mjs';

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
};
const HK = (s) => Date.parse(s + '+08:00');

// ================= 模擬 Notion =================
const ROOT = 'a'.repeat(32), DB = { daily: 'd1'.padEnd(32, '0'), days: 'd2'.padEnd(32, '0'), routine: 'd3'.padEnd(32, '0'), people: 'd4'.padEnd(32, '0'), rewards: 'd5'.padEnd(32, '0'), redemptions: 'd6'.padEnd(32, '0') };
const pad = (s) => s.padEnd(32, '0');
const P = {};
const pages = new Map(); // id → {id, db, properties}
let seq = 0, failNextPatch = false;
const rt = (s) => [{ plain_text: s, text: { content: s } }];
const norm = (props) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.title ? { title: v.title.map((x) => ({ plain_text: x.text.content })) } : v.rich_text ? { rich_text: v.rich_text.map((x) => ({ plain_text: x.text.content })) } : v]));
// 真實的 Notion 會回傳資料庫的每個欄位（沒填的是預設值），模擬也這樣做
const DEFAULTS = { 打卡: { checkbox: false }, 選填: { checkbox: false }, '⚠ 連續快速打卡': { checkbox: false }, 打卡時間: { date: null }, 積分: { number: null }, 備註: { rich_text: [] }, Key: { rich_text: [] }, 排序: { number: null } };
// 真實的 Notion 頁面 ID 開頭幾乎一樣（同一批建立），所以測試也用相同的前綴，才抓得到「截短 ID 撞在一起」的問題
const add = (db, properties) => { const id = pad('3cf4d146' + String(++seq).padStart(4, '0')); pages.set(id, { id, db, properties: db === DB.daily ? { ...DEFAULTS, ...properties } : properties }); return id; };
const person = (name, total) => add(DB.people, { Name: { title: rt(name) }, 'Total Points': { number: total } });
const routineRow = (o) => add(DB.routine, {
  Title: { title: rt(o.title) }, Person: { relation: o.persons.map((id) => ({ id })) }, Category: { select: { name: o.cat } }, Frequency: { select: { name: o.freq } },
  Points: { number: o.points ?? null }, Description: { rich_text: rt(o.desc || '') }, Active: { checkbox: o.active !== false }, 適用星期: { multi_select: (o.wd || []).map((name) => ({ name })) }, 選填: { checkbox: !!o.optional },
});
const rewardRow = (name, cost, o = {}) => add(DB.rewards, { 名稱: { title: rt(name) }, 所需積分: { number: cost }, 停用: { checkbox: !!o.off }, 每週上限: { number: o.limit ?? null }, 圖示: { rich_text: rt(o.icon || '') }, 說明: { rich_text: rt('') } });
const countdownRow = (title, date, who, hidden = false) => add(DB.days, { 事項: { title: rt(title) }, 日期: { date: { start: date } }, 對象: { select: { name: who } }, 說明: { rich_text: rt('') }, 隱藏: { checkbox: hidden }, 類型: { select: { name: '考試' } } });

const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const url = req.url.split('?')[0], j = body ? JSON.parse(body) : {};
    const send = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    let m;
    if (req.method === 'GET' && (m = url.match(/^\/v1\/blocks\/([0-9a-f]{32})\/children$/))) {
      if (m[1] !== ROOT) return send({ results: [], has_more: false });
      const t = { daily: '每日任務', days: '重要日子', routine: 'Routine Items', people: 'People', rewards: '獎勵', redemptions: '兌換記錄' };
      return send({ results: [...Object.entries(DB).map(([k, id]) => ({ id, type: 'child_database', child_database: { title: t[k] } })), { id: pad('e1'), type: 'child_database', child_database: { title: 'Routine Items - 棄用' } }], has_more: false });
    }
    if (req.method === 'POST' && (m = url.match(/^\/v1\/databases\/([0-9a-f]{32})\/query$/))) {
      let rows = [...pages.values()].filter((p) => p.db === m[1]);
      const f = j.filter;
      if (f) {
        const conds = f.or || [f];
        rows = rows.filter((p) => conds.some((c) => (p.properties[c.property]?.date?.start || '').slice(0, 10) === c.date.equals));
      }
      return send({ results: rows, has_more: false });
    }
    // 像真的 Notion 一樣：寫入資料庫沒有的欄位會被拒絕（上線時就是因為少了「排序」欄位被擋下過）
    const schemaOf = (db) => (db === DB.daily ? DAILY_SCHEMAS.daily : db === DB.redemptions ? DAILY_SCHEMAS.redemptions : db === DB.rewards ? DAILY_SCHEMAS.rewards : null);
    const unknownProp = (db, props) => { const sc = schemaOf(db); return sc ? Object.keys(props || {}).find((k) => !(k in sc.props)) : undefined; };
    if (req.method === 'POST' && url === '/v1/pages') { const bad = unknownProp(j.parent.database_id, j.properties); if (bad) return send({ message: bad + ' is not a property that exists.' }, 400); const id = add(j.parent.database_id, norm(j.properties)); return send({ id }); }
    if (req.method === 'GET' && (m = url.match(/^\/v1\/pages\/([0-9a-f]{32})$/))) { const p = pages.get(m[1]); return p ? send({ id: p.id, archived: false, properties: p.properties }) : send({ message: 'not found' }, 404); }
    if (req.method === 'PATCH' && (m = url.match(/^\/v1\/pages\/([0-9a-f]{32})$/))) {
      if (failNextPatch) { failNextPatch = false; return send({ message: 'simulated' }, 400); }
      const p = pages.get(m[1]); if (!p) return send({ message: 'nf' }, 404);
      const bad = unknownProp(p.db, j.properties); if (bad) return send({ message: bad + ' is not a property that exists.' }, 400);
      Object.assign(p.properties, norm(j.properties)); return send({ id: p.id });
    }
    send({ message: 'unhandled ' + req.method + ' ' + url }, 400);
  });
});

// ================= 記憶體資料庫 =================
function memoryStore() {
  const cols = {};
  const col = (c) => (cols[c] ||= new Map());
  return {
    cols,
    async getDoc(c, id) { const d = col(c).get(id); return d ? JSON.parse(JSON.stringify(d)) : null; },
    async setDoc(c, id, data, { merge = true } = {}) { col(c).set(id, merge ? { ...(col(c).get(id) || {}), ...data } : { ...data }); },
    async deleteDoc(c, id) { col(c).delete(id); },
    async listIds(c) { return [...col(c).keys()]; },
    async listWhere(c, field, value) { return [...col(c)].filter(([, d]) => d[field] === value).map(([id, d]) => ({ id, ...d })); },
    async listByDates(c, dates) { return [...col(c)].filter(([, d]) => dates.includes(d.date)).map(([id, d]) => ({ id, ...d })); },
    ts: () => 'TS',
  };
}

await new Promise((r) => server.listen(0, r));
const notion = createNotion({ token: 't', base: `http://localhost:${server.address().port}/v1`, delayMs: 0 });

// ---- 種子資料 ----
P.girl = person('女兒', 87); P.boy = person('兒子', 21); P.dad = person('爸爸', 15); P.mom = person('媽媽', null);
const sonHwTpl = routineRow({ title: '學校功課', persons: [P.boy], cat: '學習任務', freq: 'Daily', points: 1, desc: '完成當天所有學校功課' });
routineRow({ title: '學校功課', persons: [P.girl], cat: '學習任務', freq: 'Daily', points: 1 });
routineRow({ title: '練琴', persons: [P.girl, P.boy], cat: '日常習慣', freq: 'Daily', points: 2 });
routineRow({ title: '補習功課（若有）', persons: [P.boy], cat: '學習任務', freq: 'Daily', points: 1, wd: ['週一', '週三'], optional: true });
routineRow({ title: '每周閱讀', persons: [P.girl], cat: '每周任務', freq: 'Weekly', points: 3 });
routineRow({ title: '交費', persons: [P.dad], cat: '每周任務', freq: 'Weekly', points: 1 });
routineRow({ title: '停用的任務', persons: [P.girl], cat: '日常習慣', freq: 'Daily', points: 1, active: false });
routineRow({ title: '待評分任務', persons: [P.boy], cat: '日常習慣', freq: 'Daily', points: null });
countdownRow('第一次考試', '2026-12-01', '兒子');
countdownRow('媽媽生日', '2026-12-14', '全家');
countdownRow('隱藏的', '2026-12-20', '全家', true);

const tvId = rewardRow('看電視 30 分鐘', 40, { limit: 3, icon: '📺' });
rewardRow('玩遊戲 30 分鐘', 40);
rewardRow('已下架的獎勵', 10, { off: true });
rewardRow('沒有積分的獎勵', 0);
const store = memoryStore();
const dailyRows = () => [...pages.values()].filter((p) => p.db === DB.daily);
const byTitle = (title, kid) => dailyRows().find((p) => p.properties['任務'].title[0].plain_text === title && p.properties['孩子'].select.name === kid);
const doc = async (date, student, tpl) => { const all = store.cols.checkins; return [...(all || [])].map(([id, d]) => ({ id, ...d })).find((d) => d.date === date && d.student === student && d.title === tpl); };
const run = (now) => runDailySync({ notion, store, parentId: ROOT, now });

// ================= 情境 =================
const FRI = HK('2026-11-20T08:00:00'); // 週五
let s = await run(FRI);
eq('A1 第一次：生成 6 列（今日 5＋本週 1），爸爸任務和停用任務不生成', s.generated, 6);
eq('A2 Firestore 同步 6 筆', store.cols.checkins.size, 6);
eq('A3 Notion 每日任務有 6 列', dailyRows().length, 6);
eq('A4 孩子欄位只有女兒／兒子', [...new Set(dailyRows().map((p) => p.properties['孩子'].select.name))].sort(), ['兒子', '女兒']);
eq('A5 積分預設＝任務分數，待評分任務保持空白', [byTitle('學校功課', '兒子').properties['積分'].number, byTitle('待評分任務', '兒子').properties['積分']?.number ?? null], [1, null]);
eq('A6 每周任務日期是本週一', byTitle('每周閱讀', '女兒').properties['日期'].date.start, '2026-11-16');
eq('A7 週五不生成「補習功課（若有）」', dailyRows().some((p) => p.properties['任務'].title[0].plain_text.startsWith('補習')), false);
eq('A8 起始總分取自 People（女兒 87、兒子 21）', [(await store.getDoc('checkin_totals', 'daughter')).base, (await store.getDoc('checkin_totals', 'son')).base], [87, 21]);
eq('A9 倒數日同步（隱藏的不同步）', (await store.listIds('countdowns')).length, 2);
const cdDocs = await Promise.all((await store.listIds('countdowns')).map((id) => store.getDoc('countdowns', id)));
eq('A10 倒數日對象：兒子的考試只給兒子，全家給兩人', cdDocs.map((c) => [c.title, c.who.join('+')]).sort(), [['媽媽生日', 'daughter+son'], ['第一次考試', 'son']]);
eq('A11 ID 前綴相同的任務不會撞在一起：Firestore 文件數 = Notion 列數', [store.cols.checkins.size, new Set([...store.cols.checkins.values()].map((d) => d.page)).size], [6, 6]);

s = await run(FRI + 60000);
eq('B 第二次執行：沒有新生成、沒有更新（冪等）', [s.generated, s.created, s.updated, s.pushed, s.countdowns], [0, 0, 0, 0, 0]);

// ---- 任務說明（Routine Items 的 Description）----
const hwSon = async () => (await doc('2026-11-20', 'son', '學校功課'));
eq('M1 範本的說明帶到網站', (await hwSon()).desc, '完成當天所有學校功課');
eq('M2 沒有說明的範本 → 空字串', (await doc('2026-11-20', 'son', '練琴')).desc, '');
pages.get(sonHwTpl).properties.Description = { rich_text: rt('改過的說明') };
s = await run(FRI + 95000);
eq('M3 爸爸改範本的說明 → 下一輪同步就更新（不必等明天重新生成）', [(await hwSon()).desc, s.generated], ['改過的說明', 0]);
pages.get(sonHwTpl).properties.Description = { rich_text: [] };
await run(FRI + 96000);
eq('M4 說明清空 → 網站也清空', (await hwSon()).desc, '');
pages.get(sonHwTpl).properties.Description = { rich_text: rt('完成當天所有學校功課') };
await run(FRI + 97000);

// 生成記號遺失（例如上次生成到一半失敗）後重跑：已存在的列不能重複建立
await store.deleteDoc('daily_gen', 'D_2026-11-20'); await store.deleteDoc('daily_gen', 'W_2026-11-16');
s = await run(FRI + 90000);
eq('B2 生成記號被清掉後重跑：不重複建立任何列（識別碼在生成與讀取兩邊一致）', [s.generated, dailyRows().length], [0, 6]);

// 孩子在網站打卡
const girlHw = await doc('2026-11-20', 'daughter', '學校功課');
await store.setDoc('checkins', girlHw.id, { done: true, doneAt: FRI + 120000 });
s = await run(FRI + 180000);
const pg = byTitle('學校功課', '女兒');
eq('C1 網站打卡 → Notion 勾選', pg.properties['打卡'].checkbox, true);
eq('C2 打卡時間寫入 Notion', pg.properties['打卡時間'].date.start, new Date(FRI + 120000).toISOString());
eq('C3 Firestore 記下已同步狀態', (await store.getDoc('checkins', girlHw.id)).notionDone, true);

// 推送失敗 → 下一輪重試
const boyHw = await doc('2026-11-20', 'son', '學校功課');
await store.setDoc('checkins', boyHw.id, { done: true, doneAt: FRI + 240000 });
failNextPatch = true;
await run(FRI + 250000);
eq('D1 推送失敗：Notion 還沒勾，notionDone 保持 false（等待重試）', [byTitle('學校功課', '兒子').properties['打卡'].checkbox, (await store.getDoc('checkins', boyHw.id)).notionDone], [false, false]);
await run(FRI + 260000);
eq('D2 下一輪重試成功', [byTitle('學校功課', '兒子').properties['打卡'].checkbox, (await store.getDoc('checkins', boyHw.id)).notionDone], [true, true]);

// 爸爸在 Notion 更正
pages.get(pg.id).properties['打卡'] = { checkbox: false };
pages.get(pg.id).properties['積分'] = { number: 1 };
await run(FRI + 300000);
const g2 = await store.getDoc('checkins', girlHw.id);
eq('E1 爸爸在 Notion 取消打卡 → 網站 done=false、fix=untick', [g2.done, g2.fix], [false, 'untick']);
const piano = byTitle('練琴', '兒子');
pages.get(piano.id).properties['積分'] = { number: 0 };
pages.get(piano.id).properties['備註'] = { rich_text: rt('只彈了一半') };
await run(FRI + 310000);
const pianoDoc = await doc('2026-11-20', 'son', '練琴');
eq('E2 爸爸改積分與備註 → 網站更新，原始分數保留', [pianoDoc.points, pianoDoc.note, pianoDoc.basePoints], [0, '只彈了一半', 2]);

// 爸爸刪除一個任務 → 不重新生成，網站上也要消失（先標記，連續 20 分鐘讀不到才移除）
pages.delete(byTitle('待評分任務', '兒子').id);
await run(FRI + 320000);
eq('F1 爸爸刪掉的任務不會被重新生成', dailyRows().some((p) => p.properties['任務'].title[0].plain_text === '待評分任務'), false);
eq('F2 剛刪掉：網站上先保留並標記', [!!(await doc('2026-11-20', 'son', '待評分任務')), !!(await doc('2026-11-20', 'son', '待評分任務'))?.missingSince], [true, true]);
await run(FRI + 320000 + 25 * 60000);
eq('F3 連續 20 分鐘讀不到 → 從網站移除', await doc('2026-11-20', 'son', '待評分任務'), undefined);

// 爸爸手動新增一列（沒有 Key、沒有排序）
add(DB.daily, { 任務: { title: rt('臨時：整理房間') }, 日期: { date: { start: '2026-11-20' } }, 孩子: { select: { name: '女兒' } }, 分類: { select: { name: '日常習慣' } }, 積分: { number: 2 } });
await run(FRI + 330000);
const manual = await doc('2026-11-20', 'daughter', '臨時：整理房間');
eq('G 手動新增的列會同步，排序放最後', [!!manual, manual?.order, manual?.points], [true, 999, 2]);

// 快速打卡：女兒 5 項在 30 秒內
for (const t of ['學校功課', '練琴', '臨時：整理房間']) { const d = await doc('2026-11-20', 'daughter', t); await store.setDoc('checkins', d.id, { done: true, doneAt: FRI + 400000 + Math.random() * 1000 }); }
// 補兩項讓女兒有 5 項
add(DB.daily, { 任務: { title: rt('臨時 A') }, 日期: { date: { start: '2026-11-20' } }, 孩子: { select: { name: '女兒' } }, 分類: { select: { name: '日常習慣' } }, 積分: { number: 1 }, Key: { rich_text: rt('2026-11-20|daughter|tmpA') } });
add(DB.daily, { 任務: { title: rt('臨時 B') }, 日期: { date: { start: '2026-11-20' } }, 孩子: { select: { name: '女兒' } }, 分類: { select: { name: '日常習慣' } }, 積分: { number: 1 }, Key: { rich_text: rt('2026-11-20|daughter|tmpB') } });
await run(FRI + 410000);
for (const t of ['臨時 A', ' 臨時 B'.trim()]) { const d = await doc('2026-11-20', 'daughter', t); await store.setDoc('checkins', d.id, { done: true, doneAt: FRI + 405000 }); }
s = await run(FRI + 420000);
await run(FRI + 430000);
const flagged = dailyRows().filter((p) => p.properties['⚠ 連續快速打卡']?.checkbox).length;
eq('H 30 秒內連續打卡 5 項 → Notion 標記「⚠ 連續快速打卡」', flagged >= 5, true);

// 隔天：新的一天生成；昨天的打卡在中午後確認
const SAT = HK('2026-11-21T09:00:00');
s = await run(SAT);
eq('I1 隔天（週六）生成新的一天，不重複生成本週任務', [dailyRows().filter((p) => p.properties['日期'].date.start === '2026-11-21').length, dailyRows().filter((p) => p.properties['日期'].date.start === '2026-11-16').length], [5, 1]);
const tBefore = await store.getDoc('checkin_totals', 'daughter');
eq('I2 週六 09:00：週五的積分還沒確認', tBefore.confirmed, 0);
await run(HK('2026-11-21T12:30:00'));
const tAfter = await store.getDoc('checkin_totals', 'daughter');
const tSon = await store.getDoc('checkin_totals', 'son');
// 女兒週五：學校功課被取消(不計)、練琴 +2、臨時整理房間 +2、臨時 A +1、臨時 B +1 = 6
eq('I3 週六 12:30：女兒週五已確認 6 分（取消的不計）', [tAfter.confirmed, tAfter.upTo], [6, '2026-11-20']);
// 兒子週五：學校功課 +1（已推送成功）、練琴 0 分 = 1（待評分任務已刪除）
eq('I4 兒子週五已確認 1 分', tSon.confirmed, 1);
await run(HK('2026-11-21T13:00:00'));
eq('I5 再執行一次不會重複計算', (await store.getDoc('checkin_totals', 'daughter')).confirmed, 6);
eq('I6 起始總分不會被改動', [(await store.getDoc('checkin_totals', 'daughter')).base, (await store.getDoc('checkin_totals', 'son')).base], [87, 21]);

// 倒數日變動
pages.delete([...pages.values()].find((p) => p.db === DB.days && p.properties['事項'].title[0].plain_text === '媽媽生日').id);
await run(HK('2026-11-21T14:00:00'));
eq('J 倒數日在 Notion 刪除後，網站端也移除', (await store.listIds('countdowns')).length, 1);

// ---- 獎勵與兌換 ----
const redRows = () => [...pages.values()].filter((p) => p.db === DB.redemptions);
const RW = (await store.listIds('rewards')).length;
eq('L1 獎勵清單同步：停用和沒積分的不同步（共 2 項）', RW, 2);
const tvDoc = (await Promise.all((await store.listIds('rewards')).map(async (id) => ({ id, ...(await store.getDoc('rewards', id)) })))).find((x) => x.name.startsWith('看電視'));
eq('L2 獎勵內容：積分、每週上限、圖示', [tvDoc.cost, tvDoc.limit, tvDoc.icon], [40, 3, '📺']);

const REDEEM_AT = HK('2026-11-21T15:00:00');
await store.setDoc('redemptions', 'rq1', { student: 'daughter', rewardId: tvDoc.id, name: '看電視 30 分鐘', icon: '📺', cost: 40, status: 'pending', date: '2026-11-21', requestedAt: REDEEM_AT, note: '', page: null }, { merge: false });
await store.setDoc('redemptions', 'rq2', { student: 'son', rewardId: tvDoc.id, name: '看電視 30 分鐘', icon: '📺', cost: 40, status: 'pending', date: '2026-11-21', requestedAt: REDEEM_AT, note: '', page: null }, { merge: false });
s = await run(REDEEM_AT + 60000);
eq('L3 新的兌換申請 → Notion 兌換記錄建立 2 列（狀態：申請中）', [s.redeemCreated, redRows().length, [...new Set(redRows().map((p) => p.properties['狀態'].select.name))]], [2, 2, ['申請中']]);
const r1 = redRows().find((p) => p.properties['孩子'].select.name === '女兒');
eq('L4 兌換列內容：獎勵名稱、扣除積分、日期', [r1.properties['獎勵'].title[0].plain_text, r1.properties['扣除積分'].number, r1.properties['日期'].date.start], ['看電視 30 分鐘', 40, '2026-11-21']);
eq('L5 文件記下 Notion 頁面 ID', !!(await store.getDoc('redemptions', 'rq1')).page, true);
s = await run(REDEEM_AT + 120000);
eq('L6 再執行：不重複建立、沒有變動', [s.redeemCreated, s.redeemUpdated, redRows().length], [0, 0, 2]);

pages.get(r1.id).properties['狀態'] = { select: { name: '已批准' } };
pages.get(r1.id).properties['備註'] = { rich_text: rt('週末可以看') };
const r2 = redRows().find((p) => p.properties['孩子'].select.name === '兒子');
pages.get(r2.id).properties['狀態'] = { select: { name: '已拒絕' } };
s = await run(REDEEM_AT + 180000);
const a1 = await store.getDoc('redemptions', 'rq1'), a2 = await store.getDoc('redemptions', 'rq2');
eq('L7 爸爸批准 → approved 並帶回備註', [a1.status, a1.note, s.redeemUpdated], ['approved', '週末可以看', 2]);
eq('L8 爸爸拒絕 → rejected', a2.status, 'rejected');
s = await run(REDEEM_AT + 240000);
eq('L9 已批准、已拒絕之後不再被追蹤', [s.redeemCreated, s.redeemUpdated], [0, 0]);

await store.setDoc('redemptions', 'rq3', { student: 'daughter', rewardId: tvDoc.id, name: '看電視 30 分鐘', icon: '📺', cost: 40, status: 'pending', date: '2026-11-21', requestedAt: REDEEM_AT, note: '', page: null }, { merge: false });
await run(REDEEM_AT + 300000);
pages.delete(redRows().find((p) => p.properties['日期'] && !['rq1', 'rq2'].includes(p.properties['Key']?.rich_text?.[0]?.plain_text)).id);
s = await run(REDEEM_AT + 360000);
const a3 = await store.getDoc('redemptions', 'rq3');
eq('L10 爸爸把申請列整個刪掉 → 視為拒絕', [a3.status, a3.note], ['rejected', '這筆申請已被爸爸刪除']);

pages.delete([...pages.values()].find((p) => p.db === DB.rewards && p.properties['名稱'].title[0].plain_text === '玩遊戲 30 分鐘').id);
await run(REDEEM_AT + 420000);
eq('L11 獎勵在 Notion 刪除後，網站端也移除', (await store.listIds('rewards')).length, 1);

// 日誌不洩漏內容：整合測試只確認回傳是數字摘要
eq('K 同步摘要只有數字', Object.values(s).every((v) => typeof v === 'number'), true);

server.close();
export const failures = () => fail;
if (process.argv[1] && process.argv[1].endsWith('daily-run.test.mjs')) process.exit(fail ? 1 : 0);
