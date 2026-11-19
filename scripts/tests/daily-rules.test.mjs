// 每日打卡規則與合併邏輯的單元測試（純函式，不需要網絡）。執行：node scripts/tests/daily-rules.test.mjs
import { hkDate, addDays, mondayOf, lastEligible, effectiveDate, planGeneration, mergeRow, quickIds, confirmedBetween, keyFor, docIdFor, rules } from '../lib/daily-sync.mjs';

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
};
const HK = (s) => Date.parse(s + '+08:00'); // 例：HK('2026-11-20T08:00:00') → 香港時間

// ---------- 日期與確認時間 ----------
eq('hkDate 跨日（UTC 16:30 = 香港隔天 00:30）', hkDate(Date.parse('2026-11-19T16:30:00Z')), '2026-11-20');
eq('mondayOf（週五 → 週一）', mondayOf('2026-11-20'), '2026-11-16');
eq('mondayOf（週日 → 本週一）', mondayOf('2026-11-22'), '2026-11-16');
eq('mondayOf（週一）', mondayOf('2026-11-16'), '2026-11-16');
eq('addDays 跨月', addDays('2026-11-30', 2), '2026-12-02');
eq('次日 11:59 還不能確認前一天', lastEligible(HK('2026-11-21T11:59:00')), '2026-11-19');
eq('次日 12:00 可確認前一天', lastEligible(HK('2026-11-21T12:00:00')), '2026-11-20');
eq('當天晚上 23:59 還不能確認當天（只確認到前一天）', lastEligible(HK('2026-11-20T23:59:00')), '2026-11-19');
eq('週任務的確認日 = 該週日', effectiveDate({ cat: 'week', date: '2026-11-16' }), '2026-11-22');
eq('日任務的確認日 = 當天', effectiveDate({ cat: 'habit', date: '2026-11-20' }), '2026-11-20');
eq('週任務在下週一 11:59 未確認', rules.isFinalized({ cat: 'week', date: '2026-11-16' }, HK('2026-11-23T11:59:00')), false);
eq('週任務在下週一 12:00 確認', rules.isFinalized({ cat: 'week', date: '2026-11-16' }, HK('2026-11-23T12:00:00')), true);

// ---------- 計入積分的條件 ----------
eq('已打卡有分數 → 計入', rules.countsForPoints({ done: true, points: 2 }), true);
eq('分數為 0 也算有分數（0 分）', rules.rowPoints({ done: true, points: 0 }), 0);
eq('沒分數（待評分）不計', rules.countsForPoints({ done: true, points: null }), false);
eq('爸爸取消不計', rules.countsForPoints({ done: true, points: 2, fix: 'untick' }), false);
eq('沒打卡不計', rules.countsForPoints({ done: false, points: 2 }), false);

// ---------- 生成規則 ----------
const routine = [
  { id: 'aaaaaaaa-1', title: '學校功課', persons: ['兒子'], category: '學習任務', frequency: 'Daily', points: 1, active: true, weekdays: [], optional: false },
  { id: 'aaaaaaaa-2', title: '學校功課', persons: ['女兒'], category: '學習任務', frequency: 'Daily', points: 1, active: true, weekdays: [], optional: false },
  { id: 'aaaaaaaa-3', title: '練琴', persons: ['女兒', '兒子'], category: '日常習慣', frequency: 'Daily', points: 2, active: true, weekdays: [], optional: false },
  { id: 'aaaaaaaa-4', title: '補習功課（若有）', persons: ['兒子'], category: '學習任務', frequency: 'Daily', points: 1, active: true, weekdays: ['週一', '週三'], optional: true },
  { id: 'aaaaaaaa-5', title: '每周閱讀', persons: ['女兒'], category: '每周任務', frequency: 'Weekly', points: 3, active: true, weekdays: [], optional: false },
  { id: 'aaaaaaaa-6', title: '交費', persons: ['爸爸'], category: '每周任務', frequency: 'Weekly', points: 1, active: true, weekdays: [], optional: false },
  { id: 'aaaaaaaa-7', title: '停用', persons: ['女兒'], category: '日常習慣', frequency: 'Daily', points: 1, active: false, weekdays: [], optional: false },
  { id: 'aaaaaaaa-8', title: '待評分任務', persons: ['兒子'], category: '日常習慣', frequency: 'Daily', points: null, active: true, weekdays: [], optional: false },
];
const fri = planGeneration({ routine, today: '2026-11-20' });
eq('週五：每日任務 5 列（補習只在週一三、停用與家長任務不生成）', fri.daily.map((r) => `${r.student}:${r.title}`).sort(), ['daughter:學校功課', 'daughter:練琴', 'son:學校功課', 'son:待評分任務', 'son:練琴']);
eq('週五：每周任務 1 列，日期是本週一', fri.weekly.map((r) => [r.student, r.date]), [['daughter', '2026-11-16']]);
eq('「女兒／兒子」兩人都生成', fri.daily.filter((r) => r.title === '練琴').map((r) => r.student).sort(), ['daughter', 'son']);
eq('沒分數的任務保持 null（待評分）', fri.daily.find((r) => r.title === '待評分任務').points, null);
const mon = planGeneration({ routine, today: '2026-11-16' });
eq('週一：補習功課出現且標為選填', mon.daily.filter((r) => r.title.startsWith('補習')).map((r) => [r.student, r.optional]), [['son', true]]);
eq('Key 用完整範本 ID（截短會撞在一起）', keyFor('2026-11-20', 'son', 'aaaaaaaa-1'), '2026-11-20|son|aaaaaaaa1');
eq('前綴相同的兩個範本 ID 產生不同的文件 ID', docIdFor(keyFor('2026-11-20', 'son', '3cf4d146aaaa')) !== docIdFor(keyFor('2026-11-20', 'son', '3cf4d146bbbb')), true);
eq('docId 為 20 位十六進位', /^[0-9a-f]{20}$/.test(docIdFor('x')), true);

