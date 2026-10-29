/* v2.5 */
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
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // sequences display
  const seqHtml = '<section class="tape-wrap" style="margin-top:16px"><div class="open-head"><strong>Последовательности актов</strong></div>' +
    '<p class="kicker">К устранению: ' + (sequences.open.join(", ") || "—") + '</p>' +
    '<p class="kicker">Устранено: ' + (sequences.closed.join(", ") || "—") + '</p>' +
    '<p class="kicker">новые: ' + (sequences.new.join(", ") || "—") + '</p>' +
    '</section>';
  host.insertAdjacentHTML("beforeend", seqHtml);
  wireSlots();
  const sortBtn = host.querySelector("#sortBtn");
  if (sortBtn) sortBtn.addEventListener("click", () => { sortDesc = !sortDesc; renderOpen(); });
}

function render(d) {
  if (!d.ok) {
    ready = false; $("go").disabled = true; $("hint").textContent = "";
    $("out").innerHTML = '<div class="msg bad">' + d.error + "</div>";
    return;
  }
  ready = d.can_build;
  $("go").disabled = !d.can_build;
  $("hint").textContent = d.can_build ? "" : d.block;
  const a = d.act;
  $("out").innerHTML =
    '<section class="tape-wrap"><div class="meta">' +
    '<div><span class="k">Номер</span>' + a.act_no + "</div>" +
    '<div><span class="k">Инт.номер</span>' + (a.integration || "—") + "</div>" +
    '<div><span class="k">Статус</span>' + (a.status || "—") + "</div>" +
    '<div><span class="k">Дата предписания</span>' + (a.pred_date || "—") + "</div>" +
    '<div><span class="k">Срок</span>' + (a.deadline || "—") + "</div>" +
    '<div><span class="k">Дата акта</span>' + d.act_date + "</div>" +
    '<div><span class="k">Замечание</span>' + (a.description || "—") + "</div></div></section>" +
    '<section class="tape-wrap"><div class="photos">' +
    slotHtml(a.act_no, 1, "до", d.before, d.beforeUrl) +
    slotHtml(a.act_no, 2, "после", d.after, d.afterUrl) +
    "</div></section>";
}

