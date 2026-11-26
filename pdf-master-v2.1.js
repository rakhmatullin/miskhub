const PDFLib = globalThis.PDFLib;
const JSZip = globalThis.JSZip;

const state = {
  sources: [],
  assemblies: [],
  picked: null,
  openId: null,
  msg: "",
  msgKind: "",
  busy: false,
};

let drag = null;

const app = document.querySelector("#app");
const fileInput = document.querySelector("#file-input");

function uid() {
  return crypto.randomUUID();
}

function stem(name) {
  return String(name || "")
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareNames(a, b) {
  return String(a || "").localeCompare(String(b || ""), "ru", { numeric: true, sensitivity: "base" });
}

function allPages(count) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function formatBytes(size) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}

function formatSpec(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (!sorted.length) return "";
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let index = 1; index <= sorted.length; index += 1) {
    const page = sorted[index];
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    ranges.push(start === prev ? String(start) : `${start}–${prev}`);
    start = page;
    prev = page;
  }
  return ranges.join(", ");
}

function parseSpec(spec, pageCount) {
  const cleaned = spec.trim();
  if (!cleaned) return [];
  const pages = [];
  for (const raw of cleaned.split(/[,;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(part);
    if (range) {
      let start = Number(range[1]);
      let end = Number(range[2]);
      if (start < 1 || end < 1 || start > pageCount || end > pageCount) return null;
      if (start > end) [start, end] = [end, start];
      for (let page = start; page <= end; page += 1) pages.push(page);
      continue;
    }
    if (!/^\d+$/.test(part)) return null;
    const page = Number(part);
    if (page < 1 || page > pageCount) return null;
    pages.push(page);
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

function sourceById(id) {
  return state.sources.find((source) => source.id === id);
}

function assemblyById(id) {
  return state.assemblies.find((assembly) => assembly.id === id);
}

function autoName(segments) {
  const names = segments.map((segment) => stem(sourceById(segment.sourceId)?.name || "файл"));
  if (names.length <= 1) return names[0] || "Сборка";
  if (names.length === 2) return `${names[0]} + ${names[1]}`;
  return `${names[0]} + ещё ${names.length - 1}`;
}

function retitle(assembly) {
  if (!assembly.nameTouched) assembly.name = autoName(assembly.segments);
}

function samePick(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "source") return a.sourceId === b.sourceId;
  if (a.kind === "assembly") return a.assemblyId === b.assemblyId;
  return a.assemblyId === b.assemblyId && a.segmentId === b.segmentId;
}

function say(text, kind) {
  state.msg = text;
  state.msgKind = kind || "info";
  const box = document.querySelector("#msg");
  if (!box) return;
  box.className = `msg ${state.msgKind}`;
  box.textContent = text;
  box.hidden = !text;
}

function moveSource(sourceId, index) {
  const from = state.sources.findIndex((source) => source.id === sourceId);
  if (from < 0) return;
  let to = Number(index);
  if (!Number.isFinite(to)) return;
  if (to > from) to -= 1;
  to = Math.max(0, Math.min(to, state.sources.length - 1));
  if (to === from) return;
  const [item] = state.sources.splice(from, 1);
  state.sources.splice(to, 0, item);
}

function sourceDropIndex(zone, event) {
  let index = Number(zone.dataset.index || 0);
  if (zone.classList.contains("card")) {
    const rect = zone.getBoundingClientRect();
    if (event.clientY > rect.top + rect.height / 2) index += 1;
  }
  return index;
}

function segmentFrom(source) {
  return { id: uid(), sourceId: source.id, pages: allPages(source.pageCount) };
}

function createFromSource(sourceId) {
  const source = sourceById(sourceId);
  if (!source) return;
  state.assemblies.unshift({
    id: uid(),
    name: stem(source.name) || "Сборка",
    nameTouched: false,
    segments: [segmentFrom(source)],
  });
  state.picked = null;
}

function insertSource(assemblyId, sourceId, index) {
  const source = sourceById(sourceId);
  const assembly = assemblyById(assemblyId);
  if (!source || !assembly) return;
  const at = Math.max(0, Math.min(index, assembly.segments.length));
  assembly.segments.splice(at, 0, segmentFrom(source));
  retitle(assembly);
  state.picked = null;
}

function extractSegment(assemblyId, segmentId) {
  const assembly = assemblyById(assemblyId);
  const segment = assembly?.segments.find((item) => item.id === segmentId);
  if (!assembly || !segment) return;
  assembly.segments = assembly.segments.filter((item) => item.id !== segmentId);
  if (!assembly.segments.length) {
    state.assemblies = state.assemblies.filter((item) => item.id !== assemblyId);
  } else {
    retitle(assembly);
  }
  state.assemblies.unshift({
    id: uid(),
    name: stem(sourceById(segment.sourceId)?.name || "Сборка"),
    nameTouched: false,
    segments: [segment],
  });
  state.picked = null;
}

function moveSegment(fromId, segmentId, toId, index) {
  const from = assemblyById(fromId);
  const to = assemblyById(toId);
  const segment = from?.segments.find((item) => item.id === segmentId);
  if (!from || !to || !segment) return;
  const fromIndex = from.segments.findIndex((item) => item.id === segmentId);
  if (fromId === toId) {
    const clamped = Math.max(0, Math.min(index, from.segments.length));
    if (clamped === fromIndex || clamped === fromIndex + 1) return;
    from.segments = from.segments.filter((item) => item.id !== segmentId);
    from.segments.splice(clamped > fromIndex ? clamped - 1 : clamped, 0, segment);
    retitle(from);
    state.picked = null;
    return;
  }
  from.segments = from.segments.filter((item) => item.id !== segmentId);
  to.segments.splice(Math.max(0, Math.min(index, to.segments.length)), 0, segment);
  if (!from.segments.length) state.assemblies = state.assemblies.filter((item) => item.id !== fromId);
  else retitle(from);
  retitle(to);
  state.picked = null;
}

function mergeInto(fromId, toId, index) {
  if (fromId === toId) return;
  const from = assemblyById(fromId);
  const to = assemblyById(toId);
  if (!from || !to) return;
  to.segments.splice(Math.max(0, Math.min(index, to.segments.length)), 0, ...from.segments);
  state.assemblies = state.assemblies.filter((item) => item.id !== fromId);
  retitle(to);
  state.picked = null;
}

function applyPayload(payload, zone, indexOverride) {
  if (!payload || !zone) return;
  const kind = zone.dataset.drop;
  const assemblyId = zone.dataset.assembly || "";
  const edge = zone.dataset.edge || "";
  const index =
    indexOverride ??
    (kind === "edge" ? (edge === "left" ? 0 : assemblyById(assemblyId)?.segments.length || 0) : Number(zone.dataset.index || 0));

  if (kind === "source") {
    if (payload.kind === "source") moveSource(payload.sourceId, index);
    return;
  }
  if (kind === "bay") {
    if (payload.kind === "source") createFromSource(payload.sourceId);
    else if (payload.kind === "segment") extractSegment(payload.assemblyId, payload.segmentId);
    return;
  }
  if (payload.kind === "source") insertSource(assemblyId, payload.sourceId, index);
  else if (payload.kind === "segment") moveSegment(payload.assemblyId, payload.segmentId, assemblyId, index);
  else if (payload.kind === "assembly") mergeInto(payload.assemblyId, assemblyId, index);
}

function placePicked(assemblyId, edge) {
  if (!state.picked) {
    say("Сначала возьмите файл: нажмите его в источниках или в сборке.", "info");
    return;
  }
  const assembly = assemblyById(assemblyId);
  const index = edge === "left" ? 0 : assembly?.segments.length || 0;
  const fake = { dataset: { drop: "edge", assembly: assemblyId, edge, index: String(index) } };
  applyPayload(state.picked, fake);
  render();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function pickedTitle() {
  const picked = state.picked;
  if (!picked) return "";
  if (picked.kind === "source") return sourceById(picked.sourceId)?.name || "Файл";
  if (picked.kind === "assembly") return assemblyById(picked.assemblyId)?.name || "Сборка";
  const assembly = assemblyById(picked.assemblyId);
  const segment = assembly?.segments.find((item) => item.id === picked.segmentId);
  return sourceById(segment?.sourceId)?.name || "Фрагмент";
}

function render() {
  const active = document.activeElement;
  const activeId = active?.id || "";
  const selectionStart = active instanceof HTMLInputElement ? active.selectionStart : null;

  const sources = state.sources
    .map((source, index) => {
      const on = samePick(state.picked, { kind: "source", sourceId: source.id });
      return `<div class="src-gap" data-drop="source" data-index="${index}"></div>
        <article class="card ${on ? "on" : ""}" data-drop="source" data-index="${index}">
        <button type="button" class="take" data-pick="source" data-source="${source.id}">
          <b class="clip" data-tip="${escapeHtml(source.name)}">${escapeHtml(source.name)}</b>
          <span>${source.pageCount} стр · ${formatBytes(source.size)}</span>
          <em>${on ? "В руке — это копия" : "Нажмите, чтобы взять"}</em>
        </button>
        <button type="button" class="grip" draggable="true" data-drag='${JSON.stringify({ kind: "source", sourceId: source.id })}' aria-label="Перетащить ${escapeHtml(source.name)}">⋮⋮</button>
        <button type="button" class="x" data-remove-source="${source.id}" aria-label="Убрать ${escapeHtml(source.name)}">×</button>
      </article>`;
    })
    .join("");
  const sourceList = state.sources.length
    ? `<div class="source-grid">${sources}<div class="src-gap src-gap-end" data-drop="source" data-index="${state.sources.length}"></div></div>
       <p class="hint">Новые файлы встают по алфавиту. За ⋮⋮ можно поднять или опустить.</p>`
    : "";

  const assemblies = state.assemblies
    .map((assembly) => {
      const onAsm = samePick(state.picked, { kind: "assembly", assemblyId: assembly.id });
      const segments = assembly.segments
        .map((segment, index) => {
          const source = sourceById(segment.sourceId);
          const on = samePick(state.picked, { kind: "segment", assemblyId: assembly.id, segmentId: segment.id });
          const open = state.openId === segment.id;
          const kept = segment.pages.length;
          const total = source?.pageCount || 0;
          const chips =
            total > 0 && total <= 40
              ? `<div class="chips">${allPages(total)
                  .map(
                    (page) =>
                      `<button type="button" class="chip-page ${segment.pages.includes(page) ? "on" : ""}" data-toggle-page="${page}" data-assembly="${assembly.id}" data-segment="${segment.id}">${page}</button>`,
                  )
                  .join("")}</div>`
              : "";
          return `${index > 0 ? `<div class="seam" data-drop="seam" data-assembly="${assembly.id}" data-index="${index}" title="Склеить здесь"></div>` : ""}
            <article class="seg ${on ? "on" : ""}">
              <button type="button" class="take" data-pick="segment" data-assembly="${assembly.id}" data-segment="${segment.id}">
                <b class="clip" data-tip="${escapeHtml(source?.name || "Фрагмент")}">${escapeHtml(source?.name || "Фрагмент")}</b>
                <span class="${kept === 0 ? "bad" : ""}">${kept} из ${total}</span>
              </button>
              <button type="button" class="grip" draggable="true" data-drag='${JSON.stringify({ kind: "segment", assemblyId: assembly.id, segmentId: segment.id })}' aria-label="Перетащить фрагмент">⋮⋮</button>
              <div class="seg-actions">
                <button type="button" data-open="${segment.id}">Страницы</button>
                <button type="button" data-remove-segment="${segment.id}" data-assembly="${assembly.id}" aria-label="Убрать фрагмент">×</button>
              </div>
              ${
                open
                  ? `<div class="pages">
                      <label>Оставить страницы
                        <input id="spec-${segment.id}" data-spec="${segment.id}" data-assembly="${assembly.id}" value="${escapeHtml(formatSpec(segment.pages))}" placeholder="1–3, 5" inputmode="text" />
                      </label>
                      ${chips}
                      <p class="hint">Пустое поле уберёт все страницы этого куска. Диапазон: 1–3, 5.</p>
                    </div>`
                  : ""
              }
            </article>`;
        })
        .join("");

      return `<article class="asm">
        <div class="asm-head">
          <button type="button" class="grip asm-grip" draggable="true" data-drag='${JSON.stringify({ kind: "assembly", assemblyId: assembly.id })}' aria-label="Перетащить сборку">⋮⋮</button>
          <input class="name clip ${onAsm ? "on" : ""}" data-rename="${assembly.id}" data-tip="${escapeHtml(assembly.name)}" value="${escapeHtml(assembly.name)}" aria-label="Имя файла" />
          <button type="button" class="primary" data-download="${assembly.id}" ${state.busy ? "disabled" : ""}>Скачать</button>
          <button type="button" data-remove-assembly="${assembly.id}" aria-label="Удалить сборку">×</button>
        </div>
        <div class="rail">
          <button type="button" class="edge" data-drop="edge" data-assembly="${assembly.id}" data-edge="left">слева</button>
          <div class="rail-scroll">${segments}</div>
          <button type="button" class="edge" data-drop="edge" data-assembly="${assembly.id}" data-edge="right">справа</button>
        </div>
        <p class="hint">«Слева» и «справа» клеят то, что в руке или что перетаскиваете. Исходник в первом поле не двигается.</p>
      </article>`;
    })
    .join("");

  const picked = state.picked;
  const banner = picked
    ? `<div class="banner">
        <div>
          <b class="clip" data-tip="${escapeHtml(pickedTitle())}">В руке: ${escapeHtml(pickedTitle())}</b>
          <p>${
            picked.kind === "assembly"
              ? "Нажмите «слева» или «справа» у другой сборки — они станут одним файлом."
              : picked.kind === "source"
                ? "Исходник останется на месте. Это копия."
                : "Поставьте фрагмент слева или справа, либо вынесите отдельным файлом."
          }</p>
        </div>
        <div class="toolbar">
          ${picked.kind !== "assembly" ? `<button type="button" class="primary" data-new>Отдельным файлом</button>` : ""}
          <button type="button" data-clear>Снять</button>
        </div>
      </div>`
    : "";

  app.innerHTML = `
    <div class="bays">
      <section class="bay">
        <div class="bay-head"><h2>Источники</h2><span>${state.sources.length}</span>
          <button type="button" class="primary" id="browse">Добавить PDF</button>
        </div>
        ${
          state.sources.length
            ? sourceList
            : `<button type="button" class="empty" id="browse-empty">Положите сюда один или несколько PDF<span>Они остаются здесь. В сборку уходит только копия.</span></button>`
        }
      </section>
      <section class="bay">
        <div class="bay-head"><h2>К скачиванию</h2><span>${state.assemblies.length}</span>
          ${
            state.assemblies.length
              ? `<button type="button" class="primary" data-download-all ${state.busy ? "disabled" : ""}>${state.assemblies.length > 1 ? "Скачать всё" : "Скачать"}</button>`
              : ""
          }
        </div>
        ${banner}
        <div class="new-file" data-drop="bay">${state.assemblies.length ? "Сюда — новым отдельным файлом" : "Перетащите сюда файл из источников или нажмите его и соберите"}</div>
        <div class="asm-list">${assemblies}</div>
      </section>
    </div>`;

  if (activeId) {
    const next = document.getElementById(activeId);
    if (next instanceof HTMLInputElement) {
      next.focus();
      if (selectionStart != null) next.setSelectionRange(selectionStart, selectionStart);
    }
  }
}

async function readFiles(files) {
  const pdfs = [...files].filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  const skipped = files.length - pdfs.length;
  if (skipped) say(skipped === 1 ? "Один файл не PDF — пропустил." : `Не PDF, пропущено: ${skipped}.`, "bad");
  if (!pdfs.length) return;
  state.busy = true;
  render();
  let added = 0;
  const incoming = [];
  for (const file of pdfs) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFLib.PDFDocument.load(bytes);
      const pageCount = doc.getPageCount();
      if (pageCount < 1) throw new Error("empty");
      incoming.push({ id: uid(), name: file.name, bytes, pageCount, size: file.size });
      added += 1;
    } catch (error) {
      const encrypted = String(error?.message || error).toLowerCase().includes("encrypt");
      say(`${file.name}: ${encrypted ? "PDF с паролем не открывается." : "Не удалось прочитать PDF."}`, "bad");
    }
  }
  incoming.sort((a, b) => compareNames(a.name, b.name));
  state.sources.push(...incoming);
  state.busy = false;
  if (added) say(added === 1 ? "Файл в источниках." : `В источниках: ${added}.`, "ok");
  render();
}

async function buildAssembly(assembly) {
  const out = await PDFLib.PDFDocument.create();
  for (const segment of assembly.segments) {
    if (!segment.pages.length) continue;
    const source = sourceById(segment.sourceId);
    if (!source) throw new Error("missing");
    const src = await PDFLib.PDFDocument.load(source.bytes);
    const copied = await out.copyPages(
      src,
      segment.pages.map((page) => page - 1),
    );
    copied.forEach((page) => out.addPage(page));
  }
  if (out.getPageCount() < 1) throw new Error("nopages");
  return out.save();
}

function saveBytes(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function uniqueName(name, used) {
  const base = stem(name) || "document";
  let filename = `${base}.pdf`;
  let index = 2;
  while (used.has(filename)) {
    filename = `${base}-${index}.pdf`;
    index += 1;
  }
  used.add(filename);
  return filename;
}

async function downloadOne(assembly) {
  state.busy = true;
  render();
  try {
    const bytes = await buildAssembly(assembly);
    const filename = `${stem(assembly.name) || "document"}.pdf`;
    saveBytes(bytes, filename, "application/pdf");
    say(`Скачивается ${filename}`, "ok");
  } catch (error) {
    say(error?.message === "nopages" ? "В файле не осталось страниц." : "Не удалось собрать PDF.", "bad");
  } finally {
    state.busy = false;
    render();
  }
}

async function downloadAll() {
  if (state.assemblies.length === 1) {
    await downloadOne(state.assemblies[0]);
    return;
  }
  state.busy = true;
  render();
  try {
    const zip = new JSZip();
    const used = new Set();
    for (const assembly of state.assemblies) {
      const bytes = await buildAssembly(assembly);
      zip.file(uniqueName(assembly.name, used), bytes);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "PDF-Master.zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    say(`Скачивается архив, ${state.assemblies.length} PDF.`, "ok");
  } catch (error) {
    say(error?.message === "nopages" ? "В одном из файлов не осталось страниц." : "Не удалось собрать архив.", "bad");
  } finally {
    state.busy = false;
    render();
  }
}

function clearHot() {
  document.querySelectorAll(".hot, .hot-after").forEach((node) => node.classList.remove("hot", "hot-after"));
}

app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;
  if (target.closest("#browse, #browse-empty")) {
    fileInput.click();
    return;
  }
  const pick = target.closest("[data-pick]");
  if (pick) {
    const next =
      pick.dataset.pick === "source"
        ? { kind: "source", sourceId: pick.dataset.source }
        : { kind: "segment", assemblyId: pick.dataset.assembly, segmentId: pick.dataset.segment };
    state.picked = samePick(state.picked, next) ? null : next;
    render();
    return;
  }
  if (target.closest("[data-clear]")) {
    state.picked = null;
    render();
    return;
  }
  if (target.closest("[data-new]")) {
    if (state.picked?.kind === "source") createFromSource(state.picked.sourceId);
    else if (state.picked?.kind === "segment") extractSegment(state.picked.assemblyId, state.picked.segmentId);
    render();
    return;
  }
  const edge = target.closest(".edge");
  if (edge) {
    placePicked(edge.dataset.assembly, edge.dataset.edge);
    return;
  }
  const opener = target.closest("[data-open]");
  if (opener) {
    state.openId = state.openId === opener.dataset.open ? null : opener.dataset.open;
    render();
    return;
  }
  const toggle = target.closest("[data-toggle-page]");
  if (toggle) {
    const assembly = assemblyById(toggle.dataset.assembly);
    const segment = assembly?.segments.find((item) => item.id === toggle.dataset.segment);
    const page = Number(toggle.dataset.togglePage);
    if (segment) {
      segment.pages = segment.pages.includes(page)
        ? segment.pages.filter((item) => item !== page)
        : [...segment.pages, page].sort((a, b) => a - b);
      render();
    }
    return;
  }
  const removeSource = target.closest("[data-remove-source]");
  if (removeSource) {
    const id = removeSource.dataset.removeSource;
    const used = state.assemblies.some((assembly) => assembly.segments.some((segment) => segment.sourceId === id));
    if (used) say("Файл стоит в сборке. Сначала уберите его оттуда.", "bad");
    else {
      state.sources = state.sources.filter((source) => source.id !== id);
      if (state.picked?.kind === "source" && state.picked.sourceId === id) state.picked = null;
      render();
    }
    return;
  }
  const removeSegment = target.closest("[data-remove-segment]");
  if (removeSegment) {
    const assembly = assemblyById(removeSegment.dataset.assembly);
    if (assembly) {
      assembly.segments = assembly.segments.filter((segment) => segment.id !== removeSegment.dataset.removeSegment);
      if (!assembly.segments.length) state.assemblies = state.assemblies.filter((item) => item.id !== assembly.id);
      else retitle(assembly);
      state.picked = null;
      render();
    }
    return;
  }
  const removeAssembly = target.closest("[data-remove-assembly]");
  if (removeAssembly) {
    state.assemblies = state.assemblies.filter((assembly) => assembly.id !== removeAssembly.dataset.removeAssembly);
    state.picked = null;
    render();
    return;
  }
  const download = target.closest("[data-download]");
  if (download && !download.hasAttribute("data-download-all")) {
    const assembly = assemblyById(download.dataset.download);
    if (assembly) void downloadOne(assembly);
    return;
  }
  if (target.closest("[data-download-all]")) void downloadAll();
});

app.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.spec) {
    const assembly = assemblyById(input.dataset.assembly);
    const segment = assembly?.segments.find((item) => item.id === input.dataset.spec);
    const source = sourceById(segment?.sourceId || "");
    if (!segment || !source) return;
    const pages = parseSpec(input.value, source.pageCount);
    if (!pages) {
      input.classList.add("bad");
      say(`Страницы только от 1 до ${source.pageCount}.`, "bad");
      return;
    }
    segment.pages = pages;
    say("", "");
    render();
    return;
  }
  if (input.dataset.rename) {
    const assembly = assemblyById(input.dataset.rename);
    if (!assembly) return;
    assembly.name = input.value.trim() || assembly.name;
    assembly.nameTouched = true;
  }
});

