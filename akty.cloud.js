/* общее хранилище: state + фото в KVS, IDB кэш */
(function () {
  const REMOTE = "https://kvs.ix.workers.dev/miskhub-akty-state-rakhmatullin-2026.json";
  const FOTO = function (key) { return "https://kvs.ix.workers.dev/miskhub-foto-" + key + ".jpg"; };
  const ZIPS = [
    "https://litter.catbox.moe/f1zgce.zip",
    "https://litter.catbox.moe/3ebvzg.zip",
    "https://litter.catbox.moe/ws6pzp.zip",
    "https://litter.catbox.moe/zuacqz.zip"
  ];
  const SEED_DEL = ["92_1","92_2","92_3","94_1","94_2","94_3","120_1","120_2","120_3"];
  const SEED_UNDEL = ["27_3"];
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
  function union() {
    const out = [];
    for (let i = 0; i < arguments.length; i++) {
      const arr = arguments[i] || [];
      for (let j = 0; j < arr.length; j++) out.push(String(arr[j]));
    }
    return Array.from(new Set(out)).filter(function (k) { return SEED_UNDEL.indexOf(k) < 0; });
  }
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
      const r = await fetch(REMOTE, { method: "PUT", mode: "cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
      return r.ok || r.status === 201 || r.status === 200;
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
      localUpdatedAt: Number(prev.localUpdatedAt || 0),
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
  async function stampLocal(patch) {
    const prev = (await idbGet("meta", "state")) || {};
    const next = Object.assign({}, prev, patch || {}, { localUpdatedAt: Date.now() });
    await idbPut("meta", "state", next);
    return next;
  }
  let pushChain = Promise.resolve();
  function pushAll(alsoPhotos, forceRows) {
    const job = pushChain.then(function () { return pushInner(!!alsoPhotos, !!forceRows); }).catch(function (e) { console.warn(e); });
    pushChain = job;
    return job;
  }
  async function pushInner(alsoPhotos, forceRows) {
    const remote = await getRemote();
    const prev = (await idbGet("meta", "state")) || {};
    const local = await gatherState();
    const localStamp = Number(prev.localUpdatedAt || local.localUpdatedAt || 0);
    const remoteStamp = Number(remote.updatedAt || 0);
    const dumpChanged = !!(local.dumpName && local.dumpName !== (remote.dumpName || ""));
    const useLocal = forceRows || (local.rows && local.rows.length && (localStamp >= remoteStamp || dumpChanged || !remote.rows || !remote.rows.length));
    const now = Date.now();
    const state = {
      rev: now,
      updatedAt: now,
      deletedPhotos: union(remote.deletedPhotos, local.deletedPhotos),
      comments: Object.assign({}, remote.comments || {}, local.comments || {}),
      sentActs: union(remote.sentActs, local.sentActs),
      notes2812: local.notes2812 || remote.notes2812 || "",
      rotate: Object.assign({}, remote.rotate || {}, local.rotate || {}),
      rows: useLocal ? (local.rows || []) : ((remote.rows && remote.rows.length) ? remote.rows : (local.rows || [])),
      dumpName: useLocal ? (local.dumpName || remote.dumpName || "") : (remote.dumpName || local.dumpName || ""),
      photoKeys: union(remote.photoKeys, local.photoKeys)
    };
    const ok = await putRemote(state);
    if (ok && useLocal) {
      await idbPut("meta", "state", Object.assign({}, prev, {
        rows: state.rows,
        dumpName: state.dumpName,
        deletedPhotos: state.deletedPhotos,
        comments: state.comments,
        sentActs: state.sentActs,
        notes2812: state.notes2812,
        rotate: state.rotate,
        localUpdatedAt: prev.localUpdatedAt || now,
        updatedAt: now
      }));
    }
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
  }
  async function pushDumpAfterParse() {
    status("отправляю выгрузку в общее хранилище…");
    const started = Date.now();
    const before = (await idbGet("meta", "state")) || {};
    const beforeName = before.dumpName || "";
    const beforeCount = (before.rows || []).length;
    for (let i = 0; i < 24; i++) {
      await new Promise(function (r) { setTimeout(r, 250); });
      const st = (await idbGet("meta", "state")) || {};
      const lastName = st.dumpName || "";
      const lastCount = (st.rows || []).length;
      if (lastCount && (lastName !== beforeName || lastCount !== beforeCount || Date.now() - started > 400)) {
        await stampLocal({ rows: st.rows, dumpName: st.dumpName });
        const sent = await pushAll(false, true);
        const n = ((sent && sent.rows) || st.rows || []).length;
        status("общее хранилище · выгрузка " + (st.dumpName || "") + " · строк " + n);
        return sent;
      }
    }
    const st = (await idbGet("meta", "state")) || {};
    if (st.rows && st.rows.length) {
      await stampLocal({ rows: st.rows, dumpName: st.dumpName });
      const sent = await pushAll(false, true);
      status("общее хранилище · строк " + ((sent && sent.rows) || st.rows).length);
      return sent;
    }
    status("выгрузка не записалась в IDB — открой консоль");
  }
  async function start(force) {
    status("синхронизация…");
    try {
      const remote = await getRemote();
      const data = await loadProject();
      const prev = (await idbGet("meta", "state")) || {};
      const deleted = union(SEED_DEL, remote.deletedPhotos, prev.deletedPhotos);
      const localStamp = Number(prev.localUpdatedAt || 0);
      const remoteStamp = Number(remote.updatedAt || 0);
      const haveLocal = prev.rows && prev.rows.length;
      const haveRemote = remote.rows && remote.rows.length;
      const keepLocal = !force && haveLocal && (localStamp >= remoteStamp || (!haveRemote));
      const rows = keepLocal ? prev.rows : (haveRemote ? remote.rows : (haveLocal ? prev.rows : (data.rows || [])));
      const dumpName = keepLocal ? (prev.dumpName || remote.dumpName || data.dumpName || "") : (remote.dumpName || prev.dumpName || data.dumpName || "");
      const next = {
        rows: rows,
        dumpName: dumpName,
        actDate: new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0"),
        deletedPhotos: deleted,
        sentActs: union(prev.sentActs, remote.sentActs),
        comments: Object.assign({}, remote.comments || {}, prev.comments || {}),
        notes2812: prev.notes2812 || remote.notes2812 || "",
        rotate: Object.assign({}, remote.rotate || {}, prev.rotate || {}),
        sortDir: 1,
        localUpdatedAt: keepLocal ? (prev.localUpdatedAt || Date.now()) : (haveRemote ? remoteStamp : (prev.localUpdatedAt || Date.now())),
        updatedAt: Math.max(localStamp, remoteStamp, Date.now())
      };
      await idbPut("meta", "state", next);
      for (let i = 0; i < deleted.length; i++) { try { await idbDel("photos", deleted[i]); } catch (e) {} }
      if ($("actDate")) $("actDate").value = next.actDate;
      if ($("dumpName") && next.dumpName) $("dumpName").textContent = next.dumpName + " · " + (next.rows || []).length + " строк";
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
      status("общее хранилище · " + (next.dumpName || "без имени") + " · строк " + (next.rows || []).length + " · фото +" + added);
      const flag = force ? "miskhub.cloud.forced" : "miskhub.cloud.applied11";
      if (!sessionStorage.getItem(flag)) { sessionStorage.setItem(flag, "1"); location.reload(); }
    } catch (e) { console.warn(e); status("синхронизация не удалась"); }
  }
  window.MiskSync = {
    savePartial: async function (patch) {
      await stampLocal(patch);
      if (patch && patch.deletedPhotos) {
        const next = (await idbGet("meta", "state")) || {};
        const d = next.deletedPhotos || [];
        for (let i = 0; i < d.length; i++) { try { await idbDel("photos", d[i]); } catch (e) {} }
      }
      return pushAll(false, false);
    },
    pushNow: function (photos) { return pushAll(!!photos, false); },
    pushDump: function () { return pushDumpAfterParse(); }
  };
  function bind() {
    if ($("btnCloudPull")) $("btnCloudPull").addEventListener("click", function () {
      sessionStorage.removeItem("miskhub.cloud.forced"); start(true);
    });
    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "fileDump") pushDumpAfterParse();
      if (e.target && e.target.closest && e.target.closest("input[data-slot]")) setTimeout(function () { pushAll(true, false); }, 800);
    });
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest("[data-del]")) setTimeout(function () { pushAll(false, false); }, 400);
    });
  }
  setInterval(function () { pushAll(false, false); }, 10000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); start(false); });
  else { bind(); start(false); }
})();