function slotHtml(n, slot, label, name, url) {
  const img = url
    ? '<img src="' + url + '" alt="" data-full="' + url + '" data-pick="' + n + ':' + slot + '" style="cursor:pointer">'
    : '<div class="ph">Добавить фото ' + label + '</div>';
  const chgBtn = '<button type="button" class="chg" data-pick="' + n + ':' + slot + '">' + (url ? "Заменить" : "Добавить") + '</button>';
  return '<figure class="slot">' + img +
    '<div class="btns">' + chgBtn + '</div>' +
    '<figcaption class="kicker">' + label + " · " + (name || "нет " + n + "_" + slot) + "</figcaption></figure>";
}
async function toJpeg(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: bmp.width, h: bmp.height };
}
function drawingXml(rid, docId, name, cx, cy) {
  return '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="' + docId + '" name="' + name + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + docId + '" name="' + name + '"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>' +
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
  if (!xml.includes("xmlns:a=")) {
    xml = xml.replace("<w:document ", '<w:document xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ');
  }
  let photos = "";
  let relsExtra = "";
  if (beforeFile) {
    const before = await toJpeg(beforeFile);
    zip.file("word/media/image3.jpg", before.bytes);
    photos += drawingXml("rId13", 20, "foto_do", CX, Math.round(CX * before.h / before.w));
    relsExtra += "rId13 ";
  }
  if (afterFile) {
    const after = await toJpeg(afterFile);
    zip.file("word/media/image4.jpg", after.bytes);
    photos += drawingXml("rId14", 21, "foto_posle", CX, Math.round(CX * after.h / after.w));
    relsExtra += "rId14 ";
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
  if (!/Extension="jpe?g"/i.test(ct)) {
    ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/>');
  }
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
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);
  const a = iframe.contentDocument.createElement("a");
  a.href = url;
  a.download = name;
  iframe.contentDocument.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url); }, 500);
  return name;
}
async function pickFolder() {
  dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  $("folder").textContent = dirHandle.name;
  $("num").disabled = false;
  await refreshFiles();
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("akt-tool", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(dirHandle, "dir");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {}
}
async function restoreFolder() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("akt-tool", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const handle = await new Promise((resolve) => {
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get("dir");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (!handle) return;
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    dirHandle = handle;
    $("folder").textContent = dirHandle.name;
    await refreshFiles();
    await loadOpen();
    await loadIntMap();
    renderOpen();
  } catch (_) {}
}
$("pick").addEventListener("click", () => pickFolder().catch((e) => {
  $("out").innerHTML = '<div class="msg bad">' + (e.message || "Папку выбрать не удалось.") + "</div>";
}));
function expandNumbers(raw) {
  const nos = [];
  for (const part of (raw || "").trim().split(/\s+/)) {
    if (!part) continue;
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(x => parseInt(x, 10));
      if (!isNaN(a) && !isNaN(b)) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) nos.push(i);
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) nos.push(n);
    }
  }
  return [...new Set(nos)];
}
$("num").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const raw = $("num").value.trim();
    const nos = expandNumbers(raw);
    if (!nos.length || !dirHandle) { $("out").innerHTML = ""; $("go").disabled = true; $("pdfBtn").disabled = true; return; }
    if (nos.length === 1) {
      render(await lookup(nos[0]));
      wireSlots();
      $("pdfBtn").disabled = !$("go").disabled ? false : true;
    } else {
      $("out").innerHTML = '<div class="msg ok">Выбрано номеров: ' + nos.length + ' (' + nos.slice(0,10).join(", ") + (nos.length>10?"…":"") + ')</div>';
      $("go").disabled = false;
      $("pdfBtn").disabled = false;
      ready = true;
    }
  }, 200);
});
$("go").addEventListener("click", async () => {
  if (!ready) return;
  $("go").disabled = true;
  const nos = expandNumbers($("num").value);
  $("hint").textContent = "Собираю " + nos.length + "…";
  const done = [];
  for (const n of nos) {
    try {
      const name = await saveAct(n);
      done.push(name);
    } catch (e) {
      $("out").insertAdjacentHTML("afterbegin", '<div class="msg bad">' + n + ": " + e.message + "</div>");
    }
  }
  $("out").insertAdjacentHTML("afterbegin", '<div class="msg ok">Сохранено: ' + done.join(", ") + "</div>");
  $("go").disabled = false;
  $("hint").textContent = "";
});
if (typeof window.showDirectoryPicker !== "function") {
  $("out").innerHTML = '<div class="msg bad">Нужен Chrome или Edge. В этом браузере папку выбрать нельзя.</div>';
}


let cyrFontBytes = null;
async function getCyrFont() {
  if (cyrFontBytes) return cyrFontBytes;
  const res = await fetch("./data/ttr/LiberationSerif-Regular.ttf");
  if (!res.ok) throw new Error("не удалось загрузить шрифт");
  cyrFontBytes = new Uint8Array(await res.arrayBuffer());
  return cyrFontBytes;
}

