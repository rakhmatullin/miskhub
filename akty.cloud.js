/* общее хранилище: state + фото в KVS, IDB кэш */
(function () {
  const REMOTE = "https://kvs.ix.workers.dev/miskhub-akty-state-rakhmatullin-2026.json";
  const FOTO = function (key) { return "https://kvs.ix.workers.dev/miskhub-foto-" + key + ".jpg"; };
  const ZIPS = [
    "https://litter.catbox.moe/3ebvzg.zip",
    "https://litter.catbox.moe/ws6pzp.zip",
    "https://litter.catbox.moe/zuacqz.zip"
  ];
  const SEED_DEL = ["92_1","92_2","92_3","94_1","94_2","94_3"];
  const $ = function (id) { return document.getElementById(id); };
  function status(t) { if ($("cloudStatus")) $("cloudStatus").textContent = t; }
  function openDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open("miskhub-akty", 2);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { autoIncrement: true });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbPut(store, key, val) {
    return openDb().then(function (db) { return new Promise(function (res, rej) {
      const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(val, key);
      tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
    }); });
  }
  function idbGet(store, key) {
    return openDb().then(function (db) { return new Promise(function (res, rej) {
      const rq = db.transaction(store, "readonly").objectStore(store).get(key);
      rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); };
    }); });
  }
  function idbDel(store, key) {
    return openDb().then(function (db) { return new Promise(function (res, rej) {
      const tx = db.transaction(store, "readwrite"); tx.objectStore(store).delete(key);
      tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
    }); });
  }
  function idbKeys(store) {
    return openDb().then(function (db) { return new Promise(function (res, rej) {
      const out = [];
      const rq = db.transaction(store, "readonly").objectStore(store).openCursor();
      rq.onsuccess = function (e) { const cur = e.target.result; if (!cur) return res(out); out.push(String(cur.key)); cur.continue(); };
      rq.onerror = function () { rej(rq.error); };
    }); });
  }
  function union(a, b) { return Array.from(new Set([].concat(a || [], b || []).map(String))); }
  async function getRemote() {
    try {
      const r = await fetch(REMOTE + "?t=" + Date.now(), { cache: "no-store", mode: "cors" });
      if (r.ok) return await r.json();
    } catch (e) {}
    try {
      const r = await fetch("./cloud/state.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (e) {}
    return {};
  }
  async function putRemote(state) {
    try {
      await fetch(REMOTE, { method: "PUT", mode: "cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
      return true;
    } catch (e) { return false; }
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
    if (!window.JSZip) return 0;
    const zip = await JSZip.loadAsync(buf);
    let n = 0;
    const jobs = [];
    zip.forEach(function (path, file) {
      if (file.dir) return;
      const name = path.split("/").pop();
      const m = String(name).match(/^(\d+)_([123])\./i);
      if (!m) return;
      const key = m[1] + "_" + m[2];
      if (skip.has(key)) return;
      jobs.push(file.async("blob").then(function (blob) {
        return idbPut("photos", key, { blob: new Blob([blob], { type: "image/jpeg" }), name: name }).then(function () { n++; });
      }));
    });
    await Promise.all(jobs);
    return n;
  }
  async function pullPhotos(keys, skip) {
    let n = 0;
    for (const key of keys || []) {
      if (skip.has(key)) continue;
      try {
        const r = await fetch(FOTO(key) + "?t=" + Date.now(), { cache: "no-store", mode: "cors" });
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        if (buf.byteLength < 40) continue;
        await idbPut("photos", key, { blob: new Blob([buf], { type: "image/jpeg" }), name: key + ".jpg" });
        n++;
      } catch (e) {}
    }
    return n;
  }
  async function pushPhoto(key, blob) {
    try {
      await fetch(FOTO(key), { method: "PUT", mode: "cors", headers: { "Content-Type": "image/jpeg" }, body: blob });
      return true;
    } catch (e) { return false; }
  }
  async function gatherState() {
    const prev = (await idbGet("meta", "state")) || {};
    const deleted = union(prev.deletedPhotos, SEED_DEL);
    const keys = await idbKeys("photos");
    return {
      rev: Date.now(),
      updatedAt: Date.now(),
      deletedPhotos: deleted,
      comments: prev.comments || {},
      sentActs: prev.sentActs || [],
      notes2812: prev.notes2812 || "",
      rotate: prev.rotate || {},
      rows: prev.rows || [],
      dumpName: prev.dumpName || "",
      photoKeys: keys.filter(function (k) { return deleted.indexOf(k) < 0; })
    };
  }
  let pushBusy = false;
  async function pushAll(alsoPhotos) {
    if (pushBusy) return;
    pushBusy = true;
    try {
      const remote = await getRemote();
      const local = await gatherState();
      const state = {
        rev: Date.now(),
        updatedAt: Date.now(),
        deletedPhotos: union(remote.deletedPhotos, local.deletedPhotos),
        comments: Object.assign({}, remote.comments || {}, local.comments || {}),
        sentActs: union(remote.sentActs, local.sentActs),
        notes2812: local.notes2812 || remote.notes2812 || "",
        rotate: Object.assign({}, remote.rotate || {}, local.rotate || {}),
        rows: (local.rows && local.rows.length && (local.updatedAt || Date.now()) >= (remote.updatedAt || 0)) ? local.rows : (remote.rows && remote.rows.length ? remote.rows : local.rows),
        dumpName: local.dumpName || remote.dumpName || "",
        photoKeys: union(remote.photoKeys, local.photoKeys)
      };
      if (local.rows && local.rows.length && (!remote.rows || !remote.rows.length || (await idbGet("meta", "state") || {}).localUpdatedAt > (remote.updatedAt || 0))) {
        state.rows = local.rows;
        state.dumpName = local.dumpName || state.dumpName;
      }
      await putRemote(state);
      if (alsoPhotos) {
        const deleted = new Set(state.deletedPhotos);
        const keys = await idbKeys("photos");
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (deleted.has(key)) continue;
          const rec = await idbGet("photos", key);
          if (rec && rec.blob) await pushPhoto(key, rec.blob);
        }
      }
      return state;
    } finally { pushBusy = false; }
  }
  async function start(force) {
    status("синхронизация…");
    try {
      const remote = await getRemote();
      const data = await loadProject();
      const prev = (await idbGet("meta", "state")) || {};
      const deleted = union(SEED_DEL, remote.deletedPhotos, prev.deletedPhotos);
      const remoteNewer = (remote.updatedAt || 0) > (prev.localUpdatedAt || 0);
      const rows = (remote.rows && remote.rows.length && (force || remoteNewer || !(prev.rows && prev.rows.length)))
        ? remote.rows
        : ((prev.rows && prev.rows.length) ? prev.rows : (data.rows || []));
      const next = {
        rows: rows,
        dumpName: remote.dumpName || prev.dumpName || data.dumpName || "",
        actDate: new Date().getFullYear() + "-" + String(new Date().getMonth()+1).padStart(2,"0") + "-" + String(new Date().getDate()).padStart(2,"0"),
        deletedPhotos: deleted,
        sentActs: union(prev.sentActs, remote.sentActs),
        comments: Object.assign({}, remote.comments || {}, prev.comments || {}),
        notes2812: prev.notes2812 || remote.notes2812 || "",
        rotate: Object.assign({}, remote.rotate || {}, prev.rotate || {}),
        sortDir: 1,
        localUpdatedAt: prev.localUpdatedAt || Date.now(),
        updatedAt: Math.max(prev.localUpdatedAt || 0, remote.updatedAt || 0)
      };
      await idbPut("meta", "state", next);
      for (let i = 0; i < deleted.length; i++) { try { await idbDel("photos", deleted[i]); } catch (e) {} }
      if ($("actDate")) $("actDate").value = next.actDate;
      const skip = new Set(deleted);
      const have = await idbKeys("photos");
      have.forEach(function (k) { skip.add(k); });
      let added = 0;
      for (let z = 0; z < ZIPS.length; z++) {
        try {
          const r = await fetch(ZIPS[z], { cache: "no-store", mode: "cors" });
          if (!r.ok) continue;
          const buf = await r.arrayBuffer();
          if (buf.byteLength < 10000) continue;
          added += await ingestZip(buf, skip);
          (await idbKeys("photos")).forEach(function (k) { skip.add(k); });
        } catch (e) {}
      }
      added += await pullPhotos(remote.photoKeys || [], skip);
      status("общее хранилище · строк " + (next.rows || []).length + " · фото +" + added);
      const flag = force ? "miskhub.cloud.forced" : "miskhub.cloud.applied9";
      if (!sessionStorage.getItem(flag)) { sessionStorage.setItem(flag, "1"); location.reload(); }
    } catch (e) { console.warn(e); status("синхронизация не удалась"); }
  }
  window.MiskSync = {
    savePartial: async function (patch) {
      const prev = (await idbGet("meta", "state")) || {};
      const next = Object.assign({}, prev, patch, { localUpdatedAt: Date.now() });
      if (patch.deletedPhotos) next.deletedPhotos = union(prev.deletedPhotos, patch.deletedPhotos);
      await idbPut("meta", "state", next);
      if (patch.deletedPhotos) {
        const d = next.deletedPhotos;
        for (let i = 0; i < d.length; i++) { try { await idbDel("photos", d[i]); } catch (e) {} }
      }
      await pushAll(false);
    },
    pushNow: function (photos) { return pushAll(!!photos); }
  };
  function bind() {
    if ($("btnCloudPull")) $("btnCloudPull").addEventListener("click", function () {
      sessionStorage.removeItem("miskhub.cloud.forced"); start(true);
    });
    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "fileDump") setTimeout(function () { pushAll(false); }, 1200);
      if (e.target && e.target.closest && e.target.closest("input[data-slot]")) setTimeout(function () { pushAll(true); }, 800);
    });
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest("[data-del]")) setTimeout(function () { pushAll(false); }, 400);
    });
  }
  setInterval(function () { pushAll(false); }, 8000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); start(false); });
  else { bind(); start(false); }
})();