// ---------- 合併規則 ----------
const n0 = { page: 'p1', key: 'k1', date: '2026-11-20', student: 'son', title: '學校功課', catName: '學習任務', optional: false, points: 1, note: '', order: 3, checked: false, checkedAt: null };
const NOW = HK('2026-11-20T09:00:00');
let r = mergeRow(n0, null, NOW);
eq('新文件：未打卡，basePoints 記下原始分數', [r.create.done, r.create.basePoints, r.create.notionDone, r.create.cat], [false, 1, false, 'learn']);
eq('新文件：爸爸直接在 Notion 勾選', mergeRow({ ...n0, checked: true, checkedAt: 1000 }, null, NOW).create.doneAt, 1000);

const f0 = { ...r.create, id: 'x' };
eq('完全一致：不需要任何動作', mergeRow(n0, f0, NOW), { update: null, notionPatch: null });

// 孩子在網站打卡（Notion 沒變）→ 推送到 Notion
r = mergeRow(n0, { ...f0, done: true, doneAt: 5000 }, NOW);
eq('網站打卡 → 推送到 Notion', [r.notionPatch, r.update?.notionDone], [{ checked: true, checkedAt: 5000 }, true]);
// 已同步後，孩子在網站取消 → 推送取消
r = mergeRow({ ...n0, checked: true, checkedAt: 5000 }, { ...f0, done: false, doneAt: null, notionDone: true }, NOW);
eq('網站取消打卡 → 推送取消', r.notionPatch, { checked: false, checkedAt: null });
// 爸爸在 Notion 取消（網站原本打了卡且已同步過）→ 以 Notion 為準並標記 fix
r = mergeRow({ ...n0, checked: false }, { ...f0, done: true, doneAt: 5000, notionDone: true }, NOW);
eq('爸爸取消 → 網站 done=false 並標記 untick', [r.update.done, r.update.fix, r.update.doneAt, r.notionPatch], [false, 'untick', null, null]);
// 爸爸又勾回去 → 清除 fix
r = mergeRow({ ...n0, checked: true, checkedAt: 7000 }, { ...f0, done: false, notionDone: false, fix: 'untick' }, NOW);
eq('爸爸重新勾選 → done=true 並清除 fix', [r.update.done, r.update.fix, r.update.doneAt], [true, null, 7000]);
// 爸爸代孩子勾選
r = mergeRow({ ...n0, checked: true, checkedAt: 9000 }, { ...f0, done: false, notionDone: false }, NOW);
eq('爸爸在 Notion 代勾選', [r.update.done, r.update.doneAt], [true, 9000]);
// 積分只由 Notion 決定
r = mergeRow({ ...n0, points: 0, note: '只做一半' }, f0, NOW);
eq('爸爸改積分與備註 → 更新到網站，basePoints 不變', [r.update.points, r.update.note, 'basePoints' in r.update], [0, '只做一半', false]);
// 取消 fix 狀態下雙方都沒變 → 保持
eq('fix 狀態雙方都沒變 → 不動', mergeRow({ ...n0, checked: false }, { ...f0, done: false, notionDone: false, fix: 'untick' }, NOW), { update: null, notionPatch: null });

// ---------- 快速打卡 ----------
const mk = (id, student, t) => ({ id, student, done: true, doneAt: t });
const five = [0, 3000, 6000, 9000, 12000].map((t, i) => mk('a' + i, 'son', 1e6 + t));
eq('30 秒內連續 5 項 → 全部標記', [...quickIds(five)].sort(), ['a0', 'a1', 'a2', 'a3', 'a4']);
eq('只有 4 項 → 不標記', quickIds(five.slice(0, 4)).size, 0);
eq('分散在 5 分鐘內 → 不標記', quickIds([0, 60e3, 120e3, 180e3, 240e3].map((t, i) => mk('b' + i, 'son', 1e6 + t))).size, 0);
eq('兩位孩子各 3 項（共 6 項）→ 不標記', quickIds([...[0, 1000, 2000].map((t, i) => mk('c' + i, 'son', 1e6 + t)), ...[0, 1000, 2000].map((t, i) => mk('d' + i, 'daughter', 1e6 + t))]).size, 0);

