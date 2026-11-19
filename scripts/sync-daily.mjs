// 每日打卡同步（Notion ⇄ Firestore）。由 GitHub Actions 每 15 分鐘執行；也可手動執行。
// 環境變數：FIREBASE_SERVICE_ACCOUNT（服務帳號 JSON）、NOTION_TOKEN、NOTION_DAILY_PARENT_ID（放「每日任務」等資料庫的上層頁面）
// 日誌只印數量，不印任務標題、孩子名字或任何 Notion 內容（倉庫公開，Actions 日誌也是公開的）。
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createNotion, pageIdFrom } from './lib/notion.mjs';
import { runDailySync } from './lib/daily-run.mjs';

const { FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN, NOTION_DAILY_PARENT_ID } = process.env;
for (const [k, v] of Object.entries({ FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN, NOTION_DAILY_PARENT_ID })) {
  if (!v) { console.error(`缺少環境變數 ${k}`); process.exit(1); }
}
initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const DRY = process.env.DRY_RUN === 'true'; // 演練模式：只讀取，所有寫入（Notion 和 Firestore）都略過，只印數量

const realStore = {
  async getDoc(col, id) { const s = await db.collection(col).doc(id).get(); return s.exists ? s.data() : null; },
  async setDoc(col, id, data, { merge = true } = {}) { await db.collection(col).doc(id).set(data, { merge }); },
  async deleteDoc(col, id) { await db.collection(col).doc(id).delete(); },
  async listWhere(col, field, value) { return (await db.collection(col).where(field, '==', value).get()).docs.map((d) => ({ id: d.id, ...d.data() })); },
  async listIds(col) { return (await db.collection(col).select().get()).docs.map((d) => d.id); },
  async listByDates(col, dates) {
    const out = [];
    for (let i = 0; i < dates.length; i += 10) {
      const s = await db.collection(col).where('date', 'in', dates.slice(i, i + 10)).get();
      s.forEach((d) => out.push({ id: d.id, ...d.data() }));
    }
    return out;
  },
  ts: () => FieldValue.serverTimestamp(),
};

// 演練模式：寫入全部略過（讀取照常）
const store = DRY ? { ...realStore, async setDoc() {}, async deleteDoc() {} } : realStore;

try {
  let notion = createNotion({ token: NOTION_TOKEN });
  if (DRY) {
    const real = notion;
    notion = { ...real, call: (method, path, body) => (method === 'PATCH' || (method === 'POST' && path === '/pages') ? Promise.resolve({ id: 'dry-run' }) : real.call(method, path, body)) };
    console.log('【演練模式】只讀取，不會寫入 Notion 或 Firestore。');
  }
  const s = await runDailySync({ notion, store, parentId: pageIdFrom(NOTION_DAILY_PARENT_ID), log: console.log, purgeOrphans: process.env.PURGE_ORPHANS === 'true' });
  console.log(`完成：新生成 ${s.generated} 列、新同步 ${s.created} 筆、更新 ${s.updated} 筆、推送打卡到 Notion ${s.pushed} 筆、標記快速打卡 ${s.flagged} 筆、移除多餘文件 ${s.removed} 筆、倒數日變動 ${s.countdowns} 筆、獎勵清單變動 ${s.rewards} 筆、兌換申請新建 ${s.redeemCreated} 筆、兌換狀態更新 ${s.redeemUpdated} 筆、積分總表更新 ${s.totalsChanged} 筆`);
} catch (e) {
  console.error('同步失敗：' + e.message);
  process.exit(1);
}
