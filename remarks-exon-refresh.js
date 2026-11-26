(() => {
  const extensionId = "homjedffdaffpgbenahhadeogepcjbno";
  const button = $("refreshRegistry");
  const status = $("registryStatus");

  function report(text, error = false) {
    status.textContent = text;
    status.classList.toggle("bad", error);
    status.hidden = !text;
  }

  function requestUpdate(folder) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.connect) return Promise.resolve({type: "install"});
    return new Promise((resolve, reject) => {
      let port;
      try {
        port = runtime.connect(extensionId, {name: "miskhub-remarks-refresh"});
      } catch {
        resolve({type: "install"});
        return;
      }
      let connected = false, finished = false, heartbeat, plan, inbox = Promise.resolve();
      const files = new Map(), warnings = [];
      let added = 0;
      const handshake = setTimeout(() => finish({type: "install"}), 6000);
      function finish(result, error) {
        if (finished) return;
        finished = true;
        clearTimeout(handshake);
        clearInterval(heartbeat);
        port.disconnect();
        if (error) reject(new Error((plan ? "Реестр сохранён. " : "") + error.message));
        else resolve(result);
      }
      async function receive(message) {
        if (finished) return;
        switch (message?.type) {
          case "connected":
            if (message.protocol !== 3) { finish({type: "install"}); break; }
            connected = true;
            clearTimeout(handshake);
            heartbeat = setInterval(() => port.postMessage({type: "heartbeat"}), 15000);
            break;
          case "progress": report(message.text); break;
          case "setup": case "folder": finish(message); break;
          case "workbook":
            report("Проверяем и сохраняем реестр…");
            plan = await saveRegistry(folder, message.workbook);
            port.postMessage({type: "plan", numbers: plan.numbers, open: plan.open});
            break;
          case "catalog": {
            if (!plan) throw new Error("Список вложений получен до реестра.");
            const ids = await applyCatalog(folder, plan, message, files, warnings);
            port.postMessage({type: "files", ids});
            break;
          }
          case "attachment": {
            if (folder !== dirHandle) throw new Error("Рабочая папка изменилась. Повторите обновление.");
            const file = files.get(message.id);
            if (!file) throw new Error("Получено незапрошенное вложение Экзона.");
            files.delete(message.id);
            try {
              const data = new File([decode(message.encoded)], file.name, {type: message.mime});
              for (const n of file.numbers) {
                const result = await RemarkPhotos.importExon(folder, n, data, file.source);
                added += result.count;
                warnings.push(...result.warnings.map(text => "№" + n + " · " + text));
              }
            } catch (error) {
              warnings.push(file.name + " · " + error.message);
            }
            if (!finished) {
              try { port.postMessage({type: "saved"}); } catch { /* The last item needs no acknowledgement. */ }
            }
            break;
          }
          case "complete":
            if (!plan) throw new Error("Экзон не прислал реестр.");
            await refreshTable(folder);
            finish({type: "complete", count: plan.numbers.length, added,
              warnings: [...warnings, ...(message.warnings || [])]});
            break;
          case "error": finish(null, new Error(message.text)); break;
        }
      }
      port.onMessage.addListener(message => {
        inbox = inbox.then(() => receive(message)).catch(error => finish(null, error));
      });
      port.onDisconnect.addListener(() => {
        void runtime.lastError;
        inbox = inbox.then(() => {
          if (connected) finish(null, new Error("Связь с расширением прервалась. Повторите обновление."));
          else finish({type: "install"});
        });
      });
      try {
        port.postMessage({type: "refresh", protocol: 3, workspaceReady: Boolean(folder)});
      } catch {
        finish({type: "install"});
      }
    });
  }

  function decode(encoded) {
    if (typeof encoded !== "string" || !encoded || encoded.length > 45 * 1024 * 1024) {
      throw new Error("Экзон прислал пустой или слишком большой файл.");
    }
    return Uint8Array.fromBase64 ? Uint8Array.fromBase64(encoded) : Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  }

  async function applyCatalog(folder, plan, message, files, warnings) {
    if (folder !== dirHandle) throw new Error("Рабочая папка изменилась. Повторите обновление.");
    if (!validExonId(message.project) || !Array.isArray(message.files)) {
      throw new Error("Экзон прислал некорректный список вложений.");
    }
    const numbers = new Set(plan.numbers.map(String));
    const ids = Object.fromEntries(Object.entries(message.remarkIds || {}).filter(([n, id]) => numbers.has(n) && validExonId(id)));
    try {
      await editLegacy(folder, EXON_LINKS_FILE, data => {
        const known = data.project === message.project && data.digest === plan.digest ? data.ids : {};
        Object.assign(data, {schemaVersion: 1, digest: plan.digest, project: message.project, ids: {...known, ...ids}});
      });
    } catch (error) {
      warnings.push(error.message);
    }
    if (folder !== dirHandle) throw new Error("Рабочая папка изменилась. Повторите обновление.");
    const integration = Object.entries(message.integration || {}).filter(([n, value]) =>
      numbers.has(n) && typeof value === "string" && value.trim() && value.length <= 120);
    if (integration.length) {
      const saved = await editLegacy(folder, INT_MAP_FILE, current => {
        for (const [n, value] of integration) current[n] = value.trim();
      });
      if (folder !== dirHandle) throw new Error("Рабочая папка изменилась. Повторите обновление.");
      intMap = saved;
      for (const row of openRows) row.integration = intMap[row.act_no] || row.integration;
    }
    const current = RemarkPhotos.index(await listEntries(folder));
    const open = new Set(plan.open);
    for (const file of message.files) {
      if (typeof file?.id !== "string" || !/^[\w-]{1,128}$/.test(file.id) ||
          typeof file.name !== "string" || !/\.(pdf|jpe?g|png|webp|bmp|tiff?|gif|avif)$/i.test(file.name) ||
          !Array.isArray(file.numbers)) continue;
      const sourceBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message.project + "/" + file.id));
      const source = [...new Uint8Array(sourceBytes, 0, 16)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const candidates = [...new Set(file.numbers)].filter(n => open.has(n));
      const present = await Promise.all(candidates.map(n => RemarkPhotos.hasSource(current.get(n), source)));
      const needed = candidates.filter((n, index) => !present[index]);
      if (needed.length) files.set(file.id, {name: file.name, source, numbers: needed});
    }
    return [...files.keys()];
  }

  async function refreshTable(folder) {
    if (folder !== dirHandle) return;
    await renderOpen();
    if (folder !== dirHandle) return;
    $("num").disabled = false;
    $("journalBtn").disabled = !openRows.length;
    $("num").dispatchEvent(new Event("input"));
  }

  async function saveRegistry(folder, workbook) {
    if (!folder || folder !== dirHandle) throw new Error("Рабочая папка изменилась. Повторите обновление.");
    const extension = /^document\.(xlsx?)$/i.exec(workbook?.name)?.[1].toLowerCase();
    const name = EXON_DUMP_NAMES[extension];
    if (!name || typeof workbook.encoded !== "string" || workbook.encoded.length > 45 * 1024 * 1024) {
      throw new Error("Экзон прислал файл в неожиданном формате.");
    }
    let bytes, rows;
    try {
      bytes = decode(workbook.encoded);
      const signature = extension === "xlsx" ? [0x50, 0x4b, 0x03, 0x04] : [0xd0, 0xcf, 0x11, 0xe0];
      if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error();
      rows = parseDump(bytes);
    } catch {
      throw new Error("Файл Экзона не читается как реестр замечаний.");
    }
    if (!rows.length || rows.some(row => !row.status) || new Set(rows.map(row => row.act_no)).size !== rows.length ||
        (Number.isSafeInteger(workbook.count) && workbook.count !== rows.length)) {
      throw new Error("В файле Экзона неполный или некорректный реестр.");
    }
    const digest = await registryDigest(bytes);

    await navigator.locks.request("miskhub-remarks-exon-file", async () => {
      if (folder !== dirHandle) throw new Error("Рабочая папка изменилась. Повторите обновление.");
      await readLegacyFolder(folder);
      if (folder !== dirHandle) throw new Error("Рабочая папка изменилась. Повторите обновление.");
      legacyWrites++;
      try {
        const file = await folder.getFileHandle(name, {create: true});
        const writer = await file.createWritable();
        try {
          await writer.write(bytes);
          if (folder !== dirHandle) throw new Error("Рабочая папка изменилась. Повторите обновление.");
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => {});
          throw error;
        }
      } finally {
        legacyWrites--;
      }
      if (folder !== dirHandle) return;
      const dump = await readOpenDump(folder);
      const updated = await editLegacy(folder, SEQ_FILE, data => reconcileSequences(data, dump.rows.map(row => row.act_no)));
      if (folder !== dirHandle) return;
      applyOpenDump(dump, updated);
      await refreshTable(folder);
    });
    return {digest, numbers: rows.map(row => row.act_no), open: rows.filter(row => row.status === "К устранению").map(row => row.act_no)};
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    const folder = dirHandle;
    report("Проверяем настройки Экзона…");
    try {
      const result = await requestUpdate(folder);
      if (result.type === "install") {
        window.location.assign("./exon.html");
      } else if (result.type === "setup") {
        report("Открыт «Экзон». Выберите папку и сохраните ссылку на замечания.");
      } else if (result.type === "folder") {
        report("Выберите рабочую папку «Замечаний» и повторите обновление.");
      } else {
        const {count, added, warnings} = result;
        const summary = "Реестр обновлён. Получено замечаний: " + count + ". Добавлено изображений: " + added + ".";
        const details = warnings.slice(0, 4);
        if (warnings.length > details.length) details.push("Ещё ошибок: " + (warnings.length - details.length) + ".");
        report([summary, ...details].join(" "), warnings.length > 0);
      }
    } catch (error) {
      report(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
})();
