import { openPdf, rasterPage, rasterSizes } from "./pdf-pages-render.js";

const el = name => document.getElementById("pdf-pages-" + name);
const viewport = el("viewport"), grid = el("grid"), viewer = el("viewer");
const jump = el("jump"), picture = el("picture");
const mounted = new Map(), thumbnails = new Map(), pending = new Map(), failures = new Set();
const maxThumbs = 90, maxConcurrent = 2;
let source = null, entries = [], insertionAnchor = null;
let locked = false, exportWorker = null, savingImage = false;
let frame = 0, signature = "", revision = 0, columns = 1, rowHeight = 202;
let previewEntry, previewJob, previewUrl, revealPosition;

function say(message, error = false) {
  const status = el("status");
  status.textContent = message;
  status.dataset.error = String(error);
  status.hidden = !message;
}

function busy() {
  return locked || !!exportWorker || savingImage;
}

function syncControls() {
  const unavailable = busy();
  el("pick").disabled = el("add").disabled = unavailable;
  el("build").disabled = unavailable || entries.length === 0;
  el("cancel").hidden = !exportWorker;
  el("save-image").disabled = unavailable;
  el("workspace").hidden = !entries.length;
  jump.max = entries.length;
  for (const cell of mounted.values()) {
    for (const button of cell.querySelectorAll(".pdf-page-buttons button")) button.disabled = unavailable;
  }
}

function number(value) {
  return value.toLocaleString("ru-RU");
}

const pagePlural = new Intl.PluralRules("ru-RU");
function pageCount(count) {
  const word = { one: "страница", few: "страницы", many: "страниц", other: "страницы" }[pagePlural.select(count)];
  return number(count) + " " + word;
}

function setThumb(cell, url, error = false) {
  const image = cell.querySelector("img");
  const status = cell.querySelector(".pdf-page-thumb-status");
  if (url) image.src = url;
  image.hidden = !url;
  status.hidden = !!url;
  status.textContent = error ? "Миниатюра недоступна" : "Загрузка…";
}

function cacheUrl(id, url) {
  thumbnails.set(id, url);
  if (thumbnails.size <= maxThumbs) return;
  for (const [key, cached] of thumbnails) {
    if (mounted.has(key)) continue;
    URL.revokeObjectURL(cached);
    thumbnails.delete(key);
    if (thumbnails.size <= maxThumbs) break;
  }
}

function readCache(id) {
  const url = thumbnails.get(id);
  if (url) {
    thumbnails.delete(id);
    thumbnails.set(id, url);
  }
  return url;
}

function pumpThumbnails() {
  if (pending.size >= maxConcurrent) return;
  // Visible rows first. The buffered rows are filled as slots become free.
  const visibleRow = Math.floor(viewport.scrollTop / rowHeight);
  const cells = [...mounted.values()].sort((a, b) =>
    Math.abs(Math.floor(Number(a.dataset.position) / columns) - visibleRow) -
    Math.abs(Math.floor(Number(b.dataset.position) / columns) - visibleRow));
  for (const cell of cells) {
    if (pending.size >= maxConcurrent) break;
    const entry = entries[Number(cell.dataset.position)];
    if (!entry || thumbnails.has(entry.id) || pending.has(entry.id) || failures.has(entry.id)) continue;
    const job = new AbortController();
    const activeSource = source;
    pending.set(entry.id, job);
    rasterPage(entry, activeSource, rasterSizes.thumbnail, job.signal).then(blob => {
      if (job.signal.aborted || source !== activeSource) return;
      const url = URL.createObjectURL(blob);
      cacheUrl(entry.id, url);
      if (mounted.has(entry.id)) setThumb(mounted.get(entry.id), url);
    }).catch(() => {
      if (!job.signal.aborted && source === activeSource) {
        failures.add(entry.id);
        if (mounted.has(entry.id)) setThumb(mounted.get(entry.id), null, true);
      }
    }).finally(() => {
      pending.delete(entry.id);
      pumpThumbnails();
    });
  }
}