// ---------- 確認積分加總 ----------
const rows = [
  { cat: 'habit', date: '2026-11-19', done: true, points: 2 },
  { cat: 'habit', date: '2026-11-19', done: true, points: null },            // 待評分：不計
  { cat: 'learn', date: '2026-11-20', done: true, points: 3 },
  { cat: 'learn', date: '2026-11-20', done: true, points: 1, fix: 'untick' }, // 被取消：不計
  { cat: 'week', date: '2026-11-16', done: true, points: 5 },                 // 確認日 11-22
];
eq('11-21 中午後：只確認 11-19 與 11-20 的日任務', confirmedBetween(rows, '2026-11-18', HK('2026-11-21T12:00:00')), { sum: 5, upTo: '2026-11-20' });
eq('週任務在下週一中午後才確認', confirmedBetween(rows, '2026-11-20', HK('2026-11-23T12:00:00')), { sum: 5, upTo: '2026-11-22' });
eq('沒有新的可確認日期 → 不變', confirmedBetween(rows, '2026-11-20', HK('2026-11-21T12:00:00')), { sum: 0, upTo: '2026-11-20' });

// ---------- 網站摘要 ----------
const sumRows = [
  { cat: 'habit', date: '2026-11-19', done: true, points: 2 },          // 昨日
  { cat: 'habit', date: '2026-11-20', done: true, points: 1, optional: false },
  { cat: 'learn', date: '2026-11-20', done: false, points: 1, optional: false },
  { cat: 'learn', date: '2026-11-20', done: false, points: 1, optional: true },
  { cat: 'habit', date: '2026-11-20', done: true, points: null },
];
const sm = rules.summarize(sumRows, '2026-11-20', HK('2026-11-20T10:00:00'));
eq('摘要：昨日 +2（還沒到次日中午，未確認）', [sm.yesterday, sm.yesterdayConfirmed], [2, false]);
eq('摘要：待確認 = 今日 +1（昨日已在確認前也算待確認）', sm.pending, 3);
eq('摘要：待評分 1 項', sm.pendingUnscored, 1);
eq('摘要：今日必做還剩 1 項（選填不算）', sm.todayRequiredLeft, 1);
eq('摘要：今天 11:59 昨日還沒確認', rules.summarize(sumRows, '2026-11-20', HK('2026-11-20T11:59:00')).yesterdayConfirmed, false);
eq('摘要：今天 12:00 昨日已確認', rules.summarize(sumRows, '2026-11-20', HK('2026-11-20T12:00:00')).yesterdayConfirmed, true);

// ---------- 獎勵兌換 ----------
const reds = [
  { rewardId: 'tv', status: 'approved', cost: 40, date: '2026-11-16' },   // 本週一，已批准
  { rewardId: 'tv', status: 'pending', cost: 40, date: '2026-11-20' },    // 本週，申請中（先凍結）
  { rewardId: 'tv', status: 'rejected', cost: 40, date: '2026-11-21' },   // 已拒絕：退回，不佔用
  { rewardId: 'tv', status: 'approved', cost: 40, date: '2026-11-15' },   // 上週日：不算本週
  { rewardId: 'game', status: 'pending', cost: 60, date: '2026-11-20' },
];
eq('凍結與已兌換：申請中和已批准都佔用，已拒絕退回', rules.holdOf(reds), 40 + 40 + 40 + 60);
eq('每週用量：本週（週一到週日）申請中和已批准都算，拒絕和上週不算', rules.weekUsed(reds, 'tv', '2026-11-21'), 2);
eq('每週用量：週日 11-22 仍屬同一週', rules.weekUsed(reds, 'tv', '2026-11-22'), 2);
eq('每週用量：下週一重新計算', rules.weekUsed(reds, 'tv', '2026-11-23'), 0);
eq('可申請', rules.redeemCheck({ cost: 40, limit: 3 }, 100, 2), { ok: true });
eq('本週已達上限', rules.redeemCheck({ cost: 40, limit: 2 }, 100, 2), { ok: false, reason: 'limit' });
eq('積分不足（顯示還差多少）', rules.redeemCheck({ cost: 150, limit: null }, 100, 0), { ok: false, reason: 'points', need: 50 });
eq('沒有每週上限的獎勵不受限制', rules.redeemCheck({ cost: 40, limit: null }, 100, 99), { ok: true });

export const failures = () => fail;
if (process.argv[1] && process.argv[1].endsWith('daily-rules.test.mjs')) process.exit(fail ? 1 : 0);
