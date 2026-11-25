/* The original IndexedDB key is shared with v2.8. */
(() => {
  let candidate, busy = false;
  const buttons = ["pick", "continueMigration", "backupFolder", "retryFolder"];
  const status = $("folderStatus");

  async function run(action) {
    if (busy) return;
    busy = true;
    buttons.forEach(id => { $(id).disabled = true; });
    try {
      await action();
    } catch (error) {
      if (error.name === "AbortError") return;
      $("folderActions").hidden = false;
      $("retryFolder").hidden = !candidate;
      status.textContent = error.message;
    } finally {
      busy = false;
      buttons.forEach(id => { $(id).disabled = false; });
    }
  }

  async function remembered(handle) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("akt-tool", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("kv", handle ? "readwrite" : "readonly");
        const store = tx.objectStore("kv");
        const result = handle ? store.put(handle, "dir") : store.get("dir");
        tx.oncomplete = () => resolve(result.result);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  function clearWorkspace() {
    RemarksStore.open(null);
    dirHandle = null;
    openRows = [];
    ready = false;
    clearTimeout(timer);
    $("num").value = "";
    $("out").replaceChildren();
    $("open").replaceChildren();
    $("hint").textContent = "";
    for (const id of ["num", "go", "pdfBtn", "journalBtn"]) $(id).disabled = true;
    RemarksUI.refresh();
  }

  async function openFolder(handle, migrate = false) {
    clearWorkspace();
    candidate = handle;
    $("folder").textContent = handle.name;
    $("folderActions").hidden = false;
    $("retryFolder").hidden = true;
    $("migration").hidden = true;
    status.textContent = "Проверяем файлы…";
    if (await handle.queryPermission({mode: "readwrite"}) !== "granted") {
      $("retryFolder").hidden = false;
      status.textContent = "Разрешите чтение и запись в рабочей папке.";
      return;
    }
    const legacy = await readLegacyFolder(handle);
    if (!migrate) {
      for (const name of RemarksStore.files) {
        try {
          await handle.getFileHandle(name);
        } catch (error) {
          if (error.name !== "NotFoundError") throw error;
          $("migration").hidden = false;
          status.textContent = "Рабочие файлы ещё не изменялись.";
          return;
        }
      }
    }
    const dump = await readOpenDump(handle);
    try {
      await RemarksStore.open(handle);
      await loadWorkspace(handle, legacy, dump);
      await renderOpen();
      RemarksUI.refresh();
    } catch (error) {
      clearWorkspace();
      throw error;
    }
    $("num").disabled = !dump.date;
    $("journalBtn").disabled = !openRows.length;
    status.textContent = "";
    try {
      await remembered(handle);
    } catch {
      status.textContent = "После перезапуска браузера выберите папку снова.";
    }
  }

  async function backup() {
    status.textContent = "Создаём резервную копию…";
    const zip = new JSZip();
    async function collect(handle, archive) {
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === "directory") await collect(entry, archive.folder(name));
        else archive.file(name, await (await entry.getFile()).arrayBuffer());
      }
    }
    await collect(candidate, zip);
    const url = URL.createObjectURL(await zip.generateAsync({type: "blob"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = candidate.name + "-" + new Date().toISOString().slice(0, 10) + ".zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = "Резервная копия скачивается.";
  }

  $("pick").onclick = () => run(async () => {
    if (typeof showDirectoryPicker !== "function") throw new Error("Откройте страницу в Chrome или Edge.");
    await openFolder(await showDirectoryPicker({mode: "readwrite"}));
  });
  $("continueMigration").onclick = () => run(() => openFolder(candidate, true));
  $("backupFolder").onclick = () => run(backup);
  $("retryFolder").onclick = () => run(async () => {
    if (await candidate.requestPermission({mode: "readwrite"}) !== "granted") throw new Error("Доступ к папке не предоставлен.");
    await openFolder(candidate);
  });
  run(async () => {
    const handle = await remembered();
    if (handle) await openFolder(handle);
  });
})();
