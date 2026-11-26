const extensionId = "homjedffdaffpgbenahhadeogepcjbno";
const openTool = document.getElementById("open-tool");
const status = document.getElementById("exon-status");

function requestTool() {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) return false;
  return new Promise(resolve => {
    runtime.sendMessage(extensionId, {type: "exon-open-tool", version: "0.4.0"},
      reply => resolve(!runtime.lastError && reply?.ready === true));
  });
}

openTool.addEventListener("click", async () => {
  openTool.disabled = true;
  let ready;
  try {
    ready = await requestTool();
  } catch { /* Show the installation steps when the extension is unavailable. */ }
  if (!ready) document.getElementById("exon-help").open = true;
  status.textContent = ready
    ? "Инструмент открыт во вкладке расширения."
    : "Установите или обновите расширение до v0.4.0. Инструкция открыта ниже.";
  status.hidden = false;
  openTool.disabled = false;
});
