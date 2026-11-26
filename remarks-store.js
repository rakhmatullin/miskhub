/* Both files are read and validated inside one origin-wide lock. */
const RemarksStore = (() => {
  const peopleFile = "ответственные.json";
  const linksFile = "назначения.json";
  const fields = ["organization", "name", "phone", "email", "comment"];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const numberKey = value => Number.isSafeInteger(Number(value)) && String(Number(value)) === value;
  let active = null;

  function lock(action) {
    if (!navigator.locks) throw new Error("Откройте страницу в актуальной версии Chrome или Edge.");
    return navigator.locks.request("miskhub-responsibles-v1", action);
  }

  function fileError(name, reason) {
    return new Error(name + " — " + reason + ". Восстановите файл из копии или проверьте доступ, затем повторите открытие.");
  }

  async function read(dir, name) {
    let handle;
    try {
      handle = await dir.getFileHandle(name);
    } catch (error) {
      if (error.name === "NotFoundError") return null;
      throw fileError(name, error.message);
    }
    let data;
    try {
      data = JSON.parse(await (await handle.getFile()).text());
    } catch (error) {
      throw fileError(name, error instanceof SyntaxError ? "повреждённый JSON" : error.message);
    }
    if (data?.schemaVersion !== 1) throw fileError(name, "неизвестная версия схемы");
    return { handle, data };
  }

  async function write(dir, name, entry) {
    let writer;
    try {
      const handle = entry.handle || await dir.getFileHandle(name, {create: true});
      writer = await handle.createWritable();
      await writer.write(JSON.stringify(entry.data, null, 2) + "\n");
      await writer.close();
    } catch (error) {
      if (writer) await writer.abort().catch(() => {});
      throw fileError(name, "не удалось сохранить изменения. " + error.message);
    }
  }

  async function load(dir, initialize) {
    const savedPeople = await read(dir, peopleFile);
    const savedLinks = await read(dir, linksFile);
    if (!initialize && (!savedPeople || !savedLinks)) {
      throw fileError(savedPeople ? linksFile : peopleFile, "файл исчез после открытия папки");
    }
    const people = savedPeople || {data: {schemaVersion: 1, people: []}};
    const links = savedLinks || {data: {schemaVersion: 1, assignments: {}}};
    const ids = new Set();
    if (!Array.isArray(people.data.people)) throw fileError(peopleFile, "некорректный справочник");
    for (const p of people.data.people) {
      if (!record(p) || typeof p.id !== "string" || !uuid.test(p.id) || ids.has(p.id) ||
          !Number.isFinite(p.sortOrder) || typeof p.archived !== "boolean" ||
          !fields.every(field => typeof p[field] === "string") || !(p.organization.trim() || p.name.trim()) ||
          ![p.createdAt, p.updatedAt].every(date => typeof date === "string" && Number.isFinite(Date.parse(date)))) {
        throw fileError(peopleFile, "некорректная запись или повторяющийся ID");
      }
      ids.add(p.id);
    }
    if (!record(links.data.assignments) ||
        !Object.entries(links.data.assignments).every(([number, id]) => numberKey(number) && ids.has(id))) {
      throw fileError(linksFile, "некорректный номер или ссылка на отсутствующего ответственного");
    }
    if (!savedPeople) await write(dir, peopleFile, people);
    if (!savedLinks) await write(dir, linksFile, links);
    return {people, links};
  }

  function update(session, pair) {
    session.people = pair.people.data.people.map(p => Object.freeze({...p})).sort((a, b) => a.sortOrder - b.sortOrder);
    session.links = Object.freeze({...pair.links.data.assignments});
    Object.freeze(session.people);
  }

  async function open(dir) {
    active = null;
    if (!dir) return;
    const session = {dir, ready: false};
    active = session;
    await lock(async () => {
      update(session, await load(dir, true));
      session.ready = true;
    });
  }

  async function transaction(edit) {
    const session = active;
    if (!session?.ready) throw new Error("Повторно откройте рабочую папку.");
    return lock(async () => {
      if (!session.ready) throw new Error("Повторно откройте рабочую папку после ошибки.");
      let pair;
      try {
        pair = await load(session.dir, false);
      } catch (error) {
        session.ready = false;
        throw error;
      }
      update(session, pair);
      if (!edit) return;
      const {file, value} = edit(pair.people.data.people, pair.links.data.assignments);
      if (file) {
        try {
          await write(session.dir, file, file === peopleFile ? pair.people : pair.links);
        } catch (error) {
          session.ready = false;
          throw error;
        }
        update(session, pair);
      }
      return value;
    });
  }

  function values(input, current = {}) {
    const result = Object.fromEntries(fields.map(field => [field, String(input[field] ?? current[field] ?? "").trim()]));
    if (!(result.organization || result.name)) throw new Error("Укажите организацию или имя.");
    return result;
  }

  function person(people, id) {
    const found = people.find(p => p.id === id);
    if (!found) throw new Error("Ответственный отсутствует в справочнике.");
    return found;
  }

  return {
    files: [peopleFile, linksFile],
    open,
    refresh: () => transaction(),
    get ready() { return active?.ready === true; },
    get people() { return active?.people || []; },
    get assignments() { return active?.links || {}; },
    label(p) { return p ? p.organization || p.name : "Не назначен"; },
    forNumber(n) { return this.people.find(p => p.id === this.assignments[n]); },
    add(input) {
      return transaction(people => {
        const now = new Date().toISOString();
        const p = {...values(input), id: crypto.randomUUID(), archived: false, createdAt: now, updatedAt: now,
          sortOrder: people.reduce((max, entry) => Math.max(max, entry.sortOrder), -1) + 1};
        people.push(p);
        return {file: peopleFile, value: {...p}};
      });
    },
    edit(id, input) {
      return transaction(people => {
        const p = person(people, id);
        const next = values(input, p);
        if (fields.every(field => p[field] === next[field])) return {};
        Object.assign(p, next, {updatedAt: new Date().toISOString()});
        return {file: peopleFile};
      });
    },
    archive(id, archived) {
      return transaction(people => {
        const p = person(people, id);
        if (p.archived === archived) return {};
        Object.assign(p, {archived, updatedAt: new Date().toISOString()});
        return {file: peopleFile};
      });
    },
    move(id, delta) {
      return transaction(people => {
        const ordered = [...people].sort((a, b) => a.sortOrder - b.sortOrder);
        const i = ordered.indexOf(person(people, id));
        const j = i + delta;
        if (j < 0 || j >= ordered.length) return {};
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        ordered.forEach((p, k) => {
          if (p.sortOrder !== k) Object.assign(p, {sortOrder: k, updatedAt: new Date().toISOString()});
        });
        return {file: peopleFile};
      });
    },
    remove(id) {
      return transaction((people, links) => {
        if (Object.values(links).includes(id)) throw new Error("Сначала измените все связанные назначения.");
        people.splice(people.indexOf(person(people, id)), 1);
        return {file: peopleFile};
      });
    },
    assign(numbers, id, expected) {
      const keys = numbers.map(String);
      return transaction((people, links) => {
        if (!keys.every(numberKey)) throw new Error("Некорректный номер замечания.");
        if (id !== null && person(people, id).archived) throw new Error("Ответственный в архиве.");
        if (expected !== undefined && keys.some(key => (links[key] ?? null) !== expected)) {
          throw new Error("Связанные назначения изменились. Повторите выбор.");
        }
        if (keys.every(key => (links[key] ?? null) === id)) return {};
        for (const key of keys) {
          if (id === null) delete links[key];
          else links[key] = id;
        }
        return {file: linksFile};
      });
    }
  };
})();
