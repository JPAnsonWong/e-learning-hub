// E_learning Hub 共用邏輯：資料載入、進度/積分（localStorage）、卡片渲染
const ELH = (() => {
  const KEY = 'elh.progress.v1';
  const NEW_DAYS = 7;
  let pointsCfg = null, minutesById = new Map(), catalogIds = [], memo = {};

  // ---------- 資料載入 ----------
  async function loadAll() {
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${u} (${r.status})`);
      return r.json();
    });
    const [s, st, t, c, pc] = await Promise.all([
      get('config/students.json'), get('config/stages.json'),
      get('config/types.json'), get('catalog.json'), get('config/points.json'),
    ]);
    pointsCfg = pc;
    minutesById = new Map(c.items.map((i) => [i.id, i.minutes]));
    catalogIds = c.items.map((i) => ({ id: i.id, student: i.student }));
    memo = {};
    const data = { students: s.students, stages: st.stages, types: t.types, tags: t.tags, items: c.items };
    data.stageIndex = new Map(data.stages.map((x, i) => [x.id, i]));
    return data;
  }

  // ---------- 進度存取 ----------
  // 完成記錄是事件清單 [{t, undone?}]，積分由規則推算，方便多裝置合併。
  const hooks = { onItemChange: null, onSessionChange: null };
  let memory = null; // localStorage 不可用時的後備
  function read() {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : {}; }
    catch { return memory || {}; }
  }
  function write(db) {
    memo = {};
    memory = db;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 忽略 */ }
  }
  const emptyItem = () => ({ started: null, last: null, completions: [], review: false, reviewAt: 0, resume: null });
  function normItem(it) {
    const o = Object.assign(emptyItem(), it || {});
    o.completions = (o.completions || []).map((c) => (c.undone ? { t: c.t, undone: true } : { t: c.t }));
    return o;
  }
  function slot(db, sid, id) {
    db[sid] = db[sid] || { items: {} };
    db[sid].items = db[sid].items || {};
    db[sid].items[id] = normItem(db[sid].items[id]);
    return db[sid].items[id];
  }
  const activeOf = (it) => it.completions.filter((c) => !c.undone).sort((a, b) => a.t - b.t);
  function itemState(sid, id) {
    const it = normItem(read()[sid]?.items?.[id]);
    return { ...it, completions: activeOf(it) }; // completions：有效的「我學完了」事件（只作狀態記錄，不直接給分）
  }
  // 積分 = 舊積分（cutover 前的「點完成」記錄，已凍結）+ 新積分（由學習場次算出，見 assets/js/points.js）
  function pointsInfo(sid) {
    if (memo[sid]) return memo[sid];
    if (!pointsCfg || typeof ELH_POINTS === 'undefined') return { legacy: 0, fresh: 0, total: 0, bySession: {}, validCount: {} };
    const fresh = ELH_POINTS.compute(sessionsOf(sid), pointsCfg, (id) => minutesById.get(id));
    const items = Object.values(read()[sid]?.items || {}).map(normItem);
    const legacy = ELH_POINTS.legacyPoints(items, pointsCfg);
    return (memo[sid] = { legacy, fresh: fresh.total, total: legacy + fresh.total, bySession: fresh.bySession, validCount: fresh.validCount });
  }
  const points = (sid) => pointsInfo(sid).total; // 學習積分（作答 + 舊「點完成」積分）
  // 打卡系統的積分（舊 Notion 總分起始值、已確認的打卡積分）由同步程式寫入 Firestore，這裡只存本機快取
  const XKEY = 'elh.extra.v1';
  const readExtraAll = () => { try { return JSON.parse(localStorage.getItem(XKEY) || '{}'); } catch { return {}; } };
  const extraOf = (sid) => ({ base: 0, confirmed: 0, ...(readExtraAll()[sid] || {}) });
  function setExtra(sid, v) { const o = readExtraAll(); o[sid] = { base: v.base || 0, confirmed: v.confirmed || 0 }; try { localStorage.setItem(XKEY, JSON.stringify(o)); } catch { /* 忽略 */ } }
  // ---------- 推薦學習（爸爸在 Notion「教材進度」勾選「推薦」；同步後存在本機快取） ----------
  const RKEY = 'elh.recs.v1';
  const readRecs = () => { try { return JSON.parse(localStorage.getItem(RKEY) || '{}'); } catch { return {}; } };
  function setRecs(sid, ids) { const o = readRecs(); o[sid] = Array.isArray(ids) ? ids : []; try { localStorage.setItem(RKEY, JSON.stringify(o)); } catch { /* 忽略 */ } }
  // 排序：最近學習過的排最前面；還沒學過的排後面，依教材日期新到舊
  const byRecent = (a, b) => (b.last - a.last) || String(b.i.date).localeCompare(String(a.i.date));
  function recommended(d, sid, limit = 99) {
    const ids = new Set(readRecs()[sid] || []);
    return d.items.filter((i) => i.student === sid && ids.has(i.id))
      .map((i) => ({ i, last: itemState(sid, i.id).last || 0 })).sort(byRecent).slice(0, limit).map((x) => x.i);
  }
  function recommendedAll(d, limit = 99) {
    return d.students.flatMap((s) => recommended(d, s.id).map((i) => ({ i, last: itemState(s.id, i.id).last || 0 })))
      .sort(byRecent).slice(0, limit).map((x) => x.i);
  }
  const totalPoints = (sid) => points(sid) + extraOf(sid).base + extraOf(sid).confirmed; // 合併總分
  // 完成次數 = 舊的完成記錄（cutover 前）+ 有效場次數
  function completedTimes(sid, id) {
    if (!pointsCfg || typeof ELH_POINTS === 'undefined') return 0;
    return ELH_POINTS.legacyDoneTimes(read()[sid]?.items?.[id], pointsCfg) + (pointsInfo(sid).validCount[id] || 0);
  }
  function doneCount(sid) { return catalogIds.filter((c) => c.student === sid && completedTimes(sid, c.id) > 0).length; }
  function changed(sid, id) { try { hooks.onItemChange?.(sid, id); } catch { /* 忽略 */ } }
  function markStart(sid, id) {
    const db = read(); const it = slot(db, sid, id);
    const now = Date.now();
    it.started = it.started || now; it.last = now;
    write(db); changed(sid, id);
  }
  function complete(sid, id) { // 「我學完了」：只記錄一個完成事件；積分由場次決定
    const db = read(); const it = slot(db, sid, id);
    let t = Date.now(); while (it.completions.some((c) => c.t === t)) t++;
    it.completions.push({ t });
    it.last = Date.now();
    write(db); changed(sid, id);
  }
  // ---------- 斷點續做 ----------
  // 教材頁回報進度快照 → 存成 resume；下次打開時網站問「繼續／重新開始」，再把快照交還給頁面
  const RESUME_DAYS = 30;
  function getResume(sid, id) {
    const r = normItem(read()[sid]?.items?.[id]).resume;
    return r && !r.cleared && r.dataJson && Date.now() - r.at < RESUME_DAYS * 86400000 ? r : null;
  }
  function setResume(sid, id, obj) { // obj 為 null 表示清除（也會同步到其他裝置）
    const db = read(); const it = slot(db, sid, id);
    it.resume = obj ? { ...obj, at: Date.now() } : { at: Date.now(), cleared: true };
    write(db); changed(sid, id);
  }
  function sessionById(id) { return readSessions()[id] || null; }
  function toggleReview(sid, id) {
    const db = read(); const it = slot(db, sid, id);
    it.review = !it.review; it.reviewAt = Date.now();
    write(db); changed(sid, id);
    return it.review;
  }
  // 合併遠端與本機（可交換、可重複套用）
  function mergeItem(a, b) {
    a = normItem(a); b = normItem(b);
    const byT = new Map();
    for (const c of [...a.completions, ...b.completions]) {
      const p = byT.get(c.t);
      byT.set(c.t, { t: c.t, ...(p?.undone || c.undone ? { undone: true } : {}) });
    }
    const newer = (b.reviewAt || 0) > (a.reviewAt || 0) ? b : a;
    return {
      started: [a.started, b.started].filter(Boolean).sort((x, y) => x - y)[0] || null,
      last: Math.max(a.last || 0, b.last || 0) || null,
      completions: [...byT.values()].sort((x, y) => x.t - y.t),
      review: newer.review, reviewAt: newer.reviewAt || 0,
      resume: (b.resume?.at || 0) > (a.resume?.at || 0) ? b.resume : (a.resume || null), // 斷點續做快照：以較新者為準
    };
  }
  function getRaw(sid, id) { return normItem(read()[sid]?.items?.[id]); }
  function applyRemote(sid, id, remote) {
    const db = read(); const it = slot(db, sid, id);
    db[sid].items[id] = mergeItem(it, remote);
    write(db);
    return db[sid].items[id];
  }

  // ---------- 作答場次（session）本機快取 ----------
  const SKEY = 'elh.sessions.v1';
  function readSessions() { try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { return {}; } }
  function writeSessions(o) {
    memo = {};
    const ids = Object.keys(o).sort((a, b) => (o[b].startedAt || 0) - (o[a].startedAt || 0)); // 新到舊
    for (const k of ids.slice(1500)) delete o[k]; // 最多留 1500 場
    ids.slice(30, 1500).forEach((k) => { // 較舊的場次只留計分需要的欄位，節省空間
      const x = o[k];
      if (x && x.answers && !x._slim) {
        x.answers = x.answers.map((a) => ({ q: a.q, choice: a.choice == null ? null : 1, correct: a.correct, t: a.t }));
        x._slim = true;
      }
    });
    try { localStorage.setItem(SKEY, JSON.stringify(o)); } catch { /* 忽略 */ }
  }
  const summarize = (s) => ELH_POINTS.summarize(s);
  function saveSession(s) {
    const o = readSessions();
    o[s.id] = { ...o[s.id], ...s, ...summarize(s), updatedLocal: Date.now() };
    writeSessions(o);
    try { hooks.onSessionChange?.(o[s.id]); } catch { /* 忽略 */ }
  }
  function mergeSession(remote) {
    const o = readSessions();
    const l = o[remote.id];
    // 場次只會在單一裝置上增長，取活動秒數較大者
    if (!l || (remote.activeSeconds || 0) > (l.activeSeconds || 0) || (remote.answers || []).length > (l.answers || []).length) {
      o[remote.id] = { ...remote, ...summarize(remote) };
      writeSessions(o);
    }
  }
  function sessionsOf(sid) {
    return Object.values(readSessions()).filter((s) => s.student === sid).sort((a, b) => b.startedAt - a.startedAt);
  }
  // ---------- 輔助 ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stageLabel = (d, id) => d.stages.find((s) => s.id === id)?.label || id;
  const typeLabel = (d, id) => d.types.find((t) => t.id === id)?.label || id;
  const student = (d, id) => d.students.find((s) => s.id === id);
  const subject = (d, sid, id) => student(d, sid)?.subjects.find((s) => s.id === id);
  function isNew(item) {
    const t = new Date(item.date + 'T00:00:00').getTime();
    return Date.now() - t <= NEW_DAYS * 86400000 && Date.now() >= t - 86400000;
  }
  function badges(d, item) {
    const st = itemState(item.student, item.id);
    const out = [];
    const n = completedTimes(item.student, item.id);
    if (n) out.push(['done', `已完成 ×${n}`]);
    if (getResume(item.student, item.id)) out.push(['resume', '可繼續']);
    if (st.review) out.push(['review', '待複習']);
    if (isNew(item)) out.push(['new', '新教材']);
    for (const t of item.tags || []) out.push(['key', d.tags.find((x) => x.id === t)?.label || t]);
    return out;
  }
  function card(d, item, { showStudent = false } = {}) {
    const sub = subject(d, item.student, item.subject);
    const stu = student(d, item.student);
    const stars = item.difficulty ? '★'.repeat(item.difficulty) + '☆'.repeat(3 - item.difficulty) : '';
    const b = badges(d, item).map(([k, t]) => `<span class="elh-badge elh-badge-${k}">${esc(t)}</span>`).join('');
    return `<a class="elh-card" href="viewer.html?id=${encodeURIComponent(item.id)}" style="--accent:${stu?.color || '#555'}">
      <div class="elh-card-top">
        <span class="elh-subj">${esc(sub?.icon || '')} ${esc(sub?.name || item.subject)}</span>
        ${showStudent ? `<span class="elh-who">${esc(stu?.icon || '')} ${esc(stu?.name || item.student)}</span>` : ''}
      </div>
      <h3 class="elh-card-title">${esc(item.title)}</h3>
      <div class="elh-meta">${esc(stageLabel(d, item.stage))} · ${esc(typeLabel(d, item.type))}</div>
      <div class="elh-meta">${esc(item.date)}${item.minutes ? ` · 約 ${item.minutes} 分鐘` : ''}${stars ? ` · <span class="elh-stars">${stars}</span>` : ''}</div>
      ${b ? `<div class="elh-badges">${b}</div>` : ''}
    </a>`;
  }
  function recent(d, studentId, limit) {
    return d.items
      .filter((i) => !studentId || i.student === studentId)
      .map((i) => ({ i, last: itemState(i.student, i.id).last }))
      .filter((x) => x.last)
      .sort((a, b) => b.last - a.last)
      .slice(0, limit).map((x) => x.i);
  }
  function reviewList(d, studentId, limit) {
    return d.items.filter((i) => (!studentId || i.student === studentId) && itemState(i.student, i.id).review).slice(0, limit);
  }
  function latest(d, studentId, limit) {
    return d.items.filter((i) => !studentId || i.student === studentId).slice(0, limit); // catalog 已按日期倒序
  }
  function section(title, html, emptyText) {
    return `<section class="elh-section"><h2>${esc(title)}</h2>${html
      ? `<div class="elh-grid">${html}</div>` : `<p class="elh-empty">${esc(emptyText)}</p>`}</section>`;
  }
  // ---------- 右上角「連結」選單（資料來自 config/links.json） ----------
  let linksP = null;
  const loadLinks = () => (linksP ||= fetch('config/links.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { links: [] })).then((j) => (j.links || []).filter((l) => l && l.name && /^https?:\/\//i.test(l.url || '')))
    .catch(() => []));
  // 在頁首（.elh-top）最右邊加上「🔗 連結」按鈕；重複呼叫不會重複加入
  async function mountLinks() {
    const bar = document.querySelector('.elh-top');
    if (!bar || bar.querySelector('.elh-links')) return;
    const links = await loadLinks();
    if (!links.length || bar.querySelector('.elh-links')) return;
    const box = document.createElement('div');
    box.className = 'elh-links';
    box.innerHTML = '<button type="button" class="btn btn-outline-secondary elh-btn" aria-haspopup="true" aria-expanded="false">🔗 連結</button>' +
      '<div class="elh-links-menu" hidden>' + links.map((l) =>
        '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.name) + '</a>').join('') + '</div>';
    bar.appendChild(box);
    const btn = box.querySelector('button'), menu = box.querySelector('.elh-links-menu');
    const setOpen = (v) => { menu.hidden = !v; btn.setAttribute('aria-expanded', String(v)); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    menu.addEventListener('click', () => setOpen(false)); // 點了連結後收起選單（連結本身在新分頁開啟）
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }
  function fail(el, e) {
    el.innerHTML = `<p class="elh-empty">載入失敗：${esc(e.message)}。請確認是透過網址（不是直接雙擊檔案）打開。</p>`;
  }

  return { loadAll, hooks, itemState, getRaw, mergeItem, applyRemote, points, totalPoints, extraOf, setExtra, setRecs, recommended, recommendedAll, pointsInfo, completedTimes, doneCount, markStart, complete, toggleReview, getResume, setResume, sessionById,
    saveSession, mergeSession, sessionsOf, summarize,
    esc, stageLabel, typeLabel, student, subject, badges, isNew, card, recent, reviewList, latest, section, mountLinks, fail };
})();
