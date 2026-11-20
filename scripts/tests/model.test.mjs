// Notion 彙整資料列的模型測試：教材進度為每份教材一列；「推薦」由爸爸手動勾選，同步不會寫入。執行：node scripts/tests/model.test.mjs
import { readFileSync } from 'node:fs';
import { buildModel, SCHEMAS } from '../lib/model.mjs';

let fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); };
const root = new URL('../../', import.meta.url);
const j = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const cfg = j('config/points.json');
const base = { students: j('config/students.json').students, stages: j('config/stages.json').stages, types: j('config/types.json').types, pointsCfg: cfg, now: Date.parse(cfg.cutover) + 3600e3 };
const catalog = [
  { id: 'mat-a', student: 'daughter', subject: 'math', stage: 'g3-3d-exam1', type: 'practice', title: '教材 A', date: '2026-11-15' },
  { id: 'mat-b', student: 'son', subject: 'math', stage: 'g3-3d-exam1', type: 'practice', title: '教材 B', date: '2026-11-15' },
  { id: 'mat-c', student: 'daughter', subject: 'math', stage: 'g3-3d-exam1', type: 'quiz', title: '教材 C', date: '2026-11-16' },
];
const m = buildModel({ ...base, catalog, materials: [], sessions: [] });
eq('完全沒有學習記錄時，每份教材也有一列（爸爸才能勾「推薦」）', m.materials.map((r) => r.key).sort(), ['daughter|mat-a', 'daughter|mat-c', 'son|mat-b']);
eq('沒學過的教材：完成次數 0、學習場次 0', [m.materials[0].props.完成次數.number, m.materials[0].props.學習場次.number], [0, 0]);
eq('教材資訊（科目、階段）正確帶入', [m.materials.find((r) => r.key === 'son|mat-b').props.科目.select.name, m.materials.find((r) => r.key === 'son|mat-b').props.階段.select.name], ['數學', '三年級 3D第一次考試']);
eq('同步寫入的欄位不含「推薦」（不會覆蓋爸爸勾選的）', m.materials.every((r) => !('推薦' in r.props)), true);
eq('資料庫結構有「推薦」勾選欄位', SCHEMAS.materials.props.推薦, { checkbox: {} });
const m2 = buildModel({ ...base, catalog, materials: [{ sid: 'daughter', mid: 'mat-a', data: { last: 5, completions: [], review: true } }], sessions: [] });
eq('有學習記錄的教材不會重複出現', m2.materials.length, 3);
eq('待複習照常同步', m2.materials.find((r) => r.key === 'daughter|mat-a').props.待複習.checkbox, true);
process.exit(fail ? 1 : 0);
