/*
 * Money Tracker - the app's connection to Google.
 *
 * Same api(action, payload) as the Apps Script server (Code.gs), but run in the app itself:
 * it calls the Google Sheets and Drive APIs directly with the signed-in person's own Google
 * token. The dashboard page is unchanged; it still calls google.script.run.api(...), which
 * this file provides. Google enforces who can read and write the sheet and the receipts.
 */
(function () {
  'use strict';
  const C = window.MT_CONFIG;
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/' + C.sheetId;
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const TAB = { tx: 'Transactions', src: 'Sources', cat: 'Categories', rep: 'Report', set: 'Settings' };
  const TX_COLS = 13, RECEIPT_COL = 17, MAX_PER_ENTRY = 10, MAX_BYTES = 300 * 1024;
  const TYPES = ['Income', 'Expense', 'Transfer'];
  const KINDS = ['Bank', 'E-Wallet', 'Cash', 'Credit Card', 'Investment', 'Other'];
  const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' };
  const FOLDER_NAME = 'Money Tracker Receipts';
  const enc = encodeURIComponent;
  const JSONH = { 'Content-Type': 'application/json' };

  /* ======================= sign-in (Google Identity Services) ======================= */
  let token = null, tokenExp = 0, tokenClient = null, pendingAuth = null;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } }
  };
  // A token lasts about an hour; keeping it lets the app reopen within that hour without a new sign-in.
  try { const t = JSON.parse(store.get('mt.token') || 'null'); if (t && t.exp > Date.now() + 60000) { token = t.v; tokenExp = t.exp; } } catch (e) { }
  const saveToken = () => store.set('mt.token', JSON.stringify({ v: token, exp: tokenExp }));
  function clearToken() { token = null; tokenExp = 0; store.set('mt.token', null); }

  function tokenClientOnce() {
    if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: C.clientId, scope: C.scopes, callback: () => { } });
    return tokenClient;
  }
  function ensureToken() {
    if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
    if (!pendingAuth) pendingAuth = new Promise(resolve => signInScreen(resolve));
    return pendingAuth;
  }

  /* The sign-in screen: Google only allows its window to open from a tap, so the app asks for one. */
  function signInScreen(done) {
    const returning = !!store.get('mt.email');
    let el = document.getElementById('mt-signin');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mt-signin';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'mt-signin-title');
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="mt-signin-card">
        <img src="icons/icon-192.png" alt="" width="72" height="72">
        <h1 id="mt-signin-title">${returning ? 'Continue to Money Tracker' : 'Money Tracker'}</h1>
        <p>${returning ? 'Your Google session ended. Continue with Google to keep using your sheet.' : 'Sign in with the Google account that has your Money Tracker sheet.'}</p>
        <button type="button" class="mt-google-btn">
          <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.2-13.6-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>
          <span>Continue with Google</span></button>
        <p class="mt-signin-msg" role="alert"></p>
        <p class="mt-signin-small">Money Tracker reads and writes your Money Tracker sheet and its receipts folder in Google Drive. Nothing is stored anywhere else.</p>
      </div>`;
    el.hidden = false;
    const msg = el.querySelector('.mt-signin-msg');
    el.querySelector('.mt-google-btn').onclick = () => {
      msg.textContent = '';
      const tc = tokenClientOnce();
      tc.callback = resp => {
        if (resp.error) { msg.textContent = resp.error === 'access_denied' ? 'Access wasn’t allowed. Money Tracker needs your sheet and Drive to work.' : 'Sign-in didn’t finish. Try again.'; return; }
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive')) {
          msg.textContent = 'Please tick both boxes (Sheets and Drive) when Google asks. Money Tracker can’t work without them.'; return;
        }
        token = resp.access_token; tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000; saveToken();
        el.hidden = true; pendingAuth = null; done(token);
      };
      tc.error_callback = err => {
        msg.textContent = err && err.type === 'popup_closed' ? 'The Google window was closed. Tap Continue with Google again.'
          : err && err.type === 'popup_failed_to_open' ? 'Your browser blocked the Google window. Allow pop-ups for this site, then try again.'
          : 'Sign-in didn’t finish. Try again.';
      };
      const hint = store.get('mt.email');
      tc.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: '' });
    };
  }

  window.MTAuth = {
    signOut() {
      const t = token; clearToken(); store.set('mt.email', null);
      try { if (t) google.accounts.oauth2.revoke(t, () => location.reload()); else location.reload(); } catch (e) { location.reload(); }
    },
    email: () => store.get('mt.email')
  };

  /* ======================= Google API calls ======================= */
  class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
  async function gfetch(url, opts, retried) {
    const t = await ensureToken();
    const res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, (opts && opts.headers) || {}, { Authorization: 'Bearer ' + t }) }));
    if (res.status === 401 && !retried) { clearToken(); return gfetch(url, opts, true); }
    if (!res.ok) {
      let detail = ''; try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) { }
      throw new ApiError(detail || ('Google answered ' + res.status), res.status);
    }
    return res;
  }
  const gjson = async (url, opts) => (await gfetch(url, opts)).json();

  async function getRanges(ranges) {
    const q = ranges.map(r => 'ranges=' + enc(r)).join('&');
    let j;
    try { j = await gjson(`${SHEETS}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`); }
    catch (e) { if (e.status === 403 || e.status === 404) throw new Error('NO_ACCESS:' + (store.get('mt.email') || '')); throw e; }
    return (j.valueRanges || []).map(v => v.values || []);
  }
  const getRange = async r => (await getRanges([r]))[0];
  const putValues = data => gjson(`${SHEETS}/values:batchUpdate`, { method: 'POST', headers: JSONH, body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  async function appendRow(range, row) {
    const j = await gjson(`${SHEETS}/values/${enc(range)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`,
      { method: 'POST', headers: JSONH, body: JSON.stringify({ values: [row] }) });
    const m = ((j.updates && j.updates.updatedRange) || '').match(/![A-Z]+(\d+)/);
    return m ? +m[1] : 0;
  }
  let gids = null;
  async function gid(title) {
    if (!gids) {
      const j = await gjson(`${SHEETS}?fields=sheets.properties(sheetId,title)`);
      gids = {}; (j.sheets || []).forEach(s => { gids[s.properties.title] = s.properties.sheetId; });
    }
    if (!(title in gids)) throw new Error('MISSING_TAB:' + title);
    return gids[title];
  }
  async function deleteRow(tab, row) {
    await gjson(`${SHEETS}:batchUpdate`, { method: 'POST', headers: JSONH,
      body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: await gid(tab), dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] }) });
  }
  /** Row number of an id in column A (rows start at 2), or the first free row after the last id. */
  async function findRow(tab, id) {
    const ids = await getRange(`${tab}!A2:A`);
    let last = 1;
    for (let i = 0; i < ids.length; i++) {
      const v = str_(ids[i] && ids[i][0]);
      if (v && v === id) return { row: i + 2, next: 0 };
      if (v) last = i + 2;
    }
    return { row: -1, next: last + 1 };
  }

  /* ======================= who is signed in, who has access ======================= */
  let meP = null;
  function me() {
    if (!meP) meP = gjson('https://openidconnect.googleapis.com/v1/userinfo').then(u => {
      const email = String(u.email || '').toLowerCase();
      if (!email) throw new Error('NOT_SIGNED_IN');
      store.set('mt.email', email);
      return email;
    }).catch(e => { meP = null; throw e; });
    return meP;
  }
  let accessCache = null;
  async function accessList(fresh) {
    if (!fresh && accessCache && Date.now() - accessCache.at < 300000) return accessCache.v;
    let owner = '', editors = [];
    try {
      const j = await gjson(`${DRIVE}/files/${C.sheetId}/permissions?fields=permissions(id,emailAddress,role,type)&supportsAllDrives=true`);
      (j.permissions || []).forEach(p => {
        const e = String(p.emailAddress || '').toLowerCase();
        if (p.role === 'owner') owner = e; else if (p.type === 'user' && (p.role === 'writer' || p.role === 'organizer' || p.role === 'fileOrganizer') && e) editors.push(e);
      });
    } catch (e) { /* people who can't list sharing still use the sheet; Google enforces access */ }
    const v = { owner, editors: editors.filter(e => e !== owner) };
    accessCache = { at: Date.now(), v };
    return v;
  }

  /* ======================= values, same rules as Code.gs ======================= */
  const pad = n => ('0' + n).slice(-2);
  const clean_ = (v, max) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  const bool_ = v => String(v).toUpperCase() !== 'FALSE';
  function str_(v) { return v == null ? '' : String(v).trim(); }
  const serial = v => new Date(Math.round((v - 25569) * 86400000));         // sheet day number -> date
  function date_(v) {
    if (typeof v === 'number') { const d = serial(v); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    const s = str_(v); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? m[3] + '-' + pad(m[2]) + '-' + pad(m[1]) : '';
  }
  const stamp_ = v => typeof v === 'number' ? serial(v).toISOString() : str_(v);
  function num_(v) {
    if (typeof v === 'number') return v;
    const s = str_(v); if (!s) return 0;
    const neg = /^\(.*\)$/.test(s) || s.indexOf('-') >= 0;
    const n = parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : (neg ? -n : n);
  }
  const receiptLink = id => 'https://drive.google.com/file/d/' + id + '/view';
  const receiptIdOf = v => { const s = str_(v), m = s.match(/\/d\/([\w-]{10,})/); return m ? m[1] : s; };
  const receiptIdsOf = v => str_(v).split(/[\r\n]+/).map(receiptIdOf).filter(Boolean);
  const knownReceipts = new Set();   // ids the sheet links to, as of the last read or save
  function txFromRow(r) {
    return {
      id: str_(r[0]), date: date_(r[1]), type: TYPES.indexOf(str_(r[2])) >= 0 ? str_(r[2]) : 'Expense',
      amount: Math.abs(num_(r[3])), currency: str_(r[4]) || 'IDR',
      sourceId: str_(r[5]), toSourceId: str_(r[6]), categoryId: str_(r[7]), note: str_(r[8]),
      createdAt: stamp_(r[9]), updatedAt: stamp_(r[10]), createdBy: str_(r[11]), updatedBy: str_(r[12])
    };
  }
  /** Input time in Jakarta, e.g. 2026-11-22_16-40-05 (receipt file names). */
  function stampNow() {
    const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: C.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}`;
  }

  /* ======================= reading ======================= */
  async function getData(email) {
    const [[tx, src, cat], access] = await Promise.all([
      getRanges([`${TAB.tx}!A2:Q`, `${TAB.src}!A2:F`, `${TAB.cat}!A2:E`]), accessList()
    ]);
    const isOwner = access.owner === email;
    if (isOwner) syncReceiptFolder(email).catch(() => { });           // keep the receipts folder shared, in the background
    return {
      me: { email, isOwner }, access, sheetUrl: 'https://docs.google.com/spreadsheets/d/' + C.sheetId + '/edit',
      tx: tx.filter(r => str_(r[0])).map(r => { const t = txFromRow(r); t.receiptIds = receiptIdsOf(r[RECEIPT_COL - 1]); t.receiptIds.forEach(x => knownReceipts.add(x)); return t; }).filter(t => t.date),
      sources: src.filter(r => str_(r[0])).map(r => ({ id: str_(r[0]), name: str_(r[1]) || 'Unnamed', kind: str_(r[2]) || 'Other', opening: num_(r[3]), currency: str_(r[4]) || 'IDR', active: bool_(r[5]) })),
      cats: cat.filter(r => str_(r[0])).map(r => ({ id: str_(r[0]), name: str_(r[1]) || 'Unnamed', type: str_(r[2]) === 'Income' ? 'Income' : 'Expense', budget: num_(r[3]), active: bool_(r[4]) }))
    };
  }

  /* ======================= receipts: one Drive folder, JPEG or PNG, max 300 KB ======================= */
  let folderP = null;
  /** The "Money Tracker Receipts" folder. Its id is kept in the sheet's Settings tab (receipt_folder_id). */
  function receiptFolder(email) {
    if (!folderP) folderP = (async () => {
      const rows = await getRange(`${TAB.set}!A2:B50`);
      const hit = rows.find(r => str_(r[0]) === 'receipt_folder_id' && str_(r[1]));
      if (hit) return str_(hit[1]);
      if ((await accessList()).owner !== email) throw new Error('RECEIPT_FOLDER_NOT_READY');
      const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'me' in owners`;
      const found = await gjson(`${DRIVE}/files?q=${enc(q)}&fields=files(id)&pageSize=1`);
      const id = (found.files && found.files[0] && found.files[0].id) ||
        (await gjson(`${DRIVE}/files?fields=id`, { method: 'POST', headers: JSONH, body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) })).id;
      await appendRow(`${TAB.set}!A1:B1`, ['receipt_folder_id', id]);
      return id;
    })().catch(e => { folderP = null; throw e; });
    return folderP;
  }
  /** Owner only, at most every 6 hours: everyone who can use the sheet can add to the receipts folder. */
  async function syncReceiptFolder(email) {
    if (Date.now() - Number(store.get('mt.folderSync') || 0) < 6 * 3600000) return;
    const folder = await receiptFolder(email), access = await accessList();
    const j = await gjson(`${DRIVE}/files/${folder}/permissions?fields=permissions(emailAddress,role)`);
    const have = (j.permissions || []).map(p => String(p.emailAddress || '').toLowerCase());
    for (const e of access.editors) if (have.indexOf(e) < 0) await sharePerm(folder, e);
    store.set('mt.folderSync', String(Date.now()));
  }
  const sharePerm = (fileId, email) => gjson(`${DRIVE}/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
    { method: 'POST', headers: JSONH, body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }) });
  async function unsharePerm(fileId, email) {
    const j = await gjson(`${DRIVE}/files/${fileId}/permissions?fields=permissions(id,emailAddress)&supportsAllDrives=true`);
    const p = (j.permissions || []).find(x => String(x.emailAddress || '').toLowerCase() === email);
    if (p) await gfetch(`${DRIVE}/files/${fileId}/permissions/${p.id}?supportsAllDrives=true`, { method: 'DELETE' });
  }
  function b64ToBytes(b64) { const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  async function storeReceipt(email, rec, baseName) {
    const ext = rec && RECEIPT_TYPES[rec.mimeType];
    if (!ext) throw new Error('INVALID: the receipt must be a JPG or PNG image');
    if (typeof rec.data !== 'string' || !rec.data) throw new Error('INVALID: receipt image');
    const bytes = b64ToBytes(rec.data);
    if (bytes.length > MAX_BYTES) throw new Error('INVALID: the receipt image is larger than 300 KB');
    const folder = await receiptFolder(email), boundary = 'mt' + Math.random().toString(36).slice(2);
    const meta = { name: baseName + '.' + ext, parents: [folder], mimeType: rec.mimeType };
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${rec.mimeType}\r\n\r\n`,
      bytes, `\r\n--${boundary}--`]);
    const j = await gjson(`${UPLOAD}?uploadType=multipart&fields=id&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
    return j.id;
  }
  async function removeReceiptFile(email, fileId) {
    try { await gjson(`${DRIVE}/files/${fileId}?supportsAllDrives=true`, { method: 'PATCH', headers: JSONH, body: JSON.stringify({ trashed: true }) }); }
    catch (e) {   // saved by someone else: take it out of the folder instead
      try { const f = await receiptFolder(email); await gjson(`${DRIVE}/files/${fileId}?removeParents=${f}&supportsAllDrives=true`, { method: 'PATCH', headers: JSONH, body: '{}' }); } catch (e2) { }
    }
  }
  async function readReceipt(fileId) {
    if (!fileId) throw new Error('MISSING');
    if (!knownReceipts.has(fileId)) {   // only images linked from the sheet can be opened here
      const q = await getRange(`${TAB.tx}!Q2:Q`);
      if (!q.some(r => receiptIdsOf(r && r[0]).indexOf(fileId) >= 0)) throw new Error('MISSING');
      knownReceipts.add(fileId);
    }
    const res = await gfetch(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`);
    const blob = await res.blob();
    const data = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = no; fr.readAsDataURL(blob); });
    return { mimeType: blob.type || res.headers.get('Content-Type') || 'image/jpeg', data };
  }

  /* ======================= writing (by id: an existing row is overwritten, never duplicated) ======================= */
  async function saveTx(email, p) {
    const id = clean_(p.id, 60);
    if (!/^[\w-]+$/.test(id)) throw new Error('INVALID: entry ID');
    const type = p.type;
    if (TYPES.indexOf(type) < 0) throw new Error('INVALID: type');
    const amount = Number(p.amount);
    if (!isFinite(amount) || amount <= 0) throw new Error('INVALID: amount must be above 0');
    const date = String(p.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID: date');
    const sourceId = clean_(p.sourceId, 60);
    if (!sourceId) throw new Error('INVALID: choose a source');
    const toSourceId = type === 'Transfer' ? clean_(p.toSourceId, 60) : '';
    if (type === 'Transfer' && (!toSourceId || toSourceId === sourceId)) throw new Error('INVALID: a transfer needs two different sources');
    const categoryId = type === 'Transfer' ? '' : clean_(p.categoryId, 60);
    if (type !== 'Transfer' && !categoryId) throw new Error('INVALID: choose a category');

    const drop = Array.isArray(p.removeReceipts) ? p.removeReceipts.map(String) : [];
    const adds = Array.isArray(p.receipts) ? p.receipts : (p.receipt ? [p.receipt] : []);
    const errors = [], stamp = stampNow(), list = adds.slice(0, MAX_PER_ENTRY);
    // New images upload while the entry's row is being looked up (both go to Google at once).
    const uploads = Promise.all(list.map((rec, i) => storeReceipt(email, rec, list.length > 1 ? stamp + '_' + (i + 1) : stamp)
      .catch(e => { errors.push(String((e && e.message) || e)); return null; })));
    const [ids, olds] = await getRanges([`${TAB.tx}!A2:A`, `${TAB.tx}!J2:Q`]);
    let row = -1, last = 1;
    for (let i = 0; i < ids.length; i++) { const v = str_(ids[i] && ids[i][0]); if (v === id) { row = i + 2; break; } if (v) last = i + 2; }
    const now = new Date().toISOString();
    let createdAt = now, createdBy = email, oldQ = '';
    if (row > 0) {
      const old = olds[row - 2] || [];
      createdAt = stamp_(old[0]) || now; createdBy = str_(old[2]) || email; oldQ = old[7];
    } else if (!p.isNew) { (await uploads).filter(Boolean).forEach(f => removeReceiptFile(email, f)); throw new Error('MISSING'); }

    // Receipts: removals, then the new images (each passed the JPG/PNG, 300 KB rule; max 10 per entry).
    let receiptIds = receiptIdsOf(oldQ);
    if (drop.length) {
      await Promise.all(receiptIds.filter(r => drop.indexOf(r) >= 0).map(r => removeReceiptFile(email, r)));
      receiptIds = receiptIds.filter(r => drop.indexOf(r) < 0);
    }
    let stored = (await uploads).filter(Boolean);
    const room = MAX_PER_ENTRY - receiptIds.length;
    if (stored.length > room) {   // over the limit: keep what fits, remove the rest again
      errors.push('INVALID: an entry can hold up to ' + MAX_PER_ENTRY + ' receipts');
      stored.slice(Math.max(0, room)).forEach(f => removeReceiptFile(email, f));
      stored = stored.slice(0, Math.max(0, room));
    }
    receiptIds = receiptIds.concat(stored);
    receiptIds.forEach(x => knownReceipts.add(x));
    const qChanged = drop.length || adds.length;

    const vals = [id, date, type, amount, clean_(p.currency, 5) || 'IDR', sourceId, toSourceId, categoryId,
      clean_(p.note, 200), createdAt, now, createdBy, email];
    const qText = receiptIds.map(receiptLink).join('\n');
    if (row > 0) {
      const data = [{ range: `${TAB.tx}!A${row}:M${row}`, values: [vals] }];
      if (qChanged) data.push({ range: `${TAB.tx}!Q${row}`, values: [[qText]] });
      await putValues(data);
    } else {
      // New entry: write the whole row (with its receipt links) at the first free row in one request.
      const at = last + 1;
      const data = [{ range: `${TAB.tx}!A${at}:M${at}`, values: [vals] }];
      if (qChanged) data.push({ range: `${TAB.tx}!Q${at}`, values: [[qText]] });
      await putValues(data);
    }
    const out = txFromRow(vals); out.receiptIds = receiptIds;
    return { id, tx: out, receiptError: errors.join('; ') };
  }

  async function deleteTx(email, id) {
    id = String(id || '');
    const [ids, qs] = await getRanges([`${TAB.tx}!A2:A`, `${TAB.tx}!Q2:Q`]);
    const i = ids.findIndex(r => str_(r && r[0]) === id);
    if (!id || i < 0) throw new Error('MISSING');
    await deleteRow(TAB.tx, i + 2);
    // The entry is gone now; its receipt files go to the Drive bin in the background.
    receiptIdsOf(qs[i] && qs[i][0]).forEach(r => { knownReceipts.delete(r); removeReceiptFile(email, r).catch(() => { }); });
    return { id };
  }
  async function deleteById(tab, id) {
    const f = await findRow(tab, String(id || ''));
    if (f.row < 0) throw new Error('MISSING');
    await deleteRow(tab, f.row);
    return { id };
  }
  async function deleteUnused(tab, id) {
    id = String(id || '');
    const rows = await getRange(`${TAB.tx}!F2:H`);
    if (rows.some(r => r && (str_(r[0]) === id || str_(r[1]) === id || str_(r[2]) === id))) throw new Error('IN_USE');
    return deleteById(tab, id);
  }
  async function saveNamed(tab, width, p, buildRow) {
    const id = clean_(p.id, 60), name = clean_(p.name, 80);
    if (!/^[\w-]+$/.test(id)) throw new Error('INVALID: ID');
    if (!name) throw new Error('INVALID: give it a name');
    const rows = await getRange(`${tab}!A2:B`);
    if (rows.some(r => r && str_(r[0]) && str_(r[0]) !== id && str_(r[1]).toLowerCase() === name.toLowerCase())) throw new Error('DUPLICATE_NAME');
    const f = await findRow(tab, id);
    const row = buildRow(id, name);
    if (f.row > 0) await putValues([{ range: `${tab}!A${f.row}:${String.fromCharCode(64 + width)}${f.row}`, values: [row] }]);
    else if (p.isNew) await appendRow(`${tab}!A1:${String.fromCharCode(64 + width)}1`, row);
    else throw new Error('MISSING');
    return { id };
  }
  const saveSource = p => saveNamed(TAB.src, 6, p, (id, name) => [id, name, KINDS.indexOf(p.kind) >= 0 ? p.kind : 'Other', Number(p.opening) || 0, 'IDR', p.active ? 'TRUE' : 'FALSE']);
  const saveCategory = p => saveNamed(TAB.cat, 5, p, (id, name) => [id, name, p.type === 'Income' ? 'Income' : 'Expense', Math.max(0, Number(p.budget) || 0), p.active ? 'TRUE' : 'FALSE']);

  async function writeReport(rows) {
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('INVALID: report');
    const clean = rows.map(r => { const out = []; for (let i = 0; i < 6; i++) { const v = Array.isArray(r) ? r[i] : ''; out.push(typeof v === 'number' && isFinite(v) ? v : clean_(v, 500)); } return out; });
    await gjson(`${SHEETS}/values/${enc(TAB.rep + '!A1:F10000')}:clear`, { method: 'POST', headers: JSONH, body: '{}' });
    if (clean.length) await putValues([{ range: `${TAB.rep}!A1:F${clean.length}`, values: clean }]);
    return { rows: clean.length };
  }

  async function changeAccess(me_, target, add) {
    const access = await accessList(true);
    if (access.owner !== me_) throw new Error('NOT_OWNER');
    const email = String(target || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVALID: enter a valid Google email address');
    if (email === access.owner) throw new Error('CANNOT_REMOVE_OWNER');
    if (add) await sharePerm(C.sheetId, email); else await unsharePerm(C.sheetId, email);
    try { const folder = await receiptFolder(me_); if (add) await sharePerm(folder, email); else await unsharePerm(folder, email); } catch (e) { }
    return accessList(true);
  }

  /* ======================= api: same actions and answers as Code.gs ======================= */
  async function api(action, payload) {
    const t0 = Date.now(), p = payload || {};
    if (action === 'ping') return { ok: true, data: null };
    try {
      const email = await me();
      const andData = async r => ({ result: r, data: await getData(email) });
      const timed = r => ({ ok: true, data: { result: r, serverMs: Date.now() - t0 } });
      switch (action) {
        case 'getData': return { ok: true, data: await getData(email) };
        case 'saveTx': return timed(await saveTx(email, p));
        case 'deleteTx': return timed(await deleteTx(email, p.id));
        case 'getReceipt': return { ok: true, data: await readReceipt(String(p.id || '')) };
        case 'saveSource': return { ok: true, data: await andData(await saveSource(p)) };
        case 'deleteSource': return { ok: true, data: await andData(await deleteUnused(TAB.src, p.id)) };
        case 'saveCategory': return { ok: true, data: await andData(await saveCategory(p)) };
        case 'deleteCategory': return { ok: true, data: await andData(await deleteUnused(TAB.cat, p.id)) };
        case 'writeReport': return { ok: true, data: await writeReport(p.rows) };
        case 'addAccess': return { ok: true, data: await andData(await changeAccess(email, p.email, true)) };
        case 'removeAccess': return { ok: true, data: await andData(await changeAccess(email, p.email, false)) };
        default: throw new Error('INVALID: unknown action');
      }
    } catch (err) {
      if (err instanceof TypeError) throw err;                  // no connection: the page treats it as a network error
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* The page talks to "google.script.run.api(...)": answer it here instead of Apps Script. */
  function runner() {
    let ok = () => { }, fail = () => { };
    const r = {
      withSuccessHandler(f) { ok = f; return r; },
      withFailureHandler(f) { fail = f; return r; },
      api(a, p) { api(a, p).then(v => ok(v), e => fail(e)); }
    };
    return r;
  }
  window.google = window.google || {};
  window.google.script = { get run() { return runner(); } };
  window.MTBackend = { api };
})();
