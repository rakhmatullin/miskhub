/* Облако: Google Drive. Один проект на все устройства одного Google-аккаунта. */
(function () {
  const FOLDER_ID = "1RUbdFYVPoqhdFWtUpmIEzUXq9NaHpr4z";
  const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive";
  const C = { token: "", client: null, busy: false, last: "" };
  const $ = (id) => document.getElementById(id);
  function status(t) { if ($("cloudStatus")) $("cloudStatus").textContent = t; }
  function clientId() { return (localStorage.getItem("miskhub.googleClientId") || "").trim(); }
  function api(path, opt) {
    opt = opt || {};
    const headers = Object.assign({ Authorization: "Bearer " + C.token }, opt.headers || {});
    return fetch("https://www.googleapis.com/drive/v3/" + path, Object.assign({}, opt, { headers }))
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        if (opt.raw) return r;
        const ct = r.headers.get("content-type") || "";
        return ct.includes("json") ? r.json() : r.text();
      });
  }
  function findFile(name) {
    const q = encodeURIComponent("'" + FOLDER_ID + "' in parents and name = '" + name + "' and trashed = false");
    return api("files?q=" + q + "&fields=files(id,name,modifiedTime)&pageSize=5").then((d) => (d.files && d.files[0]) || null);
  }
  async function upsert(name, blob, mime) {
    const meta = { name: name, parents: [FOLDER_ID] };
    const existing = await findFile(name);
    const boundary = "miskhub" + Date.now();
    const head = existing ? "" : "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n";
    const bodyHead = "--" + boundary + "\r\nContent-Type: " + mime + "\r\n\r\n";
    const tail = "\r\n--" + boundary + "--";
    const buf = await blob.arrayBuffer();
    const enc = new TextEncoder();
    const parts = existing ? [enc.encode(bodyHead), new Uint8Array(buf), enc.encode(tail)] : [enc.encode(head), enc.encode(bodyHead), new Uint8Array(buf), enc.encode(tail)];
    let len = 0; parts.forEach((p) => { len += p.length; });
    const all = new Uint8Array(len); let o = 0; parts.forEach((p) => { all.set(p, o); o += p.length; });
    const url = existing ? "https://www.googleapis.com/upload/drive/v3/files/" + existing.id + "?uploadType=multipart" : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const r = await fetch(url, { method: existing ? "PATCH" : "POST", headers: { Authorization: "Bearer " + C.token, "Content-Type": "multipart/related; boundary=" + boundary }, body: all });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function downloadBlob(id) {
    const r = await fetch("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media", { headers: { Authorization: "Bearer " + C.token } });
    if (!r.ok) throw new Error("download " + id);
    return r.blob();
  }
  function projectPayload() {
    const S = window.MiskAkt.S;
    return { dumpName: S.dumpName, actDate: ($("actDate") && $("actDate").value) || "", rows: S.rows, snapshots: S.snapshots, updatedAt: new Date().toISOString() };
  }
  async function pushCloud() {
    if (!C.token || C.busy || !window.MiskAkt) return;
    C.busy = true; status("пишу в Drive…");
    try {
      await upsert("project.json", new Blob([JSON.stringify(projectPayload(), null, 2)], { type: "application/json" }), "application/json");
      for (const [key, ph] of window.MiskAkt.S.photos) {
        if (ph && ph.blob) await upsert(ph.name || key + ".jpg", ph.blob, ph.blob.type || "image/jpeg");
      }
      C.last = new Date().toLocaleTimeString(); status("облако обновлено " + C.last);
    } catch (e) { console.error(e); status("не удалось записать в Drive"); }
    C.busy = false;
  }
  async function pullCloud() {
    if (!C.token || !window.MiskAkt) return;
    C.busy = true; status("читаю Drive…");
    try {
      const pf = await findFile("project.json");
      if (pf) {
        const data = JSON.parse(await (await downloadBlob(pf.id)).text());
        const S = window.MiskAkt.S;
        if (Array.isArray(data.rows) && data.rows.length) {
          S.rows = data.rows; S.dumpName = data.dumpName || S.dumpName; S.snapshots = data.snapshots || S.snapshots;
          if (data.actDate && $("actDate")) $("actDate").value = data.actDate;
        }
      }
      const q = encodeURIComponent("'" + FOLDER_ID + "' in parents and trashed = false");
      const list = await api("files?q=" + q + "&fields=files(id,name,mimeType)&pageSize=200");
      for (const f of list.files || []) {
        const m = String(f.name).match(/^(\d+)_([12])\./i);
        if (!m) continue;
        await window.MiskAkt.photoPut(m[1] + "_" + m[2], await downloadBlob(f.id), f.name);
      }
      await window.MiskAkt.persistMeta(); window.MiskAkt.refresh(); status("забрано из Drive");
    } catch (e) { console.error(e); status("не удалось прочитать Drive"); }
    C.busy = false;
  }
  function ensureGis(cb) {
    if (window.google && google.accounts && google.accounts.oauth2) return cb();
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.onload = cb; s.onerror = () => status("не загрузился Google Sign-In"); document.head.appendChild(s);
  }
  function login() {
    const id = clientId();
    if (!id) {
      const v = prompt("Вставь Google OAuth Client ID (тип Web application, origin https://rakhmatullin.github.io)");
      if (!v) return; localStorage.setItem("miskhub.googleClientId", v.trim());
    }
    ensureGis(() => {
      C.client = google.accounts.oauth2.initTokenClient({
        client_id: clientId(), scope: SCOPE,
        callback: (resp) => { if (resp.error) { status(resp.error); return; } C.token = resp.access_token; status("вход выполнен"); pullCloud().then(() => pushCloud()); }
      });
      C.client.requestAccessToken();
    });
  }
  function bind() {
    $("btnCloudIn") && $("btnCloudIn").addEventListener("click", login);
    $("btnCloudPull") && $("btnCloudPull").addEventListener("click", () => { if (!C.token) return login(); pullCloud(); });
    $("btnCloudPush") && $("btnCloudPush").addEventListener("click", () => { if (!C.token) return login(); pushCloud(); });
    window.addEventListener("miskakt-changed", () => { if (C.token) { clearTimeout(C.t); C.t = setTimeout(pushCloud, 1200); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})();
