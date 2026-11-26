/* v2.13 */
/* MiskHub sborka — сборка акта на GitHub Pages */
const MONTHS = ["", "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const CX = 5240000;
const TPL_URL = "./shablon-akt.b64";
const EXON_DUMP_NAMES = {xls: "реестр-экзон.xls", xlsx: "реестр-экзон.xlsx"};

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
  const docs = [];
  for (const e of entries) {
    const low = e.name.toLowerCase();
    const exon = Object.values(EXON_DUMP_NAMES).includes(low);
    if (exon || e === classic || (!classic && low.includes("document") && /\.xlsx?$/.test(low))) {
      const f = await e.handle.getFile();
      if (exon && !f.size) continue;
      docs.push({file: f, exon});
    }
  }
  if (!docs.length) return null;
  docs.sort((a, b) => b.file.lastModified - a.file.lastModified || Number(b.exon) - Number(a.exon));
  return docs[0].file;
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
async function lookup(n, folder = dirHandle) {
  const entries = await listEntries(folder);
  const dumpFile = await findDumpFile(entries);
  if (!dumpFile) return { ok: false, error: "В папке нет выгрузки. Обновите реестр или добавьте Excel-файл Экзона." };
  let rows;
  try { rows = parseDump(await dumpFile.arrayBuffer()); }
  catch (e) { return { ok: false, error: e.message }; }
  const act = rows.find((x) => x.act_no === n);
  if (!act) return { ok: false, error: "Номера " + n + " нет в выгрузке." };
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
    photos: RemarkPhotos.index(entries).get(n) || [], folder,
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

function setSkp(data, n, enabled) {
  if (enabled) {
    if (!dictionary(data[n])) data[n] = {c1: data[n] || "", c2: ""};
    data[n].skp = true;
  } else if (dictionary(data[n])) {
    delete data[n].skp;
  }
}

async function saveSkp(n, enabled, folder) {
  legacyWrites++;
  try {
    await editLegacy(folder, COMMENTS_FILE, data => setSkp(data, n, enabled));
    if (folder === dirHandle) setSkp(comments, n, enabled);
  } finally {
    legacyWrites--;
  }
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
  applyOpenDump(dump, savedSequences);
  dirHandle = dir;
}

function applyOpenDump(dump, savedSequences) {
  for (const row of dump.rows) row.integration = intMap[row.act_no] || row.integration;
  sequences = savedSequences;
  openRows = dump.rows;
  dumpDate = dump.date;
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const openHost = $("open");
const descriptionObserver = new ResizeObserver(entries => {
  for (const {target} of entries) {
    if (target.classList.contains("is-expanded")) continue;
    target.nextElementSibling.hidden = target.scrollHeight <= target.clientHeight;
  }
});
new MutationObserver(() => {
  descriptionObserver.disconnect();
  for (const text of openHost.querySelectorAll(".remark-description")) descriptionObserver.observe(text);
}).observe(openHost, {childList: true});

openHost.addEventListener("click", event => {
  const toggle = event.target.closest(".remark-description-toggle");
  if (!toggle) return;
  const text = $(toggle.getAttribute("aria-controls"));
  const expanded = text.classList.toggle("is-expanded");
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = expanded ? "Свернуть" : "Развернуть";
  if (!expanded) toggle.hidden = text.scrollHeight <= text.clientHeight;
});

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
  const photos = RemarkPhotos.index(await listEntries(folder));
  let rows = "";
  for (const r of sorted) {
    const raw = comments[String(r.act_no)];
    const cc = (raw && typeof raw === "object") ? raw : { c1: raw || "", c2: "" };
    const integration = String(r.integration ?? "").trim();
    const number = r.act_no + (integration ? "(" + integration + ")" : "");
    const descriptionId = "remark-description-" + r.act_no;
    rows += '<tr data-remark="' + r.act_no + '">' +
      '<td><input type="checkbox" class="row-sel" data-n="' + r.act_no + '"></td>' +
      '<td class="num" data-go="' + r.act_no + '">' + esc(number) + "</td>" +
      '<td class="remark-dates">' + esc(r.pred_date || "—") + '<br>' + esc(r.deadline ? "- " + r.deadline : "—") + "</td>" +
      '<td class="desc"><div class="remark-description" id="' + descriptionId + '">' + esc(r.description || "—") + '</div>' +
      '<button type="button" class="remark-description-toggle" aria-controls="' + descriptionId + '" aria-expanded="false" hidden>Развернуть</button></td>' +
      '<td data-photo-for="' + r.act_no + '"></td>' +
      '<td><button type="button" data-resp="' + r.act_no + '">Не назначен</button></td>' +
      '<td><textarea class="cmt" data-cmt="' + r.act_no + '" data-field="c1" rows="2">' + esc(cc.c1 || "") + "</textarea></td>" +
      '<td><textarea class="cmt" data-cmt="' + r.act_no + '" data-field="c2" rows="2">' + esc(cc.c2 || "") + "</textarea></td>" +
      '<td><button type="button" data-remark-menu="' + r.act_no + '" popovertarget="remark-row-menu" aria-controls="remark-row-menu" aria-expanded="false" aria-label="Действия замечания №' + r.act_no + '">⋯</button></td>' +
      "</tr>";
  }
  if (folder !== dirHandle || version !== renderVersion) return;
  host.innerHTML =
    '<section class="tape-wrap"><div class="open-head"><strong>Незакрытые акты · ' + openRows.length + '</strong>' +
    '<span class="kicker">выгрузка от ' + esc(dumpDate || "—") + '</span></div>' +
    RemarksUI.toolbar + '<div class="remarks-scroll"><table class="table remarks-table"><thead><tr><th style="width:28px"><input type="checkbox" id="selAll" title="выбрать все"></th><th class="remark-number-col"><button id="sortBtn" type="button" style="background:transparent;border:0;color:inherit;cursor:pointer;font:inherit;padding:0 2px 0 0;vertical-align:middle">' + (sortDesc ? '\u2193' : '\u2191') + '</button>Номер</th><th class="remark-dates">Даты</th><th>Описание</th><th class="remark-photos-col">Фото</th><th class="remark-person-col">Ответственный</th>' +
    '<th class="remark-comment-col"><input class="colname" data-col="c1" value="' + esc((colNames && colNames.c1) || 'Комментарий') + '" style="width:110px;background:transparent;border:0;color:inherit;font:inherit" title="название столбца"></th>' +
    '<th class="remark-comment-col"><input class="colname" data-col="c2" value="' + esc((colNames && colNames.c2) || 'Примечание') + '" style="width:110px;background:transparent;border:0;color:inherit;font:inherit" title="название столбца"></th>' +
    '<th class="remark-actions" aria-label="Действия"></th></tr></thead><tbody>' +
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
  for (const cell of host.querySelectorAll("[data-photo-for]")) {
    const number = Number(cell.dataset.photoFor);
    RemarkPhotos.mount(cell, number, photos.get(number) || [], folder, true);
  }
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
    '<section class="tape-wrap" data-photo-for="' + a.act_no + '"></section>';
  RemarkPhotos.mount($("out").querySelector("[data-photo-for]"), a.act_no, d.photos, d.folder);
}

async function toJpeg(file, normalized = false) {
  const bitmap = await createImageBitmap(file, {imageOrientation: "from-image"});
  const canvas = document.createElement("canvas");
  try {
    if (normalized) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return {bytes, w: bitmap.width, h: bitmap.height};
    }
    const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height),
      Math.sqrt(6_000_000 / bitmap.width / bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", {alpha: false});
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .94));
    if (!blob) throw new Error("Не удалось подготовить изображение.");
    return {bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height};
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
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
function appXml(number) {
  return '<w:p><w:pPr><w:pageBreakBefore/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="22"/></w:rPr><w:t>Приложение ' + number + '</w:t></w:r></w:p>';
}
function addSkpReferences(documentXml, namespace) {
  const body = documentXml.getElementsByTagNameNS(namespace, "body")[0];
  if (!body) throw new Error("В шаблоне нет тела акта.");
  const paragraphs = [...body.children].filter(node => node.localName === "p" && node.namespaceURI === namespace);
  const textOf = paragraph => [...paragraph.getElementsByTagNameNS(namespace, "t")]
    .map(node => node.textContent).join("").replace(/\s+/g, " ").trim();
  const first = paragraphs.find(node => /^Приложение\s*:\s*1\)/u.test(textOf(node)));
  const second = paragraphs.find(node => /^Приложение\s*:\s*2\)/u.test(textOf(node)));
  const section = [...body.children].find(node => node.localName === "sectPr" && node.namespaceURI === namespace);

  function reference(text, sample) {
    const paragraph = documentXml.createElementNS(namespace, "w:p");
    const formatting = sample?.getElementsByTagNameNS(namespace, "pPr")[0];
    if (formatting) paragraph.append(formatting.cloneNode(true));
    const run = documentXml.createElementNS(namespace, "w:r");
    const styled = sample?.getElementsByTagNameNS(namespace, "r")[0]?.getElementsByTagNameNS(namespace, "rPr")[0];
    if (styled) run.append(styled.cloneNode(true));
    const literal = documentXml.createElementNS(namespace, "w:t");
    literal.textContent = text;
    run.append(literal);
    paragraph.append(run);
    return paragraph;
  }

  const photos = first || reference("Приложение: 1) Фотоматериалы", second);
  if (!first) body.insertBefore(photos, second || section || null);
  if (!second) photos.after(reference("Приложение: 2) Акт приема-передачи", photos));
  for (const paragraph of paragraphs) {
    if (/^Приложение\s+[12]$/u.test(textOf(paragraph))) paragraph.remove();
  }
}

