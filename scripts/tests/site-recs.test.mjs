// 網站「推薦學習」邏輯測試：只列爸爸推薦的、最近學習的排最前面、沒學過的依日期新到舊。執行：node scripts/tests/site-recs.test.mjs
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

let fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); };
const src = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

function boot(progress) {
  const store = { 'elh.progress.v1': JSON.stringify(progress || {}) };
  const ctx = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, fetch() {}, document: {}, Date, JSON, console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(src('assets/js/points.js'), ctx);
  vm.runInContext(src('assets/js/common.js') + '\nthis.ELH = ELH;', ctx);
  return ctx.ELH;
}
const item = (id, student, date) => ({ id, student, date });
const d = {
  students: [{ id: 'daughter' }, { id: 'son' }],
  items: [item('a', 'daughter', '2026-11-10'), item('b', 'daughter', '2026-11-12'), item('c', 'daughter', '2026-11-14'), item('d', 'daughter', '2026-11-01'), item('e', 'son', '2026-11-13'), item('f', 'son', '2026-11-11')],
};
const E = boot({ daughter: { items: { a: { last: 1000 }, c: { last: 3000 }, d: { last: 2000 } } }, son: { items: { f: { last: 5000 } } } });

eq('沒有推薦時是空的', E.recommended(d, 'daughter'), []);
E.setRecs('daughter', ['a', 'b', 'c', 'd']);
E.setRecs('son', ['e', 'f']);
eq('最近學習的排最前面（c 3000、d 2000、a 1000），沒學過的 b 排最後', E.recommended(d, 'daughter').map((i) => i.id), ['c', 'd', 'a', 'b']);
eq('另一位孩子只看到自己的', E.recommended(d, 'son').map((i) => i.id), ['f', 'e']);
eq('數量上限', E.recommended(d, 'daughter', 2).map((i) => i.id), ['c', 'd']);
eq('首頁合併兩位孩子：最近學習的排最前面，沒學過的依日期新到舊（e 11-13 在 b 11-12 之前）', E.recommendedAll(d).map((i) => i.id), ['f', 'c', 'd', 'a', 'e', 'b']);
E.setRecs('daughter', ['b', 'x-不存在的教材']);
eq('推薦清單裡有不存在（已下架）的教材：直接略過', E.recommended(d, 'daughter').map((i) => i.id), ['b']);
const E2 = boot({});
E2.setRecs('daughter', ['a', 'b', 'c']);
eq('全部都沒學過：依教材日期新到舊（c、b、a）', E2.recommended(d, 'daughter').map((i) => i.id), ['c', 'b', 'a']);
eq('清單不是陣列時安全處理', (E2.setRecs('daughter', null), E2.recommended(d, 'daughter')), []);
process.exit(fail ? 1 : 0);
