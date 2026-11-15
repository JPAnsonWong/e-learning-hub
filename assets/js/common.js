// E_learning Hub 共用邏輯：資料載入、進度/積分（localStorage）、卡片渲染
const ELH = (() => {
  const KEY = 'elh.progress.v1';
  const NEW_DAYS = 7;

  // ---------- 資料載入 ----------
  async function loadAll() {
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${u} (${r.status})`);
      return r.json();
    });
    const [s, st, t, c] = await Promise.all([
      get('config/students.json'), get('config/stages.json'),
      get('config/types.json'), get('catalog.json'),
    ]);
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
    memory = db;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 忽略 */ }
  }
  const emptyItem = () => ({ started: null, last: null, completions: [], review: false, reviewAt: 0 });
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
  // 第 1 次 +2，第 2、3 次 +1，第 4 次起 0
  const ptsFor = (n) => (n === 0 ? 2 : n <= 2 ? 1 : 0);
  const activeOf = (it) => it.completions.filter((c) => !c.undone).sort((a, b) => a.t - b.t);
  function itemState(sid, id) {
    const it = normItem(read()[sid]?.items?.[id]);
    return { ...it, completions: activeOf(it) }; // completions 只含有效完成
  }
  function points(sid) {
    const items = read()[sid]?.items || {};
    let total = 0;
    for (const k in items) activeOf(normItem(items[k])).forEach((_, n) => { total += ptsFor(n); });
    return total;
  }
  function doneCount(sid) {
    const items = read()[sid]?.items || {};
    return Object.values(items).filter((i) => activeOf(normItem(i)).length > 0).length;
  }
  function changed(sid, id) { try { hooks.onItemChange?.(sid, id); } catch { /* 忽略 */ } }
  function markStart(sid, id) {
    const db = read(); const it = slot(db, sid, id);
    const now = Date.now();
    it.started = it.started || now; it.last = now;
    write(db); changed(sid, id);
  }
  function complete(sid, id) {
    const db = read(); const it = slot(db, sid, id);
    const pts = ptsFor(activeOf(it).length);
    let t = Date.now(); while (it.completions.some((c) => c.t === t)) t++;
    it.completions.push({ t });
    it.last = Date.now();
    write(db); changed(sid, id);
    return pts;
  }
  function undoComplete(sid, id) {
    const db = read(); const it = slot(db, sid, id);
    const act = activeOf(it);
    if (!act.length) return 0;
    const last = act[act.length - 1];
    last.undone = true;
    const target = it.completions.find((c) => c.t === last.t); target.undone = true;
    write(db); changed(sid, id);
    return ptsFor(act.length - 1);
  }
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
    const ids = Object.keys(o);
    if (ids.length > 400) { // 只留最近 400 場
      ids.sort((a, b) => (o[a].startedAt || 0) - (o[b].startedAt || 0));
      for (const k of ids.slice(0, ids.length - 400)) delete o[k];
    }
    try { localStorage.setItem(SKEY, JSON.stringify(o)); } catch { /* 忽略 */ }
  }
  function summarize(s) {
    const last = new Map();
    for (const a of s.answers || []) last.set(a.q, a);
    const answered = [...last.values()].filter((a) => a.choice !== null && a.choice !== undefined).length;
    const correct = [...last.values()].filter((a) => a.correct === true).length;
    const total = Math.max(s.totalQ || 0, last.size);
    return { total, answered, correct, wrong: answered - correct, unanswered: Math.max(0, total - answered) };
  }
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
  function exportJson() { return JSON.stringify({ app: 'e-learning-hub', v: 2, data: read(), sessions: readSessions() }, null, 2); }
  function importJson(text) {
    const o = JSON.parse(text);
    if (!o || o.app !== 'e-learning-hub' || typeof o.data !== 'object') throw new Error('不是有效的進度檔');
    write(o.data);
    if (o.sessions && typeof o.sessions === 'object') writeSessions(o.sessions);
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
    if (st.completions.length) out.push(['done', `已完成 ×${st.completions.length}`]);
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
  function backupTools() {
    return `<div class="elh-backup">
      <button class="btn btn-outline-secondary elh-btn" id="elh-export">匯出進度</button>
      <button class="btn btn-outline-secondary elh-btn" id="elh-import">匯入進度</button>
      <input type="file" id="elh-import-file" accept="application/json,.json" hidden>
    </div>`;
  }
  function bindBackup(onDone) {
    document.getElementById('elh-export')?.addEventListener('click', () => {
      const blob = new Blob([exportJson()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `elearning-progress-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
    });
    const file = document.getElementById('elh-import-file');
    document.getElementById('elh-import')?.addEventListener('click', () => file.click());
    file?.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      if (!confirm('匯入會取代這部裝置上現有的進度和積分，確定嗎？')) { file.value = ''; return; }
      try { importJson(await f.text()); alert('匯入成功'); onDone?.(); }
      catch (e) { alert('匯入失敗：' + e.message); }
      file.value = '';
    });
  }
  function fail(el, e) {
    el.innerHTML = `<p class="elh-empty">載入失敗：${esc(e.message)}。請確認是透過網址（不是直接雙擊檔案）打開。</p>`;
  }

  return { loadAll, hooks, itemState, getRaw, mergeItem, applyRemote, points, doneCount, markStart, complete, undoComplete, toggleReview, ptsFor,
    saveSession, mergeSession, sessionsOf, summarize, exportJson, importJson,
    esc, stageLabel, typeLabel, student, subject, badges, isNew, card, recent, reviewList, latest, section, backupTools, bindBackup, fail };
})();
