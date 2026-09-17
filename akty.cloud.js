/* Облако Drive. Канон один на все устройства. */
(function () {
  const FOLDER_ID = "1RUbdFYVPoqhdFWtUpmIEzUXq9NaHpr4z";
  const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive";
  const DB_NAME = "miskhub-akty";
  const C = { token: "", busy: false };
  const $ = (id) => document.getElementById(id);
  function status(t) { if ($("cloudStatus")) $("cloudStatus").textContent = t; }
  function clientId() { return (localStorage.getItem("miskhub.googleClientId") || "").trim(); }
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbGet(store, key) {
    return openDb().then((db) => new Promise((res, rej) => {
      const rq = db.transaction(store, "readonly").objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    }));
  }
  function idbPut(store, key, val) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    }));
  }
  function idbAll(store) {
    return openDb().then((db) => new Promise((res, rej) => {
      const out = []; const rq = db.transaction(store, "readonly").objectStore(store).openCursor();
      rq.onsuccess = (e) => { const c = e.target.result; if (!c) return res(out); out.push({ key: c.key, value: c.value }); c.continue(); };
      rq.onerror = () => rej(rq.error);
    }));
  }
  function api(path) {
    return fetch("https://www.googleapis.com/drive/v3/" + path, { headers: { Authorization: "Bearer " + C.token } })
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); const ct = r.headers.get("content-type") || ""; return ct.includes("json") ? r.json() : r.text(); });
  }
  function findFile(name) {
    const q = encodeURIComponent("'" + FOLDER_ID + "' in parents and name = '" + name + "' and trashed = false");
    return api("files?q=" + q + "&fields=files(id,name)&pageSize=5").then((d) => (d.files && d.files[0]) || null);
  }
  async function upsert(name, blob, mime) {
    const existing = await findFile(name);
    const boundary = "miskhub" + Date.now();
    const meta = { name: name, parents: [FOLDER_ID] };
    const head = existing ? "" : "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n";
    const bodyHead = "--" + boundary + "\r\nContent-Type: " + mime + "\r\n\r\n";
    const tail = "\r\n--" + boundary + "--";
    const buf = new Uint8Array(await blob.arrayBuffer());
    const enc = new TextEncoder();
    const parts = existing ? [enc.encode(bodyHead), buf, enc.encode(tail)] : [enc.encode(head), enc.encode(bodyHead), buf, enc.encode(tail)];
    let n = 0; parts.forEach((p) => n += p.length);
    const all = new Uint8Array(n); let o = 0; parts.forEach((p) => { all.set(p, o); o += p.length; });
    const url = existing ? "https://www.googleapis.com/upload/drive/v3/files/" + existing.id + "?uploadType=multipart" : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const r = await fetch(url, { method: existing ? "PATCH" : "POST", headers: { Authorization: "Bearer " + C.token, "Content-Type": "multipart/related; boundary=" + boundary }, body: all });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function downloadBlob(id) {
    const r = await fetch("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media", { headers: { Authorization: "Bearer " + C.token } });
    if (!r.ok) throw new Error("download");
    return r.blob();
  }
  async function pushCloud() {
    if (!C.token || C.busy) return; C.busy = true; status("пишу в Drive…");
    try {
      const meta = (await idbGet("meta", "state")) || {};
      const snaps = await idbAll("snapshots");
      const payload = { dumpName: meta.dumpName || "", actDate: meta.actDate || "", rows: meta.rows || [], snapshots: snaps.map((x) => x.value), updatedAt: new Date().toISOString() };
      await upsert("project.json", new Blob([JSON.stringify(payload)], { type: "application/json" }), "application/json");
      const photos = await idbAll("photos");
      for (const { key, value } of photos) {
        if (!value || !value.blob) continue;
        await upsert(value.name || key + ".jpg", value.blob, value.blob.type || "image/jpeg");
      }
      status("облако обновлено " + new Date().toLocaleTimeString());
    } catch (e) { console.error(e); status("не удалось записать в Drive"); }
    C.busy = false;
  }
  async function pullCloud() {
    if (!C.token || C.busy) return; C.busy = true; status("читаю Drive…");
    try {
      const pf = await findFile("project.json");
      if (pf) {
        const data = JSON.parse(await (await downloadBlob(pf.id)).text());
        await idbPut("meta", "state", { rows: data.rows || [], dumpName: data.dumpName || "", actDate: data.actDate || "" });
      }
      const q = encodeURIComponent("'" + FOLDER_ID + "' in parents and trashed = false");
      const list = await api("files?q=" + q + "&fields=files(id,name)&pageSize=200");
      for (const f of list.files || []) {
        const m = String(f.name).match(/^(\d+)_([12])\./i);
        if (!m) continue;
        const blob = await downloadBlob(f.id);
        await idbPut("photos", m[1] + "_" + m[2], { blob: blob, name: f.name });
      }
      status("забрано, обновляю страницу…");
      setTimeout(() => location.reload(), 400);
    } catch (e) { console.error(e); status("не удалось прочитать Drive"); C.busy = false; }
  }
  function ensureGis(cb) {
    if (window.google && google.accounts && google.accounts.oauth2) return cb();
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.onload = cb; s.onerror = () => status("не загрузился Google Sign-In"); document.head.appendChild(s);
  }
  function login() {
    if (!clientId()) {
      const v = prompt("Google OAuth Client ID (Web application). Authorized origin: https://rakhmatullin.github.io");
      if (!v) return; localStorage.setItem("miskhub.googleClientId", v.trim());
    }
    ensureGis(() => {
      google.accounts.oauth2.initTokenClient({
        client_id: clientId(), scope: SCOPE,
        callback: (resp) => { if (resp.error) { status(resp.error); return; } C.token = resp.access_token; status("вход выполнен"); pullCloud(); }
      }).requestAccessToken();
    });
  }
  function bind() {
    $("btnCloudIn") && $("btnCloudIn").addEventListener("click", login);
    $("btnCloudPull") && $("btnCloudPull").addEventListener("click", () => { if (!C.token) return login(); pullCloud(); });
    $("btnCloudPush") && $("btnCloudPush").addEventListener("click", () => { if (!C.token) return login(); pushCloud(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})();