function newCell(entry, index) {
  const cell = el("card").content.firstElementChild.cloneNode(true);
  const position = index + 1;
  cell.dataset.id = entry.id;
  cell.dataset.position = index;
  cell.setAttribute("aria-posinset", position);
  cell.setAttribute("aria-setsize", entries.length);
  const caption = entry.file ? entry.file.name : "Исходная страница " + entry.page;
  const badge = cell.querySelector(".pdf-page-number");
  badge.textContent = position;
  badge.title = caption;
  const titles = {
    view: "Открыть страницу " + position,
    insert: "Вставить изображение перед страницей " + position,
    save: "Скачать картинку страницы " + position,
    remove: "Удалить страницу " + position
  };
  for (const control of cell.querySelectorAll("[data-action]")) {
    control.title = titles[control.dataset.action];
    control.setAttribute("aria-label", control.title);
    control.disabled = control.dataset.action !== "view" && busy();
  }
  setThumb(cell, readCache(entry.id), failures.has(entry.id));
  return cell;
}

function updateGrid() {
  frame = 0;
  if (!entries.length) {
    for (const job of pending.values()) job.abort();
    mounted.clear();
    grid.replaceChildren();
    el("space").style.height = "0px";
    signature = "";
    return;
  }

  const settings = getComputedStyle(viewport);
  const gap = parseFloat(settings.getPropertyValue("--gallery-gap")) || 10;
  const nextHeight = parseFloat(settings.getPropertyValue("--gallery-row")) || 202;
  const nextColumns = Math.max(1, Math.floor((viewport.clientWidth - gap) / (138 + gap)));
  const firstItem = Math.floor(viewport.scrollTop / rowHeight) * columns;
  const resized = columns !== nextColumns || rowHeight !== nextHeight;
  columns = nextColumns;
  rowHeight = nextHeight;
  const rows = Math.ceil(entries.length / columns);
  el("space").style.height = rows * rowHeight + gap + "px";
  if (revealPosition != null) {
    viewport.scrollTop = Math.floor(revealPosition / columns) * rowHeight;
    revealPosition = null;
  } else if (resized) {
    viewport.scrollTop = Math.floor(firstItem / columns) * rowHeight;
  }
  const first = Math.floor(viewport.scrollTop / rowHeight);
  const last = Math.min(rows, Math.max(first + 1, Math.ceil((viewport.scrollTop + viewport.clientHeight) / rowHeight)));
  const start = Math.max(0, first - 1), end = Math.min(rows, last + 1);
  const nextSignature = [revision, start, end, columns, rowHeight].join("/");
  el("count").textContent = pageCount(entries.length) + " · " +
    number(Math.min(entries.length, first * columns + 1)) + "–" + number(Math.min(entries.length, last * columns));
  if (signature === nextSignature) return;
  signature = nextSignature;
  grid.style.top = start * rowHeight + "px";
  grid.style.gridTemplateColumns = "repeat(" + columns + ", minmax(0, 1fr))";

  const focus = document.activeElement;
  const focusedId = focus?.closest(".pdf-page-cell")?.dataset.id;
  const focusedAction = focus?.dataset.action;
  mounted.clear();
  const content = document.createDocumentFragment();
  const to = Math.min(entries.length, end * columns);
  for (let i = start * columns; i < to; i++) {
    const entry = entries[i], cell = newCell(entry, i);
    mounted.set(entry.id, cell);
    content.append(cell);
  }
  grid.replaceChildren(content);
  if (focusedId) {
    const restored = mounted.get(focusedId)?.querySelector("[data-action='" + focusedAction + "']");
    (restored || viewport).focus({ preventScroll: true });
  }
  for (const [id, job] of pending) {
    if (!mounted.has(id)) job.abort();
  }
  pumpThumbnails();
}

function scheduleGrid() {
  if (!frame) frame = requestAnimationFrame(updateGrid);
}

function changed() {
  revision++;
  syncControls();
  scheduleGrid();
}

function resetThumbnails() {
  for (const job of pending.values()) job.abort();
  for (const url of thumbnails.values()) URL.revokeObjectURL(url);
  thumbnails.clear();
  failures.clear();
}

function sameAsSource() {
  return source && entries.length === source.doc.numPages && entries.every((entry, i) => entry.page === i + 1);
}

