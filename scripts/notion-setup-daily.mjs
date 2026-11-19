// 建立或補齊每日打卡需要的 Notion 資料庫與欄位。可重複執行，只新增、不刪除、不改動任何現有資料列。
// 用法：
//   node scripts/notion-setup-daily.mjs          預設只「預覽」將要做的事（dry-run），不寫入 Notion
//   node scripts/notion-setup-daily.mjs --apply  確認預覽內容後，真正建立
// 需要 .env.local：NOTION_TOKEN、NOTION_DAILY_PARENT_ID（見 notion-inspect.mjs）
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNotion, loadEnvLocal, pageIdFrom } from './lib/notion.mjs';
import { DAILY_SCHEMAS, ROUTINE_TITLE, ROUTINE_EXTRA, isTitleProp } from './lib/daily-schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvLocal(root);
const apply = process.argv.includes('--apply');
const parent = pageIdFrom(process.env.NOTION_DAILY_PARENT_ID);
if (!parent) { console.error('缺少 NOTION_DAILY_PARENT_ID（頁面網址或 32 位 ID），請放在 .env.local'); process.exit(1); }
const notion = createNotion({ token: process.env.NOTION_TOKEN });

const actions = [];
const log = (s) => { actions.push(s); console.log((apply ? '✔ ' : '• ') + s); };

try {
  console.log(apply ? '【正式執行】' : '【預覽模式：不會寫入 Notion，確認後加上 --apply 才會執行】');
  const existing = await notion.findDatabases(parent, 2);
  const byTitle = new Map(existing.map((d) => [d.title, d]));

  // 1) 新資料庫：不存在才建立；已存在就只補缺少的欄位
  for (const key of Object.keys(DAILY_SCHEMAS)) {
    const schema = DAILY_SCHEMAS[key];
    const found = byTitle.get(schema.title);
    if (!found) {
      log(`新建資料庫「${schema.title}」（${Object.keys(schema.props).length} 個欄位）`);
      if (apply) {
        await notion.call('POST', '/databases', {
          parent: { type: 'page_id', page_id: parent },
          title: [{ type: 'text', text: { content: schema.title } }],
          properties: schema.props,
        });
      }
      continue;
    }
    const info = await notion.call('GET', `/databases/${found.id}`);
    const missing = Object.fromEntries(Object.entries(schema.props).filter(([name, def]) => !(name in info.properties) && !isTitleProp(def)));
    if (Object.keys(missing).length) {
      log(`「${schema.title}」已存在，補上欄位：${Object.keys(missing).join('、')}`);
      if (apply) await notion.call('PATCH', `/databases/${found.id}`, { properties: missing });
    } else {
      console.log(`  「${schema.title}」已存在且欄位齊全，略過`);
    }
  }

  // 2) 既有 Routine Items：補「適用星期」
  const routine = byTitle.get(ROUTINE_TITLE);
  if (!routine) {
    console.log(`\n⚠ 找不到「${ROUTINE_TITLE}」資料庫，沒有補「適用星期」。請確認它在這個頁面底下，或告訴我它的位置。`);
  } else {
    const info = await notion.call('GET', `/databases/${routine.id}`);
    const missing = Object.fromEntries(Object.entries(ROUTINE_EXTRA).filter(([name]) => !(name in info.properties)));
    if (Object.keys(missing).length) {
      log(`「${ROUTINE_TITLE}」新增欄位：${Object.keys(missing).join('、')}（空白＝每天，不影響現有資料列）`);
      if (apply) await notion.call('PATCH', `/databases/${routine.id}`, { properties: missing });
    } else {
      console.log(`  「${ROUTINE_TITLE}」已有「適用星期」，略過`);
    }
  }

  console.log(actions.length ? `\n${apply ? '已完成' : '預覽完成，共將執行'} ${actions.length} 項。` : '\n沒有需要做的事，結構已經齊全。');
  if (apply && actions.length) {
    console.log('\n接下來請在 Notion 手動新增「檢視」（API 無法建立）：');
    console.log('  每日任務：「今日」（日期＝今天）、「本週」、「待評分」（打卡已勾選且積分為空）、「異常」（⚠ 連續快速打卡已勾選）');
    console.log('  重要日子：依日期排序，並篩掉「隱藏」');
  }
} catch (e) {
  console.error('失敗：' + e.message);
  if (e.status === 404 || e.status === 403) console.error('常見原因：整合沒有被分享到這個頁面。');
  process.exit(1);
}