async function makeActPdf(n) {
  const info = await lookup(n);
  if (!info.ok || !info.can_build) throw new Error(info.block || info.error);
  const { PDFDocument } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(await getCyrFont(), { subset: false });
  const W = 595, H = 842;
  const midY = H / 2;
  const photoMaxH = midY - 20;
  const photoMaxW = W - 40;
  const entries = await listEntries();
  const before = findPhotoEntry(entries, n, 1);
  const after = findPhotoEntry(entries, n, 2);
  const slots = [];
  if (before) slots.push({ e: before });
  if (after) slots.push({ e: after });
  if (slots.length) {
    const gap = 8;
    const slotW = (photoMaxW - (slots.length - 1) * gap) / slots.length;
    const photoTop = H - 10;
    for (let i = 0; i < slots.length; i++) {
      try {
        const file = await slots[i].e.handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        let img;
        try { img = await pdf.embedJpg(bytes); }
        catch (_) { try { img = await pdf.embedPng(bytes); } catch (__) { continue; } }
        const scale = Math.min(slotW / img.width, photoMaxH / img.height, 1);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const x = 20 + i * (slotW + gap) + (slotW - dw) / 2;
        const y = photoTop - dh;
        if (y > midY - 5) {
          page.drawImage(img, { x, y, width: dw, height: dh });
        }
      } catch (err) { console.warn("photo", n, err); }
    }
  }
  let y = midY - 16;
  page.drawText("Акт об устранении № " + n, { x: 40, y, size: 13, font });
  y -= 14;
  const intn = info.act.integration || "";
  if (intn) { page.drawText("Инт. № " + intn, { x: 40, y, size: 8, font }); y -= 12; }
  page.drawText("Дата предписания: " + (info.act.pred_date || "—") + "    Срок: " + (info.act.deadline || "—"), { x: 40, y, size: 8, font });
  y -= 14;
  page.drawText("Описание:", { x: 40, y, size: 8, font });
  y -= 14;
  // description with newline handling, fills to bottom
  let rest = (info.act.description || "—");
  const maxChars = 85;
  const bottomLimit = 40;
  const paragraphs = rest.split(/\n/);
  for (const para of paragraphs) {
    let p = para;
    while (p && y > bottomLimit) {
      let line = p.slice(0, maxChars);
      if (p.length > maxChars) {
        const cut = line.lastIndexOf(" ");
        if (cut > 30) line = line.slice(0, cut);
      }
      page.drawText(line, { x: 40, y, size: 8, font, maxWidth: 515 });
      p = p.slice(line.length).trimStart();
      y -= 12;
    }
    if (p && y > bottomLimit) {
      page.drawText(p.slice(0, maxChars - 3) + "…", { x: 40, y, size: 8, font, maxWidth: 515 });
      y -= 12;
    }
    y -= 4; // gap between paragraphs
  }
  y -= 6;
  const raw = comments[String(n)];
  const cc = (raw && typeof raw === "object") ? raw : { c1: raw || "", c2: "" };
  const c1n = (colNames && colNames.c1) || "Комментарий";
  const c2n = (colNames && colNames.c2) || "Примечание";
  if ((cc.c1 || cc.c2) && y > 30) {
    page.drawText(c1n + ": " + (cc.c1 || "—") + "    " + c2n + ": " + (cc.c2 || "—"), { x: 40, y, size: 9, font, maxWidth: 515 });
  }
  return await pdf.save();
}

