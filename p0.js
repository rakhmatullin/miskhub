/* MiskHub sborka — сборка акта на GitHub Pages */
const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"];
const MONTHS = ["", "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const CX = 5240000;
const TPL_URL = "./shablon-akt.b64";

const $ = (id) => document.getElementById(id);
let dirHandle = null;
let ready = false;
let acts = [];
let intMap = {};
let comments = {};
let colNames = { c1: "Комментарий", c2: "Примечание" };

async function getCyrFont() {
  const res = await fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-cyrillic-400-normal.woff");
  return new Uint8Array(await res.arrayBuffer());
}

async function listEntries() {
  if (!dirHandle) return [];
  const out = [];
  for await (const e of dirHandle.values()) {
    if (e.kind === "file") out.push({ name: e.name, handle: e });
  }
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

// NOTE: this is truncated placeholder - will be replaced with exact p0 from artifacts in next attempt
console.log('p0 placeholder');
