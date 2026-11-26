const get = id => document.getElementById(id);
const form = get("export-form");
const login = get("login"), password = get("password"), url = get("remarks-url");
const download = get("download"), showTab = get("show-tab"), cancel = get("cancel");
const chooseFolder = get("choose-folder"), allowFolder = get("allow-folder"), saveLogin = get("save-login");

let locationForLogin, permitted = false, vaultBusy = false, run, tabId;

function report(id, message, error = false) {
  const node = get(id);
  node.textContent = message;
  node.dataset.error = String(error);
  node.hidden = !message;
}

function refreshVault() {
  chooseFolder.disabled = vaultBusy;
  allowFolder.disabled = vaultBusy;
  allowFolder.hidden = !locationForLogin || permitted;
  saveLogin.disabled = vaultBusy || !permitted || !url.value.trim() || Boolean(login.value.trim()) !== Boolean(password.value);
}

async function withVault(task, {starting = false} = {}) {
  if (vaultBusy) return;
  vaultBusy = true;
  if (starting) download.disabled = true;
  refreshVault();
  try {
    await task();
  } catch (error) {
    if (error.name !== "AbortError") report("vault-status", error.message, true);
  } finally {
    vaultBusy = false;
    if (starting) download.disabled = false;
    refreshVault();
  }
}

function setFolder(selection, record) {
  locationForLogin = selection;
  permitted = true;
  if (record) {
    login.value = record.login;
    password.value = record.password;
    url.value = record.remarksUrl || "";
  }
  report("vault-status", record?.remarksUrl
    ? "Настройки прочитаны из «" + selection.label + "/вход.json»."
    : "Папка «" + selection.label + "» выбрана. Введите ссылку и сохраните настройки.");
}

chooseFolder.addEventListener("click", () => withVault(async () => {
  const {location, record} = await ExonVault.choose();
  setFolder(location, record);
}));
allowFolder.addEventListener("click", () => withVault(async () => {
  if (await locationForLogin.dir.requestPermission({mode: "readwrite"}) !== "granted") {
    throw new Error("Браузер пока не разрешил доступ к папке.");
  }
  setFolder(locationForLogin, await ExonVault.load(locationForLogin.dir));
}));
async function saveSettings(target) {
  await ExonVault.save(locationForLogin.dir, {login: login.value.trim(), password: password.value, remarksUrl: target.href});
  report("vault-status", "Настройки сохранены в «" + locationForLogin.label + "/вход.json».");
}

saveLogin.addEventListener("click", () => withVault(() => saveSettings(ExonExport.parseLink(url.value))));
login.addEventListener("input", refreshVault);
password.addEventListener("input", refreshVault);
url.addEventListener("input", refreshVault);

withVault(async () => {
  locationForLogin = await ExonVault.restore();
  if (!locationForLogin) return;
  if (await locationForLogin.dir.queryPermission({mode: "readwrite"}) === "granted") {
    setFolder(locationForLogin, await ExonVault.load(locationForLogin.dir));
  } else {
    report("vault-status", "Разрешите доступ к «" + locationForLogin.label + "», чтобы загрузить сохранённые данные.");
  }
}, {starting: true});

showTab.addEventListener("click", async () => {
  try { await chrome.tabs.update(tabId, {active: true}); }
  catch { report("export-status", "Вкладка Экзона закрыта.", true); }
});
cancel.addEventListener("click", () => run?.abort());
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (run) return;
  let target;
  try { target = ExonExport.parseLink(url.value); }
  catch (error) { report("export-status", error.message, true); url.focus(); return; }

  run = new AbortController();
  download.disabled = true;
  cancel.hidden = false;
  showTab.hidden = true;
  tabId = undefined;
  try {
    if (!saveLogin.disabled) await withVault(() => saveSettings(target));
    const count = await ExonExport.run(target, {login: login.value.trim(), password: password.value},
      message => report("export-status", message),
      id => { tabId = id; showTab.hidden = id == null; }, run.signal);
    const selected = count ? " · строк выбрано: " + count : "";
    report("export-status", "Экзону отправлена команда скачивания XLS" + selected + ". Проверьте загрузки браузера.");
  } catch (error) {
    report("export-status", run.signal.aborted ? "Скачивание отменено." : error.message, !run.signal.aborted);
  } finally {
    run = null;
    download.disabled = false;
    cancel.hidden = true;
  }
});
