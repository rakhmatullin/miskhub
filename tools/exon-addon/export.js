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
        if (latest?.status === "loading" || latest?.url !== tab.url ||
            /execution context was destroyed|frame (?:with id \d+ )?was removed/i.test(error.message)) return null;
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
        const submitted = await call("login", credentials);
        if (submitted !== false) loggedIn = await wait(afterLogin, "", 9000);
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

    let selectIndividually = false;
    async function selectRows(expected) {
      if (!selectIndividually) {
        await wait(() => call("select"), "Чекбокс выбора строк недоступен.");
        const selected = await wait(state(s => readable(s) &&
          (expected ? s.selected === expected : s.checked || s.selected > 0)), null, 3500);
        if (selected) {
          const withActions = await wait(state(s => readable(s) && s.bulk &&
            (expected ? s.selected === expected : s.checked || s.selected > 0)), null, 1800);
          if (withActions) return withActions;
        }
        selectIndividually = true;
        await chrome.tabs.update(id, {active: true});
      }

      announce("Отмечаем строки по отдельности…");
      const current = await wait(state(readable), "Таблица замечаний недоступна.");
      if (current.checked && !current.bulk) {
        await call("clear-all");
        await wait(state(s => readable(s) && !s.checked && !s.selected), "Не удалось сбросить общее выделение.");
      }
      const count = expected ?? (current.end == null ? null : current.end - current.start + 1);
      const confirmed = state(s => {
        if (!readable(s) || !s.bulk) return false;
        if (count != null && s.selected != null) return s.selected === count;
        return expected == null && s.checked;
      });

      await call("rewind-rows");
      await pause();
      let batch;
      do {
        batch = await wait(() => call("select-visible-rows"), "В таблице не найдены чекбоксы отдельных строк.", 5000);
        const done = await confirmed();
        if (done) return done;
        if (batch.advanced) await pause();
      } while (batch.advanced);
      return wait(confirmed, "Не удалось выделить все строки с помощью чекбоксов Экзона. Проверьте таблицу в открытой вкладке.", 3500);
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
    if (page.total && !allSelected(page) &&
        (page.start !== 1 || page.end !== page.total || !page.checked || page.selected != null)) {
      throw new Error(incomplete);
    }
    if (!page.total && !page.checked) throw new Error(incomplete);
    announce("Запрашиваем XLS у Экзона…");
    await wait(() => call("actions"), "Кнопка «Выбрать действие» недоступна.");
    const result = await wait(() => call("xls"), "В меню Экзона нет действия «Скачать в XLS».", 8000);
    if (result.disabled) throw new Error("Экзон отключил действие «Скачать в XLS». Проверьте право на выгрузку в проекте.");
    return page.total;
  }

  return {parseLink, run};
})();
