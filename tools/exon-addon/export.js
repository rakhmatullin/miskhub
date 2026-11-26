const ExonExport = (() => {
  const origin = "https://exon.exonproject.ru";
  const incomplete = "Экзон не подтвердил выбор всех замечаний. Проверьте число выбранных строк во вкладке Экзона.";

  function parseLink(raw) {
    let url;
    try { url = new URL(raw.trim()); } catch { /* handled below */ }
    if (url?.origin !== origin || url.username || url.password ||
        !/^\/projects\/[\w-]+\/buildControl\/remarks\/?$/.test(url.pathname)) {
      throw new Error("Введите ссылку раздела «Замечания» на exon.exonproject.ru.");
    }
    return url;
  }

  async function run(target, credentials, announce, onTab, signal) {
    const {id} = await chrome.tabs.create({url: target.href, active: false});
    onTab(id);
    const path = target.pathname.replace(/\/$/, "");
    const pause = () => new Promise(resolve => setTimeout(resolve, 240));

    async function call(action, data = null) {
      signal.throwIfAborted();
      const tab = await chrome.tabs.get(id).catch(() => { throw new Error("Вкладка Экзона закрыта."); });
      if (tab.status !== "complete" || !tab.url) return null;
      if (new URL(tab.url).origin !== origin) throw new Error("Вкладка перешла на другой сайт. Проверьте вход в Экзон.");
      try {
        const [result] = await chrome.scripting.executeScript({target: {tabId: id}, func: exonPageAction, args: [action, path, data]});
        return result?.result;
      } catch (error) {
        const latest = await chrome.tabs.get(id).catch(() => null);
        if (latest?.status === "loading" || latest?.url !== tab.url) return null;
        throw error;
      }
    }

    async function wait(check, error, timeout = 20000) {
      const until = Date.now() + timeout;
      do {
        const result = await check();
        if (result) return result;
        await pause();
      } while (Date.now() < until);
      signal.throwIfAborted();
      if (error) throw new Error(error);
      return null;
    }
    const state = predicate => async () => {
      const current = await call("state");
      return current && predicate(current) ? current : null;
    };
    const awaitPage = state(s => s.phase === "remarks" || s.phase === "login");
    const afterLogin = state(s => s.phase === "remarks" || s.phase === "other");

    announce("Открываем раздел замечаний…");
    const first = await wait(awaitPage, "Раздел замечаний не открылся. Проверьте ссылку и доступ к проекту.");
    if (first.phase === "login") {
      let loggedIn;
      if (credentials.login && credentials.password) {
        announce("Входим в Экзон…");
        if (await call("login", credentials)) loggedIn = await wait(afterLogin, "", 9000);
      }
      if (!loggedIn) {
        announce("Завершите вход во вкладке Экзона. После входа выгрузка продолжится.");
        await chrome.tabs.update(id, {active: true});
        loggedIn = await wait(afterLogin, "Вход не завершён. Войдите в Экзон и повторите скачивание.", 180000);
      }
      if (loggedIn.phase === "other") await chrome.tabs.update(id, {url: target.href});
    }

    announce("Выбираем все замечания…");
    const readable = s => s.phase === "remarks" && (s.ready || s.total === 0);
    let page = await wait(state(readable), "Не удалось открыть таблицу замечаний после входа.");
    if (page.filtered) {
      await call("reset");
      page = await wait(state(s => readable(s) && !s.filtered), "Не удалось сбросить фильтры Экзона.");
    }
    if (page.total === 0) throw new Error("В разделе нет замечаний для выгрузки.");
    if (page.start > 1) {
      if (!await call("first")) throw new Error("Не удалось открыть первую страницу таблицы Экзона.");
      page = await wait(state(s => readable(s) && s.start === 1), incomplete);
    }
    if (page.total == null && page.next) throw new Error(incomplete);

    async function selectRows(expected) {
      await wait(() => call("select"), "Чекбокс выбора строк недоступен.");
      if (expected) return wait(state(s => readable(s) && s.bulk && s.selected === expected), incomplete, 6000);
      return wait(state(s => readable(s) && s.bulk && (s.checked || s.selected > 0)), "Экзон не выбрал строки для выгрузки.");
    }
    page = await selectRows();
    const allSelected = s => s.total > 0 && s.selected === s.total;
    if (page.total > page.end && !allSelected(page)) {
      if (await call("select-total")) {
        page = await wait(state(allSelected), incomplete, 6000);
      } else {
        if (await call("size")) {
          const size = await wait(() => call("largest-size"), "Не удалось выбрать размер страницы.", 5000);
          if (size.changed) {
            await wait(state(s => readable(s) && s.start === 1 && s.end === (size.limit ? Math.min(size.limit, s.total) : s.total)), incomplete);
            page = await selectRows();
          }
        }
        while (page.total > page.end && !allSelected(page)) {
          const {end, selected, total} = page;
          if (selected !== end || !page.next || !await call("next")) throw new Error(incomplete);
          const next = await wait(state(s => readable(s) && s.start === end + 1), incomplete);
          if (next.total !== total || next.selected < selected) throw new Error(incomplete);
          page = await selectRows(next.end);
        }
      }
    }
    if (page.total && !allSelected(page) && (page.start !== 1 || page.end !== page.total || !page.checked)) {
      throw new Error(incomplete);
    }
    if (!page.total && !page.checked) throw new Error(incomplete);
    announce("Запрашиваем XLS у Экзона…");
    await wait(() => call("actions"), "Кнопка «Выбрать действие» недоступна.");
    await wait(() => call("xls"), "В меню Экзона нет действия «Скачать в xls».", 8000);
    return page.total;
  }

  return {parseLink, run};
})();
