importScripts("vault.js", "export-page.js", "capture.js", "export.js");

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
  if (port.name !== "miskhub-remarks-refresh" || !fromHub(port.sender, "sborka.html")) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  const send = data => {
    if (!controller.signal.aborted) port.postMessage(data);
  };
  let started = false;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(message => {
    if (started || message?.type !== "refresh") return;
    started = true;
    (async () => {
      send({type: "connected"});
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
      const workbook = await navigator.locks.request("miskhub-exon-remarks-refresh", {ifAvailable: true}, lock => {
        if (!lock) throw new Error("Обновление реестра уже выполняется в другой вкладке.");
        controller.signal.throwIfAborted();
        return ExonExport.run(target, settings, text => send({type: "progress", text}), () => {}, controller.signal, true);
      });
      send({type: "workbook", workbook});
    })().catch(error => send({type: "error", text: error.message}));
  });
});
