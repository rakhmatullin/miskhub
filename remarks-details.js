(() => {
  const host = $("open");
  const dialog = $("remark-details");
  const title = $("remark-details-title");
  const content = $("remark-details-content");
  const link = $("remark-details-exon");
  const linkHint = $("remark-details-exon-hint");
  let active;

  function message(text, error = false) {
    const status = document.createElement("p");
    status.className = error ? "msg bad" : "msg";
    status.role = "status";
    status.textContent = text;
    content.replaceChildren(status);
  }

  host.addEventListener("click", async event => {
    const trigger = event.target.closest("button[data-go]");
    if (!trigger || !dirHandle || dialog.open) return;
    const n = Number(trigger.dataset.go);
    const showing = active = {folder: dirHandle, trigger};
    title.textContent = "Замечание №" + n;
    link.hidden = linkHint.hidden = true;
    link.removeAttribute("href");
    message("Загружаем замечание…");
    dialog.showModal();
    dialog.scrollTop = 0;
    try {
      const detail = await lookup(n, showing.folder, true);
      if (active !== showing || !dialog.open || showing.folder !== dirHandle) return;
      if (!detail.ok) {
        message(detail.error, true);
        return;
      }
      const person = RemarksStore.forNumber(n);
      const label = person ? [person.organization, person.name].filter(Boolean).join(" — ") : "Не назначен";
      const comment = comments[n];
      const extra = [["Ответственный", label + (person?.archived ? " (архив)" : "")],
        [colNames.c1, typeof comment === "string" ? comment : comment?.c1], [colNames.c2, comment?.c2]];
      renderRemarkInfo(content, detail, extra);
      if (detail.exonUrl) {
        link.href = detail.exonUrl;
        link.hidden = false;
      } else {
        linkHint.hidden = false;
      }
    } catch (error) {
      if (active === showing && dialog.open) message(error.message, true);
    }
  });

  $("remark-details-close").onclick = () => dialog.close();
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    content.replaceChildren();
    if (active?.trigger.isConnected) active.trigger.focus({preventScroll: true});
    active = null;
  });
  new MutationObserver(() => {
    if (dialog.open && active?.folder !== dirHandle) dialog.close();
  }).observe(host, {childList: true});
})();