async function appendWordPhotos(zip, xml, entries, skp) {
  const parser = new DOMParser();
  const documentXml = parser.parseFromString(xml, "application/xml");
  const relsPath = "word/_rels/document.xml.rels";
  const relsXml = parser.parseFromString(await zip.file(relsPath).async("string"), "application/xml");
  if (documentXml.querySelector("parsererror") || relsXml.querySelector("parsererror")) {
    throw new Error("Не удалось прочитать структуру шаблона акта.");
  }

  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
  const relNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const existingIds = new Set([
    ...documentXml.getElementsByTagNameNS(wp, "docPr"),
    ...documentXml.getElementsByTagNameNS(pic, "cNvPr")
  ].map(element => Number(element.getAttribute("id"))));
  const existingRels = new Set([...relsXml.getElementsByTagNameNS(relNamespace, "Relationship")]
    .map(element => element.getAttribute("Id")));
  const section = [...documentXml.getElementsByTagNameNS(w, "sectPr")].at(-1);
  const size = section?.getElementsByTagNameNS(w, "pgSz")[0];
  const margins = section?.getElementsByTagNameNS(w, "pgMar")[0];
  const twips = (node, key, fallback) => {
    const value = node?.getAttributeNS(w, key);
    return value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
  };
  const width = Math.min(CX, 635 * Math.max(300, twips(size, "w", 11906) -
    twips(margins, "left", 1134) - twips(margins, "right", 707) - twips(margins, "gutter", 0)));
  const height = Math.min(7_800_000, 635 * Math.max(300, twips(size, "h", 16838) -
    twips(margins, "top", 1134) - twips(margins, "bottom", 709) - 1000));

  const parts = skp
    ? [1, ...entries.filter(entry => entry.group === 1), 2, ...entries.filter(entry => entry.group === 2)]
    : [1, ...entries];
  const paragraphs = [];
  let docId = 1, relId = 1, imageId = 1, photoNo = 0;
  for (const entry of parts) {
    if (typeof entry === "number") {
      paragraphs.push(appXml(entry));
      continue;
    }
    let image;
    try {
      const file = await entry.handle.getFile();
      image = await toJpeg(file, entry.normalized);
    } catch {
      throw new Error("Не удалось прочитать вложение «" + entry.name + "».");
    }
    while (existingIds.has(docId)) docId++;
    while (existingRels.has("rId" + relId)) relId++;
    let path;
    do { path = "media/remark-photo-" + imageId++ + ".jpg"; } while (zip.file("word/" + path));

    const rid = "rId" + relId++;
    const rel = relsXml.createElementNS(relNamespace, "Relationship");
    rel.setAttribute("Id", rid);
    rel.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
    rel.setAttribute("Target", path);
    relsXml.documentElement.append(rel);
    zip.file("word/" + path, image.bytes);

    const scale = Math.min(width / image.w, height / image.h);
    paragraphs.push(drawingXml(rid, docId++, "Фото " + (++photoNo),
      Math.max(1, Math.round(image.w * scale)), Math.max(1, Math.round(image.h * scale))));
  }
  if (skp) {
    addSkpReferences(documentXml, w);
    xml = new XMLSerializer().serializeToString(documentXml);
  }
  const point = xml.lastIndexOf("<w:sectPr");
  if (point < 0) throw new Error("В шаблоне нет раздела страницы.");
  zip.file(relsPath, new XMLSerializer().serializeToString(relsXml));
  return xml.slice(0, point) + paragraphs.join("") + xml.slice(point);
}

