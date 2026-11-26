const RemarkPhotos = (() => {
  // The original n_1.jpg and n_2.jpg stay at the head of each row.
  const filenames = /^(-?\d+)_(1|2)(?:_(\d+)(?:_([a-f0-9-]+))?)?\.(?:jpe?g|png|webp|bmp|tiff?|gif|avif)$/i;
  const lockName = "miskhub-remark-photos";
  const preview = $("remark-photo-preview");
  const picker = $("photoIn");
  let target, busy = false, selection, previewUrl;
  const displays = new WeakMap();
  const galleries = new WeakMap();

  function index(files) {
    const result = new Map();
    for (const entry of files) {
      const parsed = filenames.exec(entry.name);
      if (!parsed) continue;
      const n = Number(parsed[1]), group = Number(parsed[2]), order = Number(parsed[3] || 0);
      if (!Number.isSafeInteger(n) || !Number.isSafeInteger(order)) continue;
      if (!result.has(n)) result.set(n, []);
      const normalized = /^[a-f0-9-]{36}$/i.test(parsed[4] || "") && /\.jpg$/i.test(entry.name);
      result.get(n).push({...entry, group, order, normalized});
    }
    for (const entries of result.values()) {
      entries.sort((a, b) => a.group - b.group || a.order - b.order || a.name.localeCompare(b.name));
    }
    return result;
  }

  async function* convert(file, onPage) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      yield (await toJpeg(file)).bytes;
      return;
    }
    let renderer;
    try {
      renderer = await import("./pdf-pages-render.js?v=2.10");
    } catch {
      throw new Error("Для импорта PDF откройте «Замечания» через MISKHub или локальный HTTP-сервер.");
    }
    const source = await renderer.openPdf(file);
    const signal = new AbortController().signal;
    const size = {...renderer.rasterSizes.download, edge: 3000, pixels: 6_000_000};
    try {
      for (let page = 1; page <= source.doc.numPages; page++) {
        onPage(page, source.doc.numPages);
        yield await renderer.rasterPage({page}, source, size, signal);
      }
    } finally {
      await source.doc.destroy().catch(() => {});
    }
  }

  async function saveFiles({folder, n, group}, files) {
    return navigator.locks.request(lockName, async () => {
      if (folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
      const current = index(await listEntries(folder)).get(n) || [];
      let order = current.reduce((max, entry) => entry.group === group ? Math.max(max, entry.order) : max, 0);
      const warnings = [];
      let count = 0;
      for (const file of files) {
        const created = [];
        try {
          const images = convert(file, (page, total) => report(file.name + " · " + page + " / " + total));
          for await (const image of images) {
            if (folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
            const filename = [n, group, String(++order).padStart(6, "0"), crypto.randomUUID()].join("_") + ".jpg";
            const handle = await folder.getFileHandle(filename, {create: true});
            created.push(filename);
            const writer = await handle.createWritable();
            try {
              await writer.write(image);
              await writer.close();
            } catch (error) {
              await writer.abort().catch(() => {});
              throw error;
            }
          }
          count += created.length;
        } catch (error) {
          let retained = 0;
          for (const filename of created) {
            try { await folder.removeEntry(filename); }
            catch { retained++; }
          }
          warnings.push(file.name + " — " + error.message +
            (retained ? " Не удалось удалить временные файлы: " + retained + "." : ""));
          if (folder !== dirHandle) break;
        }
      }
      return {count, warnings};
    });
  }

  function report(message, error = false) {
    const status = $("remark-photo-status");
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("bad", error);
  }

  async function refresh({folder, n}) {
    if (folder !== dirHandle) return;
    const entries = index(await listEntries(folder)).get(n) || [];
    if (folder !== dirHandle) return;
    for (const placeholder of document.querySelectorAll('[data-photo-for="' + n + '"]')) {
      mount(placeholder, n, entries, folder, placeholder.tagName === "TD");
    }
  }

  async function operate(context, task) {
    if (busy || context.folder !== dirHandle) return;
    busy = true;
    document.body.classList.add("remark-photo-busy");
    const pickWasDisabled = $("pick").disabled;
    $("pick").disabled = true;
    try {
      const result = await task();
      await refresh(context);
      report(result.message, result.error);
    } catch (error) {
      report(error.message, true);
    } finally {
      busy = false;
      document.body.classList.remove("remark-photo-busy");
      $("pick").disabled = pickWasDisabled;
    }
  }

  function pick(context) {
    if (busy || context.folder !== dirHandle) return;
    target = context;
    picker.value = "";
    picker.click();
  }

  function remove(context, entry) {
    if (busy || context.folder !== dirHandle || !confirm("Удалить это вложение из рабочей папки?")) return;
    if (preview.open) preview.close();
    operate(context, async () => {
      await navigator.locks.request(lockName, async () => {
        if (context.folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
        const current = await context.folder.getFileHandle(entry.name);
        if (!(await current.isSameEntry(entry.handle))) throw new Error("Файл изменился. Повторите открытие папки.");
        await context.folder.removeEntry(entry.name);
      });
      return {message: "Вложение удалено."};
    });
  }

  function clearPreview() {
    selection = null;
    const image = $("remark-photo-image");
    image.hidden = true;
    image.removeAttribute("src");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  async function show(context, entry) {
    clearPreview();
    selection = {context, entry};
    const current = selection;
    const image = $("remark-photo-image");
    const status = $("remark-photo-preview-status");
    status.textContent = "Загрузка…";
    if (!preview.open) preview.showModal();
    try {
      const file = await entry.handle.getFile();
      if (selection !== current || !preview.open) return;
      previewUrl = URL.createObjectURL(file);
      image.src = previewUrl;
      image.hidden = false;
      status.textContent = "";
    } catch {
      if (selection === current) status.textContent = "Не удалось открыть изображение.";
    }
  }

  const visible = new IntersectionObserver(items => {
    for (const {target: image, isIntersecting} of items) {
      if (!isIntersecting) continue;
      visible.unobserve(image);
      const display = displays.get(image);
      if (!display) continue;
      display.entry.handle.getFile().then(file => {
        if (!image.isConnected) return;
        display.url = URL.createObjectURL(file);
        image.src = display.url;
      }).catch(() => {});
    }
  }, {rootMargin: "140px"});

  function eraseGallery(gallery) {
    if (gallery.isConnected) return;
    for (const img of galleries.get(gallery) || []) {
      visible.unobserve(img);
      const url = displays.get(img)?.url;
      if (url) URL.revokeObjectURL(url);
      displays.delete(img);
    }
    galleries.delete(gallery);
  }

  new MutationObserver(records => {
    for (const {removedNodes} of records) {
      for (const node of removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (galleries.has(node)) eraseGallery(node);
        node.querySelectorAll(".remark-photo-gallery").forEach(eraseGallery);
      }
    }
  }).observe(document.body, {childList: true, subtree: true});

  function button(label, className, action, aria) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.className = className;
    element.setAttribute("aria-label", aria);
    element.title = aria;
    element.onclick = action;
    return element;
  }

  function mount(placeholder, n, entries, folder, compact = false) {
    const gallery = document.createElement("div");
    gallery.className = "remark-photo-gallery" + (compact ? " compact" : "");
    const images = [];
    for (const group of [1, 2]) {
      const context = {folder, n, group};
      const row = document.createElement("div");
      row.className = "remark-photo-row";
      const strip = document.createElement("div");
      strip.className = "remark-photo-strip";
      row.append(button("+", "remark-photo-add", () => pick(context), "Добавить фото или PDF, ряд " + group), strip);
      let position = 0;
      for (const entry of entries) {
        if (entry.group !== group) continue;
        const tile = document.createElement("div");
        tile.className = "remark-photo-tile";
        const view = button("", "remark-photo-view", () => show(context, entry), "Открыть фото " + (++position));
        const image = document.createElement("img");
        image.alt = "";
        image.decoding = "async";
        displays.set(image, {entry});
        image.addEventListener("error", () => { image.classList.add("remark-photo-unavailable"); });
        view.append(image);
        tile.append(view, button(compact ? "×" : "Удалить", "remark-photo-delete", () => remove(context, entry), "Удалить фото " + position));
        strip.append(tile);
        images.push(image);
      }
      gallery.append(row);
    }
    placeholder.replaceChildren(gallery);
    galleries.set(gallery, images);
    images.forEach(image => visible.observe(image));
  }

  picker.addEventListener("change", () => {
    const context = target, files = [...picker.files];
    target = null;
    picker.value = "";
    if (!context || !files.length) return;
    operate(context, async () => {
      report("Сохраняем вложения…");
      const {count, warnings} = await saveFiles(context, files);
      return {message: ["Добавлено изображений: " + count + ".", ...warnings].join(" "), error: !!warnings.length};
    });
  });
  $("remark-photo-image").addEventListener("error", () => {
    if (preview.open) $("remark-photo-preview-status").textContent = "Не удалось открыть изображение.";
  });
  preview.addEventListener("close", clearPreview);
  $("remark-photo-close").onclick = () => preview.close();
  $("remark-photo-remove").onclick = () => {
    if (selection) remove(selection.context, selection.entry);
  };
  // A user may navigate after a successful import. Protect in-flight writes
  // while a PDF is still being converted.
  window.addEventListener("beforeunload", event => {
    if (busy) {
      event.preventDefault();
      event.returnValue = true;
    }
  });

  return {index, mount, busy: () => busy};
})();
