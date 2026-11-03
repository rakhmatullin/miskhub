/* v2.7 */
/* MiskHub sborka — сборка акта на GitHub Pages */
const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"];
const MONTHS = ["", "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const CX = 5240000;
const TPL_URL = "./shablon-akt.b64";

const $ = (id) => document.getElementById(id);
let dirHandle = null;
let ready = false;
let timer = null;

function pad(n) { return String(n).padStart(2, "0"); }
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;");
}
function ruQuoted(d) {
  const [dd, mm, yy] = d.split(".");
  return "«" + dd + "» " + MONTHS[Number(mm)] + " " + yy;
}
function todayStr() {
  const d = new Date();
  return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
}
function asDateStr(val) {
  if (val == null || val === "") return null;
  if (val instanceof Date && !isNaN(val)) return pad(val.getDate()) + "." + pad(val.getMonth() + 1) + "." + val.getFullYear();
  if (typeof val === "number" && val > 20000 && val < 80000) {
    const p = XLSX.SSF.parse_date_code(val);
    if (p) return pad(p.d) + "." + pad(p.m) + "." + p.y;
  }
  const m = String(val).trim().match(/(\d{1,2})[.](\d{1,2})[.](\d{4})/);
  if (!m) return null;
  return pad(m[1]) + "." + pad(m[2]) + "." + m[3];
}
function cleanDeadline(val) {
  if (val instanceof Date || typeof val === "number") return asDateStr(val);
  const cut = String(val == null ? "" : val).replace(/\s*\+?\s*\d+\s*дн\.?/i, " ").trim();
  return asDateStr(cut) || asDateStr(val);
}
function parseDump(buf) {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  let header = -1, map = {};
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const vals = {};
    grid[i].forEach((v, c) => { const key = String(v).trim(); if (key) vals[key] = c; });
    if ("Номер" in vals && "Статус" in vals) { header = i; map = vals; break; }
  }
  if (header < 0) throw new Error("В файле нет таблицы замечаний. Нужна выгрузка с колонками Номер и Статус.");
  const col = (...names) => { for (const name of names) if (name in map) return map[name]; return -1; };
  const rows = [];
  for (let i = header + 1; i < grid.length; i++) {
    const n = parseInt(String(grid[i][map["Номер"]]).trim(), 10);
    if (!Number.isFinite(n)) continue;
    const descCol = col("Описание", "Устраненные замечания");
    rows.push({
      act_no: n,
      status: String(grid[i][map["Статус"]] || "").trim(),
      pred_date: asDateStr(grid[i][col("Дата")]),
      deadline: cleanDeadline(grid[i][col("Срок устранения")]),
      description: descCol < 0 ? "" : String(grid[i][descCol] || "").trim(),
      integration: col("Интеграционный номер") < 0 ? "" : String(grid[i][col("Интеграционный номер")] || "").trim(),
    });
  }
  return rows;
}
async function listEntries() {
  const out = [];
  for await (const [name, handle] of dirHandle.entries()) if (handle.kind === "file") out.push({ name, handle });
  return out;
}
async function fileByName(entries, name) {
  const hit = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.handle.getFile() : null;
}
async function findDumpFile(entries) {
  const classic = entries.find((e) => e.name.toLowerCase() === "выгрузка.xlsx");
  if (classic) return classic.handle.getFile();
  const docs = [];
  for (const e of entries) {
    const low = e.name.toLowerCase();
    if (low.includes("document") && (low.endsWith(".xls") || low.endsWith(".xlsx"))) {
      const f = await e.handle.getFile();
      docs.push({ entry: e, file: f, mtime: f.lastModified });
    }
  }
  if (!docs.length) return null;
  docs.sort((a, b) => b.mtime - a.mtime);
  for (const d of docs.slice(1)) {
    try { await dirHandle.removeEntry(d.entry.name); } catch (_) {}
  }
  return docs[0].file;
}
function findPhotoEntry(entries, n, slot) {
  const prefix = (n + "_" + slot + ".").toLowerCase();
  return entries.find((e) => {
    const low = e.name.toLowerCase();
    return low.startsWith(prefix) && PHOTO_EXT.some((ext) => low.endsWith(ext));
  }) || null;
}
function pill(text, cls) { return '<span class="pill ' + (cls || "") + '">' + text + "</span>"; }
async function embeddedTemplate() {
  const res = await fetch(TPL_URL);
  if (!res.ok) throw new Error("Не удалось загрузить встроенный шаблон.");
  const b64 = (await res.text()).replace(/\s/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function refreshFiles() {
  if (!dirHandle) { $("files").innerHTML = ""; return; }
  const entries = await listEntries();
  const dump = await findDumpFile(entries);
  $("files").innerHTML = "";
  $("num").disabled = !dump;
}
async function lookup(n) {
  const entries = await listEntries();
  const dumpFile = await findDumpFile(entries);
  if (!dumpFile) return { ok: false, error: "В папке нет выгрузка.xlsx и нет document*.xls(x)." };
  let rows;
  try { rows = parseDump(await dumpFile.arrayBuffer()); }
  catch (e) { return { ok: false, error: e.message }; }
  const act = rows.find((x) => x.act_no === n);
  if (!act) return { ok: false, error: "Номера " + n + " нет в выгрузке." };
  const before = findPhotoEntry(entries, n, 1);
  const after = findPhotoEntry(entries, n, 2);
  let block = "";
  if (act.status === "Закрыто") block = "Строка закрыта, акт не собираю.";
  else if (act.status === "Удалено") block = "Строка удалена, акта нет.";
  else if (act.status !== "К устранению") block = "Статус «" + (act.status || "пусто") + "» — собираю только «К устранению».";
  else if (!act.pred_date) block = "В строке нет даты предписания.";
  else if (!act.deadline) block = "В строке нет срока устранения.";
  else if (!act.description) block = "В строке нет текста замечания.";
  if (intMap[String(act.act_no)]) act.integration = intMap[String(act.act_no)];
  return {
    ok: true, act, act_date: todayStr(),
    before: before ? before.name : null, after: after ? after.name : null,
    beforeUrl: before ? URL.createObjectURL(await before.handle.getFile()) : null,
    afterUrl: after ? URL.createObjectURL(await after.handle.getFile()) : null,
    can_build: !block, block,
  };
}

const COMMENTS_FILE = "комментарии.json";
let comments = {};
let openRows = [];
let sortDesc = true;
let dumpDate = "";

async function loadComments() {
  comments = {};
  if (!dirHandle) return;
  try {
    const entries = await listEntries();
    const f = await fileByName(entries, COMMENTS_FILE);
    if (!f) return;
    comments = JSON.parse(await f.text()) || {};
  } catch (_) { comments = {}; }
}
async function saveComments() {
  if (!dirHandle) return;
  const fh = await dirHandle.getFileHandle(COMMENTS_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([JSON.stringify(comments, null, 2)], { type: "application/json" }));
  await w.close();
}

const INT_MAP_FILE = "интеграционные.json";
let intMap = {};

async function loadIntMap() {
  intMap = {};
  if (!dirHandle) return;
  try {
    const entries = await listEntries();
    const f = await fileByName(entries, INT_MAP_FILE);
    if (!f) return;
    intMap = JSON.parse(await f.text()) || {};
  } catch (_) { intMap = {}; }
}
async function saveIntMap() {
  if (!dirHandle) return;
  const fh = await dirHandle.getFileHandle(INT_MAP_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([JSON.stringify(intMap, null, 2)], { type: "application/json" }));
  await w.close();
}


let commentTimers = {};
function scheduleComment(n, field, value) {
  const key = String(n);
  if (!comments[key] || typeof comments[key] !== "object") {
    comments[key] = { c1: (typeof comments[key] === "string" ? comments[key] : ""), c2: "" };
  }
  comments[key][field || "c1"] = value;
  clearTimeout(commentTimers[key + (field || "c1")]);
  commentTimers[key + (field || "c1")] = setTimeout(() => saveComments().catch(() => {}), 400);
}
async function savePhoto(n, slot, file) {
  const jpeg = await toJpeg(file);
  const name = n + "_" + slot + ".jpg";
  const entries = await listEntries();
  const old = findPhotoEntry(entries, n, slot);
  if (old && old.name !== name) {
    try { await dirHandle.removeEntry(old.name); } catch (_) {}
  }
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(jpeg.bytes);
  await w.close();
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """);
}

const SEQ_FILE = "последовательности_актов.json";
let sequences = { open: [], closed: [], new: [] };

async function loadSequences() {
  sequences = { open: [], closed: [], new: [] };
  if (!dirHandle) return;
  try {
    const entries = await listEntries();
    const f = await fileByName(entries, SEQ_FILE);
    if (!f) return;
    const data = JSON.parse(await f.text()) || {};
    sequences.open = Array.isArray(data.open) ? data.open : [];
    sequences.closed = Array.isArray(data.closed) ? data.closed : [];
    sequences.new = Array.isArray(data.new) ? data.new : [];
  } catch (_) { sequences = { open: [], closed: [], new: [] }; }
}

async function saveSequences() {
  if (!dirHandle) return;
  const payload = {
    _comment: "Файл последовательностей актов для нейронки и человека. open — текущие незакрытые номера в порядке первого появления. closed — закрытые в порядке закрытия. new — новые в порядке появления. Логика: при загрузке выгрузки номера, исчезнувшие из open, переносятся в closed; новые из выгрузки добавляются в open и new. Не править вручную без понимания.",
    open: sequences.open,
    closed: sequences.closed,
    new: sequences.new
  };
  const fh = await dirHandle.getFileHandle(SEQ_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  await w.close();
}

async function updateSequences() {
  await loadSequences();
  const current = openRows.map(r => r.act_no);
  const currentSet = new Set(current);
  if (sequences.open.length === 0 && sequences.closed.length === 0 && sequences.new.length === 0) {
    sequences.open = [...current];
    sequences.closed = [];
    sequences.new = [];
  } else {
    // numbers in open that disappeared from dump → move to closed
    const stillOpen = [];
    for (const n of sequences.open) {
      if (currentSet.has(n)) stillOpen.push(n);
      else sequences.closed.push(n);
    }
    sequences.open = stillOpen;
    // numbers in dump not in open → add to open and new
    const openSet = new Set(sequences.open);
    for (const n of current) {
      if (!openSet.has(n)) {
        sequences.open.push(n);
        sequences.new.push(n);
        openSet.add(n);
      }
    }
  }
  await saveSequences();
}

async function loadOpen() {
  openRows = []; dumpDate = "";
  if (!dirHandle) return;
  const entries = await listEntries();
  const dump = await findDumpFile(entries);
  if (!dump) return;
  dumpDate = todayStrFrom(dump.lastModified);
  try { openRows = parseDump(await dump.arrayBuffer()).filter((r) => r.status === "К устранению"); }
  catch (_) { openRows = []; }
  await loadComments();
  await loadColNames();
  await loadIntMap();
  openRows.forEach(r => { if (intMap[String(r.act_no)]) r.integration = intMap[String(r.act_no)]; });
  await updateSequences();
}
function todayStrFrom(ms) {
  const d = new Date(ms);
  return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
}

let colNames = { c1: "Комментарий", c2: "Примечание" };
async function loadColNames() {
  if (!dirHandle) return;
  try {
    const entries = await listEntries();
    const f = await fileByName(entries, "названия_комментариев.json");
    if (f) Object.assign(colNames, JSON.parse(await f.text()) || {});
  } catch (_) {}
}
async function saveColNames() {
  if (!dirHandle) return;
  try {
    const fh = await dirHandle.getFileHandle("названия_комментариев.json", { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([JSON.stringify(colNames)], { type: "application/json" }));
    await w.close();
  } catch (_) {}
}
async function renderOpen() {
  const host = $("open");
  if (!host) return;
  if (!dirHandle) { host.innerHTML = ""; return; }
  if (!openRows.length) {
    host.innerHTML = '<section class="tape-wrap"><div class="open-head"><strong>Незакрытые акты</strong><span class="kicker">' +
      (dumpDate ? "выгрузка от " + dumpDate : "нет выгрузки") + '</span></div><p class="kicker">Нет строк «К устранению».</p></section>';
    return;
  }
  const sorted = [...openRows].sort((a, b) => sortDesc ? b.act_no - a.act_no : a.act_no - b.act_no);
  let rows = "";
  for (const r of sorted) {
    const raw = comments[String(r.act_no)];
    const cc = (raw && typeof raw === "object") ? raw : { c1: raw || "", c2: "" };
    const entries = await listEntries();
    const before = findPhotoEntry(entries, r.act_no, 1);
    const after = findPhotoEntry(entries, r.act_no, 2);
    const beforeUrl = before ? URL.createObjectURL(await before.handle.getFile()) : "";
    const afterUrl = after ? URL.createObjectURL(await after.handle.getFile()) : "";
    const mini = '<div class="mini-photos">' +
      (beforeUrl ? '<img src="' + beforeUrl + '" data-full="' + beforeUrl + '" data-pick="' + r.act_no + ':1" title="ДО">' : '<div class="ph" data-pick="' + r.act_no + ':1">+</div>') +
      (afterUrl ? '<img src="' + afterUrl + '" data-full="' + afterUrl + '" data-pick="' + r.act_no + ':2" title="ПОСЛЕ">' : '<div class="ph" data-pick="' + r.act_no + ':2">+</div>') +
      '</div>';
    rows += "<tr>" +
      '<td class="num" data-go="' + r.act_no + '">' + r.act_no + "</td>" +
      '<td>' + esc(r.integration || "—") + "</td>" +
      "<td>" + esc(r.pred_date || "—") + "</td>" +
      "<td>" + esc(r.deadline || "—") + "</td>" +
      '<td class="desc">' + esc(r.description || "—") + "</td>" +
      '<td>' + mini + '</td>' +
      '<td><textarea class="cmt" data-cmt="' + r.act_no + '" data-field="c1" rows="2">' + esc(cc.c1 || "") + "</textarea></td>" +
      '<td><textarea class="cmt" data-cmt="' + r.act_no + '" data-field="c2" rows="2">' + esc(cc.c2 || "") + "</textarea></td>" +
      "</tr>";
  }
  host.innerHTML =
    '<section class="tape-wrap"><div class="open-head"><strong>Незакрытые акты · ' + openRows.length + '</strong>' +
    '<span class="kicker">выгрузка от ' + esc(dumpDate || "—") + '</span></div>' +
    '<table class="table"><thead><tr><th style="white-space:nowrap"><button id="sortBtn" type="button" style="background:transparent;border:0;color:inherit;cursor:pointer;font:inherit;padding:0 2px 0 0;vertical-align:middle">' + (sortDesc ? '\u2193' : '\u2191') + '</button>Номер</th><th>Инт.номер</th><th>Дата</th><th>Срок устранения</th><th>Описание</th>' +
    '<th><input class="colname" data-col="c1" value="' + esc((colNames && colNames.c1) || 'Комментарий') + '" style="width:110px;background:transparent;border:0;color:inherit;font:inherit" title="название столбца"></th>' +
    '<th><input class="colname" data-col="c2" value="' + esc((colNames && colNames.c2) || 'Примечание') + '" style="width:110px;background:transparent;border:0;color:inherit;font:inherit" title="название столбца"></th>' +
    '</tr></thead><tbody>' +
    rows + "</tbody></table></section>";
  host.querySelectorAll("[data-cmt]").forEach((el) => {
    el.addEventListener("input", () => scheduleComment(el.dataset.cmt, el.dataset.field || "c1", el.value));
  });
  host.querySelectorAll(".colname").forEach((el) => {
    el.addEventListener("change", () => {
      colNames[el.dataset.col] = el.value;
      saveColNames().catch(() => {});
    });
    el.addEventListener("blur", () => {
      colNames[el.dataset.col] = el.value;
      saveColNames().catch(() => {});
    });
  });
  host.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => {
      $("num").value = el.dataset.go;
      $("num").dispatchEvent(new Event("input"));
    });
  });
  const sortBtn = host.querySelector("#sortBtn");
  if (sortBtn) sortBtn.addEventListener("click", () => { sortDesc = !sortDesc; renderOpen(); });
  host.querySelectorAll("[data-pick]").forEach((el) => {
    el.addEventListener("click", () => {
      const [n, slot] = el.dataset.pick.split(":");
      pickPhoto(n, slot);
    });
  });
  host.querySelectorAll("img[data-full]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center";
      overlay.innerHTML = '<img src="' + el.dataset.full + '" style="max-width:90%;max-height:90%">';
      overlay.addEventListener("click", () => overlay.remove());
      document.body.appendChild(overlay);
    });
  });
}

async function toJpeg(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, w: bmp.width, h: bmp.height };
}

function drawingXml(rid, docId, name, cx, cy) {
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="' + docId + '" name="' + name + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="' + docId + '" name="' + name + '"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}
function appXml() {
  return '<w:p><w:pPr><w:pageBreakBefore/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="22"/></w:rPr><w:t>Приложение 1</w:t></w:r></w:p>';
}
function ensureRel(rels, rid, target) {
  if (rels.includes('Id="' + rid + '"')) {
    return rels.replace(new RegExp('<Relationship Id="' + rid + '"[^>]*/>'),
      '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + target + '"/>');
  }
  return rels.replace("</Relationships>",
    '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + target + '"/></Relationships>');
}
async function buildAct({ templateBuf, actNo, integration, actDate, predDate, deadline, description, beforeFile, afterFile }) {
  const zip = await JSZip.loadAsync(templateBuf);
  let xml = await zip.file("word/document.xml").async("string");
  const useNo = (integration || "").trim() || String(actNo);
  const map = {
    "{{НОМЕР-АКТА}}": useNo,
    "{{ДАТА-АКТА-ТЕКСТ}}": ruQuoted(actDate),
    "{{ДАТА-ПРЕДПИСАНИЯ-ТЕКСТ}}": ruQuoted(predDate) + "г.",
    "{{ОПИСАНИЕ}}": xmlEscape(description),
    "{{СРОК-УСТРАНЕНИЯ}}": deadline,
  };
  for (const [a, b] of Object.entries(map)) xml = xml.split(a).join(b);
  xml = xml.split("А.О. Татаринов").join("Р.Р. Рахматов");
  const marker = xml.indexOf("> Приложение 1<") >= 0 ? xml.indexOf("> Приложение 1<") : xml.indexOf(">Приложение 1<");
  if (marker > 0) {
    let start = -1, from = marker;
    while (from > 0) {
      const i = xml.lastIndexOf("<w:p", from);
      if (i < 0) break;
      const next = xml[i + 4];
      if (next === ">" || next === " ") { start = i; break; }
      from = i - 1;
    }
    const end = xml.indexOf("</w:p>", marker);
    if (start >= 0 && end > marker) xml = xml.slice(0, start) + xml.slice(end + "</w:p>".length);
  }
  if (!xml.includes("xmlns:r=")) xml = xml.replace("<w:document ", '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  if (!xml.includes("xmlns:wp=")) xml = xml.replace("<w:document ", '<w:document xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ');
  if (!xml.includes("xmlns:a=")) xml = xml.replace("<w:document ", '<w:document xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ');
  if (!xml.includes("xmlns:pic=")) xml = xml.replace("<w:document ", '<w:document xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ');
  let photos = "";
  if (beforeFile) {
    const before = await toJpeg(beforeFile);
    zip.file("word/media/image3.jpg", before.bytes);
    photos += drawingXml("rId13", 20, "foto_do", CX, Math.round(CX * before.h / before.w));
  }
  if (afterFile) {
    const after = await toJpeg(afterFile);
    zip.file("word/media/image4.jpg", after.bytes);
    photos += drawingXml("rId14", 21, "foto_posle", CX, Math.round(CX * after.h / after.w));
  }
  if (photos) photos = appXml() + photos;
  if (!xml.includes("<w:sectPr")) throw new Error("В шаблоне нет раздела страницы.");
  xml = xml.replace("<w:sectPr", photos + "<w:sectPr");
  zip.file("word/document.xml", xml);
  let rels = await zip.file("word/_rels/document.xml.rels").async("string");
  if (beforeFile) rels = ensureRel(rels, "rId13", "media/image3.jpg");
  if (afterFile) rels = ensureRel(rels, "rId14", "media/image4.jpg");
  zip.file("word/_rels/document.xml.rels", rels);
  let ct = await zip.file("[Content_Types].xml").async("string");
  // Всегда гарантируем корректные ContentType для jpg и jpeg.
  // Старый код добавлял их только если не было ни одного из расширений,
  // из-за чего при наличии jpeg (логотип) jpg оставался без типа → Word «восстановить содержимое».
  ct = ct.replace(/<Default Extension="jpe?g"[^>]*\/>/gi, "");
  ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/>');
  zip.file("[Content_Types].xml", ct);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
function actName(n, integration) {
  const use = (integration || "").trim() || String(n);
  return "Акт об Устранении №" + use + ".docx";
}
async function saveAct(n) {
  const info = await lookup(n);
  if (!info.ok) throw new Error(info.error);
  if (!info.can_build) throw new Error(info.block);
  const entries = await listEntries();
  const templateFile = await fileByName(entries, "shablon-akt.docx");
  const templateBuf = templateFile ? await templateFile.arrayBuffer() : await embeddedTemplate();
  const before = findPhotoEntry(entries, n, 1);
  const after = findPhotoEntry(entries, n, 2);
  const blob = await buildAct({
    templateBuf,
    actNo: n,
    integration: info.act.integration,
    actDate: info.act_date,
    predDate: info.act.pred_date,
    deadline: info.act.deadline,
    description: info.act.description,
    beforeFile: before ? await before.handle.getFile() : null,
    afterFile: after ? await after.handle.getFile() : null,
  });
  const name = actName(n, info.act.integration);
  if (!dirHandle) throw new Error("Сначала выбери папку");
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  $("hint").textContent = "Собран: " + name;
  await refreshFiles();
}
async function pickPhoto(n, slot) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    if (!input.files || !input.files[0]) return;
    await savePhoto(n, slot, input.files[0]);
    $("hint").textContent = "Фото сохранено: " + n + "_" + slot + ".jpg";
    await renderOpen();
  };
  input.click();
}

$("pick").addEventListener("click", async () => {
  try {
    dirHandle = await window.showDirectoryPicker();
    await refreshFiles();
    await loadOpen();
    await renderOpen();
    $("hint").textContent = "Папка выбрана";
  } catch (e) {
    if (e.name !== "AbortError") $("hint").textContent = e.message;
  }
});
$("num").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const n = parseInt($("num").value, 10);
    if (!n) { $("card").innerHTML = ""; return; }
    try {
      const info = await lookup(n);
      if (!info.ok) { $("card").innerHTML = '<p class="err">' + info.error + "</p>"; return; }
      const a = info.act;
      $("card").innerHTML =
        "<p><strong>№" + a.act_no + "</strong> " + pill(a.status) + "</p>" +
        "<p>Инт.: " + esc(a.integration || "—") + "</p>" +
        "<p>Дата предп.: " + esc(a.pred_date || "—") + "</p>" +
        "<p>Срок: " + esc(a.deadline || "—") + "</p>" +
        "<p>" + esc(a.description || "—") + "</p>" +
        "<p>Фото ДО: " + (info.before || "нет") + "</p>" +
        "<p>Фото ПОСЛЕ: " + (info.after || "нет") + "</p>" +
        (info.block ? '<p class="err">' + info.block + "</p>" : "") +
        (info.can_build ? '<button id="build">Собрать акт</button>' : "");
      const btn = $("build");
      if (btn) btn.addEventListener("click", () => saveAct(n).catch((e) => { $("hint").textContent = e.message; }));
    } catch (e) {
      $("card").innerHTML = '<p class="err">' + e.message + "</p>";
    }
  }, 300);
});

// Инициализация
$("hint").textContent = "Выбери папку с выгрузкой и фото";
