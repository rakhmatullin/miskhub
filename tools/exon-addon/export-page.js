// Chrome runs this function in the isolated world of the current top-level tab.
async function exonPageAction(action, remarksPath, credentials) {
  const origin = "https://exon.exonproject.ru";
  if (location.origin !== origin) return null;
  const visible = node => Boolean(node?.getClientRects().length) &&
    !node.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(node).visibility !== "hidden";
  const enabled = node => visible(node) && !node.closest(':disabled, [aria-disabled="true"], .Mui-disabled');
  const normalize = text => text.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
  const controls = 'button, [role="button"], [role="menuitem"], [role="option"], [role="combobox"], a[href], .MuiListItemButton-root, [matomo-id]';
  const find = (test, parent = document, available = enabled) => [...parent.querySelectorAll(controls)]
    .find(node => available(node) && [node.innerText, node.getAttribute("aria-label")].some(text => text && test(normalize(text))));

  if (/^\/auth\/realms\/SpringBoot\//.test(location.pathname)) {
    const password = [...document.querySelectorAll('form input[name="password"][type="password"]')].find(visible);
    const form = password?.form;
    const login = form?.querySelector('input[name="username"]');
    const submit = [...form?.querySelectorAll('button[type="submit"], input[type="submit"]') ?? []].find(visible);
    if (action === "state") {
      return visible(login) && submit ? {phase: "login"} : {phase: "auth"};
    }
    if (action !== "login" || !enabled(login) || !enabled(password) || !submit) return false;

    function trustedPost(receiver) {
      if (!receiver) return false;
      const actionUrl = new URL(receiver, location.href);
      return actionUrl.origin === origin && !actionUrl.username && !actionUrl.password &&
        actionUrl.pathname === "/auth/realms/SpringBoot/login-actions/authenticate";
    }
    const directAction = submit.getAttribute("formaction") || form.getAttribute("action");
    const isTrusted = directAction
      ? trustedPost(directAction) && (submit.getAttribute("formmethod") || form.method).toLowerCase() === "post"
      : Boolean(form.closest("#keycloakRoot")) && [...document.forms].some(receiver =>
          receiver !== form && receiver.method === "post" && trustedPost(receiver.getAttribute("action")));
    if (!isTrusted) return false;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (const [input, value] of [[login, credentials.login], [password, credentials.password]]) {
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", {bubbles: true}));
      input.dispatchEvent(new Event("change", {bubbles: true}));
    }
    if (!enabled(submit)) return false;
    submit.click();
    return true;
  }
  if (/^\/(?:auth|callback)(?:\/|$)/.test(location.pathname)) return {phase: "auth"};
  if (location.pathname.replace(/\/$/, "") !== remarksPath) return {phase: "other"};

  if (action === "xls") {
    const popper = [...document.querySelectorAll('[data-testid="remark-actions-popper"]')].find(visible);
    const isXls = text => /^скачать в\s+\.?xls$/i.test(text);
    const download = (popper && find(isXls, popper, visible)) || find(isXls, document, visible);
    if (!download) return false;
    if (!enabled(download)) return {disabled: true};
    download.click();
    return {clicked: true};
  }
  if (action === "largest-size") {
    const options = [...document.querySelectorAll('[role="listbox"] [role="option"]')]
      .filter(enabled).map(node => {
        const text = normalize(node.innerText);
        return {node, limit: text === "все" || text === "all" ? Infinity : Number(text.replace(/\s/g, ""))};
      }).filter(({limit}) => limit > 0).sort((a, b) => b.limit - a.limit);
    if (!options.length) return null;
    const target = options[0].node;
    const changed = target.getAttribute("aria-selected") !== "true";
    target.click();
    return {changed, limit: Number.isFinite(options[0].limit) ? options[0].limit : 0};
  }

  const select = document.querySelector('[role="grid"] input[name="select_all_rows"][type="checkbox"]');
  const grid = select?.closest('[role="grid"]');
  const region = select?.closest(".MuiDataGrid-root") || grid;
  if (!region || !visible(select)) return null;
  const reset = region.querySelector('[data-testid="reset-filters-btn"]');
  const first = region.querySelector('[data-testid="table-first-page-btn"]');
  const next = region.querySelector('[data-testid="table-next-page-btn"]');
  const size = region.querySelector('[role="combobox"][aria-label="rows per page"]');
  const pageText = region.querySelector(".MuiTablePagination-displayedRows")?.textContent.replace(/\s/g, "") || "";
  const range = pageText.match(/^(\d+)[–—-](\d+)(?:из|of)(\d+)$/i);
  const count = region.querySelector(".MuiDataGrid-selectedRowCount")?.innerText || "";
  const total = range ? Number(range[3]) : pageText.startsWith("0") ? 0 : null;
  const selected = count.match(/\d[\d\s\u00a0\u202f]*/)?.[0].replace(/\s/g, "");
  const checked = select.checked && !select.indeterminate && select.dataset.indeterminate !== "true";
  const loading = region.getAttribute("aria-busy") === "true" ||
    [...grid.querySelectorAll('[role="progressbar"], .MuiDataGrid-loadingOverlay, .MuiDataGrid-skeletonLoadingOverlay')].some(visible);
  const bulk = [...document.querySelectorAll('[data-testid="open-remark-actions-popper-btn"]')].find(enabled) ||
    find(text => /^(выбрать|выберите) действие$/.test(text), region) || find(text => /^(выбрать|выберите) действие$/.test(text));
  const scroller = grid.querySelector(".MuiDataGrid-virtualScroller");

  switch (action) {
    case "state":
      return {
        phase: "remarks", total, start: range ? Number(range[1]) : null, end: range ? Number(range[2]) : null,
        selected: selected == null ? null : Number(selected), checked, bulk: Boolean(bulk), next: enabled(next),
        filtered: enabled(reset), ready: enabled(select) && !loading
      };
    case "reset":
      if (!enabled(reset)) return false;
      reset.click();
      return true;
    case "select":
      if (!enabled(select) || loading) return false;
      if (!checked) select.click();
      return true;
    case "clear-all":
      if (!enabled(select)) return false;
      if (checked) select.click();
      return true;
    case "rewind-rows":
      if (scroller) scroller.scrollTop = 0;
      return true;
    case "select-visible-rows": {
      if (loading) return null;
      const inputs = [...grid.querySelectorAll('[role="row"] input[name="select_row"][type="checkbox"]')].filter(visible);
      if (!inputs.length) return null;
      for (const input of inputs) {
        if (!input.isConnected || input.checked || !enabled(input)) continue;
        input.click();
        // Let the grid commit its controlled selection before adding another row.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const before = scroller?.scrollTop ?? 0;
      if (scroller?.clientHeight) {
        // Overlap the rendered rows between scroll positions.
        scroller.scrollTop += Math.floor(scroller.clientHeight * 0.75);
      }
      return {advanced: (scroller?.scrollTop ?? 0) > before};
    }
    case "select-total": {
      if (!total) return false;
      const all = find(text => /^выбрать все(?:\s+\d[\d ]*)?(?:\s+(?:замечаний|замечания|строк|результатов))?(?:\s*\(\d[\d ]*\))?$/.test(text), region);
      if (!all || !all.innerText.trim()) return false;
      all.click();
      return true;
    }
    case "size":
      if (!enabled(size)) return false;
      size.dispatchEvent(new MouseEvent("mousedown", {button: 0, bubbles: true, cancelable: true}));
      await new Promise(resolve => setTimeout(resolve, 0));
      if (size.getAttribute("aria-expanded") !== "true") size.click();
      return true;
    case "next":
      if (!enabled(next)) return false;
      next.click();
      return true;
    case "first":
      if (!enabled(first)) return false;
      first.click();
      return true;
    case "actions":
      if (!bulk) return false;
      bulk.click();
      return true;
    default:
      return null;
  }
}
