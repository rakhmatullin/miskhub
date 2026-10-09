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
  const dump = await fileByName(entries, "выгрузка.xlsx");
  const template = await fileByName(entries, "shablon-akt.docx");
  $("files").innerHTML =
    pill(template ? "свой шаблон в папке" : "встроенный шаблон", "ok") +
    pill(dump ? "выгрузка на месте" : "нет выгрузки.xlsx", dump ? "ok" : "bad");
  $("num").disabled = !dump;
}
async function lookup(n) {
  const entries = await listEntries();
  const dumpFile = await fileByName(entries, "выгрузка.xlsx");
  if (!dumpFile) return { ok: false, error: "В папке нет выгрузка.xlsx." };
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
let commentTimers = {};
function scheduleComment(n, value) {
  comments[String(n)] = value;
  clearTimeout(commentTimers[n]);
  commentTimers[n] = setTimeout(() => saveComments().catch(() => {}), 400);
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
async function loadOpen() {
  openRows = []; dumpDate = "";
  if (!dirHandle) return;
  const entries = await listEntries();
  const dump = await fileByName(entries, "выгрузка.xlsx");
  if (!dump) return;
  dumpDate = todayStrFrom(dump.lastModified);
  try { openRows = parseDump(await dump.arrayBuffer()).filter((r) => r.status === "К устранению"); }
  catch (_) { openRows = []; }
  await loadComments();
}
function todayStrFrom(ms) {
  const d = new Date(ms);
  return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
}
function renderOpen() {
  const host = $("open");
  if (!host) return;
  if (!dirHandle) { host.innerHTML = ""; return; }
  if (!openRows.length) {
    host.innerHTML = '<section class="tape-wrap"><div class="open-head"><strong>Незакрытые акты</strong><span class="kicker">' +
      (dumpDate ? "выгрузка от " + dumpDate : "нет выгрузки") + '</span></div><p class="kicker">Нет строк «К устранению».</p></section>';
    return;
  }
  let rows = "";
  openRows.forEach((r) => {
    const c = comments[String(r.act_no)] || "";
    rows += "<tr>" +
      '<td class="num" data-go="' + r.act_no + '">' + r.act_no + "</td>" +
      "<td>" + esc(r.pred_date || "—") + "</td>" +
      "<td>" + esc(r.deadline || "—") + "</td>" +
      '<td class="desc">' + esc(r.description || "—") + "</td>" +
      '<td><textarea class="cmt" data-cmt="' + r.act_no + '" rows="2">' + esc(c) + "</textarea></td>" +
      "</tr>";
  });
  host.innerHTML =
    '<section class="tape-wrap"><div class="open-head"><strong>Незакрытые акты · ' + openRows.length + '</strong>' +
    '<span class="kicker">выгрузка от ' + esc(dumpDate || "—") + '</span></div>' +
    '<table class="table"><thead><tr><th>Номер</th><th>Дата</th><th>Срок устранения</th><th>Описание</th><th>Комментарий</th></tr></thead><tbody>' +
    rows + "</tbody></table></section>";
  host.querySelectorAll("[data-cmt]").forEach((el) => {
    el.addEventListener("input", () => scheduleComment(el.dataset.cmt, el.value));
  });
  host.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => {
      $("num").value = el.dataset.go;
      $("num").dispatchEvent(new Event("input"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
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
    '<div><span class="k">Номер</span>' + a.act_no + (a.integration ? ' <span class="kicker">интеграционный ' + a.integration + ", в акт не идёт</span>" : "") + "</div>" +
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
    ? '<img src="' + url + '" alt="">'
    : '<div class="ph">Добавить фото ' + label + '</div>';
  const btn = url ? '<button type="button" class="chg" data-pick="' + n + ':' + slot + '">Заменить</button>' : "";
  return '<figure class="slot" data-pick="' + n + ':' + slot + '">' + img + btn +
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
  return '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="' + docId + '" name="' + name + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="' + name + '"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>";
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
async function buildAct({ templateBuf, actNo, actDate, predDate, deadline, description, beforeFile, afterFile }) {
  const zip = await JSZip.loadAsync(templateBuf);
  let xml = await zip.file("word/document.xml").async("string");
  const map = {
    "{{НОМЕР-АКТА}}": String(actNo),
    "{{ДАТА-АКТА-ТЕКСТ}}": ruQuoted(actDate),
    "{{ДАТА-ПРЕДПИСАНИЯ-ТЕКСТ}}": ruQuoted(predDate) + "г.",
    "{{ОПИСАНИЕ}}": xmlEscape(description),
    "{{СРОК-УСТРАНЕНИЯ}}": deadline,
  };
  for (const [a, b] of Object.entries(map)) xml = xml.split(a).join(b);
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
function actName(n) { return "Акт об Устранении №" + n + ".docx"; }
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
    actDate: info.act_date,
    predDate: info.act.pred_date,
    deadline: info.act.deadline,
    description: info.act.description,
    beforeFile: before ? await before.handle.getFile() : null,
    afterFile: after ? await after.handle.getFile() : null,
  });
  const fh = await dirHandle.getFileHandle(actName(n), { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return actName(n);
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
    renderOpen();
  } catch (_) {}
}
$("pick").addEventListener("click", () => pickFolder().catch((e) => {
  $("out").innerHTML = '<div class="msg bad">' + (e.message || "Папку выбрать не удалось.") + "</div>";
}));
$("num").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const n = Number($("num").value);
    if (!n || !dirHandle) { $("out").innerHTML = ""; $("go").disabled = true; return; }
    render(await lookup(n));
    wireSlots();
  }, 200);
});
$("go").addEventListener("click", async () => {
  if (!ready) return;
  $("go").disabled = true;
  $("hint").textContent = "Собираю…";
  try {
    const name = await saveAct(Number($("num").value));
    $("out").insertAdjacentHTML("afterbegin", '<div class="msg ok">Сохранено в папке: ' + name + "</div>");
  } catch (e) {
    $("out").insertAdjacentHTML("afterbegin", '<div class="msg bad">' + e.message + "</div>");
  }
  $("go").disabled = false;
  $("hint").textContent = "";
});
if (typeof window.showDirectoryPicker !== "function") {
  $("out").innerHTML = '<div class="msg bad">Нужен Chrome или Edge. В этом браузере папку выбрать нельзя.</div>';
}
restoreFolder().then(() => loadOpen().then(renderOpen));

function wireSlots() {
  document.querySelectorAll("[data-pick]").forEach((el) => {
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
