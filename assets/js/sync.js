// Firebase 同步：家庭共用帳號登入 + Firestore。未啟用或離線時，網站照常用 localStorage。
const ELH_SYNC = (() => {
  const FB_VER = '10.14.1';
  let cfg = null, fb = null, readyP = null, state = 'off', chip = null;
  const LABEL = { off: '', login: '☁ 請登入', online: '☁ 已連線', offline: '☁ 離線（稍後自動同步）', error: '☁ 同步出錯' };

  function setState(s) {
    state = s;
    if (!LABEL[s]) { chip?.remove(); chip = null; return; }
    if (!chip) { chip = document.createElement('div'); chip.className = 'elh-sync'; document.body.appendChild(chip); }
    chip.textContent = LABEL[s]; chip.dataset.s = s;
  }

  function loginUI() {
    return new Promise((resolve) => {
      setState('login');
      const ov = document.createElement('div');
      ov.className = 'elh-login';
      ov.innerHTML = `<form class="elh-login-box">
        <h2>🔒 家庭密碼</h2>
        <p>這部裝置第一次使用，請輸入家庭密碼（之後會記住）。</p>
        <input type="password" id="elh-pw" class="form-control" autocomplete="current-password" placeholder="密碼" required>
        <div class="elh-login-err" id="elh-err"></div>
        <button class="btn btn-primary elh-btn" type="submit">進入</button>
        <button class="btn btn-link" type="button" id="elh-skip">先不同步，只用本機</button>
      </form>`;
      document.body.appendChild(ov);
      const form = ov.querySelector('form'), err = ov.querySelector('#elh-err');
      ov.querySelector('#elh-skip').onclick = () => { ov.remove(); setState('off'); resolve(false); };
      form.onsubmit = async (e) => {
        e.preventDefault(); err.textContent = '';
        try {
          await fb.authMod.signInWithEmailAndPassword(fb.auth, cfg.familyEmail, ov.querySelector('#elh-pw').value);
          ov.remove(); resolve(true);
        } catch (x) {
          err.textContent = /network/i.test(x.code || x.message) ? '連不上網路，請稍後再試。' : '密碼不正確。';
        }
      };
      ov.querySelector('#elh-pw').focus();
    });
  }

  function init() {
    readyP ||= (async () => {
      try { cfg = await (await fetch('config/firebase.json', { cache: 'no-cache' })).json(); } catch { cfg = null; }
      if (!cfg?.enabled || !cfg.firebase?.projectId) { setState('off'); return false; }
      try {
        const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
        const [appMod, authMod, fsMod] = await Promise.all([
          import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
        const app = appMod.initializeApp(cfg.firebase);
        const db = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }) }); // 離線寫入會排隊；可同時開多個分頁
        fb = { authMod, fsMod, auth: authMod.getAuth(app), db };
        await new Promise((res) => { const un = authMod.onAuthStateChanged(fb.auth, (u) => { un(); fb.user = u; res(); }); });
        if (!fb.user && !(await loginUI())) return false;
        setState(navigator.onLine ? 'online' : 'offline');
        window.addEventListener('online', () => setState('online'));
        window.addEventListener('offline', () => setState('offline'));
        ELH.hooks.onItemChange = (sid, id) => { pushItem(sid, id); };
        ELH.hooks.onSessionChange = (s) => { pushSession(s); };
        return true;
      } catch (e) { console.warn('Firebase init failed', e); setState('error'); return false; }
    })();
    return readyP;
  }

  const ok = async () => (await init()) && fb;

  async function pushItem(sid, id) {
    const f = await ok(); if (!f) return;
    const { doc, runTransaction } = f.fsMod;
    try {
      const ref = doc(f.db, 'students', sid, 'materials', id);
      const merged = await runTransaction(f.db, async (tx) => {
        const snap = await tx.get(ref);
        const m = ELH.mergeItem(ELH.getRaw(sid, id), snap.exists() ? snap.data() : {});
        tx.set(ref, { ...m, updatedAt: f.fsMod.serverTimestamp() }, { merge: true });
        return m;
      });
      ELH.applyRemote(sid, id, merged);
    } catch (e) { console.warn('pushItem', e); setState(navigator.onLine ? 'error' : 'offline'); }
  }

  async function pushSession(s) {
    const f = await ok(); if (!f) return;
    const { doc, setDoc, serverTimestamp } = f.fsMod;
    const { updatedLocal, ...clean } = s;
    try { await setDoc(doc(f.db, 'sessions', s.id), { ...clean, updatedAt: serverTimestamp() }, { merge: true }); }
    catch (e) { console.warn('pushSession', e); setState(navigator.onLine ? 'error' : 'offline'); }
  }

  // 從雲端拉取某位學生的進度與作答場次，合併到本機；回傳是否有成功連線
  async function pull(sid) {
    const f = await ok(); if (!f) return false;
    const { collection, getDocs, query, where } = f.fsMod;
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000));
      const [mats, sess] = await Promise.race([Promise.all([
        getDocs(collection(f.db, 'students', sid, 'materials')),
        getDocs(query(collection(f.db, 'sessions'), where('student', '==', sid))),
      ]), timeout]);
      mats.forEach((d) => ELH.applyRemote(sid, d.id, d.data()));
      sess.forEach((d) => ELH.mergeSession({ id: d.id, ...d.data(), updatedAt: undefined }));
      await pullTotals(sid); // 打卡積分總表（失敗不影響其他功能，例如安全規則還沒更新時）
      setState('online');
      return true;
    } catch (e) { console.warn('pull', e); setState(navigator.onLine ? 'error' : 'offline'); return false; }
  }
  // 每日打卡：起始總分與已確認的打卡積分（由同步程式寫入 checkin_totals/{孩子}）
  async function pullTotals(sid) {
    const f = await ok(); if (!f) return;
    try {
      const snap = await f.fsMod.getDoc(f.fsMod.doc(f.db, 'checkin_totals', sid));
      if (snap.exists()) ELH.setExtra(sid, { base: Number(snap.data().base) || 0, confirmed: Number(snap.data().confirmed) || 0 });
    } catch (e) { /* 沒有權限或離線就沿用本機快取 */ }
  }
  // 讓其他頁面（例如打卡頁）直接使用 Firestore
  async function getFs() { const f = await ok(); return f ? { db: f.db, fs: f.fsMod } : null; }
  async function pullAll(students) { return (await Promise.all(students.map((s) => pull(s.id)))).some(Boolean); }

  return { init, pull, pullAll, pullTotals, getFs, get state() { return state; } };
})();