async function loadFile(file) {
  if (!file || busy()) return;
  if (entries.length && !sameAsSource() && !confirm("Открыть другой PDF и заменить текущий список страниц?")) return;
  locked = true;
  syncControls();
  say("Читаем PDF…");
  try {
    const next = await openPdf(file);
    const previous = source;
    resetThumbnails();
    if (viewer.open) viewer.close();
    source = next;
    // Prefix with a document generation so pending renders from a previous PDF
    // cannot block or overwrite the corresponding pages of the new PDF.
    entries = Array.from({ length: next.doc.numPages }, (_, i) => ({
      id: "pdf-" + revision + "-" + i,
      page: i + 1
    }));
    viewport.scrollTop = 0;
    jump.value = "";
    say(file.name + " · " + pageCount(entries.length));
    previous?.doc.destroy().catch(() => {});
  } catch (error) {
    say(error.message, true);
  } finally {
    locked = false;
    changed();
  }
}

function pickImages(anchor = null) {
  if (busy()) return;
  insertionAnchor = anchor;
  el("images").click();
}

const imageTypes = /^image\/(jpeg|png|webp|gif|avif|bmp|x-ms-bmp)$/i;

async function insertImages(files, anchor) {
  if (!files.length || busy()) return;
  locked = true;
  syncControls();
  say("Проверяем изображения…");
  const inserted = [];
  let skipped = 0;
  try {
    for (const file of files) {
      try {
        if (!imageTypes.test(file.type) && !(file.type === "" && /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name))) {
          throw new Error("Неподдерживаемый формат.");
        }
        const bitmap = await createImageBitmap(file);
        bitmap.close();
        inserted.push({ id: crypto.randomUUID(), file });
      } catch {
        skipped++;
      }
    }
    if (!inserted.length) throw new Error("Выберите читаемое изображение JPEG, PNG, WebP, GIF, AVIF или BMP.");
    const index = anchor ? entries.indexOf(anchor) : entries.length;
    if (index < 0) throw new Error("Страница для вставки удалена. Повторите выбор.");
    entries = entries.slice(0, index).concat(inserted, entries.slice(index));
    say("Добавлено изображений: " + inserted.length + (skipped ? ". Не удалось прочитать: " + skipped : ""));
    revealPosition = index;
  } catch (error) {
    say(error.message, true);
  } finally {
    locked = false;
    changed();
  }
}

function removeEntry(entry) {
  if (busy()) return;
  const position = entries.indexOf(entry);
  if (position < 0) return;
  entries.splice(position, 1);
  pending.get(entry.id)?.abort();
  const cached = thumbnails.get(entry.id);
  if (cached) URL.revokeObjectURL(cached);
  thumbnails.delete(entry.id);
  failures.delete(entry.id);
  say("Удалена страница " + (position + 1) + ".");
  changed();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function fileStem() {
  return (source?.file.name || "страницы")
    .replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 110) || "страницы";
}

async function saveImage(entry) {
  if (busy()) return;
  const position = entries.indexOf(entry) + 1;
  if (!position) return;
  if (entry.file) {
    download(entry.file, entry.file.name);
    return;
  }
  savingImage = true;
  syncControls();
  const message = "Готовим изображение страницы " + position + "…";
  if (viewer.open) el("preview-status").textContent = message;
  else say(message);
  try {
    const blob = await rasterPage(entry, source, rasterSizes.download, new AbortController().signal);
    download(blob, fileStem() + "-стр-" + position + ".jpg");
    if (viewer.open) el("preview-status").textContent = "Скачивается JPEG.";
    else say("Скачивается JPEG страницы " + position + ".");
  } catch {
    const error = "Не удалось сохранить изображение страницы.";
    if (viewer.open) el("preview-status").textContent = error;
    else say(error, true);
  } finally {
    savingImage = false;
    syncControls();
  }
}

function clearViewer() {
  previewJob?.abort();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  picture.hidden = true;
  picture.removeAttribute("src");
}

