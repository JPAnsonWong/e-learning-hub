// 把 Firestore 的學習記錄同步到 Notion（由 GitHub Actions 每半天執行；也可手動執行）
// 需要環境變數：FIREBASE_SERVICE_ACCOUNT（服務帳號 JSON）、NOTION_TOKEN、NOTION_PARENT_PAGE_ID
// 用法：先執行 node scripts/build-catalog.mjs 產生 catalog.json，再執行 node scripts/sync-notion.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { buildModel, SCHEMAS } from './lib/model.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const { FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN, NOTION_PARENT_PAGE_ID } = process.env;
for (const [k, v] of Object.entries({ FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN, NOTION_PARENT_PAGE_ID })) {
  if (!v) { console.error(`缺少環境變數 ${k}`); process.exit(1); }
}
const PARENT = NOTION_PARENT_PAGE_ID.replace(/-/g, '');

// ---- Notion REST（含限速與重試）----
let lastCall = 0;
async function notion(method, path, body, attempt = 0) {
  const wait = 350 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch('https://api.notion.com/v1' + path, {
    method,
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const ra = Number(res.headers.get('retry-after')) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, ra * 1000));
    return notion(method, path, body, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Notion ${method} ${path} → ${res.status} ${json.message || ''}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

// ---- Firebase Admin ----
initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const metaRef = db.doc('meta/notion');
const meta = (await metaRef.get()).data() || {};
meta.dbs ||= {};
meta.pages ||= {};
const hash = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex');

// ---- 沒有新活動就直接略過（每 30 分鐘執行一次，絕大多數時候只花 3 次 Firestore 讀取）----
const runStart = Timestamp.now();           // 用開始時間當作「上次同步」，同步期間新增的資料下一輪會再處理
const cfgStudents = readJson('config/students.json').students;
const force = process.env.FORCE === 'true';
async function plan() {
  const last = meta.lastSync, lastFull = meta.lastFull;
  if (force) return { go: true, full: true, why: '手動要求完整同步' };
  if (!last || !lastFull) return { go: true, full: true, why: '第一次同步' };
  if (Date.now() - lastFull.toMillis() > 12 * 3600e3) return { go: true, full: true, why: '距離上次完整同步超過 12 小時' };
  const qs = [db.collection('sessions').where('updatedAt', '>', last).limit(1)];
  for (const s of cfgStudents) qs.push(db.collection(`students/${s.id}/materials`).where('updatedAt', '>', last).limit(1));
  const rs = await Promise.all(qs.map((q) => q.get()));
  return rs.some((r) => !r.empty) ? { go: true, full: false, why: '有新的學習活動' } : { go: false };
}
const decision = await plan();
if (!decision.go) { console.log('沒有新活動，略過同步。'); process.exit(0); }
console.log('開始同步：' + decision.why);

// 舊資料庫補上新增的欄位（已存在的欄位不受影響）
async function migrate(id, schema) {
  const props = Object.fromEntries(Object.entries(schema.props).filter(([, v]) => !v.title));
  await notion('PATCH', `/databases/${id}`, { properties: props });
}
async function ensureDb(key) {
  const schema = SCHEMAS[key];
  if (meta.dbs[key]) {
    try { await notion('GET', `/databases/${meta.dbs[key]}`); await migrate(meta.dbs[key], schema); return meta.dbs[key]; }
    catch (e) { if (e.status !== 404 && e.status !== 400) throw e; }
  }
  let cursor;
  do { // 先看父頁面下有沒有同名資料庫
    const r = await notion('GET', `/blocks/${PARENT}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    const hit = r.results.find((b) => b.type === 'child_database' && b.child_database.title === schema.title);
    if (hit) { meta.dbs[key] = hit.id; await migrate(hit.id, schema); return hit.id; }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  const created = await notion('POST', '/databases', {
    parent: { type: 'page_id', page_id: PARENT },
    title: [{ type: 'text', text: { content: schema.title } }],
    properties: schema.props,
  });
  console.log(`已建立 Notion 資料庫：${schema.title}`);
  meta.dbs[key] = created.id;
  return created.id;
}

const stats = { created: 0, updated: 0, skipped: 0, archived: 0 };
// 新增或更新一列；回傳 {page, hash}。createOnly 只在新建時寫入（使用者自己勾選的欄位不會被覆蓋）
async function upsert(dbId, prev, key, props, createOnly = {}) {
  const h = hash(props);
  if (prev?.page && prev.hash === h) { stats.skipped++; return prev; }
  let page = prev?.page;
  if (!page) {
    const q = await notion('POST', `/databases/${dbId}/query`, { filter: { property: 'Key', rich_text: { equals: key } }, page_size: 1 });
    page = q.results[0]?.id;
  }
  if (page) {
    try { await notion('PATCH', `/pages/${page}`, { properties: props }); stats.updated++; return { page, hash: h }; }
    catch (e) { if (e.status !== 400 && e.status !== 404) throw e; /* 已被封存或刪除，重建 */ }
  }
  const c = await notion('POST', '/pages', { parent: { database_id: dbId }, properties: { ...props, ...createOnly } });
  stats.created++;
  return { page: c.id, hash: h };
}

// ---- 讀資料並同步 ----
const model = buildModel({
  students: cfgStudents,
  stages: readJson('config/stages.json').stages,
  types: readJson('config/types.json').types,
  catalog: readJson('catalog.json').items,
  pointsCfg: readJson('config/points.json'),
  materials: (await db.collectionGroup('materials').get()).docs.map((d) => ({ sid: d.ref.parent.parent.id, mid: d.id, data: d.data() })),
  sessions: (await db.collection('sessions').get()).docs.map((d) => ({ id: d.id, ...d.data() })),
});
console.log(`資料：${model.students.length} 位學生、${model.materials.length} 份教材進度、${model.sessions.length} 個作答場次`);

const ids = {
  students: await ensureDb('students'), materials: await ensureDb('materials'),
  sessions: await ensureDb('sessions'), wrong: await ensureDb('wrong'),
};
await metaRef.set({ dbs: meta.dbs, pages: meta.pages }, { merge: true }); // 先存資料庫 ID，避免中途失敗後重複建立

for (const r of model.students) meta.pages[`s:${r.key}`] = await upsert(ids.students, meta.pages[`s:${r.key}`], r.key, r.props);
for (const r of model.materials) meta.pages[`m:${r.key}`] = await upsert(ids.materials, meta.pages[`m:${r.key}`], r.key, r.props);

for (const s of model.sessions) {
  const ref = db.doc(`sessions/${s.id}`);
  const prev = (await ref.get()).data()?.notion || {};
  const row = await upsert(ids.sessions, prev, s.key, s.props);
  const wrongPages = { ...(prev.wrongPages || {}) };
  const live = new Set();
  for (const w of s.wrong) {
    live.add(String(w.q));
    wrongPages[w.q] = await upsert(ids.wrong, wrongPages[w.q], w.key, w.props, { 已跟進: { checkbox: false } });
  }
  for (const [q, p] of Object.entries(wrongPages)) { // 後來答對了的題目，移除對應的錯題列
    if (live.has(q) || !p?.page) continue;
    try { await notion('PATCH', `/pages/${p.page}`, { archived: true }); stats.archived++; } catch { /* 已不存在 */ }
    delete wrongPages[q];
  }
  await ref.update({ notion: { page: row.page, hash: row.hash, wrongPages } }); // 只寫 notion 欄位，不動 updatedAt
}

await metaRef.set({ dbs: meta.dbs, pages: meta.pages, lastSync: runStart, lastFull: decision.full ? runStart : meta.lastFull }, { merge: true });
console.log(`完成：新增 ${stats.created}、更新 ${stats.updated}、略過（無變化）${stats.skipped}、移除 ${stats.archived}`);