async function makeCoverPdf(nos) {
  const { PDFDocument } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(await getCyrFont(), { subset: false });
  const bold = font;
  page.drawText("Устранение нарушений", { x: 30, y: 810, size: 14, font: bold });
  page.drawText("Всего: " + nos.length, { x: 30, y: 792, size: 10, font });
  let y = 770;
  const c1n = (colNames && colNames.c1) || "Комментарий";
  const c2n = (colNames && colNames.c2) || "Примечание";
  page.drawText("№", { x: 30, y, size: 8, font: bold });
  page.drawText("Инт. №", { x: 55, y, size: 8, font: bold });
  page.drawText("Описание", { x: 90, y, size: 8, font: bold });
  page.drawText("Фото", { x: 330, y, size: 8, font: bold });
  page.drawText(c1n.slice(0, 10), { x: 370, y, size: 8, font: bold });
  page.drawText(c2n.slice(0, 10), { x: 480, y, size: 8, font: bold });
  y -= 4;
  page.drawLine({ start: { x: 30, y }, end: { x: 565, y }, thickness: 0.5 });
  y -= 11;
  const rowH = Math.max(16, Math.min(22, (y - 28) / Math.max(nos.length, 1)));
  const thumbH = Math.min(rowH - 4, 14);
  const entries = await listEntries();
  for (const n of nos) {
    if (y < 28) break;
    const info = await lookup(n);
    const intn = info.ok ? (info.act.integration || "—") : "—";
    const descFull = info.ok ? (info.act.description || "").replace(/\n/g, " ") : "";
    const descMax = 52;
    let desc1 = descFull.slice(0, descMax);
    let desc2 = "";
    if (descFull.length > descMax) { const cut = desc1.lastIndexOf(" "); if (cut > 20) desc1 = desc1.slice(0, cut); desc2 = descFull.slice(desc1.length).trimStart().slice(0, descMax); }
    const raw = comments[String(n)];
    const cc = (raw && typeof raw === "object") ? raw : { c1: raw || "", c2: "" };
    page.drawText(String(n), { x: 30, y, size: 7, font });
    page.drawText(String(intn), { x: 55, y, size: 7, font });
    page.drawText(desc1, { x: 90, y, size: 7, font, maxWidth: 230 });
    if (desc2) page.drawText(desc2, { x: 90, y: y - 8, size: 7, font, maxWidth: 230 });
    // mini photos
    const before = findPhotoEntry(entries, n, 1);
    const after = findPhotoEntry(entries, n, 2);
    let px = 330;
    for (const e of [before, after]) {
      if (e) {
        try {
          const file = await e.handle.getFile();
          const bytes = new Uint8Array(await file.arrayBuffer());
          let img;
          try { img = await pdf.embedJpg(bytes); }
          catch (_) { try { img = await pdf.embedPng(bytes); } catch (__) { img = null; } }
          if (img) {
            const scale = Math.min(thumbH / img.height, 16 / img.width, 1);
            const dw = img.width * scale;
            const dh = img.height * scale;
            page.drawImage(img, { x: px, y: y - 2, width: dw, height: dh });
          }
        } catch (_) {}
      }
      px += 16;
    }
    page.drawText((cc.c1 || "").slice(0, 16), { x: 370, y, size: 7, font, maxWidth: 100 });
    page.drawText((cc.c2 || "").slice(0, 16), { x: 480, y, size: 7, font, maxWidth: 80 });
    y -= rowH;
    if (y > 28) page.drawLine({ start: { x: 30, y: y + 10 }, end: { x: 565, y: y + 10 }, thickness: 0.3, color: PDFLib.rgb(0.75, 0.75, 0.75) });
  }
  return await pdf.save();
}

async function downloadPdf(bytes, name) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  setTimeout(() => {
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }, 0);
}

$("pdfBtn").addEventListener("click", async () => {
  const nos = expandNumbers($("num").value);
  if (!nos.length) return;
  $("hint").textContent = "Делаю PDF…";
  try {
    if (nos.length === 1) {
      const bytes = await makeActPdf(nos[0]);
      await downloadPdf(bytes, "Акт_" + nos[0] + ".pdf");
    } else {
      const { PDFDocument } = PDFLib;
      const merged = await PDFDocument.create();
      for (const n of nos) {
        try {
          const bytes = await makeActPdf(n);
          const src = await PDFDocument.load(bytes);
          const [p] = await merged.copyPages(src, [0]);
          merged.addPage(p);
        } catch (_) {}
      }
      await downloadPdf(await merged.save(), "акты.pdf");
    }
    $("hint").textContent = "PDF готов";
  } catch (e) {
    $("hint").textContent = "";
    $("out").insertAdjacentHTML("afterbegin", '<div class="msg bad">' + e.message + "</div>");
  }
});



