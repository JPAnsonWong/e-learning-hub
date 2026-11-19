// 每日打卡同步的純邏輯（不做任何網絡或資料庫操作，方便測試）：生成當日任務、合併 Notion 與網站的狀態、標記快速打卡。
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const R = createRequire(import.meta.url)('../../assets/js/daily-rules.js');

export const { hkDate, addDays, mondayOf, weekdayIndex, WEEKDAY_NAMES, lastEligible, effectiveDate, countsForPoints, daysBetween } = R;
export const rules = R;

export const CHILD = { 女兒: 'daughter', 兒子: 'son' };
export const CHILD_NAME = { daughter: '女兒', son: '兒子' };
export const CAT = { 學習任務: 'learn', 日常習慣: 'habit', 每周任務: 'week' };

const compact = (id) => String(id || '').replace(/-/g, '');
export const keyFor = (date, student, templateId) => `${date}|${student}|${compact(templateId).slice(0, 8)}`;
export const docIdFor = (key) => createHash('sha1').update(key).digest('hex').slice(0, 20);

// ---------- 生成當日（和本週）任務 ----------
// routine: [{id, title, persons:[名字], category, frequency, points, active, weekdays:[週一…], optional, order}]
// 只為女兒、兒子生成；爸爸、媽媽的任務略過。回傳要新建的列（還沒檢查 Notion 裡是否已存在）。
export function planGeneration({ routine, today }) {
  const monday = mondayOf(today);
  const wd = WEEKDAY_NAMES[weekdayIndex(today)];
  const daily = [], weekly = [];
  routine.forEach((r, idx) => {
    if (!r.active) return;
    const kids = r.persons.filter((p) => CHILD[p]);
    if (!kids.length) return;
    const isWeekly = r.frequency === 'Weekly' || r.category === '每周任務';
    if (!isWeekly && r.weekdays?.length && !r.weekdays.includes(wd)) return;
    for (const kid of kids) {
      const student = CHILD[kid];
      const date = isWeekly ? monday : today;
      const row = {
        key: keyFor(date, student, r.id), date, student, childName: kid, title: r.title,
        catName: isWeekly ? '每周任務' : (r.category || '日常習慣'), optional: !!r.optional,
        points: r.points ?? null, templateId: compact(r.id), order: r.order ?? idx,
      };
      (isWeekly ? weekly : daily).push(row);
    }
  });
  return { daily, weekly, monday };
}

// ---------- 合併 Notion 一列與 Firestore 一份文件 ----------
// n：Notion 現況 {page,key,date,student,title,catName,optional,points,note,order,checked,checkedAt}
// f：Firestore 現有文件（沒有就是 null）
// 規則：
//   內容欄位（標題、分數、備註…）永遠以 Notion 為準（積分只由爸爸改，網站不覆蓋）。
//   打卡狀態：若 Notion 自上次同步以來沒變（notionDone 仍等於 Notion 現況），代表是網站改的 → 推送到 Notion；
//            若 Notion 變了（爸爸更正）→ 以 Notion 為準，取消打卡會標記 fix='untick'，網站顯示「爸爸已更正」。
export function mergeRow(n, f, nowMs) {
  const content = {
    student: n.student, date: n.date, title: n.title, cat: CAT[n.catName] || 'habit', optional: !!n.optional,
    points: n.points ?? null, note: n.note || '', order: n.order ?? 999, page: n.page, key: n.key,
  };
  const checked = !!n.checked;
  if (!f) {
    return {
      create: { ...content, basePoints: n.points ?? null, done: checked, doneAt: checked ? (n.checkedAt ?? nowMs) : null, fix: null, notionDone: checked },
      notionPatch: null,
    };
  }
  const update = {};
  for (const [k, v] of Object.entries(content)) if (f[k] !== v) update[k] = v;
  let notionPatch = null;
  if (!!f.done !== checked) {
    if (!!f.notionDone === checked) {
      notionPatch = { checked: !!f.done, checkedAt: f.doneAt ?? null };
      update.notionDone = !!f.done;
    } else {
      update.done = checked;
      update.doneAt = checked ? (n.checkedAt ?? f.doneAt ?? nowMs) : null;
      update.notionDone = checked;
      update.fix = !checked && f.done ? 'untick' : null;
    }
  } else if (!!f.notionDone !== checked) {
    update.notionDone = checked;
  }
  return { update: Object.keys(update).length ? update : null, notionPatch };
}

// ---------- 快速打卡標記 ----------
// 同一位孩子在 windowMs 內連續打卡 minCount 項以上，視為可能亂點，回傳這些文件的 id（只給爸爸看的提示）
export function quickIds(docs, { windowMs = 30000, minCount = 5 } = {}) {
  const out = new Set(), by = {};
  for (const d of docs) if (d.done && d.doneAt) (by[d.student] ||= []).push(d);
  for (const list of Object.values(by)) {
    list.sort((a, b) => a.doneAt - b.doneAt);
    for (let i = 0; i < list.length; i++) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].doneAt - list[i].doneAt <= windowMs) j++;
      if (j - i + 1 >= minCount) for (let k = i; k <= j; k++) out.add(list[k].id);
    }
  }
  return out;
}

// ---------- 確認積分 ----------
// 把 (upTo, 最近可確認日期] 之間每一天已確認的積分加總（rows 是這位孩子在相關日期的所有打卡文件）
export function confirmedBetween(rows, upTo, nowMs) {
  const last = lastEligible(nowMs);
  let sum = 0, newUpTo = upTo;
  for (let e = addDays(upTo, 1), guard = 0; e <= last && guard < 400; e = addDays(e, 1), guard++) {
    for (const r of rows) if (effectiveDate(r) === e && countsForPoints(r)) sum += Number(r.points) || 0;
    newUpTo = e;
  }
  return { sum, upTo: newUpTo };
}
