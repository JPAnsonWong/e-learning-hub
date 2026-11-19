// 打卡共用核心：今日打卡頁和家庭看板共用（任務卡片、即時監聽、打卡動作、倒數日）。
// 需要先載入：points.js、daily-rules.js、common.js、fx.js
const ELH_CK = (() => {
  const DR = ELH_DAILY, FX = ELH_FX, esc = ELH.esc;
  const TICK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const CAT_ORDER = { learn: 0, habit: 1, week: 2 };
  const CAT_NAME = { learn: '📚 學習任務', habit: '🌱 日常習慣', week: '📅 每周任務' };
  const CN = '日一二三四五六';

  const isDone = (r) => !!r.done && r.fix !== 'untick';
  const corrected = (r) => r.basePoints != null && r.points != null && r.points !== r.basePoints;
  const sortRows = (a, b) => (CAT_ORDER[a.cat] - CAT_ORDER[b.cat]) || ((a.optional ? 1 : 0) - (b.optional ? 1 : 0))
    || ((a.order ?? 999) - (b.order ?? 999)) || String(a.title).localeCompare(b.title, 'zh-Hant');
  // 清單只顯示今天的任務和本週的每周任務；昨天、上週的列只用來計算積分
  const shownRows = (rows, today) => { const monday = DR.mondayOf(today); return rows.filter((r) => r.date === today || (r.cat === 'week' && r.date === monday)).sort(sortRows); };
  const sig = (r) => [r.done, r.fix, r.points, r.note, r.title, r.basePoints, r.optional].join('|');

  function taskHTML(r) {
    const done = isDone(r), fixed = r.fix === 'untick';
    const pt = r.points == null ? '<span class="ck-pt na">待評分</span>' : `<span class="ck-pt">+${r.points}${corrected(r) ? '（已更正）' : ''}</span>`;
    const note = r.note ? `（${esc(r.note)}）` : '';
    let fix = '';
    if (fixed) fix = `<div class="ck-fix">👨 爸爸已更正：這項未通過${note}</div>`;
    else if (corrected(r) && r.done) fix = `<div class="ck-fix">👨 爸爸已更正：+${r.basePoints} → +${r.points}${note}</div>`;
    else if (r.note) fix = `<small>${esc(r.note)}</small>`;
    const sub = r.cat === 'week' && !fix ? '<small>本週內完成一次打卡</small>' : (done && r.points == null && !fix ? '<small>已打卡，等爸爸評分</small>' : '');
    return `<div class="ck-task${done ? ' done' : ''}${fixed ? ' fixed' : ''}" data-id="${esc(r.id)}" role="checkbox" aria-checked="${done}" tabindex="0"><div class="ck-ttl">${esc(r.title)}${r.optional ? '<span class="ck-opt">選填</span>' : ''}${fix || sub}</div>${pt}<div class="ck-chk">${TICK}</div></div>`;
  }

  // 任務清單：第一次完整繪製；之後只更新有變動的卡片（不會打斷動畫）。
  // opts.week：是否顯示每周任務；opts.emptyHTML：沒有任務時的說明
  function createTaskList(container, { today, week = true, emptyHTML = '' }) {
    let rows = [], map = new Map(), ready = false;
    const cats = week ? ['learn', 'habit', 'week'] : ['learn', 'habit'];
    function full() {
      const list = shownRows(rows, today).filter((r) => week || r.cat !== 'week');
      if (!list.length) { container.innerHTML = ready ? emptyHTML : '<p class="ck-empty">載入今天的任務…</p>'; return; }
      container.innerHTML = cats.map((c) => {
        const items = list.filter((r) => r.cat === c); if (!items.length) return '';
        return `<div class="ck-cat">${CAT_NAME[c]}</div><div class="ck-tasks">${items.map(taskHTML).join('')}</div>`;
      }).join('');
    }
    return {
      // 回傳這次有變動的列（沒有變動或第一次繪製時回傳空陣列）
      update(next) {
        const same = ready && next.length === rows.length && next.every((r) => map.has(r.id));
        const changed = same ? next.filter((r) => sig(r) !== sig(map.get(r.id))) : [];
        rows = next; map = new Map(next.map((r) => [r.id, r])); ready = true;
        if (!same) full();
        else for (const r of changed) {
          const q = `.ck-task[data-id="${CSS.escape(r.id)}"]`, el = container.querySelector(q);
          if (!el) continue;
          const pop = el.classList.contains('pop');
          el.outerHTML = taskHTML(r);
          if (pop) container.querySelector(q)?.classList.add('pop');
        }
        return changed;
      },
      get: (id) => map.get(id),
      get rows() { return rows; },
    };
  }

  // 即時監聽今天、昨天、本週一、上週一的打卡（兩位孩子都在裡面，由呼叫端依孩子篩選）
  function watch(F, today, onRows, onError) {
    const { db, fs } = F;
    return fs.onSnapshot(fs.query(fs.collection(db, 'checkins'), fs.where('date', 'in', DR.watchDates(today))),
      (snap) => onRows(snap.docs.map((x) => ({ id: x.id, ...x.data() }))), onError);
  }

  // 打卡動作（含動畫、音效、規則檢查）。targetEl：星星要飛向的積分元素
  async function toggle(F, row, node, targetEl, toast) {
    if (!row) return;
    if (row.fix === 'untick') { toast('這項已被爸爸更正，不能再改喔'); return; }
    if (DR.isFinalized(row, Date.now())) { toast('這天的積分已經確認了，不能再改'); return; }
    const done = !row.done;
    if (done) {
      FX.sfx.tick(); FX.buzz(30);
      if (node) { node.classList.add('pop'); FX.burst(node.querySelector('.ck-chk')); }
      if (row.points != null) FX.flyStars(node && node.querySelector('.ck-chk'), targetEl, row.points); else toast('已打卡！這項由爸爸評分，評分後才會計入');
    } else FX.sfx.untick();
    try {
      await F.fs.updateDoc(F.fs.doc(F.db, 'checkins', row.id), { done, doneAt: done ? Date.now() : null, updatedAt: F.fs.serverTimestamp() });
    } catch (e) {
      console.warn('checkin update', e);
      toast(e && e.code === 'permission-denied' ? '打卡失敗：還沒有寫入權限，請爸爸先更新 Firestore 安全規則' : '打卡失敗，請稍後再試');
    }
  }

  // 倒數日
  async function loadCountdowns(F) { return (await F.fs.getDocs(F.fs.collection(F.db, 'countdowns'))).docs.map((x) => x.data()); }
  // forStudent：只顯示這位孩子的；null：全家（兩位孩子合併，名稱相同的合併成一項）
  function countdownsHTML(list, forStudent, today, nameOf) {
    let items = list.map((c) => ({ ...c, days: DR.daysBetween(today, c.date) })).filter((c) => c.days >= 0);
    if (forStudent) items = items.filter((c) => (c.who || []).includes(forStudent));
    items.sort((a, b) => a.days - b.days);
    if (!items.length) return '<div class="ck-hint">暫無倒數事項（可以在 Notion「重要日子」新增）</div>';
    return items.map((c) => {
      const cls = c.days <= 3 ? 'hot' : c.days <= 7 ? 'warn' : '';
      const dt = new Date(c.date + 'T00:00:00Z');
      const who = !forStudent && nameOf ? ((c.who || []).length > 1 ? '全家' : nameOf((c.who || [])[0])) + '：' : '';
      return `<div class="ck-cd ${cls}"><b>${c.days === 0 ? '🎯' : c.days}</b><div>${esc(who)}離「${esc(c.title)}」${c.days === 0 ? '就是今天！' : `還有 ${c.days} 天`}<small>${dt.getUTCMonth() + 1} 月 ${dt.getUTCDate()} 日（週${CN[dt.getUTCDay()]}）${c.note ? '・' + esc(c.note) : ''}</small></div></div>`;
    }).join('');
  }

  // 時鐘：把日期、時間、秒針、問候、今日進度寫進指定的元素（id 對應）。回傳 tick 函式；跨過午夜（香港時間）時換新的一天。
  function startClock(ids, today) {
    const $ = (k) => document.getElementById(ids[k]);
    let lastSec = -1;
    function tick() {
      const n = new Date(), sec = n.getSeconds();
      if (DR.hkDate(Date.now()) !== today) { location.reload(); return; }
      if (sec === lastSec) return; lastSec = sec;
      const h = n.getHours(), pct = Math.round(((n - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000) * 100);
      if ($('date')) $('date').textContent = `${n.getFullYear()} 年 ${n.getMonth() + 1} 月 ${n.getDate()} 日　星期${CN[n.getDay()]}`;
      if ($('hm')) $('hm').textContent = `${String(h).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
      if ($('sec')) { const s = $('sec'); s.textContent = ':' + String(sec).padStart(2, '0'); s.classList.remove('tick'); void s.offsetWidth; s.classList.add('tick'); }
      if ($('greet')) $('greet').textContent = h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
      if ($('pct')) $('pct').textContent = `今天已過 ${pct}%`;
      if ($('bar')) $('bar').style.width = pct + '%';
    }
    tick(); setInterval(tick, 250);
  }

  let toastT;
  function makeToast(el) { return (m) => { el.textContent = m; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2800); }; }

  return { DR, isDone, corrected, shownRows, taskHTML, createTaskList, watch, toggle, loadCountdowns, countdownsHTML, startClock, makeToast, CN };
})();
