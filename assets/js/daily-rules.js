// 每日打卡規則：純函式，網站（瀏覽器）和 Notion 同步腳本（Node）共用同一份。
// 日期一律用香港時間（UTC+8）的 'YYYY-MM-DD' 字串。
(function (root) {
  const DAY = 86400000, HK = 8 * 3600000;

  const hkDate = (ms) => new Date(ms + HK).toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const weekdayIndex = (d) => new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay(); // 0 = 週日
  const mondayOf = (d) => addDays(d, -((weekdayIndex(d) + 6) % 7));
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const WEEKDAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  // 確認規則：某天的打卡積分，在「次日 12:00（香港時間）」後自動確認。
  // 某日 D 的確認時間 = D 的香港 00:00 再加 36 小時，所以「最近一個已可確認的日期」= 36 小時前的香港日期。
  const lastEligible = (nowMs) => hkDate(nowMs - 36 * 3600000);
  // 每周任務放在週一那一列，整週內打卡一次；在「週日」那天算起，同樣次日 12:00 確認（即下週一中午）。
  const effectiveDate = (r) => (r.cat === 'week' ? addDays(r.date, 6) : r.date);
  const isFinalized = (r, nowMs) => effectiveDate(r) <= lastEligible(nowMs);
  // 計入積分的條件：已打卡、沒有被爸爸取消、而且有分數（沒分數＝待評分，爸爸填了才計）
  const countsForPoints = (r) => !!r.done && r.fix !== 'untick' && r.points != null;
  const rowPoints = (r) => (countsForPoints(r) ? Number(r.points) || 0 : 0);

  // 網站需要監聽的日期：今天、昨天、本週一、上週一（上週的週任務在週一中午前還沒確認）
  const watchDates = (today) => [...new Set([today, addDays(today, -1), mondayOf(today), addDays(mondayOf(today), -7)])];

  // 打卡頁的積分摘要。rows 是這位孩子已載入的打卡列。
  function summarize(rows, today, nowMs) {
    const yesterday = addDays(today, -1);
    let pending = 0, pendingUnscored = 0, yPts = 0;
    for (const r of rows) {
      if (!isFinalized(r, nowMs)) {
        pending += rowPoints(r);
        if (r.done && r.fix !== 'untick' && r.points == null) pendingUnscored++;
      }
      if (r.cat !== 'week' && r.date === yesterday) yPts += rowPoints(r);
    }
    const required = rows.filter((r) => r.date === today && r.cat !== 'week' && !r.optional);
    return {
      pending, pendingUnscored, yesterday: yPts,
      yesterdayConfirmed: yesterday <= lastEligible(nowMs),
      todayDone: rows.filter((r) => r.date === today && r.cat !== 'week' && r.done && r.fix !== 'untick').length,
      todayRequiredLeft: required.filter((r) => !r.done || r.fix === 'untick').length,
    };
  }

  // ---------- 獎勵兌換 ----------
  // 申請中（先凍結）和已批准的都算「佔用」積分；已拒絕的退回。
  const heldStatus = (x) => x.status === 'pending' || x.status === 'approved';
  const holdOf = (list) => list.filter(heldStatus).reduce((a, x) => a + (Number(x.cost) || 0), 0);
  // 本週（週一到週日）已用幾次這個獎勵（申請中和已批准都算）
  const weekUsed = (list, rewardId, today) => { const mon = mondayOf(today), sun = addDays(mon, 6); return list.filter((x) => x.rewardId === rewardId && heldStatus(x) && x.date >= mon && x.date <= sun).length; };
  // 能不能申請這個獎勵：{ok} 或 {ok:false, reason:'limit'|'points', need}
  function redeemCheck(reward, available, used) {
    if (reward.limit && used >= reward.limit) return { ok: false, reason: 'limit' };
    if (available < reward.cost) return { ok: false, reason: 'points', need: reward.cost - available };
    return { ok: true };
  }

  const api = { DAY, HK, hkDate, addDays, weekdayIndex, mondayOf, daysBetween, WEEKDAY_NAMES, lastEligible, effectiveDate, isFinalized, countsForPoints, rowPoints, watchDates, summarize, holdOf, weekUsed, redeemCheck };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ELH_DAILY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
