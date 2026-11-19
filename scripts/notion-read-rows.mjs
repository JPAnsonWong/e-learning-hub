// 唯讀：只讀指定資料庫的「指定欄位」，列印成表格（只在本機終端機輸出，不寫入、不上傳）。
// 用法：node scripts/notion-read-rows.mjs "<資料庫標題>" "<欄位1,欄位2,...>" [頁面ID或網址 ...]
//   例：node scripts/notion-read-rows.mjs "Routine Items" "Title,Person,Category,Frequency,Points,Active"
// 頁面 ID 預設用 .env.local 的 NOTION_DAILY_PARENT_ID；可額外附上其他上層頁面。
// 安全：只讀你列出的欄位；關聯欄位只解析被關聯頁面的「標題」。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNotion, loadEnvLocal, pageIdFrom } from './lib/notion.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvLocal(root);
const [dbTitle, colArg, ...extraPages] = process.argv.slice(2);
if (!dbTitle || !colArg) { console.error('用法：node scripts/notion-read-rows.mjs "<資料庫標題>" "<欄位1,欄位2,...>" [頁面ID ...]'); process.exit(1); }
const cols = colArg.split(',').map((s) => s.trim()).filter(Boolean);
const parents = [process.env.NOTION_DAILY_PARENT_ID, ...extraPages].map(pageIdFrom).filter(Boolean);
const notion = createNotion({ token: process.env.NOTION_TOKEN });

const plain = (arr) => (arr || []).map((t) => t.plain_text).join('');
const titleCache = new Map();
async function pageTitle(id) {
  if (titleCache.has(id)) return titleCache.get(id);
  let t = id.slice(0, 8);
  try {
    const p = await notion.call('GET', `/pages/${id}`);
    const tp = Object.values(p.properties).find((x) => x.type === 'title');
    if (tp) t = plain(tp.title);
  } catch { /* 沒權限就顯示 ID 前綴 */ }
  titleCache.set(id, t);
  return t;
}
async function show(p) {
  switch (p?.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select?.name ?? '';
    case 'multi_select': return p.multi_select.map((x) => x.name).join('／');
    case 'status': return p.status?.name ?? '';
    case 'number': return p.number ?? '';
    case 'checkbox': return p.checkbox ? '✓' : '';
    case 'date': return p.date?.start ?? '';
    case 'relation': return (await Promise.all(p.relation.map((r) => pageTitle(r.id)))).join('／');
    default: return `(${p?.type ?? '無此欄位'})`;
  }
}

try {
  let db = null;
  for (const pid of parents) {
    db = (await notion.findDatabases(pid, 3)).find((d) => d.title === dbTitle);
    if (db) break;
  }
  if (!db) { console.error(`找不到資料庫「${dbTitle}」。請確認已分享給連線，或附上它所在的上層頁面。`); process.exit(1); }

  const rows = [];
  let cursor;
  do {
    const r = await notion.call('POST', `/databases/${db.id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const page of r.results) {
      const row = {};
      for (const c of cols) row[c] = await show(page.properties[c]);
      rows.push(row);
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);

  console.log(`資料庫「${dbTitle}」，共 ${rows.length} 列；只顯示欄位：${cols.join('、')}\n`);
  console.log(cols.join(' | '));
  for (const row of rows) console.log(cols.map((c) => String(row[c])).join(' | '));
} catch (e) {
  console.error('讀取失敗：' + e.message);
  process.exit(1);
}
