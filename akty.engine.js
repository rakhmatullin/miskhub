/* MiskHub — акты об устранении. Браузер, без сервера. */
(function () {
  const OPEN = "К устранению";
  const CLOSED = "Закрыто";
  const DEL = "Удалено";
  const TOKENS = [
    ["{{НОМЕР-АКТА}}", "номер из выгрузки"],
    ["{{ИНТЕГРАЦИОННЫЙ-НОМЕР}}", "если нет — тот же номер"],
    ["{{ДАТА-ПРЕДПИСАНИЯ}}", "дд.мм.гггг из столбца Дата"],
    ["{{ДАТА-ПРЕДПИСАНИЯ-ТЕКСТ}}", "«14» сентября 2026г."],
    ["{{ДАТА-АКТА}}", "дд.мм.гггг дата комплекта"],
    ["{{ДАТА-АКТА-ТЕКСТ}}", "«17» сентября 2026"],
    ["{{СРОК-УСТРАНЕНИЯ}}", "дата срока без «+ N дн.»"],
    ["{{ОПИСАНИЕ}}", "текст замечания"],
    ["{{ВИД-РАБОТ}}", "вид работ"],
    ["{{СТАТУС}}", "статус выгрузки"],
  ];
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const DB_NAME = "miskhub-akty";
  const DB_VER = 2;
  const S = { rows: [], templateBuf: null, templateName: "", photos: new Map(), snapshots: [], dumpName: "", tplReady: null, activeSnap: -1 };
  const $ = (id) => document.getElementById(id);
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function isoToDot(iso) { if (!iso) return ""; const [y,m,d] = iso.split("-"); return `${d}.${m}.${y}`; }
  function parseDotDate(val) {
    if (val == null || val === "") return "";
    if (val instanceof Date && !isNaN(val)) return `${String(val.getDate()).padStart(2,"0")}.${String(val.getMonth()+1).padStart(2,"0")}.${val.getFullYear()}`;
    const s = String(val).trim();
    const m = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
    if (!m) return "";
    let y = m[3]; if (y.length === 2) y = "20" + y;
    return `${m[1].padStart(2,"0")}.${m[2].padStart(2,"0")}.${y}`;
  }
  function ruQuoted(dot, withG) {
    const p = parseDotDate(dot); if (!p) return "";
    const [d,m,y] = p.split(".");
    const t = `«${d}» ${MONTHS[Number(m)-1]} ${y}`;
    return withG ? t + "г." : t;
  }
  function normStatus(s) {
    const t = String(s || "").trim().toLowerCase();
    if (t.includes("удален")) return DEL;
    if (t.includes("закрыт")) return CLOSED;
    if (t.includes("устран")) return OPEN;
    return String(s || "").trim() || OPEN;
  }
  function xmlEsc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function escapeHtml(s) { return String(s || "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
  function openRows() { return S.rows.filter((r) => r.status === OPEN); }
  function tokensFor(row) {
    const actDot = isoToDot(($("actDate") && $("actDate").value) || todayISO());
    const pred = row.date || "";
    return {
      "{{НОМЕР-АКТА}}": String(row.num),
      "{{ИНТЕГРАЦИОННЫЙ-НОМЕР}}": String(row.integ || row.num),
      "{{ДАТА-ПРЕДПИСАНИЯ}}": pred,
      "{{ДАТА-ПРЕДПИСАНИЯ-ТЕКСТ}}": ruQuoted(pred, true),
      "{{ДАТА-АКТА}}": actDot,
      "{{ДАТА-АКТА-ТЕКСТ}}": ruQuoted(actDot, false),
      "{{СРОК-УСТРАНЕНИЯ}}": row.srok || "",
      "{{ОПИСАНИЕ}}": row.desc || "",
      "{{ВИД-РАБОТ}}": row.kind || "",
      "{{СТАТУС}}": row.status || "",
    };
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
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
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    }));
  }
  function idbDel(store, key) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    }));
  }
  function idbGet(store, key) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, "readonly");
      const rq = tx.objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    }));
  }
  function idbAll(store) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, "readonly");
      const out = [];
      const rq = tx.objectStore(store).openCursor();
      rq.onsuccess = (e) => { const cur = e.target.result; if (!cur) return res(out); out.push({ key: cur.key, value: cur.value }); cur.continue(); };
      rq.onerror = () => rej(rq.error);
    }));
  }
  async function photoPut(key, blob, name) {
    await idbPut("photos", key, { blob, name });
    const prev = S.photos.get(key);
    if (prev && prev.url) URL.revokeObjectURL(prev.url);
    S.photos.set(key, { name, blob, url: URL.createObjectURL(blob) });
  }
  async function photoDel(key) {
    await idbDel("photos", key);
    const prev = S.photos.get(key);
    if (prev && prev.url) URL.revokeObjectURL(prev.url);
    S.photos.delete(key);
  }
  async function photoLoadAll() {
    const all = await idbAll("photos");
    for (const { key, value } of all) {
      if (!value || !value.blob) continue;
      S.photos.set(key, { name: value.name || String(key), blob: value.blob, url: URL.createObjectURL(value.blob) });
    }
  }
  async function prunePhotos(openNums) {
    const keep = new Set(openNums.map(String));
    let n = 0;
    for (const key of [...S.photos.keys()]) {
      const num = String(key).split("_")[0];
      if (!keep.has(num)) { await photoDel(key); n++; }
    }
    return n;
  }
  async function persistMeta() {
    await idbPut("meta", "state", { rows: S.rows, dumpName: S.dumpName, actDate: $("actDate") ? $("actDate").value : todayISO() });
  }
  async function addSnapshot() {
    const snap = {
      iso: todayISO(), time: new Date().toISOString(), dumpName: S.dumpName,
      open: S.rows.filter((r) => r.status === OPEN).map((r) => r.num),
      closed: S.rows.filter((r) => r.status === CLOSED).map((r) => r.num),
      deleted: S.rows.filter((r) => r.status === DEL).map((r) => r.num),
    };
    await idbPut("snapshots", snap.time, snap);
    S.snapshots.push(snap); S.activeSnap = S.snapshots.length - 1;
  }
  async function loadSnapshots() {
    const all = await idbAll("snapshots");
    S.snapshots = all.map((x) => x.value).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    S.activeSnap = S.snapshots.length - 1;
  }
  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const map = {};
      (rows[i] || []).forEach((v, c) => { const k = String(v || "").trim().toLowerCase(); if (k) map[k] = c; });
      if (map["номер"] != null && (map["дата"] != null || map["статус"] != null || map["описание"] != null)) return { i, map };
    }
    return null;
  }
  function col(map, ...names) { for (const n of names) if (map[n] != null) return map[n]; return null; }
  function parseDump(buf) {
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    const hdr = findHeader(raw);
    if (!hdr) throw new Error("Не нашёл строку заголовков (нужны колонки Номер и Дата/Статус).");
    const m = hdr.map;
    const cNum = col(m, "номер"), cInteg = col(m, "интеграционный номер", "интегр. номер");
    const cDate = col(m, "дата"), cSrok = col(m, "срок устранения", "срок"), cStatus = col(m, "статус"), cKind = col(m, "вид работ"), cDesc = col(m, "описание");
    const rows = [];
    for (let r = hdr.i + 1; r < raw.length; r++) {
      const line = raw[r] || [];
      const num = Number(String(line[cNum] ?? "").trim());
      if (!Number.isFinite(num) || num <= 0) continue;
      rows.push({
        num, integ: cInteg != null && line[cInteg] !== "" ? line[cInteg] : num,
        date: parseDotDate(cDate != null ? line[cDate] : ""),
        srok: parseDotDate(cSrok != null ? line[cSrok] : ""),
        status: normStatus(cStatus != null ? line[cStatus] : OPEN),
        kind: cKind != null ? String(line[cKind] || "") : "",
        desc: cDesc != null ? String(line[cDesc] || "") : "",
      });
    }
    return rows;
  }
  function joinRuns(xml) { return xml.replace(/<\/w:t><\/w:r>\s*<w:r[^>]*>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>/g, ""); }
  function dropForcedBreakBeforeObject(xml) {
    return xml.replace(/<w:br\/>\s*(?=<\/w:rPr>\s*<w:t[^>]*>\s*№)/g, "").replace(/<w:br\/>\s*(?=<w:t[^>]*>\s*№\s)/g, "");
  }
  function applyTokens(xml, map) {
    let out = dropForcedBreakBeforeObject(joinRuns(xml));
    for (const [k, v] of Object.entries(map)) out = out.split(k).join(xmlEsc(v));
    return out;
  }
  function leftoverTokens(xml) { const found = xml.match(/\{\{[А-ЯЁA-Z0-9-]+\}\}/g); return found ? [...new Set(found)] : []; }
  async function makeActBlob(row) {
    if (!S.templateBuf) throw new Error("Нет шаблона");
    const src = await JSZip.loadAsync(S.templateBuf);
    const map = tokensFor(row);
    const out = new JSZip();
    const files = []; src.forEach((path, file) => files.push({ path, file }));
    let leftovers = [];
    for (const { path, file } of files) {
      if (file.dir) continue;
      const isDoc = path === "word/document.xml" || /^word\/header\d+\.xml$/.test(path) || /^word\/footer\d+\.xml$/.test(path);
      if (isDoc) {
        const txt = applyTokens(await file.async("string"), map);
        leftovers = leftovers.concat(leftoverTokens(txt));
        out.file(path, txt);
      } else {
        out.file(path, await file.async("uint8array"));
      }
    }
    leftovers = [...new Set(leftovers)];
    if (leftovers.length) throw new Error("В акте №" + row.num + " не подставились поля: " + leftovers.join(", "));
    return out.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
  }
  function actFileName(num) { return `Акт об Устранении №${num}+.docx`; }
  async function loadOfficial() {
    const parts = await Promise.all([1,2,3,4,5,6].map((n) => fetch("./shablon.b"+n+".txt?v=3").then((r) => { if (!r.ok) throw new Error("нет куска шаблона b"+n); return r.text(); })));
    const b64 = parts.join("").replace(/\s+/g, "");
    S.templateBuf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    S.templateName = "встроенный шаблон МИСК";
    if ($("tplName")) $("tplName").textContent = S.templateName;
  }
  function renderTokens() { if ($("tokenList")) $("tokenList").innerHTML = TOKENS.map(([t,d]) => `<span class="token" title="${d}">${t}</span>`).join(""); }
  function renderActDate() { if ($("actDateLabel") && $("actDate")) $("actDateLabel").textContent = isoToDot($("actDate").value || todayISO()) || "—"; }
  function renderTape() {
    const el = $("tape"); if (!el) return;
    if (!S.snapshots.length) { el.innerHTML = '<div class="tape-empty">Загрузи выгрузку — здесь появятся дни срезов</div>'; return; }
    const max = Math.max(1, ...S.snapshots.map((s) => (s.open?.length||0)+(s.closed?.length||0)+(s.deleted?.length||0)));
    el.innerHTML = S.snapshots.map((s, i) => {
      const o = s.open?.length||0, c = s.closed?.length||0, d = s.deleted?.length||0;
      const h = (n) => Math.max(4, Math.round((n/max)*36));
      return `<div class="day${i===S.activeSnap?" on":""}" data-snap="${i}"><div class="d">${isoToDot(s.iso)||s.iso}</div><div class="bars"><div class="bar open" style="height:${h(o)}px" title="открыто ${o}"></div><div class="bar closed" style="height:${h(c)}px" title="закрыто ${c}"></div><div class="bar del" style="height:${h(d)}px" title="удалено ${d}"></div></div></div>`;
    }).join("");
  }
  function renderStats() {
    const all = S.rows;
    if (!all.length) { $("stats").hidden = true; $("toolbar").hidden = true; return; }
    $("stats").hidden = false; $("toolbar").hidden = false;
    $("nOpen").textContent = all.filter((r)=>r.status===OPEN).length;
    $("nClosed").textContent = all.filter((r)=>r.status===CLOSED).length;
    $("nDeleted").textContent = all.filter((r)=>r.status===DEL).length;
    let p1=0,p2=0; for (const r of openRows()) { if (S.photos.has(`${r.num}_1`)) p1++; if (S.photos.has(`${r.num}_2`)) p2++; }
    $("nPhoto1").textContent=p1; $("nPhoto2").textContent=p2;
  }
  function slotHtml(num, slot) {
    const key = `${num}_${slot}`; const ph = S.photos.get(key); const label = slot===1 ? "до · _1" : "после · _2";
    if (ph) return `<label class="slot has"><img alt="${key}" src="${ph.url}"/><span class="lab">${label}</span><button type="button" class="x" data-del="${key}" title="удалить это фото">×</button><input hidden type="file" accept="image/*" data-slot="${key}"/></label>`;
    return `<label class="slot">${label}<input hidden type="file" accept="image/*" data-slot="${key}"/></label>`;
  }
  function renderTable() {
    const q = (($("q") && $("q").value) || "").trim().toLowerCase();
    const rows = openRows().filter((r) => !q || String(r.num).includes(q) || (r.desc||"").toLowerCase().includes(q));
    if (!S.rows.length) { $("tableWrap").innerHTML = ""; return; }
    $("tableWrap").innerHTML = `<table class="table"><thead><tr><th>№</th><th>Интегр.</th><th>Предписание</th><th>Срок</th><th>Описание</th><th>Статус</th><th>Фото</th></tr></thead><tbody>${rows.map((r)=>`<tr><td class="num">${r.num}</td><td>${escapeHtml(String(r.integ))}</td><td>${r.date}</td><td>${r.srok}</td><td class="desc">${escapeHtml(r.desc)}</td><td><span class="chip open">${r.status}</span></td><td><div class="slots">${slotHtml(r.num,1)}${slotHtml(r.num,2)}</div></td></tr>`).join("")}</tbody></table><p class="lead" style="margin-top:12px">В список актов попадают только «К устранению» текущей выгрузки. Закрыто и удалено видны на ленте срезов.</p>`;
  }
  function refresh() { renderActDate(); renderTape(); renderStats(); renderTable(); }
  async function onDump(file) {
    S.rows = parseDump(await file.arrayBuffer()); S.dumpName = file.name;
    if ($("dumpName")) $("dumpName").textContent = file.name + " · " + S.rows.length + " строк";
    const dropped = await prunePhotos(openRows().map((r) => r.num));
    await addSnapshot(); await persistMeta(); refresh();
    if (dropped) $("tableWrap").insertAdjacentHTML("afterbegin", `<p class="warn">Снял ${dropped} фото у актов, которых больше нет в «К устранению».</p>`);
  }
  async function onTpl(file) { S.templateBuf = await file.arrayBuffer(); S.templateName = file.name; if ($("tplName")) $("tplName").textContent = file.name; }
  async function onPhotoFile(key, file) {
    if (!file) return;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const [num, slot] = key.split("_");
    await photoPut(key, file, `${num}_${slot}.${ext==="jpeg"?"jpg":ext}`);
    refresh();
  }
  function listSheet() {
    return openRows().map((r) => ({
      "Номер": r.num, "Интеграционный номер": r.integ, "Дата предписания": r.date, "Срок устранения": r.srok, "Описание": r.desc, "Статус": r.status,
      "Фото до": S.photos.has(`${r.num}_1`) ? `${r.num}_1` : "", "Фото после": S.photos.has(`${r.num}_2`) ? `${r.num}_2` : "", "Файл акта": actFileName(r.num),
    }));
  }
  async function downloadList() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(listSheet()), "К устранению");
    XLSX.writeFile(wb, "reestr_neustranennye.xlsx");
  }
  async function fillActsZip(zip, withPhotos) {
    const list = openRows();
    if (!list.length) throw new Error("Нет строк «К устранению».");
    if (!S.templateBuf) throw new Error("Нет шаблона — обнови страницу или загрузи образец.docx");
    for (const r of list) {
      zip.file("akty/" + actFileName(r.num), await makeActBlob(r));
      if (withPhotos) for (const slot of [1,2]) { const ph = S.photos.get(`${r.num}_${slot}`); if (ph) zip.file("foto/"+ph.name, ph.blob); }
    }
    return list;
  }
  function saveBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function downloadActsOnly() { try { const zip = new JSZip(); await fillActsZip(zip, false); saveBlob(await zip.generateAsync({ type: "blob" }), "akty_k_ustraneniyu.zip"); } catch (e) { alert(e.message || e); } }
  async function downloadPack() {
    try {
      const zip = new JSZip(); await fillActsZip(zip, true);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(listSheet()), "К устранению");
      zip.file("reestr_neustranennye.xlsx", XLSX.write(wb, { bookType: "xlsx", type: "array" }));
      zip.file("README.txt", "Акты: токены только в document.xml. settings.xml не трогали.\nФото N_1 / N_2.\nДата акта ≠ дата предписания.\n");
      saveBlob(await zip.generateAsync({ type: "blob" }), "miskhub_akty_paket.zip");
    } catch (e) { alert(e.message || e); }
  }
  async function downloadProject() {
    const zip = new JSZip();
    zip.file("project.json", JSON.stringify({ dumpName: S.dumpName, actDate: $("actDate").value, rows: S.rows, snapshots: S.snapshots }, null, 2));
    for (const [key, ph] of S.photos) zip.file("foto/" + (ph.name || key + ".jpg"), ph.blob);
    saveBlob(await zip.generateAsync({ type: "blob" }), "miskhub_project.zip");
  }
  async function restoreProject(file) {
    if (file.name.endsWith(".json")) {
      const data = JSON.parse(await file.text());
      S.rows = data.rows || []; S.dumpName = data.dumpName || file.name; S.snapshots = data.snapshots || [];
      if (data.actDate && $("actDate")) $("actDate").value = data.actDate;
      await persistMeta(); refresh(); return;
    }
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const jsonFile = zip.file("project.json");
    if (jsonFile) {
      const data = JSON.parse(await jsonFile.async("string"));
      S.rows = data.rows || []; S.dumpName = data.dumpName || file.name; S.snapshots = data.snapshots || S.snapshots;
      if (data.actDate && $("actDate")) $("actDate").value = data.actDate;
    }
    const jobs = [];
    zip.folder("foto")?.forEach((path, f) => {
      if (f.dir) return;
      const name = path.split("/").pop();
      const m = name.match(/^(\d+)_([12])\./i);
      if (m) jobs.push(f.async("blob").then((blob) => photoPut(`${m[1]}_${m[2]}`, blob, name)));
    });
    await Promise.all(jobs);
    if (S.rows.length) await prunePhotos(openRows().map((r) => r.num));
    await persistMeta();
    if ($("dumpName")) $("dumpName").textContent = S.dumpName || file.name;
    refresh();
  }
  function bindDrop(el, input, handler) {
    if (!el || !input) return;
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.style.borderColor = "#5b9bd5"; });
    el.addEventListener("dragleave", () => { el.style.borderColor = ""; });
    el.addEventListener("drop", (e) => { e.preventDefault(); el.style.borderColor = ""; const f = e.dataTransfer.files[0]; if (f) handler(f); });
    input.addEventListener("change", () => { if (input.files[0]) handler(input.files[0]); });
  }
  async function init() {
    if ($("actDate")) $("actDate").value = todayISO();
    renderTokens(); renderActDate();
    S.tplReady = loadOfficial().catch((e) => { if ($("tplName")) $("tplName").textContent = "нет шаблона: загрузи образец.docx"; console.error(e); });
    try {
      await photoLoadAll(); await loadSnapshots();
      const meta = await idbGet("meta", "state");
      if (meta && meta.rows) {
        S.rows = meta.rows; S.dumpName = meta.dumpName || "";
        if (meta.actDate && $("actDate")) $("actDate").value = meta.actDate;
        if ($("dumpName") && S.dumpName) $("dumpName").textContent = S.dumpName + " · восстановлено";
      }
    } catch (e) { console.warn(e); }
    refresh();
    bindDrop($("dropDump"), $("fileDump"), onDump);
    bindDrop($("dropTpl"), $("fileTpl"), onTpl);
    $("actDate")?.addEventListener("change", () => { renderActDate(); persistMeta(); });
    $("q")?.addEventListener("input", renderTable);
    $("btnXlsx")?.addEventListener("click", downloadList);
    $("btnActs")?.addEventListener("click", downloadActsOnly);
    $("btnPack")?.addEventListener("click", downloadPack);
    $("btnProject")?.addEventListener("click", downloadProject);
    $("fileProject")?.addEventListener("change", () => { const f = $("fileProject").files[0]; if (f) restoreProject(f); });
    $("tape")?.addEventListener("click", (e) => { const day = e.target.closest("[data-snap]"); if (!day) return; S.activeSnap = Number(day.dataset.snap); renderTape(); });
    $("tableWrap")?.addEventListener("change", async (e) => { const inp = e.target.closest("input[data-slot]"); if (inp && inp.files[0]) await onPhotoFile(inp.dataset.slot, inp.files[0]); });
    $("tableWrap")?.addEventListener("click", async (e) => { const btn = e.target.closest("[data-del]"); if (!btn) return; e.preventDefault(); e.stopPropagation(); await photoDel(btn.dataset.del); refresh(); });
    document.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
    document.addEventListener("drop", async (e) => {
      const named = [...(e.dataTransfer?.files || [])].filter((f) => /^\d+_[12]\.\w+$/i.test(f.name));
      if (!named.length) return; e.preventDefault();
      for (const f of named) { const m = f.name.match(/^(\d+)_([12])\./i); await onPhotoFile(`${m[1]}_${m[2]}`, f); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
