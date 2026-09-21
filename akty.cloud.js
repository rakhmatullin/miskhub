/* общий state: kvs + github, IDB только кэш */
(function () {
  const REMOTE = "https://kvs.ix.workers.dev/miskhub-akty-state-rakhmatullin-2026.json";
  const FOTO_ZIPS = [
    "https://litter.catbox.moe/ws6pzp.zip",
    "https://litter.catbox.moe/zuacqz.zip",
    "https://corsproxy.io/?" + encodeURIComponent("https://litter.catbox.moe/ws6pzp.zip")
  ];
  const $ = (id) => document.getElementById(id);
  function status(t) { if ($("cloudStatus")) $("cloudStatus").textContent = t; }
  function emptyState() {
    return { rev: 0, updatedAt: 0, deletedPhotos: ["92_1","92_2","92_3"], comments: {}, sentActs: [], notes2812: "", rotate: {}, sortDir: 1 };
  }
  function normState(s) {
    const d = emptyState();
    if (!s || typeof s !== "object") return d;
    d.rev = Number(s.rev) || 0;
    d.updatedAt = Number(s.updatedAt) || 0;
    d.deletedPhotos = [...new Set([].concat(s.deletedPhotos || d.deletedPhotos).map(String))];
    d.comments = s.comments && typeof s.comments === "object" ? s.comments : {};
    d.sentActs = [...new Set([].concat(s.sentActs || []).map(String))];
    d.notes2812 = String(s.notes2812 || "");
    d.rotate = s.rotate && typeof s.rotate === "object" ? s.rotate : {};
    d.sortDir = s.sortDir === -1 ? -1 : 1;
    return d;
  }
  function mergeState(a, b) {
    const x = normState(a), y = normState(b);
    const newer = (y.updatedAt || 0) >= (x.updatedAt || 0) ? y : x;
    const older = newer === y ? x : y;
    return {
      rev: Math.max(x.rev, y.rev),
      updatedAt: Math.max(x.updatedAt || 0, y.updatedAt || 0),
      deletedPhotos: [...new Set(x.deletedPhotos.concat(y.deletedPhotos))],
      comments: Object.assign({}, older.comments, newer.comments),
      sentActs: [...new Set(x.sentActs.concat(y.sentActs))],
      notes2812: (y.updatedAt >= x.updatedAt ? y.notes2812 : x.notes2812) || x.notes2812 || y.notes2812,
      rotate: Object.assign({}, older.rotate, newer.rotate),
      sortDir: newer.sortDir
    };
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("miskhub-akty", 2);
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
  function idbPut(store, key, val) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    }));
  }
  function idbGet(store, key) {
    return openDb().then((db) => new Promise((res, rej) => {
      const rq = db.transaction(store, "readonly").objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    }));
  }
  function idbDel(store, key) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite"); tx.objectStore(store).delete(key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    }));
  }
  function idbKeys(store) {
    return openDb().then((db) => new Promise((res, rej) => {
      const out = [];
      const rq = db.transaction(store, "readonly").objectStore(store).openCursor();
      rq.onsuccess = (e) => { const cur = e.target.result; if (!cur) return res(out); out.push(String(cur.key)); cur.continue(); };
      rq.onerror = () => rej(rq.error);
    }));
  }
  async function pullRemote() {
    let s = emptyState();
    try {
      const r = await fetch(REMOTE + "?t=" + Date.now(), { cache: "no-store", mode: "cors" });
      if (r.ok) s = mergeState(s, await r.json());
    } catch (e) { console.warn("kvs", e); }
    try {
      const r = await fetch("./cloud/state.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) s = mergeState(s, await r.json());
    } catch (e) {}
    return s;
  }
  let pushTimer = 0;
  function schedulePush(state) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      fetch(REMOTE, { method: "PUT", mode: "cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(normState(state)) }).catch(function () {});
    }, 300);
  }
  async function loadProject() {
    const r = await fetch("./cloud/project.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("no project");
    const data = await r.json();
    let rows = Array.isArray(data.rows) ? data.rows.slice() : [];
    for (const f of (data.rowFiles || [])) {
      const p = await fetch("./cloud/" + f + "?t=" + Date.now(), { cache: "no-store" });
      if (p.ok) rows = rows.concat(await p.json());
    }
    data.rows = rows;
    return data;
  }
  async function ingestZip(buf, skip) {
    if (!window.JSZip) throw new Error("no jszip");
    const zip = await JSZip.loadAsync(buf);
    let n = 0;
    const jobs = [];
    zip.forEach((path, file) => {
      if (file.dir) return;
      const name = path.split("/").pop();
      const m = String(name).match(/^(\d+)_([123])\./i);
      if (!m) return;
      const key = m[1] + "_" + m[2];
      if (skip && skip.has(key)) return;
      jobs.push(file.async("blob").then((blob) => {
        return idbPut("photos", key, { blob: new Blob([blob], { type: "image/jpeg" }), name: name }).then(() => { n++; });
      }));
    });
    await Promise.all(jobs);
    return n;
  }
  async function loadFotos(skip) {
    let total = 0;
    for (const url of FOTO_ZIPS) {
      try {
        status("качаю фото…");
        const r = await fetch(url, { cache: "no-store", mode: "cors" });
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        if (buf.byteLength < 10000) continue;
        total += await ingestZip(buf, skip);
      } catch (e) { console.warn("foto zip", url, e); }
    }
    return total;
  }
  async function applyDeleted(deleted) {
    for (const key of deleted) { try { await idbDel("photos", key); } catch (e) {} }
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  async function start(forceRemote) {
    status("синхронизация…");
    try {
      const remote = await pullRemote();
      const data = await loadProject();
      const prev = (await idbGet("meta", "state")) || {};
      const merged = mergeState({
        comments: prev.comments || {}, sentActs: prev.sentActs || [], notes2812: prev.notes2812 || "",
        deletedPhotos: prev.deletedPhotos || [], rotate: prev.rotate || {}, sortDir: prev.sortDir || 1,
        updatedAt: prev.localUpdatedAt || 0
      }, remote);
      ["92_1","92_2","92_3"].forEach(function (k) { if (merged.deletedPhotos.indexOf(k) < 0) merged.deletedPhotos.push(k); });
      const localRows = Array.isArray(prev.rows) && prev.rows.length;
      const useRemoteRows = forceRemote || !localRows;
      const next = {
        rows: useRemoteRows ? (data.rows || []) : prev.rows,
        dumpName: useRemoteRows ? (data.dumpName || prev.dumpName || "") : (prev.dumpName || data.dumpName || ""),
        actDate: todayISO(),
        deletedPhotos: merged.deletedPhotos,
        sentActs: merged.sentActs,
        comments: merged.comments,
        notes2812: merged.notes2812,
        rotate: merged.rotate,
        sortDir: merged.sortDir,
        localUpdatedAt: Date.now(),
        updatedAt: merged.updatedAt
      };
      await idbPut("meta", "state", next);
      await applyDeleted(next.deletedPhotos);
      if ($("actDate")) $("actDate").value = next.actDate;
      const skip = new Set(next.deletedPhotos.map(String));
      const existing = await idbKeys("photos");
      existing.forEach(function (k) { skip.add(k); });
      next.deletedPhotos.forEach(function (k) { skip.add(k); });
      const fotos = await loadFotos(skip);
      schedulePush(merged);
      status("общее хранилище · строк " + (next.rows || []).length + " · фото +" + fotos);
      const flag = forceRemote ? "miskhub.cloud.forced" : "miskhub.cloud.applied8";
      if (!sessionStorage.getItem(flag)) { sessionStorage.setItem(flag, "1"); location.reload(); }
    } catch (e) { console.warn(e); status("синхронизация не удалась"); }
  }
  window.MiskSync = {
    async snapshotFromIdb() {
      const prev = (await idbGet("meta", "state")) || {};
      schedulePush(normState(Object.assign({}, prev, { updatedAt: Date.now() })));
    },
    async savePartial(patch) {
      const prev = (await idbGet("meta", "state")) || {};
      const next = Object.assign({}, prev, patch, { localUpdatedAt: Date.now() });
      if (patch.deletedPhotos) next.deletedPhotos = [...new Set([].concat(prev.deletedPhotos || [], patch.deletedPhotos))];
      await idbPut("meta", "state", next);
      if (patch.deletedPhotos) await applyDeleted(next.deletedPhotos);
      schedulePush(normState(next));
    }
  };
  setInterval(function () { if (window.MiskSync) window.MiskSync.snapshotFromIdb(); }, 5000);
  function bind() {
    if ($("btnCloudPull")) $("btnCloudPull").addEventListener("click", function () {
      sessionStorage.removeItem("miskhub.cloud.forced"); start(true);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); start(false); });
  else { bind(); start(false); }
})();
