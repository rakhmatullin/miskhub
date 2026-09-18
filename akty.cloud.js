/* Общий проект + фото без входа */
(function () {
  const FOTO_ZIP = [
    "./cloud/fotos.zip",
    "https://corsproxy.io/?" + encodeURIComponent("https://drive.google.com/uc?export=download&id=152yeA_XT-FJmR2URN5-a_yxdcJj5EqmC"),
    "https://corsproxy.io/?" + encodeURIComponent("https://drive.google.com/uc?export=download&id=1CfEDQ3SC9XHs8Bn7tI7qWAIwX4fXeYF7")
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
  async function ingestZip(buf) {
    if (!window.JSZip) return 0;
    const zip = await JSZip.loadAsync(buf);
    let n = 0;
    const jobs = [];
    zip.forEach((path, file) => {
      if (file.dir) return;
      const name = path.split("/").pop();
      const m = String(name).match(/^(\d+)_([12])\./i);
      if (!m) return;
      jobs.push(file.async("blob").then((blob) => idbPut("photos", m[1] + "_" + m[2], { blob: blob, name: name }).then(() => { n++; })));
    });
    await Promise.all(jobs);
    return n;
  }
  async function loadFotos() {
    for (const url of FOTO_ZIP) {
      try {
        status("загружаю общие фото…");
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        if (buf.byteLength < 10000) continue;
        const n = await ingestZip(buf);
        if (n) return n;
      } catch (e) { console.warn("foto zip", url, e); }
    }
    return 0;
  }
  async function start() {
    status("читаю общий проект…");
    try {
      const data = await loadProject();
      if (data.rows && data.rows.length) {
        const prev = (await idbGet("meta", "state")) || {};
        await idbPut("meta", "state", {
          rows: data.rows,
          dumpName: data.dumpName || prev.dumpName || "",
          actDate: data.actDate || prev.actDate || "",
          updatedAt: data.updatedAt
        });
      }
      const fotos = await loadFotos();
      status("общий проект · строк " + ((data && data.rows) || []).length + " · фото " + fotos);
      if (!sessionStorage.getItem("miskhub.cloud.applied2")) {
        sessionStorage.setItem("miskhub.cloud.applied2", "1");
        location.reload();
      }
    } catch (e) {
      console.warn(e);
      status("общий файл не прочитался");
    }
  }
  function bind() {
    if ($("btnCloudPull")) $("btnCloudPull").addEventListener("click", function () {
      sessionStorage.removeItem("miskhub.cloud.applied2"); start();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); start(); });
  else { bind(); start(); }
})();