$("journalBtn").addEventListener("click", async () => {
  const nos = openRows.map(r => r.act_no);
  if (!nos.length) { alert("Нет незакрытых актов"); return; }
  $("hint").textContent = "Собираю журнал…";
  try {
    const { PDFDocument } = PDFLib;
    const journal = await PDFDocument.create();
    journal.registerFontkit(fontkit);
    const fontBytes = await getCyrFont();
    const font = await journal.embedFont(fontBytes, { subset: false });
    // cover page
    const coverPage = journal.addPage([595, 842]);
    coverPage.drawText("Устранение нарушений", { x: 30, y: 810, size: 14, font });
    coverPage.drawText("Всего: " + nos.length, { x: 30, y: 792, size: 10, font });
    let cy = 770;
    const c1n = (colNames && colNames.c1) || "Комментарий";
    const c2n = (colNames && colNames.c2) || "Примечание";
    coverPage.drawText("№", { x: 30, y: cy, size: 8, font });
    coverPage.drawText("Инт. №", { x: 55, y: cy, size: 8, font });
    coverPage.drawText("Описание", { x: 90, y: cy, size: 8, font });
    coverPage.drawText("Фото", { x: 330, y: cy, size: 8, font });
    coverPage.drawText(c1n.slice(0, 10), { x: 370, y: cy, size: 8, font });
    coverPage.drawText(c2n.slice(0, 10), { x: 480, y: cy, size: 8, font });
    cy -= 4;
    coverPage.drawLine({ start: { x: 30, y: cy }, end: { x: 565, y: cy }, thickness: 0.5 });
    cy -= 11;
    const rowH = Math.max(16, Math.min(22, (cy - 28) / Math.max(nos.length, 1)));
    const thumbH = Math.min(rowH - 4, 14);
    const entries = await listEntries();
    for (const n of nos) {
      if (cy < 28) break;
      const info = await lookup(n);
      const intn = info.ok ? (info.act.integration || "—") : "—";
      const descFull = info.ok ? (info.act.description || "").replace(/\n/g, " ") : "";
    const descMax = 52;
    let desc1 = descFull.slice(0, descMax);
    let desc2 = "";
    if (descFull.length > descMax) { const cut = desc1.lastIndexOf(" "); if (cut > 20) desc1 = desc1.slice(0, cut); desc2 = descFull.slice(desc1.length).trimStart().slice(0, descMax); }
      const raw = comments[String(n)];
      const cc = (raw && typeof raw === "object") ? raw : { c1: raw || "", c2: "" };
      coverPage.drawText(String(n), { x: 30, y: cy, size: 7, font });
      coverPage.drawText(String(intn), { x: 55, y: cy, size: 7, font });
      coverPage.drawText(desc1, { x: 90, y: cy, size: 7, font, maxWidth: 235 });
      if (desc2) coverPage.drawText(desc2, { x: 90, y: cy - 8, size: 7, font, maxWidth: 235 });
      const before = findPhotoEntry(entries, n, 1);
      const after = findPhotoEntry(entries, n, 2);
      let px = 330;
      for (const e of [before, after]) {
        if (e) {
          try {
            const file = await e.handle.getFile();
            const bytes = new Uint8Array(await file.arrayBuffer());
            let img;
            try { img = await journal.embedJpg(bytes); }
            catch (_) { try { img = await journal.embedPng(bytes); } catch (__) { img = null; } }
            if (img) {
              const scale = Math.min(thumbH / img.height, 16 / img.width, 1);
              const dw = img.width * scale;
              const dh = img.height * scale;
              coverPage.drawImage(img, { x: px, y: cy - 2, width: dw, height: dh });
            }
          } catch (_) {}
        }
        px += 16;
      }
      coverPage.drawText((cc.c1 || "").slice(0, 16), { x: 370, y: cy, size: 7, font, maxWidth: 100 });
      coverPage.drawText((cc.c2 || "").slice(0, 16), { x: 480, y: cy, size: 7, font, maxWidth: 80 });
      cy -= rowH;
      if (cy > 28) coverPage.drawLine({ start: { x: 30, y: cy + 10 }, end: { x: 565, y: cy + 10 }, thickness: 0.3, color: PDFLib.rgb(0.75, 0.75, 0.75) });
    }
    // act pages
    for (const n of nos) {
      try {
        const info = await lookup(n);
        if (!info.ok || !info.can_build) continue;
        const page = journal.addPage([595, 842]);
        const W = 595, H = 842;
        const midY = H / 2;
        const photoMaxH = midY - 20;
        const entries = await listEntries();
        const before = findPhotoEntry(entries, n, 1);
        const after = findPhotoEntry(entries, n, 2);
        const slots = [];
        if (before) slots.push({ e: before });
        if (after) slots.push({ e: after });
        if (slots.length) {
          const gap = 8;
          const slotW = (W - 40 - (slots.length - 1) * gap) / slots.length;
          const photoTop = H - 10;
          for (let i = 0; i < slots.length; i++) {
            try {
              const file = await slots[i].e.handle.getFile();
              const bytes = new Uint8Array(await file.arrayBuffer());
              let img;
              try { img = await journal.embedJpg(bytes); }
              catch (_) { try { img = await journal.embedPng(bytes); } catch (__) { continue; } }
              const scale = Math.min(slotW / img.width, photoMaxH / img.height, 1);
              const dw = img.width * scale, dh = img.height * scale;
              const x = 20 + i * (slotW + gap) + (slotW - dw) / 2;
              const y = photoTop - dh;
              if (y > midY - 5) {
                page.drawImage(img, { x, y, width: dw, height: dh });
              }
            } catch (err) { console.warn("jphoto", n, err); }
          }
        }
        let y = midY - 16;
        page.drawText("Акт об устранении № " + n, { x: 40, y, size: 13, font });
        y -= 14;
        const intn = info.act.integration || "";
        if (intn) { page.drawText("Инт. № " + intn, { x: 40, y, size: 8, font }); y -= 12; }
        page.drawText("Дата предписания: " + (info.act.pred_date || "—") + "    Срок: " + (info.act.deadline || "—"), { x: 40, y, size: 8, font });
        y -= 14;
        page.drawText("Описание:", { x: 40, y, size: 8, font });
        y -= 14;
        let rest = (info.act.description || "—");
        const maxChars = 85;
        const bottomLimit = 40;
        const paragraphs = rest.split(/\n/);
        for (const para of paragraphs) {
          let p = para;
          while (p && y > bottomLimit) {
            let line = p.slice(0, maxChars);
            if (p.length > maxChars) {
              const cut = line.lastIndexOf(" ");
              if (cut > 30) line = line.slice(0, cut);
            }
            page.drawText(line, { x: 40, y, size: 8, font, maxWidth: 515 });
            p = p.slice(line.length).trimStart();
            y -= 12;
          }
          if (p && y > bottomLimit) {
            page.drawText(p.slice(0, maxChars - 3) + "…", { x: 40, y, size: 8, font, maxWidth: 515 });
            y -= 12;
          }
          y -= 4;
        }
      } catch (err) { console.warn("jact", n, err); }
    }
    await downloadPdf(await journal.save(), "журнал.pdf");
    $("hint").textContent = "Журнал готов";
  } catch (e) {
    $("hint").textContent = "";
    alert(e.message);
  }
});

