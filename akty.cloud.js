/* Общий проект без входа: файл на GitHub Pages. */
(function () {
  const PROJECT_URL = "./cloud/project.json";
  const FOTO_BASE = "./cloud/foto/";
  const FLAG = "miskhub.cloud.applied";
  const $ = (id) => document.getElementById(id);
  function status(t) { if ($("cloudStatus")) $("cloudStatus").textContent = t; }
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
  async function pull() {
    status("читаю общий проект…");
    const r = await fetch(PROJECT_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("нет cloud/project.json");
    const data = await r.json();
    const local = (await idbGet("meta", "state")) || {};
    const remoteAt = Date.parse(data.updatedAt || 0) || 0;
    const localAt = Date.parse(local.updatedAt || 0) || 0;
    const localEmpty = !local.rows || !local.rows.length;
    if (data.rows && data.rows.length && (localEmpty || remoteAt >= localAt)) {
      await idbPut("meta", "state", { rows: data.rows || [], dumpName: data.dumpName || "", actDate: data.actDate || "", updatedAt: data.updatedAt || new Date().toISOString() });
    }
    for (const name of (data.photoFiles || [])) {
      const m = String(name).match(/^(\d+)_([12])\./i);
      if (!m) continue;
      try {
        const img = await fetch(FOTO_BASE + name + "?t=" + Date.now(), { cache: "no-store" });
        if (!img.ok) continue;
        await idbPut("photos", m[1] + "_" + m[2], { blob: await img.blob(), name: name });
      } catch (e) { console.warn(name, e); }
    }
    return data;
  }
  async function start() {
    try {
      const data = await pull();
      status("общий проект · вход не нужен · строк " + ((data.rows || []).length));
      if (!sessionStorage.getItem(FLAG)) { sessionStorage.setItem(FLAG, "1"); location.reload(); }
    } catch (e) { console.warn(e); status("общий файл пока пуст"); }
  }
  function bind() {
    if ($("btnCloudPull")) $("btnCloudPull").addEventListener("click", function () { sessionStorage.removeItem(FLAG); start(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); start(); });
  else { bind(); start(); }
})();
