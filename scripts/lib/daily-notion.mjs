// Notion 讀寫（每日打卡專用）：把 Notion 的頁面屬性轉成程式用的物件，以及建立、更新每日任務列。
// 只讀寫每日打卡需要的資料庫與欄位；不讀 People 的「Goals」等自由文字欄位。
import { CHILD } from './daily-sync.mjs';

const plain = (a) => (a || []).map((t) => t.plain_text).join('');
const sel = (p) => p?.select?.name ?? '';
const num = (p) => (typeof p?.number === 'number' ? p.number : null);
const chk = (p) => !!p?.checkbox;
const rich = (p) => plain(p?.rich_text);
const titleOf = (p) => plain(p?.title);
const msel = (p) => (p?.multi_select || []).map((x) => x.name);
const dateStart = (p) => p?.date?.start ?? null;
export const compactId = (id) => String(id || '').replace(/-/g, '');

export async function queryAll(notion, dbId, body = {}) {
  const out = [];
  let cursor;
  do {
    const r = await notion.call('POST', `/databases/${dbId}/query`, { page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out;
}

// 在上層頁面底下找到需要的資料庫（用標題；「棄用」的舊資料庫標題不同，不會被選中）
export async function locate(notion, parentId) {
  const dbs = await notion.findDatabases(parentId, 3);
  const get = (title) => {
    const hit = dbs.find((d) => d.title === title);
    if (!hit) throw new Error(`找不到資料庫「${title}」，請確認已分享給連線並執行過 notion-setup-daily`);
    return hit.id;
  };
  return { daily: get('每日任務'), days: get('重要日子'), routine: get('Routine Items'), people: get('People') };
}

export async function readPeople(notion, dbId) {
  const pages = await queryAll(notion, dbId);
  const idToName = new Map(), totals = {};
  for (const p of pages) {
    const name = titleOf(p.properties.Name);
    idToName.set(compactId(p.id), name);
    if (CHILD[name]) totals[name] = num(p.properties['Total Points']) ?? 0;
  }
  return { idToName, totals };
}

export async function readRoutine(notion, dbId, idToName) {
  const pages = await queryAll(notion, dbId);
  return pages.map((p, order) => {
    const pr = p.properties;
    return {
      id: compactId(p.id), title: titleOf(pr.Title), order,
      persons: (pr.Person?.relation || []).map((r) => idToName.get(compactId(r.id))).filter(Boolean),
      category: sel(pr.Category), frequency: sel(pr.Frequency), points: num(pr.Points),
      active: chk(pr.Active), weekdays: msel(pr['適用星期']), optional: chk(pr['選填']),
    };
  });
}

export function toRow(p) {
  const pr = p.properties;
  const date = dateStart(pr['日期'])?.slice(0, 10);
  const student = CHILD[sel(pr['孩子'])];
  if (!date || !student) return null; // 缺日期或孩子的列沒辦法顯示，略過
  const at = dateStart(pr['打卡時間']);
  return {
    // 識別碼：日期＋孩子＋範本 Key（完整 ID）。爸爸手動新增的列沒有範本 Key，就用它自己的完整頁面 ID。不使用 Key 欄位（舊版本寫入的值可能被截短）
    page: p.id, key: `${date}|${student}|${rich(pr['範本 Key']) || 'm' + compactId(p.id)}`,
    date, student, title: titleOf(pr['任務']) || '（無標題）', catName: sel(pr['分類']) || '日常習慣', optional: chk(pr['選填']),
    points: num(pr['積分']), note: rich(pr['備註']), order: num(pr['排序']),
    checked: chk(pr['打卡']), checkedAt: at ? Date.parse(at) : null, quick: chk(pr['⚠ 連續快速打卡']),
  };
}

export async function readDailyRows(notion, dbId, dates) {
  if (!dates.length) return [];
  const filter = dates.length === 1 ? { property: '日期', date: { equals: dates[0] } } : { or: dates.map((d) => ({ property: '日期', date: { equals: d } })) };
  return (await queryAll(notion, dbId, { filter })).map(toRow).filter(Boolean);
}

const t = (s) => [{ text: { content: String(s).slice(0, 1900) } }];
export async function createDailyRow(notion, dbId, r) {
  return notion.call('POST', '/pages', {
    parent: { database_id: dbId },
    properties: {
      任務: { title: t(r.title) }, 日期: { date: { start: r.date } }, 孩子: { select: { name: r.childName } }, 分類: { select: { name: r.catName } },
      選填: { checkbox: !!r.optional }, 排序: { number: r.order }, '範本 Key': { rich_text: t(r.templateId) }, Key: { rich_text: t(r.key) },
      ...(r.points != null ? { 積分: { number: r.points } } : {}), // 沒有分數的任務留空＝待評分
    },
  });
}

export async function patchDailyRow(notion, page, { checked, checkedAt, quick }) {
  const properties = {};
  if (checked !== undefined) {
    properties['打卡'] = { checkbox: !!checked };
    properties['打卡時間'] = { date: checked && checkedAt ? { start: new Date(checkedAt).toISOString() } : null };
  }
  if (quick) properties['⚠ 連續快速打卡'] = { checkbox: true };
  return notion.call('PATCH', `/pages/${page}`, { properties });
}

// 倒數日：只回傳要顯示的（沒有被「隱藏」、有日期的）
export async function readCountdowns(notion, dbId) {
  const out = [];
  for (const p of await queryAll(notion, dbId)) {
    const pr = p.properties;
    const date = dateStart(pr['日期'])?.slice(0, 10);
    if (!date || chk(pr['隱藏'])) continue;
    const who = sel(pr['對象']);
    out.push({
      id: compactId(p.id),
      data: { title: titleOf(pr['事項']) || '（未命名）', date, note: rich(pr['說明']), type: sel(pr['類型']) || '其他',
        who: who === '女兒' ? ['daughter'] : who === '兒子' ? ['son'] : ['daughter', 'son'] },
    });
  }
  return out;
}
