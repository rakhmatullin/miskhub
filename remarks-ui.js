const RemarksUI = (() => {
  const get = id => document.getElementById(id);
  const host = get("open"), picker = get("respPicker"), editor = get("respEditor");
  const form = get("respForm"), fields = ["organization", "name", "phone", "email", "comment"];
  const toolbar = '<div class="toolbar resp-toolbar">' +
    '<label>Ответственный <select id="respFilter"></select></label>' +
    '<label><input type="checkbox" id="respGroup"> По ответственному</label>' +
    '<button type="button" id="respBulk">Назначить ответственного</button>' +
    '<button type="button" id="respClear">Снять назначение</button>' +
    '<span id="respSelection" aria-live="polite"></span></div>';
  let folder, filter = "", grouped = false, choice, edit, pending = 0;
  const text = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  };
  const button = (label, click) => {
    const node = text("button", label);
    node.type = "button";
    node.onclick = click;
    return node;
  };
  const fullName = p => [p.organization, p.name].filter(Boolean).join(" — ");
  const label = p => RemarksStore.label(p) + (p?.archived ? " (архив)" : "");
  const normalized = value => value.trim().normalize("NFC").toLocaleLowerCase("ru");
  const matches = (p, query) => [p.organization, p.name].some(value => normalized(value).includes(normalized(query)));
  const checks = () => [...host.querySelectorAll("tr:not([hidden]) .row-sel")];
  const selected = () => checks().filter(box => box.checked).map(box => Number(box.dataset.n));

  function updateSelection() {
    if (!get("selAll")) return;
    const count = selected().length, total = checks().length;
    get("selAll").checked = count > 0 && count === total;
    get("selAll").indeterminate = count > 0 && count < total;
    get("respSelection").textContent = count ? "Выбрано: " + count : "";
    for (const id of ["respBulk", "respClear"]) get(id).disabled = !RemarksStore.ready || !count;
  }

  function updateTable() {
    const select = get("respFilter");
    if (!select) return;
    const people = RemarksStore.people;
    const byId = new Map(people.map(p => [p.id, p]));
    if (filter && filter !== "none" && !byId.has(filter)) filter = "";
    const options = [new Option("Все замечания", ""), new Option("Без ответственного", "none")];
    const names = people.map(fullName);
    people.forEach((p, i) => {
      const duplicate = names.indexOf(names[i]) !== names.lastIndexOf(names[i]);
      options.push(new Option(names[i] + (p.archived ? " (архив)" : "") + (duplicate ? " · " + (i + 1) : ""), p.id));
    });
    select.replaceChildren(...options);
    select.value = filter;
    get("respGroup").checked = grouped;
    select.disabled = get("respGroup").disabled = !RemarksStore.ready;
    const tbody = host.querySelector("tbody");
    const rows = [...tbody.rows];
    let deselected = false;
    for (const row of rows) {
      const id = RemarksStore.assignments[row.dataset.remark];
      const person = byId.get(id);
      const selectPerson = row.querySelector("[data-resp]");
      selectPerson.textContent = label(person);
      selectPerson.title = person ? fullName(person) + (person.archived ? " (архив)" : "") : "Не назначен";
      selectPerson.setAttribute("aria-label", "Ответственный за №" + row.dataset.remark + " · " + selectPerson.title);
      selectPerson.disabled = !RemarksStore.ready;
      row.hidden = filter === "none" ? !!id : !!filter && filter !== id;
      const checkbox = row.querySelector(".row-sel");
      if (row.hidden && checkbox.checked) {
        checkbox.checked = false;
        deselected = true;
      }
    }
    const ordered = [...rows].sort((a, b) => {
      if (grouped) {
        const p = byId.get(RemarksStore.assignments[a.dataset.remark]);
        const q = byId.get(RemarksStore.assignments[b.dataset.remark]);
        const byPerson = label(p).localeCompare(label(q), "ru") ||
          (p?.sortOrder ?? -1) - (q?.sortOrder ?? -1);
        if (byPerson) return byPerson;
      }
      return (sortDesc ? -1 : 1) * (Number(a.dataset.remark) - Number(b.dataset.remark));
    });
    if (ordered.some((row, i) => row !== rows[i])) tbody.append(...ordered);
    get("respNoRows").hidden = rows.some(row => !row.hidden);
    updateSelection();
    if (deselected) syncNumberInput();
  }

  function syncNumberInput() {
    get("num").value = selected().join(" ");
    get("num").dispatchEvent(new Event("input"));
  }

  async function change(action) {
    const start = folder;
    pending++;
    try {
      await action();
      if (start === folder) {
        get("respError").hidden = true;
        refresh();
      }
      return true;
    } catch (error) {
      if (start === folder) {
        get("respError").textContent = error.message;
        get("respError").hidden = false;
        if (!RemarksStore.ready) {
          get("retryFolder").hidden = false;
          refresh();
        }
        if (editor.open) get("respEditStatus").textContent = error.message;
        else alert(error.message);
      }
      return false;
    } finally {
      pending--;
    }
  }

  function drawOptions() {
    const box = get("respOptions"), query = get("respPickerSearch").value;
    box.replaceChildren();
    if (!choice) return;
    const current = choice;
    function choose(id) {
      picker.close();
      choice = null;
      current.apply(id);
    }
    if (!query.trim() && current.clear) box.append(button("Снять назначение", () => choose(null)));
    const people = RemarksStore.people, names = people.map(fullName);
    people.forEach((p, i) => {
      if (p.archived || p.id === current.exclude || !matches(p, query)) return;
      const option = button(names[i], () => choose(p.id));
      if (current.current === p.id) option.setAttribute("aria-current", "true");
      const details = [p.phone, p.email].filter(Boolean);
      if (names.indexOf(names[i]) !== names.lastIndexOf(names[i])) details.push("Позиция в справочнике: " + (i + 1));
      if (details.length) option.append(text("small", details.join(" · ")));
      box.append(option);
    });
    if (!box.children.length) box.append(text("p", query ? "Никого не найдено." : "Нет доступных ответственных."));
  }

  function showPicker(anchor, title, options) {
    choice = options;
    get("respPickerTitle").textContent = title;
    get("respPickerSearch").value = "";
    drawOptions();
    picker.showModal();
    const bounds = anchor.getBoundingClientRect();
    picker.style.left = Math.max(8, Math.min(bounds.left, innerWidth - picker.offsetWidth - 8)) + "px";
    picker.style.top = (bounds.bottom + picker.offsetHeight + 8 <= innerHeight
      ? bounds.bottom + 2 : Math.max(8, bounds.top - picker.offsetHeight - 2)) + "px";
    get("respPickerSearch").focus();
  }

  function drawCards() {
    const cards = get("respCards"), open = new Set([...cards.querySelectorAll("details[open]")].map(d => d.dataset.person));
    cards.replaceChildren();
    if (!RemarksStore.ready) return;
    const byPerson = new Map();
    for (const [n, id] of Object.entries(RemarksStore.assignments)) {
      if (!byPerson.has(id)) byPerson.set(id, []);
      byPerson.get(id).push(Number(n));
    }
    const people = RemarksStore.people;
    for (const [i, p] of people.entries()) {
      if (!matches(p, get("respSearch").value)) continue;
      const links = byPerson.get(p.id) || [];
      const details = document.createElement("details");
      details.dataset.person = p.id;
      details.open = open.has(p.id);
      const summary = document.createElement("summary");
      summary.append(text("strong", label(p)), text("span", (p.organization && p.name ? p.name + " · " : "") + "Замечаний: " + links.length));
      const notes = document.createElement("dl");
      const info = [["Организация", p.organization], ["Имя", p.name], ["Телефон", p.phone], ["Эл. почта", p.email],
        ["Внутренний комментарий", p.comment], ["Замечания", links.join(", ")]];
      for (const [name, value] of info) {
        if (value) notes.append(text("dt", name), text("dd", value));
      }
      const actions = document.createElement("div");
      actions.className = "toolbar";
      const up = button("Выше", () => change(() => RemarksStore.move(p.id, -1)));
      const down = button("Ниже", () => change(() => RemarksStore.move(p.id, 1)));
      up.disabled = i === 0;
      down.disabled = i === people.length - 1;
      actions.append(button("Редактировать", () => showEditor(p)), up, down,
        button(p.archived ? "Восстановить" : "В архив", () => change(() => RemarksStore.archive(p.id, !p.archived))));
      if (links.length) actions.append(button("Изменить все назначения…", event => {
        showPicker(event.currentTarget, "Связанные замечания · " + links.length, {
          clear: true, exclude: p.id,
          apply: id => {
            const action = id ? "Переназначить" : "Снять назначение";
            if (confirm(action + " для замечаний № " + links.join(", ") + "?")) change(() => RemarksStore.assign(links, id, p.id));
          }
        });
      }));
      actions.append(button("Удалить", () => {
        if (!links.length) {
          if (confirm("Удалить «" + label(p) + "»?")) change(() => RemarksStore.remove(p.id));
        } else if (p.archived) {
          alert("Сначала измените все связанные назначения.");
        } else if (confirm("Есть связанные замечания. Переместить в архив с сохранением назначений?")) {
          change(() => RemarksStore.archive(p.id, true));
        }
      }));
      details.append(summary, notes, actions);
      cards.append(details);
    }
    if (!cards.children.length) cards.append(text("p", people.length ? "Никого не найдено." : "Справочник пуст."));
  }

  function refresh() {
    if (folder !== dirHandle) {
      folder = dirHandle;
      filter = "";
      grouped = false;
      edit = choice = null;
      if (picker.open) picker.close();
      if (editor.open) editor.close();
      get("respSearch").value = "";
      get("respError").hidden = true;
    }
    get("respDirectory").hidden = !folder;
    get("respAdd").disabled = get("respSearch").disabled = !RemarksStore.ready;
    drawCards();
    updateTable();
  }

  const draft = () => Object.fromEntries(fields.map(key => [key, form.elements.namedItem(key).value.trim()]));
  function validate(values) {
    if (values.organization || values.name) return true;
    get("respEditStatus").textContent = "Укажите организацию или имя.";
    return false;
  }
  function showEditor(person) {
    fields.forEach(key => { form.elements.namedItem(key).value = person?.[key] || ""; });
    edit = {id: person?.id, saved: draft(), queue: Promise.resolve()};
    get("respEditorTitle").textContent = person ? "Редактировать ответственного" : "Новый ответственный";
    get("respEditStatus").textContent = person ? "Изменения сохраняются автоматически." : "Укажите организацию или имя.";
    get("respCreate").hidden = !!person;
    get("respCreate").disabled = false;
    editor.showModal();
    form.elements.namedItem("organization").focus();
  }

  form.addEventListener("input", () => {
    const session = edit;
    if (!session?.id) return;
    session.latest = draft();
    session.queue = session.queue.then(async () => {
      if (edit !== session || !session.latest) return;
      const values = session.latest;
      session.latest = null;
      if (!validate(values)) return;
      const edits = Object.fromEntries(fields.filter(key => values[key] !== session.saved[key]).map(key => [key, values[key]]));
      if (!Object.keys(edits).length) return;
      get("respEditStatus").textContent = "Сохраняем…";
      if (await change(() => RemarksStore.edit(session.id, edits))) {
        session.saved = values;
        if (edit === session) get("respEditStatus").textContent = "Сохранено.";
      }
    });
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (edit?.id || get("respCreate").disabled) return;
    const values = draft();
    if (!validate(values)) return;
    get("respCreate").disabled = true;
    if (await change(() => RemarksStore.add(values))) editor.close();
    get("respCreate").disabled = false;
  });
  const unsaved = () => edit?.id && fields.some(key => draft()[key] !== edit.saved[key]);
  async function closeEditor() {
    await edit?.queue;
    if (!unsaved() || confirm("Закрыть без сохранения оставшихся изменений?")) editor.close();
  }
  editor.addEventListener("close", () => { edit = null; });
  editor.addEventListener("cancel", event => { event.preventDefault(); closeEditor(); });
  editor.querySelector("[data-close]").onclick = closeEditor;
  picker.querySelector("[data-close]").onclick = () => picker.close();
  get("respPickerSearch").oninput = drawOptions;
  get("respSearch").oninput = drawCards;
  get("respAdd").onclick = () => showEditor(null);
  window.addEventListener("beforeunload", event => {
    if (pending || legacyWrites || unsaved()) {
      event.preventDefault();
      event.returnValue = true;
    }
  });

  host.addEventListener("change", event => {
    if (event.target.id === "respFilter" || event.target.id === "respGroup") {
      filter = get("respFilter").value;
      grouped = get("respGroup").checked;
      updateTable();
    } else if (event.target.matches(".row-sel, #selAll")) {
      updateSelection();
    }
  });
  host.addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target || !RemarksStore.ready) return;
    if (target.dataset.resp) {
      const n = Number(target.dataset.resp);
      const current = RemarksStore.assignments[n];
      showPicker(target, "Ответственный · №" + n, {
        current, clear: !!current, apply: id => change(() => RemarksStore.assign([n], id))
      });
    } else if (target.id === "respBulk" || target.id === "respClear") {
      const numbers = selected();
      if (!numbers.length) return;
      if (target.id === "respBulk") {
        showPicker(target, "Назначить · " + numbers.length, {apply: id => change(() => RemarksStore.assign(numbers, id))});
      } else if (confirm("Снять назначение у отмеченных замечаний (" + numbers.length + ")?")) {
        change(() => RemarksStore.assign(numbers, null));
      }
    }
  });
  return {toolbar, refresh, updateTable};
})();