restoreFolder().then(() => loadOpen().then(() => { renderOpen(); wireSlots(); }));

function wireSlots() {
  document.querySelectorAll("[data-pick]").forEach((el) => {
    if (el.dataset.full) return; // photos with data-full open fullscreen via document listener
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const [n, slot] = el.dataset.pick.split(":");
      const inp = $("photoIn");
      inp.dataset.n = n;
      inp.dataset.slot = slot;
      inp.value = "";
      inp.click();
    });
  });
}
$("photoIn").addEventListener("change", async () => {
  const file = $("photoIn").files && $("photoIn").files[0];
  if (!file) return;
  const n = Number($("photoIn").dataset.n);
  const slot = Number($("photoIn").dataset.slot);
  $("hint").textContent = "Сохраняю фото…";
  try {
    await savePhoto(n, slot, file);
    render(await lookup(n));
    wireSlots();
    $("hint").textContent = "Фото сохранено: " + n + "_" + slot + ".jpg";
  } catch (e) {
    $("hint").textContent = "";
    $("out").insertAdjacentHTML("afterbegin", '<div class="msg bad">' + (e.message || "Не удалось сохранить фото.") + "</div>");
  }
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-full]");
  if (!btn) return;
  e.stopPropagation();
  const url = btn.dataset.full;
  const pick = btn.dataset.pick || "";
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:#000c;z-index:9999;display:flex;align-items:center;justify-content:center";
  overlay.innerHTML = '<img src="' + url + '" style="max-width:96%;max-height:96%;object-fit:contain"><div style="position:absolute;top:12px;right:12px;display:flex;gap:6px"><button id="fs-replace" style="background:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer">Заменить</button><button id="fs-close" style="background:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer">Закрыть</button></div>';
  overlay.querySelector("#fs-close").onclick = () => overlay.remove();
  overlay.querySelector("#fs-replace").onclick = () => {
    overlay.remove();
    if (pick) {
      const inp = $("photoIn");
      inp.dataset.pick = pick;
      inp.click();
    }
  };
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
});