app.addEventListener("dragstart", (event) => {
  const handle = event.target instanceof Element ? event.target.closest("[data-drag]") : null;
  if (!handle) return;
  drag = JSON.parse(handle.dataset.drag);
  event.dataTransfer.effectAllowed = drag.kind === "source" ? "copyMove" : "move";
  event.dataTransfer.setData("text/plain", drag.kind);
  handle.closest(".card, .seg, .asm")?.classList.add("moving");
  if (drag.kind === "source") document.querySelector(".source-grid")?.classList.add("sorting");
  hideTip();
});

app.addEventListener("dragend", () => {
  drag = null;
  clearHot();
  document.querySelector(".source-grid")?.classList.remove("sorting");
  document.querySelectorAll(".moving").forEach((node) => node.classList.remove("moving"));
});

app.addEventListener("dragover", (event) => {
  const zone = event.target instanceof Element ? event.target.closest("[data-drop]") : null;
  if (!zone || !drag) return;
  if (zone.dataset.drop === "source") {
    if (drag.kind !== "source") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearHot();
    const after = zone.classList.contains("card") && event.clientY > zone.getBoundingClientRect().top + zone.getBoundingClientRect().height / 2;
    zone.classList.add(after ? "hot-after" : "hot");
    return;
  }
  if (drag.kind === "assembly" && zone.dataset.drop === "bay") return;
  if (drag.kind === "assembly" && zone.dataset.assembly === drag.assemblyId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = drag.kind === "source" ? "copy" : "move";
  clearHot();
  zone.classList.add("hot");
});

app.addEventListener("drop", (event) => {
  const zone = event.target instanceof Element ? event.target.closest("[data-drop]") : null;
  if (!zone || !drag) return;
  event.preventDefault();
  const payload = drag;
  const index = zone.dataset.drop === "source" ? sourceDropIndex(zone, event) : undefined;
  drag = null;
  clearHot();
  applyPayload(payload, zone, index);
  render();
});

let tipEl = null;
let tipTimer = 0;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "tip";
  tipEl.hidden = true;
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
  return tipEl;
}

