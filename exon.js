const extensionId = "homjedffdaffpgbenahhadeogepcjbno";
const openTool = document.getElementById("open-tool");
const status = document.getElementById("exon-status");

function requestTool() {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) return false;
  return new Promise(resolve => {
    runtime.sendMessage(extensionId, {type: "exon-open"}, reply => resolve(!runtime.lastError && reply?.ready === true));
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
    : "Установите расширение v0.2.0 или откройте инструмент через значок «Экзон — надстройка» в браузере.";
  status.hidden = false;
  openTool.disabled = false;
});
