// 打卡動畫與音效：全部自己寫，不依賴任何外部資源。可靜音、可減少動畫，也尊重系統的「減少動態」設定。
const ELH_FX = (() => {
  const KEY = 'elh.fx.v1';
  let sound = true;
  let calm = false;
  try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); sound = o.sound !== false; calm = !!o.calm; } catch { /* 用預設 */ }
  const sysCalm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const isCalm = () => calm || sysCalm();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ sound, calm })); } catch { /* 忽略 */ } };

  // ---------- 音效（Web Audio 合成） ----------
  let ac = null;
  function tone(f, t0, d, type = 'sine', v = .14) {
    if (!sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + t0;
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + .03);
    } catch { /* 沒有音效裝置就略過 */ }
  }
  const sfx = {
    tick() { tone(660, 0, .12); tone(990, .09, .2); },
    untick() { tone(330, 0, .14, 'triangle'); },
    star() { tone(1320, 0, .07, 'sine', .06); },
    coin() { tone(880, 0, .1, 'square', .05); tone(1175, .09, .22, 'square', .05); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .13, .32, 'triangle', .17)); tone(1319, .55, .7, 'triangle', .17); },
  };
  const buzz = (n) => { try { if (!isCalm() && navigator.vibrate) navigator.vibrate(n); } catch { /* 忽略 */ } };

  // ---------- 數字滾動 ----------
  function countTo(el, to, ms = 600) {
    if (!el) return;
    const from = Number(el.dataset.v ?? String(el.textContent).replace(/[^\d-]/g, '')) || 0;
    el.dataset.v = to;
    if (isCalm() || from === to) { el.textContent = to.toLocaleString(); return; }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.max(0, Math.min(1, (t - t0) / ms));
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function bump(el) {
    if (!el) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  // ---------- 星星飛向積分、打卡爆開 ----------
  function flyStars(from, to, n) {
    if (isCalm() || !from || !to) { bump(to); return; }
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    n = Math.max(1, Math.min(5, n));
    for (let k = 0; k < n; k++) {
      const s = document.createElement('div');
      s.className = 'fx-flyer'; s.textContent = '⭐';
      const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, dx = b.left + b.width / 2 - x0, dy = b.top + b.height / 2 - y0, w = (Math.random() - .5) * 140;
      s.style.left = x0 + 'px'; s.style.top = y0 + 'px';
      document.body.appendChild(s);
      const an = s.animate([
        { transform: 'translate(-50%,-50%) scale(.5)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * .45 + w}px), calc(-50% + ${dy * .45 - 90}px)) scale(1.35)`, opacity: 1, offset: .45 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.45)`, opacity: .9 },
      ], { duration: 780 + k * 80, delay: k * 70, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' });
      an.onfinish = () => { s.remove(); sfx.star(); if (k === n - 1) bump(to); };
    }
  }
  function burst(el) {
    if (isCalm() || !el) return;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const cols = ['#ffb703', '#fb5607', '#ff006e', '#3a86ff', '#06d6a0'];
    for (let k = 0; k < 10; k++) {
      const p = document.createElement('div');
      p.className = 'fx-spark'; p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.background = cols[k % cols.length];
      document.body.appendChild(p);
      const ang = (k / 10) * Math.PI * 2, d = 34 + Math.random() * 30;
      p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * d}px), calc(-50% + ${Math.sin(ang) * d}px)) scale(.2)`, opacity: 0 }],
      { duration: 520, easing: 'ease-out' }).onfinish = () => p.remove();
    }
  }

  return {
    sfx, buzz, countTo, bump, flyStars, burst, isCalm,
    get sound() { return sound; }, get calm() { return calm; },
    setSound(v) { sound = !!v; save(); if (sound) sfx.tick(); },
    setCalm(v) { calm = !!v; save(); },
  };
})();