async function buildAct({ templateBuf, actNo, integration, actDate, predDate, deadline, description, photoEntries, skp }) {
  const zip = await JSZip.loadAsync(templateBuf);
  let xml = await zip.file("word/document.xml").async("string");
  const useNo = String(integration || "").trim() || String(actNo);
  const map = {
    "{{НОМЕР-АКТА}}": xmlEscape(useNo),
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
  if (skp || photoEntries.length) {
    xml = await appendWordPhotos(zip, xml, photoEntries, skp);
  } else {
    const path = "word/_rels/document.xml.rels";
    zip.file(path, await zip.file(path).async("string"));
  }
  zip.file("word/document.xml", xml);
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
async function makeAct(n, folder) {
  if (folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
  const info = await lookup(n, folder);
  if (!info.ok) throw new Error(info.error);
  if (!info.can_build) throw new Error(info.block);
  const entries = await listEntries(folder);
  const templateFile = await fileByName(entries, "shablon-akt.docx");
  const templateBuf = templateFile ? await templateFile.arrayBuffer() : await embeddedTemplate();
  const {data} = await navigator.locks.request("miskhub-legacy-json", () => readLegacy(folder, COMMENTS_FILE));
  const blob = await buildAct({
    templateBuf,
    actNo: n,
    integration: info.act.integration,
    actDate: info.act_date,
    predDate: info.act.pred_date,
    deadline: info.act.deadline,
    description: info.act.description,
    photoEntries: info.photos,
    skp: data[n]?.skp === true,
  });
  return {blob, name: actName(n, info.act.integration)};
}

async function saveAct(n, folder) {
  const {blob, name} = await makeAct(n, folder);
  if (folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
  const fh = await folder.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(blob);
    await w.close();
  } catch (error) {
    await w.abort().catch(() => {});
    throw error;
  }
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
  ready = false;
  $("go").disabled = true;
  $("pdfBtn").disabled = true;
  timer = setTimeout(async () => {
    const raw = $("num").value.trim();
    const nos = expandNumbers(raw);
    if (!nos.length || !dirHandle) { $("out").innerHTML = ""; $("go").disabled = true; $("pdfBtn").disabled = true; return; }
    if (nos.length === 1) {
      const folder = dirHandle;
      try {
        const info = await lookup(nos[0], folder);
        if (folder !== dirHandle || raw !== $("num").value.trim()) return;
        render(info);
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
  if (RemarkPhotos.busy()) {
    $("hint").textContent = "Дождитесь окончания записи вложений.";
    return;
  }
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

function downloadFile(blob, name) {
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

function downloadPdf(bytes, name) {
  downloadFile(new Blob([bytes], {type: "application/pdf"}), name);
}
