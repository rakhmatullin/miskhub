/* общий проект: не затирать локальную выгрузку */
(function () {
  const FOTO_ZIPS = [
    "https://litter.catbox.moe/adhzwp.zip",
    "https://corsproxy.io/?" + encodeURIComponent("https://litter.catbox.moe/adhzwp.zip")
  ];
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
  async function ingestZip(buf, deleted) {
    if (!window.JSZip) throw new Error("no jszip");
    const zip = await JSZip.loadAsync(buf);
    let n = 0;
    const jobs = [];
    zip.forEach((path, file) => {
      if (file.dir) return;
      const name = path.split("/").pop();
      const m = String(name).match(/^(\d+)_([12])\./i);
      if (!m) return;
      const key = m[1] + "_" + m[2];
      if (deleted && deleted.has(key)) return;
      jobs.push(file.async("blob").then((blob) => {
        const typed = new Blob([blob], { type: "image/jpeg" });
        return idbPut("photos", key, { blob: typed, name: name }).then(() => { n++; });
      }));
    });
    await Promise.all(jobs);
    return n;
  }
  async function loadFotos(deleted) {
    for (const url of FOTO_ZIPS) {
      try {
        status("качаю общий архив фото…");
        const r = await fetch(url, { cache: "no-store", mode: "cors" });
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        if (buf.byteLength < 20000) continue;
        status("раскладываю фото · " + Math.round(buf.byteLength / 1024) + " КБ");
        const n = await ingestZip(buf, deleted);
        if (n) return n;
      } catch (e) { console.warn("foto zip", url, e); }
    }
    return 0;
  }
  async function start(forceRemote) {
    status("читаю общий проект…");
    try {
      const data = await loadProject();
      const prev = (await idbGet("meta", "state")) || {};
      const localRows = Array.isArray(prev.rows) && prev.rows.length;
      const useRemote = forceRemote || !localRows;
      const next = {
        rows: useRemote ? (data.rows || []) : prev.rows,
        dumpName: useRemote ? (data.dumpName || prev.dumpName || "") : (prev.dumpName || data.dumpName || ""),
        actDate: new Date().getFullYear() + "-" + String(new Date().getMonth()+1).padStart(2,"0") + "-" + String(new Date().getDate()).padStart(2,"0"),
        deletedPhotos: prev.deletedPhotos || [],
        localUpdatedAt: prev.localUpdatedAt || Date.now(),
        updatedAt: data.updatedAt
      };
      await idbPut("meta", "state", next);
      if ($("actDate")) $("actDate").value = next.actDate;
      const deleted = new Set((next.deletedPhotos || []).map(String));
      const fotos = await loadFotos(deleted);
      status((useRemote ? "с сайта" : "локальная выгрузка") + " · строк " + (next.rows||[]).length + " · фото " + fotos);
      const flag = forceRemote ? "miskhub.cloud.forced" : "miskhub.cloud.applied6";
      if (!sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, "1");
        location.reload();
      }
    } catch (e) {
      console.warn(e);
      status("общий файл не прочитался");
    }
  }
  function bind() {
    if ($("btnCloudPull")) $("btnCloudPull").addEventListener("click", function () {
      sessionStorage.removeItem("miskhub.cloud.forced");
      start(true);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); start(false); });
  else { bind(); start(false); }
})();
