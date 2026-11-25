const openButton = document.getElementById("open");
const status = document.getElementById("status");

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  status.hidden = true;
  try {
    await chrome.tabs.create({url: "https://exon.exonproject.ru/"});
    window.close();
  } catch {
    status.textContent = "Не удалось открыть Экзон. Повторите попытку.";
    status.hidden = false;
    openButton.disabled = false;
  }
});