function hideTip() {
  clearTimeout(tipTimer);
  if (tipEl) tipEl.hidden = true;
}

function showTip(text, x, y) {
  const el = ensureTip();
  el.textContent = text;
  el.hidden = false;
  el.style.left = "0px";
  el.style.top = "0px";
  const rect = el.getBoundingClientRect();
  const pad = 8;
  let left = x;
  let top = y + 16;
  if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
  if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, y - rect.height - 10);
  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

function tipNode(event) {
  const node = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
  if (!node || !node.dataset.tip) return null;
  if (node instanceof HTMLInputElement && document.activeElement === node) return null;
  return node;
}

app.addEventListener("pointerover", (event) => {
  if (event.pointerType === "touch" || drag) return;
  const node = tipNode(event);
  if (!node) return;
  showTip(node.dataset.tip, event.clientX, event.clientY);
});

app.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse" || drag) return;
  const node = tipNode(event);
  if (!node) {
    hideTip();
    return;
  }
  showTip(node.dataset.tip, event.clientX, event.clientY);
});

app.addEventListener("pointerout", (event) => {
  if (event.pointerType === "touch") return;
  const node = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
  if (!node) return;
  const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-tip]") : null;
  if (next === node) return;
  hideTip();
});

app.addEventListener("pointerup", (event) => {
  if (event.pointerType !== "touch" || drag) return;
  const raw = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
  if (!raw || !raw.dataset.tip) return;
  if (raw instanceof HTMLInputElement && document.activeElement === raw) return;
  showTip(raw.dataset.tip, event.clientX, event.clientY);
  clearTimeout(tipTimer);
  tipTimer = window.setTimeout(hideTip, 2800);
});

window.addEventListener("scroll", hideTip, true);

fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  fileInput.value = "";
  if (files.length) void readFiles(files);
});

window.addEventListener("dragover", (event) => {
  if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault();
});

window.addEventListener("drop", (event) => {
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  event.preventDefault();
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length) void readFiles(files);
});

render();
