(() => {
  const menu = $("remark-row-menu");
  const checkbox = $("remark-row-skp");
  const download = $("remark-row-download");
  const status = $("remark-row-status");
  let active;

  function sync() {
    checkbox.disabled = download.disabled = !active || active.busy;
  }

  function position() {
    if (!active || !menu.matches(":popover-open")) return;
    if (!active.trigger.isConnected || active.folder !== dirHandle) {
      menu.hidePopover();
      return;
    }
    const anchor = active.trigger.getBoundingClientRect();
    const viewport = document.documentElement;
    if (anchor.bottom <= 0 || anchor.top >= viewport.clientHeight ||
        anchor.right <= 0 || anchor.left >= viewport.clientWidth) {
      menu.hidePopover();
      return;
    }
    const left = Math.max(8, Math.min(anchor.right - menu.offsetWidth, viewport.clientWidth - menu.offsetWidth - 8));
    const top = anchor.bottom + menu.offsetHeight + 8 <= viewport.clientHeight
      ? anchor.bottom + 4
      : Math.max(8, anchor.top - menu.offsetHeight - 4);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  function message(text, error = false) {
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle("bad", error);
    position();
  }

  $("open").addEventListener("click", event => {
    const trigger = event.target.closest("[data-remark-menu]");
    if (!trigger || !dirHandle) return;
    event.preventDefault();
    if (active?.trigger === trigger && menu.matches(":popover-open")) {
      menu.hidePopover();
      return;
    }
    active?.trigger.setAttribute("aria-expanded", "false");
    const number = Number(trigger.dataset.remarkMenu);
    active = {trigger, number, folder: dirHandle, busy: false};
    checkbox.checked = comments[number]?.skp === true;
    download.setAttribute("aria-label", "Скачать акт Word №" + number);
    trigger.setAttribute("aria-expanded", "true");
    message("");
    sync();
    if (!menu.matches(":popover-open")) menu.showPopover({source: trigger});
    position();
    download.focus({preventScroll: true});
  });
  menu.addEventListener("toggle", () => {
    if (menu.matches(":popover-open") || !active) return;
    const trigger = active.trigger;
    trigger.setAttribute("aria-expanded", "false");
    if (menu.contains(document.activeElement) && trigger.isConnected) trigger.focus({preventScroll: true});
    active = null;
  });
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  new MutationObserver(position).observe($("open"), {childList: true});

  async function run(action) {
    const current = active;
    if (!current || current.busy || current.folder !== dirHandle) return;
    current.busy = true;
    sync();
    try {
      const note = await action(current);
      if (active === current) message(note);
    } catch (error) {
      if (active === current) {
        checkbox.checked = comments[current.number]?.skp === true;
        message(error.message, true);
      }
    } finally {
      if (active === current) {
        current.busy = false;
        sync();
      }
    }
  }

  checkbox.addEventListener("change", () => {
    const enabled = checkbox.checked;
    run(async ({number, folder}) => {
      message("Сохраняем…");
      await saveSkp(number, enabled, folder);
      return "Сохранено.";
    });
  });
  download.addEventListener("click", () => run(async ({number, folder}) => {
    if (RemarkPhotos.busy()) throw new Error("Дождитесь окончания записи вложений.");
    message("Готовим акт…");
    const {blob, name} = await makeAct(number, folder);
    if (folder !== dirHandle) throw new Error("Рабочая папка изменилась.");
    downloadFile(blob, name);
    return "Акт скачивается.";
  }));
})();
