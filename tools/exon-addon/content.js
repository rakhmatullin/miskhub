(() => {
  const host = document.createElement("div");
  host.id = "exon-addon-tools";
  const shadow = host.attachShadow({mode: "open"});
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial; position: fixed; inset: auto auto 16px 16px; z-index: 2147483647;
      font: 14px/1.4 system-ui, sans-serif; color: #172737;
    }
    :host([hidden]) { display: none !important; }
    button {
      appearance: none; font: inherit; font-weight: 650; cursor: pointer;
      padding: 8px 12px; border: 1px solid #8babc3; border-radius: 8px;
      background: #edf5fb; color: #164a71; box-shadow: 0 2px 9px #152d403b;
    }
    button:hover { background: #dcecf7; }
    button:focus-visible { outline: 2px solid #164a71; outline-offset: 2px; }
    [role=status] {
      display: block; width: max-content; max-width: calc(100vw - 48px);
      border: 1px solid #8babc3; border-radius: 8px; margin-top: 5px;
      padding: 5px 9px; background: #fff;
    }
    [role=status][hidden] { display: none; }
  `;
  const download = document.createElement("button");
  download.type = "button";
  download.textContent = "Скачать страницу";
  download.title = "Сохранить HTML-копию открытой страницы Экзона";
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.hidden = true;
  shadow.append(style, download, status);
  let feedbackTimer;
  function feedback(message) {
    status.textContent = message;
    status.hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { status.hidden = true; }, 5000);
  }
  download.addEventListener("click", () => {
    try {
      const html = ExonSnapshot.capture(document, host);
      const blob = new Blob([html], {type: "text/html;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "экзон-" + new Date().toISOString().slice(0, 19).replace(/:/g, "-") + ".html";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      feedback("Браузер сохраняет HTML.");
    } catch (error) {
      feedback(error.message);
    }
  });

  let frame = 0;
  function update() {
    frame = 0;
    const allowed = ExonSnapshot.canCapture(document);
    if (allowed && host.parentNode !== document.body) document.body.append(host);
    host.hidden = !allowed;
  }
  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  new MutationObserver(scheduleUpdate).observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener("popstate", scheduleUpdate);
  window.addEventListener("hashchange", scheduleUpdate);
  window.navigation?.addEventListener("currententrychange", scheduleUpdate);
  update();
})();
