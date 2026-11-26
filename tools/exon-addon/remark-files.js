// Reads the same project data and files as the Exon interface, in its own tab.
async function exonRemarkData(action, remarksPath, args) {
  if (location.origin !== "https://exon.exonproject.ru" || location.pathname.replace(/\/$/, "") !== remarksPath) return null;
  const projectId = remarksPath.split("/")[2];
  const fileTypes = /\.(?:pdf|jpe?g|png|webp|bmp|tiff?|gif|avif)$/i;
  const validId = id => typeof id === "string" && /^[\w-]{1,128}$/.test(id);
  function summarize(row) {
    const n = Number(row?.number), id = String(row?.id ?? "");
    if (row?.number == null || String(row.number).trim() === "" || !Number.isSafeInteger(n) || !validId(id)) return null;
    const number = row.integrationBusNumber;
    const integration = typeof number === "number" || typeof number === "string" ? String(number).trim() : "";
    const attached = Object.entries(row).filter(([field, values]) => /Attachments$/.test(field) && (values == null || Array.isArray(values)));
    const files = new Map();
    for (const [, values] of attached) {
      for (const file of values || []) {
        const fileId = String(file?.link ?? "");
        if (file?.type === "FILE" && validId(fileId) && typeof file.name === "string" && fileTypes.test(file.name)) {
          files.set(fileId, {id: fileId, name: file.name});
        }
      }
    }
    return {id, n, integration, files: attached.length ? [...files.values()] : null};
  }
  const summaries = rows => Array.isArray(rows) ? rows.map(summarize).filter(Boolean) : null;

  if (action === "table") {
    const grid = document.querySelector('[role="grid"]');
    if (!grid) return null;
    // MUI already has the full project rows even when it displays a single page.
    const reactKey = Object.keys(grid).find(key => key.startsWith("__reactFiber$"));
    for (let node = grid[reactKey], depth = 0; node && depth < 80; node = node.return, depth++) {
      const rows = summaries(node.memoizedProps?.rows);
      if (rows?.length) return rows;
    }
    return [...grid.querySelectorAll('[role="row"][data-id]')].map(row => summarize({
      id: row.dataset.id,
      number: row.querySelector('[data-field="number"]')?.innerText.trim(),
      integrationBusNumber: row.querySelector('[data-field="integrationBusNumber"]')?.innerText.trim()
    })).filter(Boolean).map(row => ({...row, integration: /^[–—-]$/.test(row.integration) ? "" : row.integration}));
  }

  // Reuse the loaded Exon client so its existing session and project permissions apply.
  const chunks = window.webpackChunkremote_module_sk;
  if (!chunks?.push || chunks.push === Array.prototype.push) return null;
  let runtime;
  const entry = [["miskhub-" + crypto.randomUUID()], {}, require => { runtime = require; }];
  chunks.push(entry);
  const index = chunks.indexOf(entry);
  if (index >= 0) chunks.splice(index, 1);
  if (!runtime?.m) return null;
  const apiModule = runtime.m[62431]?.toString().includes("d9") ? runtime(62431).d9 : null;
  let api = apiModule;
  if (!api?.skService?.remarkV2) {
    const match = Object.entries(runtime.m).find(([, factory]) => {
      const code = String(factory);
      return code.includes("skService:new") && code.includes("fileService:new");
    });
    if (match) api = runtime(match[0]).F;
  }
  const remarks = api?.skService?.remarkV2;
  if (!remarks?.getByIdsAndPermissions || !api.fileService?.file?.getBlob) return null;

  if (action === "registry") return summaries(await remarks.getAllByProjectId({projectId}));
  if (action === "batch" && Array.isArray(args) && args.length <= 100 && args.every(validId)) {
    return summaries(await remarks.getByIdsAndPermissions({projectId, data: args}));
  }
  if (action === "detail" && validId(args)) {
    const row = summarize(await remarks.getByIdAndProjectId({projectId, id: args}));
    return row ? {...row, files: row.files || []} : null;
  }
  if (action === "file" && validId(args)) {
    const blob = await api.fileService.file.getBlob({id: args});
    if (!(blob instanceof Blob) || !blob.size) throw new Error("Экзон вернул пустой файл.");
    if (blob.size > 32 * 1024 * 1024) throw new Error("Файл больше 32 МБ.");
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",", 2)[1]);
      reader.onerror = () => reject(new Error("Не удалось прочитать вложение."));
      reader.readAsDataURL(blob);
    });
    return {encoded, mime: blob.type};
  }
  return null;
}

const ExonRemarkFiles = (() => {
  async function catalog(read, plan, announce) {
    const wanted = new Set(plan.numbers), opened = new Set(plan.open);
    const byNumber = new Map();
    function add(rows) {
      for (const row of rows || []) {
        if (!wanted.has(row.n)) continue;
        byNumber.set(row.n, {...row, integration: row.integration || byNumber.get(row.n)?.integration || ""});
      }
    }
    const warnings = [];
    add(await read("table"));
    if (byNumber.size < wanted.size) {
      try { add(await read("registry")); }
      catch { warnings.push("Не удалось прочитать полный список замечаний из Экзона."); }
    }
    const pending = [...byNumber.values()].filter(row => opened.has(row.n) && row.files === null);
    if (byNumber.size < wanted.size) warnings.push("В Экзоне найдено " + byNumber.size + " из " + wanted.size + " замечаний из выгрузки.");
    for (let from = 0; from < pending.length; from += 100) {
      announce("Проверяем вложения · " + Math.min(from + 100, pending.length) + " / " + pending.length);
      const batch = pending.slice(from, from + 100);
      try {
        const rows = await read("batch", batch.map(row => row.id));
        if (!rows) throw new Error("Интерфейс Экзона не вернул список вложений.");
        const byId = new Map(rows.map(row => [row.id, row]));
        for (const entry of batch) {
          try {
            let row = byId.get(entry.id);
            if (row && row.files === null) row = await read("detail", entry.id);
            if (!row || row.id !== entry.id || row.n !== entry.n) {
              warnings.push("№" + entry.n + " · вложения не получены.");
              continue;
            }
            byNumber.set(entry.n, {...row, integration: row.integration || entry.integration});
          } catch {
            warnings.push("№" + entry.n + " · не удалось прочитать вложения.");
          }
        }
      } catch (error) {
        warnings.push("Вложения замечаний №" + batch.map(row => row.n).join(", ") + " · " + error.message);
      }
    }

    const files = new Map();
    const integration = {};
    for (const row of byNumber.values()) {
      if (row.integration && row.integration.length <= 120) integration[row.n] = row.integration;
      if (!opened.has(row.n)) continue;
      for (const file of row.files || []) {
        if (!files.has(file.id)) files.set(file.id, {...file, numbers: []});
        files.get(file.id).numbers.push(row.n);
      }
    }
    return {integration, files: [...files.values()], warnings};
  }

  return {catalog};
})();
