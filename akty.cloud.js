/* Общий проект + общий архив фото */
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
  async function ingestZip(buf) {
    if (!window.JSZip) throw new Error("no jszip");
    const zip = await JSZip.loadAsync(buf);
    let n = 0;
    const jobs = [];
    zip.forEach((path, file) => {
      if (file.dir) return;
      const name = path.split("/").pop();
      const m = String(name).match(/^(\d+)_([12])\./i);
      if (!m) return;
      jobs.push(file.async("blob").then((blob) => {
        const typed = blob.type && blob.type.indexOf("image") === 0 ? blob : new Blob([blob], { type: "image/jpeg" });
        return idbPut("photos", m[1] + "_" + m[2], { blob: typed, name: name }).then(() => { n++; });
      }));
    });
    await Promise.all(jobs);
    return n;
  }
  async function loadFotos() {
    for (const url of FOTO_ZIPS) {
      try {
        status("качаю общий архив фото…");
        const r = await fetch(url, { cache: "no-store", mode: "cors" });
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        if (buf.byteLength < 20000) continue;
        status("раскладываю фото · " + Math.round(buf.byteLength / 1024) + " КБ");
        const n = await ingestZip(buf);
        if (n) return n;
      } catch (e) { console.warn("foto zip", url, e); }
    }
    return 0;
  }
  function paintDl() {
    document.querySelectorAll(".slot.has").forEach((slot) => {
      if (slot.querySelector("[data-dl]")) return;
      const img = slot.querySelector("img");
      if (!img) return;
      const b = document.createElement("button");
      b.type = "button"; b.className = "dl"; b.dataset.dl = img.alt || "foto";
      b.title = "скачать фото"; b.textContent = "↓";
      b.style.cssText = "position:absolute;top:4px;left:4px;background:#000c;color:#fff;border:0;border-radius:6px;padding:2px 6px;cursor:pointer";
      slot.appendChild(b);
    });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dl]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const img = b.closest(".slot") && b.closest(".slot").querySelector("img");
    if (!img || !img.src) return;
    const a = document.createElement("a"); a.href = img.src; a.download = (b.dataset.dl || "foto") + ".jpg"; a.click();
  });
  setInterval(paintDl, 700);
  async function start() {
    status("читаю общий проект…");
    try {
      const data = await loadProject();
      if (data.rows && data.rows.length) {
        const prev = (await idbGet("meta", "state")) || {};
        await idbPut("meta", "state", { rows: data.rows, dumpName: data.dumpName || prev.dumpName || "", actDate: data.actDate || prev.actDate || "", updatedAt: data.updatedAt });
      }
      const fotos = await loadFotos();
      status("общий проект · строк " + ((data && data.rows) || []).length + " · фото " + fotos);
      if (!sessionStorage.getItem("miskhub.cloud.applied5")) {
        sessionStorage.setItem("miskhub.cloud.applied5", "1");
        location.reload();
      }
    } catch (e) {
      console.warn(e);
      status("общий файл не прочитался");
    }
  }
  function bind() {
    if ($("btnCloudPull")) $("btnCloudPull").addEventListener("click", function () {
      sessionStorage.removeItem("miskhub.cloud.applied5"); start();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); start(); });
  else { bind(); start(); }
})();
