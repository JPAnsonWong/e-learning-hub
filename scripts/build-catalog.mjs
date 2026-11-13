// 掃描 content/*/meta.json，驗證並生成 catalog.json。
// 用法：node scripts/build-catalog.mjs [--check]（--check 只驗證不寫檔）
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const checkOnly = process.argv.includes('--check');

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const students = readJson('config/students.json').students;
const stages = readJson('config/stages.json').stages;
const typesCfg = readJson('config/types.json');
const studentMap = new Map(students.map((s) => [s.id, s]));
const stageIds = new Set(stages.map((s) => s.id));
const typeIds = new Set(typesCfg.types.map((t) => t.id));
const tagIds = new Set(typesCfg.tags.map((t) => t.id));

const REQUIRED = ['id', 'student', 'subject', 'stage', 'type', 'title', 'date', 'version'];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const items = [];
const seen = new Set();
const contentDir = join(root, 'content');
for (const dir of readdirSync(contentDir)) {
  const full = join(contentDir, dir);
  if (!statSync(full).isDirectory()) continue;
  const where = `content/${dir}`;
  const metaPath = join(full, 'meta.json');
  if (!existsSync(metaPath)) { err(where, '缺少 meta.json'); continue; }
  if (!existsSync(join(full, 'index.html'))) err(where, '缺少 index.html');
  let m;
  try { m = JSON.parse(readFileSync(metaPath, 'utf8')); }
  catch (e) { err(where, `meta.json 不是有效 JSON：${e.message}`); continue; }

  for (const k of REQUIRED) if (m[k] === undefined || m[k] === '') err(where, `缺少必填欄位 ${k}`);
  if (m.id !== undefined) {
    if (m.id !== dir) err(where, `id "${m.id}" 必須與資料夾名稱 "${dir}" 相同`);
    if (!ID_RE.test(m.id)) err(where, `id "${m.id}" 只能用小寫英文、數字和連字號`);
    if (seen.has(m.id)) err(where, `id "${m.id}" 重複`);
    seen.add(m.id);
  }
  const st = studentMap.get(m.student);
  if (m.student && !st) err(where, `student "${m.student}" 不在 config/students.json`);
  if (st && m.subject && !st.subjects.some((s) => s.id === m.subject))
    err(where, `subject "${m.subject}" 不屬於學生 "${m.student}"`);
  if (m.stage && !stageIds.has(m.stage)) err(where, `stage "${m.stage}" 不在 config/stages.json`);
  if (m.type && !typeIds.has(m.type)) err(where, `type "${m.type}" 不在 config/types.json`);
  if (m.date && !DATE_RE.test(m.date)) err(where, `date "${m.date}" 格式必須是 YYYY-MM-DD`);
  if (m.tags !== undefined) {
    if (!Array.isArray(m.tags)) err(where, 'tags 必須是陣列');
    else for (const t of m.tags) if (!tagIds.has(t)) err(where, `tag "${t}" 不在 config/types.json 的 tags`);
  }
  if (m.difficulty !== undefined && ![1, 2, 3].includes(m.difficulty)) err(where, 'difficulty 必須是 1、2 或 3');
  if (m.minutes !== undefined && !(Number.isFinite(m.minutes) && m.minutes > 0)) err(where, 'minutes 必須是正數');
  if (!Number.isInteger(m.version) || m.version < 1) err(where, 'version 必須是正整數');

  items.push({ ...m, tags: m.tags ?? [], path: `content/${dir}/index.html` });
}

if (errors.length) {
  console.error(`驗證失敗，共 ${errors.length} 個問題：`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}

items.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
if (!checkOnly) {
  writeFileSync(join(root, 'catalog.json'), JSON.stringify({ generated: new Date().toISOString(), items }, null, 2));
}
console.log(`OK：${items.length} 份教材${checkOnly ? '（僅驗證）' : '，已生成 catalog.json'}`);
