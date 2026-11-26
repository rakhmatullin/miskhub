importScripts("vault.js", "export-page.js", "capture.js", "remark-files.js", "export.js");

const toolPage = chrome.runtime.getURL("popup.html");
const hub = "https://rakhmatullin.github.io/miskhub/";

function fromHub(sender, page) {
  if (!sender?.url || (sender.frameId != null && sender.frameId !== 0)) return false;
  const url = new URL(sender.url);
  return url.origin + url.pathname === hub + page;
}

async function openTool() {
  await chrome.tabs.create({url: toolPage});
}

chrome.action.onClicked.addListener(() => { openTool().catch(console.warn); });
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!fromHub(sender, "exon.html")) return;
  if (message?.type === "exon-open-tool" && message.version === chrome.runtime.getManifest().version) {
    openTool().then(() => respond({ready: true}), () => respond({ready: false}));
    return true;
  }
});

chrome.runtime.onConnectExternal.addListener(port => {
  const withAttachments = fromHub(port.sender, "sborka.html") || fromHub(port.sender, "sborka-v2.14.html");
  if (port.name !== "miskhub-remarks-refresh" || (!withAttachments && !fromHub(port.sender, "sborka-v2.13.html"))) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  const send = data => {
    if (!controller.signal.aborted) port.postMessage(data);
  };
  let started = false, pending;
  function ask(message, replyType) {
    controller.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(null, new Error("Нет ответа от «Замечаний».")), 600000);
      function finish(reply, error) {
        clearTimeout(timer);
        pending = null;
        if (error) reject(error);
        else resolve(reply);
      }
      pending = {replyType, finish};
      try { send(message); }
      catch (error) { finish(null, error); }
    });
  }

  async function importWorkbook(workbook, {project, read}, announce) {
    const wanted = await ask({type: "workbook", workbook}, "plan");
    if (!Array.isArray(wanted.numbers) || !Array.isArray(wanted.open) ||
        !wanted.numbers.every(Number.isSafeInteger) || !wanted.open.every(Number.isSafeInteger)) {
      throw new Error("«Замечания» не передали список актов для обновления.");
    }
    const catalog = await ExonRemarkFiles.catalog(read, wanted, announce);
    const {integration, remarkIds, files: attachments} = catalog;
    const request = await ask({type: "catalog", project, integration, remarkIds, files: attachments}, "files");
    if (!Array.isArray(request.ids)) throw new Error("«Замечания» не передали список вложений.");
    const requested = new Set(request.ids);
    const files = catalog.files.filter(file => requested.has(file.id));
    for (const [index, file] of files.entries()) {
      controller.signal.throwIfAborted();
      announce("Загружаем вложения · " + (index + 1) + " / " + files.length);
      let blob;
      try {
        blob = await read("file", file.id);
        if (!blob?.encoded) throw new Error("Экзон не вернул файл.");
      } catch (error) {
        catalog.warnings.push(file.name + " · " + error.message);
        continue;
      }
      const message = {type: "attachment", id: file.id, ...blob};
      if (index + 1 === files.length) send(message);
      else await ask(message, "saved");
    }
    return catalog.warnings;
  }

  port.onDisconnect.addListener(() => {
    controller.abort();
    pending?.finish(null, controller.signal.reason);
  });
  port.onMessage.addListener(message => {
    if (pending && pending.replyType === message?.type) {
      pending.finish(message);
      return;
    }
    if (started || message?.type !== "refresh") return;
    started = true;
    const includeAttachments = withAttachments && [2, 3].includes(message.protocol);
    (async () => {
      send({type: "connected", protocol: message.protocol === 3 ? 3 : 2});
      let settings, target;
      try {
        const saved = await ExonVault.restore();
        if (saved && await saved.dir.queryPermission({mode: "read"}) === "granted") {
          settings = await ExonVault.load(saved.dir);
          if (settings?.remarksUrl) target = ExonExport.parseLink(settings.remarksUrl);
        }
      } catch {
        // The settings page can display the local file or permission error.
      }
      controller.signal.throwIfAborted();
      if (!target) {
        await openTool();
        send({type: "setup"});
        return;
      }
      if (message.workspaceReady !== true) {
        send({type: "folder"});
        return;
      }
      const announce = text => send({type: "progress", text});
      const result = await navigator.locks.request("miskhub-exon-remarks-refresh", {ifAvailable: true}, lock => {
        if (!lock) throw new Error("Обновление реестра уже выполняется в другой вкладке.");
        controller.signal.throwIfAborted();
        return ExonExport.run(target, settings, announce, () => {}, controller.signal, true,
          includeAttachments ? (workbook, tab) => importWorkbook(workbook, tab, announce) : undefined);
      });
      if (includeAttachments) send({type: "complete", warnings: result});
      else send({type: "workbook", workbook: result});
    })().catch(error => send({type: "error", text: error.message}));
  });
});
