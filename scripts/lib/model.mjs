// Firestore 資料 → Notion 資料列（純函式，不做任何網絡操作，方便測試）
// 積分規則與網站共用同一份：assets/js/points.js + config/points.json
import { createRequire } from 'node:module';
const PTS = createRequire(import.meta.url)('../../assets/js/points.js');
export const summarize = PTS.summarize;

// ---- Notion 屬性值建構 ----
const clip = (x, n = 1900) => String(x ?? '').slice(0, n);
export const P = {
  title: (t) => ({ title: [{ text: { content: clip(t) || '（無標題）' } }] }),
  text: (t) => ({ rich_text: t ? [{ text: { content: clip(t) } }] : [] }),
  num: (n) => ({ number: n === null || n === undefined || Number.isNaN(n) ? null : n }),
  sel: (n) => ({ select: n ? { name: clip(n, 90).replace(/,/g, '，') } : null }),
  date: (ms) => ({ date: ms ? { start: new Date(ms).toISOString() } : null }),
  chk: (b) => ({ checkbox: !!b }),
};
const mins = (sec) => Math.round((sec || 0) / 6) / 10;
const pct = (c, t) => (t > 0 ? Math.round((c / t) * 1000) / 1000 : null);

// ---- Notion 資料庫結構 ----
export const SCHEMAS = {
  students: { title: '學生概況', props: {
    學生: { title: {} }, 積分: { number: {} }, 已完成教材: { number: {} }, 累計用時分鐘: { number: {} },
    學習場次: { number: {} }, 整體正確率: { number: { format: 'percent' } }, 最近學習: { date: {} },
    更新時間: { date: {} }, Key: { rich_text: {} } } },
  materials: { title: '教材進度', props: {
    教材: { title: {} }, 學生: { select: {} }, 科目: { select: {} }, 階段: { select: {} }, 類型: { select: {} },
    完成次數: { number: {} }, 累計用時分鐘: { number: {} }, 學習場次: { number: {} },
    最近正確率: { number: { format: 'percent' } }, 最近學習: { date: {} }, 待複習: { checkbox: {} },
    推薦: { checkbox: {} }, Key: { rich_text: {} } } }, // 「推薦」由爸爸手動勾選（Y/N），同步程式不會寫入、不會覆蓋
  sessions: { title: '作答記錄', props: {
    場次: { title: {} }, 學生: { select: {} }, 教材: { rich_text: {} }, 科目: { select: {} }, 階段: { select: {} },
    開始時間: { date: {} }, 用時分鐘: { number: {} }, 總題數: { number: {} }, 答對: { number: {} }, 答錯: { number: {} },
    未做: { number: {} }, 正確率: { number: { format: 'percent' } }, 完成: { checkbox: {} }, 得分: { number: {} }, 積分明細: { rich_text: {} },
    裝置: { rich_text: {} }, Key: { rich_text: {} } } },
  wrong: { title: '錯題跟進', props: {
    題目: { title: {} }, 學生: { select: {} }, 教材: { rich_text: {} }, 題號: { number: {} }, 情況: { select: {} },
    所選答案: { rich_text: {} }, 正確答案: { rich_text: {} }, 日期: { date: {} }, 已跟進: { checkbox: {} }, Key: { rich_text: {} } } },
};

