(() => {
  const extensionId = "homjedffdaffpgbenahhadeogepcjbno";
  const button = $("refreshRegistry");
  const status = $("registryStatus");

  function report(text, error = false) {
    status.textContent = text;
    status.classList.toggle("bad", error);
    status.hidden = !text;
  }

  function requestWorkbook(workspaceReady) {
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
      let connected = false, finished = false;
      const handshake = setTimeout(() => finish({type: "install"}), 6000);
      function finish(result, error) {
        if (finished) return;
        finished = true;
        clearTimeout(handshake);
        port.disconnect();
        if (error) reject(error);
        else resolve(result);
      }
      port.onMessage.addListener(message => {
        switch (message?.type) {
          case "connected": connected = true; clearTimeout(handshake); break;
          case "progress": report(message.text); break;
          case "setup": case "folder": case "workbook": finish(message); break;
          case "error": finish(null, new Error(message.text)); break;
        }
      });
      port.onDisconnect.addListener(() => {
        void runtime.lastError;
        if (connected) finish(null, new Error("Связь с расширением прервалась. Повторите обновление."));
        else finish({type: "install"});
      });
      try {
        port.postMessage({type: "refresh", workspaceReady});
      } catch {
        finish({type: "install"});
      }
    });
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
      bytes = Uint8Array.fromBase64 ? Uint8Array.fromBase64(workbook.encoded) : Uint8Array.from(atob(workbook.encoded), c => c.charCodeAt(0));
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
      await renderOpen();
      if (folder !== dirHandle) return;
      $("num").disabled = false;
      $("journalBtn").disabled = !openRows.length;
      $("num").dispatchEvent(new Event("input"));
    });
    return rows.length;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    const folder = dirHandle;
    report("Проверяем настройки Экзона…");
    try {
      const result = await requestWorkbook(Boolean(folder));
      if (result.type === "install") {
        window.location.assign("./exon.html");
      } else if (result.type === "setup") {
        report("Открыт «Экзон». Выберите папку и сохраните ссылку на замечания.");
      } else if (result.type === "folder") {
        report("Выберите рабочую папку «Замечаний» и повторите обновление.");
      } else {
        report("Проверяем и сохраняем реестр…");
        const count = await saveRegistry(folder, result.workbook);
        report("Реестр обновлён. Получено замечаний: " + count + ".");
      }
    } catch (error) {
      report(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
})();