async function showEntry(entry) {
  clearViewer();
  previewEntry = entry;
  const position = entries.indexOf(entry);
  if (position < 0) return;
  el("viewer-title").textContent = "Страница " + (position + 1) + " из " + number(entries.length);
  el("prev").disabled = position === 0;
  el("next").disabled = position === entries.length - 1;
  el("preview").classList.remove("zoomed");
  el("zoom").setAttribute("aria-pressed", "false");
  el("zoom").textContent = "Увеличить";
  el("zoom").disabled = true;
  el("preview").scrollTo(0, 0);
  el("preview-status").textContent = "Загрузка страницы…";
  if (!viewer.open) viewer.showModal();

  const job = new AbortController();
  previewJob = job;
  try {
    const blob = await rasterPage(entry, source, rasterSizes.viewer, job.signal);
    if (job.signal.aborted) return;
    previewUrl = URL.createObjectURL(blob);
    picture.src = previewUrl;
    picture.alt = "Страница " + (position + 1);
    picture.hidden = false;
    el("zoom").disabled = false;
    el("preview-status").textContent = "";
  } catch {
    if (!job.signal.aborted) el("preview-status").textContent = "Не удалось показать эту страницу.";
  }
}

function moveViewer(delta) {
  const index = entries.indexOf(previewEntry);
  if (index >= 0 && entries[index + delta]) showEntry(entries[index + delta]);
}

function stopExport() {
  exportWorker?.terminate();
  exportWorker = null;
  syncControls();
}

function assemble() {
  if (busy() || !entries.length) return;
  const name = fileStem() + "-сборка.pdf";
  if (sameAsSource()) {
    download(source.file, name);
    say("PDF скачивается.");
    return;
  }

  try {
    const worker = new Worker(new URL("./pdf-pages-worker.js", import.meta.url));
    exportWorker = worker;
    syncControls();
    say("Подготавливаем сборку…");
    worker.onmessage = ({ data }) => {
      if (exportWorker !== worker) return;
      if (data.type === "progress") {
        say(data.message);
        return;
      }
      stopExport();
      if (data.type === "done") {
        download(data.file, name);
        say("PDF скачивается.");
      } else {
        say(data.message, true);
      }
    };
    worker.onerror = () => {
      if (exportWorker !== worker) return;
      stopExport();
      say("Не удалось запустить сборку. Откройте PDF Master через MISKHub и повторите попытку.", true);
    };
    worker.postMessage({ file: source?.file, order: entries.map(entry => entry.page ?? entry.file) });
  } catch {
    stopExport();
    say("Не удалось запустить сборку PDF.", true);
  }
}

el("pick").onclick = () => el("file").click();
el("file").onchange = event => {
  const file = event.target.files[0];
  event.target.value = "";
  loadFile(file);
};
el("add").onclick = () => pickImages();
el("images").onchange = event => {
  const files = [...event.target.files];
  event.target.value = "";
  insertImages(files, insertionAnchor);
};
el("build").onclick = assemble;
el("cancel").onclick = () => {
  stopExport();
  say("Сборка отменена.");
};
el("jump-form").onsubmit = event => {
  event.preventDefault();
  if (!jump.reportValidity()) return;
  viewport.scrollTop = Math.floor((jump.valueAsNumber - 1) / columns) * rowHeight;
  viewport.focus({ preventScroll: true });
  scheduleGrid();
};
grid.onclick = event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const cell = button.closest(".pdf-page-cell");
  const entry = entries[Number(cell.dataset.position)];
  if (!entry || entry.id !== cell.dataset.id) return;
  switch (button.dataset.action) {
    case "view": showEntry(entry); break;
    case "insert": pickImages(entry); break;
    case "save": saveImage(entry); break;
    case "remove": removeEntry(entry); break;
  }
};
el("prev").onclick = () => moveViewer(-1);
el("next").onclick = () => moveViewer(1);
el("zoom").onclick = () => {
  const zoomed = el("preview").classList.toggle("zoomed");
  el("zoom").setAttribute("aria-pressed", String(zoomed));
  el("zoom").textContent = zoomed ? "По размеру" : "Увеличить";
};
el("save-image").onclick = () => saveImage(previewEntry);
el("close").onclick = () => viewer.close();
viewer.addEventListener("close", () => {
  clearViewer();
  previewEntry = null;
});
viewer.addEventListener("keydown", event => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (el("preview").classList.contains("zoomed")) return;
  event.preventDefault();
  moveViewer(event.key === "ArrowLeft" ? -1 : 1);
});
viewport.addEventListener("scroll", scheduleGrid, { passive: true });
new ResizeObserver(scheduleGrid).observe(viewport);
syncControls();
