/* v2.9 */
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
async function listEntries(folder = dirHandle) {
  const out = [];
  for await (const [name, handle] of folder.entries()) if (handle.kind === "file") out.push({ name, handle });
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
const INT_MAP_FILE = "интеграционные.json";
const COL_FILE = "названия_комментариев.json";
const SEQ_FILE = "последовательности_актов.json";
const defaultColumns = {c1: "Комментарий", c2: "Примечание"};
let comments = {}, intMap = {}, colNames = {...defaultColumns};
let sequences = {open: [], closed: [], new: []}, openRows = [], dumpDate = "", sortDesc = true;

function dictionary(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validLegacy(name, data) {
  if (!dictionary(data) || Object.hasOwn(data, "schemaVersion")) return false;
  if (name === SEQ_FILE) {
    return ["open", "closed", "new"].every(key => Array.isArray(data[key]) && data[key].every(Number.isSafeInteger));
  }
  const validColumns = item => ["c1", "c2"].every(key => !Object.hasOwn(item, key) || typeof item[key] === "string");
  if (name === COL_FILE) return validColumns(data);
  return Object.entries(data).every(([key, item]) => {
    if (!/^-?\d+$/.test(key)) return true;
    if (name === INT_MAP_FILE) return typeof item === "string" || typeof item === "number";
    return typeof item === "string" || (dictionary(item) && validColumns(item));
  });
}

async function readLegacy(dir, name) {
  try {
    const matches = (await listEntries(dir)).filter(entry => entry.name.toLowerCase() === name);
    if (matches.length > 1) throw new Error("Неоднозначное имя файла.");
    const handle = matches[0]?.handle;
    if (!handle) return {data: {}};
    const data = JSON.parse(await (await handle.getFile()).text());
    if (!validLegacy(name, data)) throw new Error("Неизвестная структура или версия данных.");
    return {handle, data};
  } catch (error) {
    throw new Error("Не удалось прочитать «" + name + "». " + error.message + " Восстановите файл из резервной копии и повторите открытие.");
  }
}

function readLegacyFolder(dir) {
  return navigator.locks.request("miskhub-legacy-json", async () => {
    const files = await Promise.all([COMMENTS_FILE, INT_MAP_FILE, COL_FILE, SEQ_FILE].map(name => readLegacy(dir, name)));
    return {comments: files[0].data, intMap: files[1].data, colNames: {...defaultColumns, ...files[2].data},
      sequences: files[3].handle ? files[3].data : {open: [], closed: [], new: []}};
  });
}

function editLegacy(dir, name, edit) {
  return navigator.locks.request("miskhub-legacy-json", async () => {
    const {handle, data} = await readLegacy(dir, name);
    const previous = JSON.stringify(data);
    edit(data);
    if (JSON.stringify(data) !== previous) {
      const file = handle || await dir.getFileHandle(name, {create: true});
      const writer = await file.createWritable();
      try {
        await writer.write(JSON.stringify(data, null, 2));
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => {});
        throw error;
      }
    }
    return data;
  });
}

// Merge queued edits into the latest valid disk data. The captured directory
// remains the write destination if the user switches folders in the meantime.
const pendingEdits = new WeakMap();
let legacyWrites = 0;
function queueLegacyEdit(dir, name, key, edit) {
  let files = pendingEdits.get(dir);
  if (!files) pendingEdits.set(dir, files = new Map());
  let edits = files.get(name);
  if (!edits) {
    files.set(name, edits = new Map());
    legacyWrites++;
    editLegacy(dir, name, data => {
      files.delete(name);
      for (const change of edits.values()) change(data);
    }).catch(error => {
      if (files.get(name) === edits) files.delete(name);
      if (dir === dirHandle) $("hint").textContent = "Не сохранён файл «" + name + "». " + error.message;
    }).finally(() => legacyWrites--);
  }
  edits.set(key, edit);
}

function scheduleComment(n, field, value) {
  if (!dirHandle) return;
  const edit = data => {
    if (!dictionary(data[n])) data[n] = {c1: data[n] || "", c2: ""};
    data[n][field] = value;
  };
  edit(comments);
  queueLegacyEdit(dirHandle, COMMENTS_FILE, n + "/" + field, edit);
}

function updateColName(field, value) {
  if (!dirHandle) return;
  colNames[field] = value;
  queueLegacyEdit(dirHandle, COL_FILE, field, data => {
    for (const key of Object.keys(defaultColumns)) data[key] ??= defaultColumns[key];
    data[field] = value;
  });
}

function reconcileSequences(data, current) {
  if (!data.open) Object.assign(data, {open: [], closed: [], new: []});
  if (!data.open.length && !data.closed.length && !data.new.length) {
    data.open = [...current];
    return;
  }
  const currentSet = new Set(current);
  data.closed.push(...data.open.filter(n => !currentSet.has(n)));
  data.open = data.open.filter(n => currentSet.has(n));
  const openSet = new Set(data.open);
  for (const n of current) {
    if (!openSet.has(n)) {
      data.open.push(n);
      data.new.push(n);
      openSet.add(n);
    }
  }
}

async function readOpenDump(dir) {
  const file = await findDumpFile(await listEntries(dir));
  if (!file) return {date: "", rows: []};
  const rows = parseDump(await file.arrayBuffer()).filter(row => row.status === "К устранению");
  const date = new Date(file.lastModified);
  return {date: pad(date.getDate()) + "." + pad(date.getMonth() + 1) + "." + date.getFullYear(), rows};
}

async function loadWorkspace(dir, legacy, dump) {
  const savedSequences = dump.date
    ? await editLegacy(dir, SEQ_FILE, data => reconcileSequences(data, dump.rows.map(row => row.act_no)))
    : legacy.sequences;
  ({comments, intMap, colNames} = legacy);
  for (const row of dump.rows) row.integration = intMap[row.act_no] || row.integration;
  sequences = savedSequences;
  openRows = dump.rows;
  dumpDate = dump.date;
  dirHandle = dir;
}
async function savePhoto(n, slot, file, folder) {
  if (folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
  const jpeg = await toJpeg(file);
  const name = n + "_" + slot + ".jpg";
  const old = findPhotoEntry(await listEntries(folder), n, slot);
  const fh = await folder.getFileHandle(name, { create: true });
  const writer = await fh.createWritable();
  try {
    await writer.write(jpeg.bytes);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
  if (old && old.name !== name) await folder.removeEntry(old.name);
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let renderVersion = 0;
async function renderOpen() {
  const version = ++renderVersion;
  const folder = dirHandle;
  const host = $("open");
  if (!host) return;
  if (!dirHandle) { host.innerHTML = ""; return; }
  if (!openRows.length) {
    host.innerHTML = '<section class="tape-wrap"><div class="open-head"><strong>Незакрытые акты</strong><span class="kicker">' +
      (dumpDate ? "выгрузка от " + dumpDate : "нет выгрузки") + '</span></div><p class="kicker">Нет строк «К устранению».</p></section>';
    return;
  }
  const sorted = [...openRows].sort((a, b) => sortDesc ? b.act_no - a.act_no : a.act_no - b.act_no);
  const entries = await listEntries(folder);
  let rows = "";
  for (const r of sorted) {
    const raw = comments[String(r.act_no)];
    const cc = (raw && typeof raw === "object") ? raw : { c1: raw || "", c2: "" };
    const before = findPhotoEntry(entries, r.act_no, 1);
    const after = findPhotoEntry(entries, r.act_no, 2);
    const beforeUrl = before ? URL.createObjectURL(await before.handle.getFile()) : "";
    const afterUrl = after ? URL.createObjectURL(await after.handle.getFile()) : "";
    const mini = '<div class="mini-photos">' +
      (beforeUrl ? '<img src="' + beforeUrl + '" data-full="' + beforeUrl + '" data-pick="' + r.act_no + ':1" title="ДО">' : '<div class="ph" data-pick="' + r.act_no + ':1">+</div>') +
      (afterUrl ? '<img src="' + afterUrl + '" data-full="' + afterUrl + '" data-pick="' + r.act_no + ':2" title="ПОСЛЕ">' : '<div class="ph" data-pick="' + r.act_no + ':2">+</div>') +
      '</div>';
    rows += '<tr data-remark="' + r.act_no + '">' +
      '<td><input type="checkbox" class="row-sel" data-n="' + r.act_no + '"></td>' +
      '<td class="num" data-go="' + r.act_no + '">' + r.act_no + "</td>" +
      '<td>' + esc(r.integration || "—") + "</td>" +
      "<td>" + esc(r.pred_date || "—") + "</td>" +
      "<td>" + esc(r.deadline || "—") + "</td>" +
      '<td class="desc">' + esc(r.description || "—") + "</td>" +
      '<td>' + mini + '</td>' +
      '<td><button type="button" data-resp="' + r.act_no + '">Не назначен</button></td>' +
      '<td><textarea class="cmt" data-cmt="' + r.act_no + '" data-field="c1" rows="2">' + esc(cc.c1 || "") + "</textarea></td>" +
      '<td><textarea class="cmt" data-cmt="' + r.act_no + '" data-field="c2" rows="2">' + esc(cc.c2 || "") + "</textarea></td>" +
      "</tr>";
  }
  if (folder !== dirHandle || version !== renderVersion) return;
  host.innerHTML =
    '<section class="tape-wrap"><div class="open-head"><strong>Незакрытые акты · ' + openRows.length + '</strong>' +
    '<span class="kicker">выгрузка от ' + esc(dumpDate || "—") + '</span></div>' +
    RemarksUI.toolbar + '<div class="remarks-scroll"><table class="table"><thead><tr><th style="width:28px"><input type="checkbox" id="selAll" title="выбрать все"></th><th style="white-space:nowrap"><button id="sortBtn" type="button" style="background:transparent;border:0;color:inherit;cursor:pointer;font:inherit;padding:0 2px 0 0;vertical-align:middle">' + (sortDesc ? '\u2193' : '\u2191') + '</button>Номер</th><th>Инт.номер</th><th>Дата</th><th>Срок устранения</th><th>Описание</th><th>Фото</th><th>Ответственный</th>' +
    '<th><input class="colname" data-col="c1" value="' + esc((colNames && colNames.c1) || 'Комментарий') + '" style="width:110px;background:transparent;border:0;color:inherit;font:inherit" title="название столбца"></th>' +
    '<th><input class="colname" data-col="c2" value="' + esc((colNames && colNames.c2) || 'Примечание') + '" style="width:110px;background:transparent;border:0;color:inherit;font:inherit" title="название столбца"></th>' +
    '</tr></thead><tbody>' +
    rows + '</tbody></table></div><p id="respNoRows" hidden>По фильтру замечаний нет.</p></section>';
  host.querySelectorAll("[data-cmt]").forEach((el) => {
    el.addEventListener("input", () => scheduleComment(el.dataset.cmt, el.dataset.field || "c1", el.value));
  });
  host.querySelectorAll(".colname").forEach(el => {
    el.addEventListener("change", () => updateColName(el.dataset.col, el.value));
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
  if (sortBtn) sortBtn.addEventListener("click", () => { sortDesc = !sortDesc; sortBtn.textContent = sortDesc ? "↓" : "↑"; RemarksUI.updateTable(); });

  // Чекбоксы ↔ поле номеров
  function syncFromChecks() {
    const selected = [...host.querySelectorAll("tr:not([hidden]) .row-sel:checked")].map(el => el.dataset.n);
    const num = $("num");
    if (num) {
      num.value = selected.join(" ");
      num.dispatchEvent(new Event("input"));
    }
  }
  host.querySelectorAll(".row-sel").forEach(el => {
    el.addEventListener("change", syncFromChecks);
  });
  const selAll = host.querySelector("#selAll");
  if (selAll) {
    selAll.addEventListener("change", () => {
      host.querySelectorAll("tr:not([hidden]) .row-sel").forEach(el => { el.checked = selAll.checked; });
      syncFromChecks();
    });
  }
  // Применить текущее значение поля к чекбоксам
  const current = expandNumbers(($("num") && $("num").value) || "");
  const set = new Set(current.map(String));
  host.querySelectorAll(".row-sel").forEach(el => { el.checked = set.has(el.dataset.n); });
  RemarksUI.refresh();
}

function render(d) {
  if (!d.ok) {
    ready = false; $("go").disabled = true; $("hint").textContent = "";
    $("out").innerHTML = '<div class="msg bad">' + esc(d.error) + "</div>";
    return;
  }
  ready = d.can_build;
  $("go").disabled = !d.can_build;
  $("hint").textContent = d.can_build ? "" : d.block;
  const a = d.act;
  $("out").innerHTML =
    '<section class="tape-wrap"><div class="meta">' +
    '<div><span class="k">Номер</span>' + a.act_no + "</div>" +
    '<div><span class="k">Инт.номер</span>' + esc(a.integration || "—") + "</div>" +
    '<div><span class="k">Статус</span>' + esc(a.status || "—") + "</div>" +
    '<div><span class="k">Дата предписания</span>' + esc(a.pred_date || "—") + "</div>" +
    '<div><span class="k">Срок</span>' + esc(a.deadline || "—") + "</div>" +
    '<div><span class="k">Дата акта</span>' + d.act_date + "</div>" +
    '<div><span class="k">Замечание</span>' + esc(a.description || "—") + "</div></div></section>" +
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
    '<figcaption class="kicker">' + label + " · " + esc(name || "нет " + n + "_" + slot) + "</figcaption></figure>";
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
  const useNo = String(integration || "").trim() || String(actNo);
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
  // Всегда гарантируем корректные ContentType для jpg и jpeg.
  // Старый код добавлял их только если не было ни одного из расширений,
  // из-за чего при наличии jpeg (логотип) jpg оставался без типа → Word «восстановить содержимое».
  ct = ct.replace(/<Default Extension="jpe?g"[^>]*\/>/gi, "");
  ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/>');
  zip.file("[Content_Types].xml", ct);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
function actName(n, integration) {
  const use = String(integration || "").trim() || String(n);
  return "Акт об Устранении №" + use + ".docx";
}
async function saveAct(n, folder) {
  if (folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
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
  if (folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
  const fh = await folder.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return name;
}
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
      const folder = dirHandle;
      try {
        const info = await lookup(nos[0]);
        if (folder !== dirHandle || raw !== $("num").value.trim()) return;
        render(info);
        wireSlots();
        $("pdfBtn").disabled = !info.ok || info.act.status !== "К устранению";
      } catch (error) {
        if (folder === dirHandle) $("hint").textContent = error.message;
      }
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
  const folder = dirHandle;
  for (const n of nos) {
    try {
      const name = await saveAct(n, folder);
      done.push(name);
    } catch (e) {
      $("out").insertAdjacentHTML("afterbegin", '<div class="msg bad">' + n + ": " + esc(e.message) + "</div>");
    }
  }
  $("out").insertAdjacentHTML("afterbegin", '<div class="msg ok">Сохранено: ' + esc(done.join(", ")) + "</div>");
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

function wireSlots() {
  document.querySelectorAll("[data-pick]").forEach((el) => {
    if (el.dataset.full) return; // photos with data-full open fullscreen via document listener
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const [n, slot] = el.dataset.pick.split(":");
      armPhotoPick(n, slot);
    });
  });
}
let photoTarget = null;
function armPhotoPick(n, slot) {
  const num = Number(n);
  const sl = Number(slot);
  if (!Number.isFinite(num) || !Number.isFinite(sl)) return;
  photoTarget = { n: num, slot: sl, folder: dirHandle };
  const inp = $("photoIn");
  inp.dataset.n = String(num);
  inp.dataset.slot = String(sl);
  inp.value = "";
  inp.click();
}
$("photoIn").addEventListener("change", async () => {
  const file = $("photoIn").files && $("photoIn").files[0];
  if (!file) return;
  const target = photoTarget || {
    n: Number($("photoIn").dataset.n),
    slot: Number($("photoIn").dataset.slot),
  };
  const n = target.n;
  const slot = target.slot;
  photoTarget = null;
  if (!Number.isFinite(n) || !Number.isFinite(slot)) {
    $("hint").textContent = "";
    $("out").insertAdjacentHTML("afterbegin", '<div class="msg bad">Не понял, какое фото заменять.</div>');
    return;
  }
  $("hint").textContent = "Сохраняю фото…";
  try {
    await savePhoto(n, slot, file, target.folder);
    const shown = expandNumbers(($("num").value || "").trim());
    if (shown.length === 1 && shown[0] === n) render(await lookup(n));
    await renderOpen();
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
  overlay.querySelector("#fs-replace").onclick = (ev) => {
    ev.stopPropagation();
    const [n, slot] = String(pick).split(":");
    overlay.remove();
    armPhotoPick(n, slot);
  };
  overlay.onclick = (ev) => { if (ev.target === overlay) close(); };
  const onEsc = (e) => { if (e.key === "Escape") close(); };
  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onEsc);
  }
  document.addEventListener("keydown", onEsc);
  document.body.appendChild(overlay);
});

