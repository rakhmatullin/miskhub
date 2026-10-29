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
  if (!dirHandle) { $("files").innerHTML = pill("папка не выбрана", "bad"); return; }
  const entries = await listEntries();
  const dump = await findDumpFile(entries);
  const template = await fileByName(entries, "shablon-akt.docx");
  $("files").innerHTML =
    pill(template ? "свой шаблон в папке" : "встроенный шаблон", "ok") +
    pill(dump ? "выгрузка на месте" : "нет выгрузки / document*.xls", dump ? "ok" : "bad");
  $("num").disabled = !dump;
}
// CONTINUED IN NEXT UPDATE - partial restore to unbreak site
console.log("sborka partial v1.0-restore");