export function buildModel({ students, stages, types, catalog, materials, sessions, pointsCfg, now = Date.now() }) {
  const stuName = (id) => students.find((s) => s.id === id)?.name || id;
  const subjName = (sid, id) => students.find((s) => s.id === sid)?.subjects.find((x) => x.id === id)?.name || id;
  const stageName = (id) => stages.find((s) => s.id === id)?.label || id;
  const typeName = (id) => types.find((t) => t.id === id)?.label || id;
  const cat = new Map(catalog.map((i) => [i.id, i]));
  // 以香港時間（UTC+8）顯示場次標題
  const fmt = (ms) => {
    const d = new Date(ms + 8 * 3600e3);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  };

  const sess = sessions.map((s) => ({ ...s, ...summarize(s) }));
  const minutesOf = (id) => cat.get(id)?.minutes;
  const pc = {};
  for (const stu of students) pc[stu.id] = PTS.compute(sess.filter((s) => s.student === stu.id), pointsCfg, minutesOf);
  const explain = (p) => (!p ? '舊規則時期，不計新分' : [...p.parts.map((x) => `${x.label} +${x.pts}`), p.note].filter(Boolean).join('；') || '本場次沒有得分');
  const out = { students: [], materials: [], sessions: [] };

  // 學生概況
  for (const stu of students) {
    const mats = materials.filter((m) => m.sid === stu.id).map((m) => m.data);
    const ss = sess.filter((s) => s.student === stu.id);
    const lastMs = Math.max(0, ...mats.map((m) => m.last || 0), ...ss.map((s) => s.endedAt || 0));
    const c = ss.reduce((a, s) => a + s.correct, 0);
    const t = ss.reduce((a, s) => a + s.total, 0);
    out.students.push({ key: stu.id, props: {
      學生: P.title(stu.name), 積分: P.num(PTS.legacyPoints(mats, pointsCfg) + pc[stu.id].total),
      已完成教材: P.num(catalog.filter((c) => c.student === stu.id && (PTS.legacyDoneTimes(materials.find((x) => x.sid === stu.id && x.mid === c.id)?.data, pointsCfg) + (pc[stu.id].validCount[c.id] || 0)) > 0).length),
      累計用時分鐘: P.num(mins(ss.reduce((a, s) => a + (s.activeSeconds || 0), 0))), 學習場次: P.num(ss.length),
      整體正確率: P.num(pct(c, t)), 最近學習: P.date(lastMs || null), 更新時間: P.date(now), Key: P.text(stu.id) } });
  }

  // 教材進度（有進度或有場次的才列出）
  // 每份教材都有一列（即使還沒學過），爸爸才能在 Notion 勾選「推薦」
  const keys = new Set([...catalog.map((i) => `${i.student}|${i.id}`), ...materials.map((m) => `${m.sid}|${m.mid}`), ...sess.map((s) => `${s.student}|${s.material}`)]);
  for (const key of keys) {
    const [sid, mid] = key.split('|');
    const md = materials.find((m) => m.sid === sid && m.mid === mid)?.data || {};
    const item = cat.get(mid);
    const ss = sess.filter((s) => s.student === sid && s.material === mid).sort((a, b) => b.startedAt - a.startedAt);
    const lastQ = ss.find((s) => s.total > 0);
    out.materials.push({ key, props: {
      教材: P.title(item?.title || ss[0]?.title || mid), 學生: P.sel(stuName(sid)),
      科目: P.sel(item ? subjName(sid, item.subject) : ''), 階段: P.sel(item ? stageName(item.stage) : ''),
      類型: P.sel(item ? typeName(item.type) : ''),
      完成次數: P.num(PTS.legacyDoneTimes(md, pointsCfg) + (pc[sid]?.validCount[mid] || 0)), 累計用時分鐘: P.num(mins(ss.reduce((a, s) => a + (s.activeSeconds || 0), 0))),
      學習場次: P.num(ss.length), 最近正確率: P.num(lastQ ? pct(lastQ.correct, lastQ.total) : null),
      最近學習: P.date(Math.max(md.last || 0, ss[0]?.endedAt || 0) || null), 待複習: P.chk(md.review), Key: P.text(key) } });
  }

  // 作答記錄 + 錯題
  for (const s of sess) {
    const item = cat.get(s.material);
    const wrong = [];
    const last = new Map();
    for (const a of s.answers || []) last.set(a.q, a);
    for (const a of last.values()) {
      if (a.correct === true) continue;
      wrong.push({ q: a.q, key: `${s.id}#${a.q}`, props: {
        題目: P.title(a.text || `第 ${a.q} 題`), 學生: P.sel(stuName(s.student)), 教材: P.text(item?.title || s.title || s.material),
        題號: P.num(typeof a.q === 'number' ? a.q : Number(a.q) || null), 情況: P.sel(a.choice == null ? '跳過' : '答錯'),
        所選答案: P.text(a.picked), 正確答案: P.text(a.answer), 日期: P.date(a.t || s.startedAt), Key: P.text(`${s.id}#${a.q}`) } });
    }
    out.sessions.push({ id: s.id, key: s.id, wrong, props: {
      場次: P.title(`${fmt(s.startedAt)} ${item?.title || s.title || s.material}`), 學生: P.sel(stuName(s.student)),
      教材: P.text(item?.title || s.title || s.material), 科目: P.sel(item ? subjName(s.student, item.subject) : ''),
      階段: P.sel(item ? stageName(item.stage) : ''), 開始時間: P.date(s.startedAt), 用時分鐘: P.num(mins(s.activeSeconds)),
      總題數: P.num(s.total), 答對: P.num(s.correct), 答錯: P.num(s.wrong), 未做: P.num(s.unanswered),
      正確率: P.num(pct(s.correct, s.total)), 完成: P.chk(s.completed), 得分: P.num(pc[s.student]?.bySession[s.id]?.pts ?? null),
      積分明細: P.text(explain(pc[s.student]?.bySession[s.id])), 裝置: P.text(s.device), Key: P.text(s.id) } });
  }
  return out;
}
