// Runs in the dedicated Exon tab's main world, only during the native export.
function captureExonWorkbook(action, remarksPath, key) {
  if (location.origin !== "https://exon.exonproject.ru" ||
      location.pathname.replace(/\/$/, "") !== remarksPath) return null;
  if (action === "read") return window[key]?.result ?? null;
  if (action === "close") {
    window[key]?.close();
    return true;
  }
  if (action !== "arm" || window[key]) return null;

  const createURL = URL.createObjectURL;
  const click = HTMLAnchorElement.prototype.click;
  const recent = new Map();
  const capture = {result: null, close};
  window[key] = capture;
  const timeout = setTimeout(close, 75000);

  function restore() {
    if (URL.createObjectURL === remember) URL.createObjectURL = createURL;
    if (HTMLAnchorElement.prototype.click === intercept) HTMLAnchorElement.prototype.click = click;
    recent.clear();
  }

  function close() {
    clearTimeout(timeout);
    restore();
    if (window[key] === capture) delete window[key];
  }

  function remember(blob) {
    const url = createURL.call(URL, blob);
    if (blob instanceof Blob) {
      recent.set(url, blob);
      if (recent.size > 8) recent.delete(recent.keys().next().value);
    }
    return url;
  }

  function intercept() {
    const blob = recent.get(this.href);
    if (!blob || !/^document\.xlsx?$/i.test(this.download)) return click.call(this);
    const name = this.download;
    restore();
    if (blob.size > 32 * 1024 * 1024) {
      capture.result = {error: "Реестр больше 32 МБ. Скачайте его в Экзоне и положите в рабочую папку."};
      return;
    }
    blob.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer);
      let encoded;
      if (bytes.toBase64) {
        encoded = bytes.toBase64();
      } else {
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
        }
        encoded = btoa(binary);
      }
      capture.result = {name, encoded};
    }).catch(() => { capture.result = {error: "Не удалось прочитать выгрузку Экзона."}; });
  }

  URL.createObjectURL = remember;
  HTMLAnchorElement.prototype.click = intercept;
  return true;
}
