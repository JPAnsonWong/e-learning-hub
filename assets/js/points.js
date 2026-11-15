// 積分計算：純函式，網站（瀏覽器）和 Notion 同步腳本（Node）共用同一份。
// 積分只由系統記錄到的學習行為算出，不由「點完成」直接給分，所以可隨時重算、多裝置一致。
(function (root) {
  function summarize(s) {
    const last = new Map();
    for (const a of s.answers || []) last.set(a.q, a);
    const answered = [...last.values()].filter((a) => a.choice !== null && a.choice !== undefined).length;
    const correct = [...last.values()].filter((a) => a.correct === true).length;
    const total = Math.max(s.totalQ || 0, last.size);
    return { total, answered, correct, wrong: answered - correct, unanswered: Math.max(0, total - answered) };
  }

  // 舊規則：同一教材第 1 次 +2、第 2、3 次 +1，只計 cutover 之前的「完成」事件
  function legacyPoints(items, cfg) {
    const cut = Date.parse(cfg.cutover);
    let total = 0;
    for (const it of items) {
      const act = (it.completions || []).filter((c) => !c.undone && c.t < cut).sort((a, b) => a.t - b.t);
      act.forEach((_, n) => { total += cfg.legacyBonus[n] || 0; });
    }
    return total;
  }
  function legacyDoneTimes(item, cfg) {
    const cut = Date.parse(cfg.cutover);
    return (item?.completions || []).filter((c) => !c.undone && c.t < cut).length;
  }

  // sessions：該學生所有場次；minutesOf(materialId) → 預計分鐘（可選）
  // 回傳 { total, bySession: {id: {pts, parts:[{label,pts}], valid, note}}, validCount: {materialId: n} }
  function compute(sessions, cfg, minutesOf) {
    const cut = Date.parse(cfg.cutover);
    const off = (cfg.tzOffsetHours || 0) * 3600e3;
    const day = (ms) => Math.floor((ms + off) / 86400e3);
    const mat = new Map(); // materialId → {q: Map(q→'correct'|'wrong'), bonusCount, days:Set}
    const out = { total: 0, bySession: {}, validCount: {} };
    const list = sessions.filter((s) => s.startedAt >= cut).sort((a, b) => a.startedAt - b.startedAt);

    for (const s of list) {
      const st = mat.get(s.material) || { q: new Map(), bonusCount: 0, days: new Set() };
      mat.set(s.material, st);
      const parts = [];
      let note = '';
      const sum = summarize(s);

      // 1) 按題計分：每題只看這個場次的「第一次」作答，避免同場次先錯後改的刷分
      const first = new Map();
      for (const a of s.answers || []) if (!first.has(a.q)) first.set(a.q, a);
      let nFirst = 0, nRetry = 0;
      const decided = new Map();
      for (const [q, a] of first) {
        if (a.choice === null || a.choice === undefined) continue; // 沒作答就看答案：不計、不改狀態
        const prev = st.q.get(q);
        if (a.correct === true) {
          if (prev === undefined) { nFirst++; } else if (prev === 'wrong') { nRetry++; }
          decided.set(q, 'correct');
        } else if (prev !== 'correct') {
          decided.set(q, 'wrong');
        }
      }
      for (const [q, v] of decided) st.q.set(q, v);
      if (nFirst) parts.push({ label: `首次答對 ${nFirst} 題`, pts: nFirst * cfg.question.firstCorrect });
      if (nRetry) parts.push({ label: `錯題改對 ${nRetry} 題`, pts: nRetry * cfg.question.retryCorrect });

      // 2) 有效場次與完成獎勵
      let valid = false;
      if (sum.total > 0) {
        valid = sum.answered / sum.total >= cfg.validSession.answeredRatio;
        if (!valid) note = `作答未達 ${Math.round(cfg.validSession.answeredRatio * 100)}%（${sum.answered}/${sum.total}），不算完成`;
      } else if (s.completed) {
        const mins = (minutesOf && minutesOf(s.material)) || cfg.static.defaultMinutes;
        const need = Math.max(cfg.static.minSecondsFloor, Math.round(mins * 60 * cfg.static.timeRatio));
        valid = (s.activeSeconds || 0) >= need;
        if (!valid) note = `停留時間不足（需要 ${need} 秒，實際 ${s.activeSeconds || 0} 秒），不算完成`;
      }
      if (valid) {
        out.validCount[s.material] = (out.validCount[s.material] || 0) + 1;
        const d = day(s.startedAt);
        if (st.days.has(d)) {
          note = `今天已拿過這份教材的完成獎勵`;
        } else {
          st.days.add(d);
          const b = cfg.bonus[st.bonusCount] || 0;
          st.bonusCount++;
          parts.push({ label: `完成獎勵（第 ${st.bonusCount} 次）`, pts: b });
        }
      }
      const pts = parts.reduce((a, p) => a + p.pts, 0);
      out.total += pts;
      out.bySession[s.id] = { pts, parts, valid, note };
    }
    return out;
  }

  const api = { summarize, compute, legacyPoints, legacyDoneTimes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ELH_POINTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
