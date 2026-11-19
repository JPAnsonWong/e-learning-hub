// 唯讀檢查：列出 Notion 頁面底下的資料庫，以及每個資料庫的欄位名稱與類型。
// 不讀任何資料列、不印任何欄位的選項值、不印 token。只在本機終端機輸出（倉庫是公開的，不要在 GitHub Actions 裡跑）。
// 用法：node scripts/notion-inspect.mjs
// 需要：專案根目錄的 .env.local（已被 .gitignore 忽略）裡有
//   NOTION_TOKEN=...            Notion 整合的 Internal Integration Secret
//   NOTION_DAILY_PARENT_ID=...  舊 TaskReminder 的上層頁面（網址或 32 位 ID）
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNotion, loadEnvLocal, pageIdFrom } from './lib/notion.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvLocal(root);
const parent = pageIdFrom(process.env.NOTION_DAILY_PARENT_ID);
if (!parent) { console.error('缺少 NOTION_DAILY_PARENT_ID（頁面網址或 32 位 ID），請放在 .env.local'); process.exit(1); }
const notion = createNotion({ token: process.env.NOTION_TOKEN });

try {
  const dbs = await notion.findDatabases(parent, 2);
  if (!dbs.length) {
    console.log('在這個頁面底下沒有找到任何資料庫。請確認已把頁面分享給整合（頁面右上 ⋯ → 連線 → 加入），或上層頁面 ID 是否正確。');
  }
  for (const d of dbs) {
    const info = await notion.call('GET', `/databases/${d.id}`);
    const where = d.path.length ? `（在子頁面：${d.path.join(' / ')}）` : '';
    console.log(`\n資料庫：${d.title}${where}`);
    for (const [name, p] of Object.entries(info.properties)) console.log(`  - ${name}  [${p.type}]`);
  }
  console.log('\n（只列出欄位名稱與類型，沒有讀取任何資料列。）');
} catch (e) {
  console.error('檢查失敗：' + e.message);
  if (e.status === 404 || e.status === 403) console.error('常見原因：整合沒有被分享到這個頁面。');
  process.exit(1);
}
