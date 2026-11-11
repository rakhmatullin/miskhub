import {
  addDays,
  ensureJournal,
  isoToRu,
  normalizeSettings,
  numbersFor,
  summaryText,
  todayISO,
} from "./ttr-core.js";

const REPO = "rakhmatullin/miskhub";
const TOKEN_KEY = "miskhub.githubToken";
const WEEK = [
  [1, "Пн"],
  [2, "Вт"],
  [3, "Ср"],
  [4, "Чт"],
  [5, "Пт"],
  [6, "Сб"],
  [0, "Вс"],
];

const $ = (id) => document.getElementById(id);
let saved = null;
let journal = { acts: {} };
let manuals = {};
let secretKnown = null;

function token() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function msg(text, kind) {
  const el = $("msg");
  el.className = "msg " + (kind || "info");
  el.textContent = text;
  if (!text) el.className = "";
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function selectedDays() {
  return [...document.querySelectorAll("#days button.on")].map((b) => Number(b.dataset.d));
}

function readMail() {
  return {
    enabled: $("enabled").checked,
    from: $("from").value,
    fromName: $("from-name").value,
    smtpHost: $("smtp").value,
    smtpPort: $("port").value,
    sendTime: $("send-time").value,
    weekdays: selectedDays(),
    to: [],
    cc: [],
    subject: "",
    body: "",
  };
}

function readActs() {
  const cards = document.querySelectorAll(".act-card");
  return [...cards].map((card) => {
    const id = card.dataset.id;
    const name = card.querySelector(".act-name").value.trim() || "Фиксация";
    const subject = card.querySelector(".act-subject")?.value || "";
    const body = card.querySelector(".act-body-text")?.value || "";
    const to = (card.querySelector(".act-to")?.value || "").split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const cc = (card.querySelector(".act-cc")?.value || "").split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const objects = [...card.querySelectorAll(".object-row")].map((row) => ({
      number: row.querySelector(".obj-number").value.trim() || "1",
      name: row.querySelector(".obj-name").value.trim() || "Объект",
      ranges: {
        workers: { min: row.querySelector(".w-min").value, max: row.querySelector(".w-max").value },
        itr: { min: row.querySelector(".i-min").value, max: row.querySelector(".i-max").value },
        tech: { min: row.querySelector(".t-min").value, max: row.querySelector(".t-max").value },
      },
    }));
    return { id, name, subject, body, to, cc, objects };
  });
}

function readForm() {
  return normalizeSettings({
    mail: readMail(),
    acts: readActs(),
  });
}

function writeMail(settings) {
  const s = normalizeSettings(settings);
  $("enabled").checked = s.mail.enabled;
  $("from").value = s.mail.from;
  $("from-name").value = s.mail.fromName;
  $("smtp").value = s.mail.smtpHost;
  $("port").value = s.mail.smtpPort;
  $("send-time").value = s.mail.sendTime;
  // recipients are per-act now
  for (const btn of document.querySelectorAll("#days button")) {
    btn.classList.toggle("on", s.mail.weekdays.includes(Number(btn.dataset.d)));
  }
}

function dirty() {
  if (!saved) return false;
  return JSON.stringify(readForm()) !== JSON.stringify(saved);
}

function actDate(card) {
  return card.querySelector(".act-date").value || todayISO();
}

function shownFor(card) {
  const id = card.dataset.id;
  const iso = actDate(card);
  const ranges = {
    workers: { min: Number(card.querySelector(".w-min").value), max: Number(card.querySelector(".w-max").value) },
    itr: { min: Number(card.querySelector(".i-min").value), max: Number(card.querySelector(".i-max").value) },
    tech: { min: Number(card.querySelector(".t-min").value), max: Number(card.querySelector(".t-max").value) },
  };
  if (manuals[id] && manuals[id].iso === iso) {
    const m = manuals[id];
    const sum = m.workers + m.itr + m.tech;
    return { ...m, sum, locked: false, status: "draft", note: "" };
  }
  const jact = journal.acts?.[id] || { days: {} };
  return numbersFor(iso, ranges, jact);
}

async function gh(method, path, body) {
  const res = await fetch("https://api.github.com" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token(),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    let message = data.message || res.statusText;
    if (message === "Resource not accessible by personal access token") {
      if (path.includes("/actions/workflows/") && path.includes("/dispatches")) {
        message = "Токен не может запускать Actions. В fine-grained токене нужно право Actions → Read and write (и Contents → Read and write). Создай новый токен только на репозиторий rakhmatullin/miskhub.";
      } else if (path.includes("/actions/secrets")) {
        message = "Токен не видит секреты. Нужно право Secrets → Read and write.";
      } else {
        message = "Токен не имеет доступа к ресурсу. Проверь, что fine-grained токен выдан именно на rakhmatullin/miskhub и имеет Contents + Actions + Secrets (Read and write).";
      }
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function putJson(filePath, obj, message) {
  let sha;
  try {
    const cur = await gh("GET", `/repos/${REPO}/contents/${filePath}?ref=main`);
    sha = cur.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  await gh("PUT", `/repos/${REPO}/contents/${filePath}`, {
    message,
    content: utf8ToB64(JSON.stringify(obj, null, 2) + "\n"),
    branch: "main",
    sha,
  });
}

async function loadAsset(path) {
  const res = await fetch("./" + path);
  if (!res.ok) throw new Error("Не удалось открыть " + path);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadJson(path) {
  const res = await fetch("./" + path + "?t=" + Date.now());
  if (!res.ok) throw new Error(path);
  return res.json();
}

function statusText(day, numbers, iso) {
  if (manuals[day?.id] && manuals[day.id]?.iso === iso) return "Эти числа ещё не в журнале. Нажми «Зафиксировать», иначе утром уйдут другие.";
  if (!numbers.locked) return "Числа посчитаны из диапазонов. В момент отправки они запишутся и больше не изменятся.";
  if (day?.status === "sent") return "Отправлен " + (day.sentAt ? new Date(day.sentAt).toLocaleString("ru-RU") : "") + (day.to ? " → " + day.to.join(", ") : "");
  if (day?.status === "archive") return "Исходный акт, уже был. Сам повторно не уйдёт.";
  if (day?.status === "error") return "Не отправился: " + (day.error || "ошибка");
  if (day?.status === "locked") return "Числа зафиксированы. Письмо уйдёт в заданное время.";
  return "Дата зафиксирована.";
}

function objectsFor(card) {
  const id = card.dataset.id;
  const iso = actDate(card);
  const rows = [...card.querySelectorAll(".object-row")];
  return rows.map((row) => {
    const ranges = {
      workers: { min: Number(row.querySelector(".w-min").value), max: Number(row.querySelector(".w-max").value) },
      itr: { min: Number(row.querySelector(".i-min").value), max: Number(row.querySelector(".i-max").value) },
      tech: { min: Number(row.querySelector(".t-min").value), max: Number(row.querySelector(".t-max").value) },
    };
    const key = id + ":" + (row.querySelector(".obj-number").value || "1");
    let numbers;
    if (manuals[key] && manuals[key].iso === iso) {
      const m = manuals[key];
      numbers = { ...m, sum: m.workers + m.itr + m.tech, locked: false };
    } else {
      const jact = journal.acts?.[id] || { days: {} };
      numbers = numbersFor(iso, ranges, jact);
    }
    return {
      number: row.querySelector(".obj-number").value.trim() || "1",
      name: row.querySelector(".obj-name").value.trim() || "Объект",
      ranges,
      numbers,
      row,
    };
  });
}

async function refreshAct(card) {
  const id = card.dataset.id;
  const iso = actDate(card);
  const objs = objectsFor(card);
  let totalW = 0, totalI = 0, totalT = 0;
  for (const o of objs) {
    o.row.querySelector(".on-w").textContent = o.numbers.workers;
    o.row.querySelector(".on-i").textContent = o.numbers.itr;
    o.row.querySelector(".on-t").textContent = o.numbers.tech;
    o.row.querySelector(".on-s").textContent = o.numbers.sum;
    totalW += o.numbers.workers;
    totalI += o.numbers.itr;
    totalT += o.numbers.tech;
  }
  const jact = journal.acts?.[id] || { days: {} };
  const day = jact.days?.[iso];
  const first = objs[0]?.numbers || { workers: 0, itr: 0, tech: 0, sum: 0, locked: false };
  const extra = objs.length > 1 ? ` · ${objs.length} объектов` : "";
  card.querySelector(".day-status").textContent = statusText({ ...day, id }, first, iso) + extra;
}

async function refreshAll() {
  for (const card of document.querySelectorAll(".act-card")) {
    await refreshAct(card);
  }
  renderLog();
}

function renderLog() {
  const rows = [];
  const today = todayISO();
  for (const [actId, jact] of Object.entries(journal.acts || {})) {
    const keys = new Set(Object.keys(jact.days || {}));
    for (let i = -3; i <= 4; i++) keys.add(addDays(today, i));
    for (const iso of [...keys].sort().reverse()) {
      let ranges = { workers: {min:13,max:15}, itr:{min:4,max:5}, tech:{min:4,max:5} };
      const card = document.querySelector(`.act-card[data-id="${actId}"]`);
      if (card) {
        ranges = {
          workers: { min: Number(card.querySelector(".w-min").value), max: Number(card.querySelector(".w-max").value) },
          itr: { min: Number(card.querySelector(".i-min").value), max: Number(card.querySelector(".i-max").value) },
          tech: { min: Number(card.querySelector(".t-min").value), max: Number(card.querySelector(".t-max").value) },
        };
      }
      const n = manuals[actId] && manuals[actId].iso === iso
        ? { ...manuals[actId], sum: manuals[actId].workers + manuals[actId].itr + manuals[actId].tech }
        : numbersFor(iso, ranges, jact);
      const day = jact.days?.[iso] || {};
      const label = day.status === "sent" ? "отправлен" : day.status === "archive" ? "исходный" : day.status === "error" ? "ошибка" : day.status === "locked" || n.locked ? "ждут" : iso > today ? "план" : "не отправлялся";
      const actName = card ? card.querySelector(".act-name").value : actId;
      rows.push(`<tr><td>${actName}</td><td><button type="button" class="act-dl" data-iso="${iso}" data-act="${actId}">${isoToRu(iso)}</button></td><td>${n.workers}</td><td>${n.itr}</td><td>${n.tech}</td><td>${n.sum}</td><td>${label}</td></tr>`);
    }
  }
  const head = "<tr><th>Фиксация</th><th>Дата</th><th>Раб.</th><th>ИТР</th><th>Тех.</th><th>Σ</th><th>Статус</th></tr>";
  $("log").innerHTML = head + rows.join("");
}

function buildDays() {
  $("days").innerHTML = WEEK.map(([d, name]) => `<button type="button" data-d="${d}">${name}</button>`).join("");
  $("days").addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    btn.classList.toggle("on");
    if (!selectedDays().length) btn.classList.add("on");
  });
}

function objectRowHtml(obj, idx) {
  const o = obj || { number: String(idx + 1), name: "Объект " + (idx + 1), ranges: { workers: {min:13,max:15}, itr:{min:4,max:5}, tech:{min:4,max:5} } };
  return `
    <div class="object-row" style="border:1px solid var(--line);border-radius:10px;padding:10px;margin:8px 0;background:#0a1422">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <label class="field" style="margin:0;flex:0 0 70px">№<input class="obj-number" type="text" value="${o.number || ""}" /></label>
        <label class="field" style="margin:0;flex:1">Название<input class="obj-name" type="text" value="${(o.name || "").replace(/"/g, "&quot;")}" /></label>
        <button type="button" class="remove-object" title="Удалить объект" style="align-self:flex-end">×</button>
      </div>
      <div class="row2">
        <label class="field">Рабочие от<input class="w-min" type="number" min="0" max="999" value="${o.ranges.workers.min}" /></label>
        <label class="field">Рабочие до<input class="w-max" type="number" min="0" max="999" value="${o.ranges.workers.max}" /></label>
        <label class="field">ИТР от<input class="i-min" type="number" min="0" max="999" value="${o.ranges.itr.min}" /></label>
        <label class="field">ИТР до<input class="i-max" type="number" min="0" max="999" value="${o.ranges.itr.max}" /></label>
        <label class="field">Техника от<input class="t-min" type="number" min="0" max="999" value="${o.ranges.tech.min}" /></label>
        <label class="field">Техника до<input class="t-max" type="number" min="0" max="999" value="${o.ranges.tech.max}" /></label>
      </div>
      <div class="obj-nums" style="display:flex;gap:12px;font-size:13px;color:var(--mute);margin-top:6px">
        <span>Раб. <b class="on-w">—</b></span>
        <span>ИТР <b class="on-i">—</b></span>
        <span>Тех. <b class="on-t">—</b></span>
        <span>Σ <b class="on-s">—</b></span>
      </div>
    </div>`;
}

function createActCard(act, open = true) {
  const card = document.createElement("div");
  card.className = "act-card" + (open ? " open" : "");
  card.dataset.id = act.id;
  const objects = (act.objects && act.objects.length) ? act.objects : [{ number: "1", name: act.name || "Объект", ranges: act.ranges || { workers:{min:13,max:15}, itr:{min:4,max:5}, tech:{min:4,max:5} } }];
  card.innerHTML = `
    <div class="act-header">
      <span class="chevron">▸</span>
      <input class="act-name" value="${(act.name || "").replace(/"/g, "&quot;")}" />
      <button type="button" class="remove-act" title="Удалить">×</button>
    </div>
    <div class="act-body">
      <label class="field">Дата фиксации
        <input class="act-date" type="date" value="${todayISO()}" />
      </label>
      <p class="hint day-status"></p>
      <div class="objects-list"></div>
      <button type="button" class="add-object">Добавить объект</button>
      <label class="field">Кому (адресаты этой фиксации, по одному в строке)
        <textarea class="act-to" placeholder="name@company.ru">${(act.to || []).join("\n")}</textarea>
      </label>
      <label class="field">Копия
        <textarea class="act-cc" placeholder="необязательно">${(act.cc || []).join("\n")}</textarea>
      </label>
      <label class="field">Тема письма
        <input class="act-subject" type="text" value="${(act.subject || "Фиксация ТТР {date} — {name}").replace(/"/g, "&quot;")}" />
      </label>
      <label class="field">Текст письма
        <textarea class="act-body-text">${act.body || "Добрый день.\\n\\nНаправляю фиксацию технических и трудовых ресурсов на {date} ({name}).\\n\\n{objects}\\n\\nС уважением,\\nРахматуллин Ренат"}</textarea>
      </label>
      <p class="hint">Переменные: <code>{date}</code> <code>{name}</code> <code>{objects}</code> <code>{sum}</code> <code>{workers}</code> <code>{itr}</code> <code>{tech}</code> <code>{filename}</code>. {objects} — список всех объектов с числами.</p>
      <div class="toolbar">
        <button type="button" class="act-reroll">Другие числа</button>
        <button type="button" class="act-lock">Зафиксировать</button>
        <button type="button" class="primary act-send">Отправить сейчас</button>
      </div>
      <p class="hint">Письмо уходит текстом, без PDF. Числа выше попадут в письмо.</p>
    </div>
  `;
  const list = card.querySelector(".objects-list");
  objects.forEach((obj, i) => list.insertAdjacentHTML("beforeend", objectRowHtml(obj, i)));
  card.querySelector(".act-body-text").value = String(act.body || "Добрый день.\n\nНаправляю фиксацию технических и трудовых ресурсов на {date} ({name}).\n\n{objects}\n\nС уважением,\nРахматуллин Ренат").replace(/\\n/g, "\n");
  card.querySelector(".act-to").value = (act.to || []).join("\n");
  card.querySelector(".act-cc").value = (act.cc || []).join("\n");
  return card;
}

function bindAct(card) {
  const header = card.querySelector(".act-header");
  header.addEventListener("click", (e) => {
    if (e.target.closest("input, button")) return;
    card.classList.toggle("open");
  });
  card.querySelector(".remove-act").addEventListener("click", (e) => {
    e.stopPropagation();
    if (document.querySelectorAll(".act-card").length <= 1) {
      msg("Должна остаться хотя бы одна фиксация.", "bad");
      return;
    }
    if (!confirm("Удалить эту фиксацию?")) return;
    const id = card.dataset.id;
    delete manuals[id];
    card.remove();
    updateRemoveButtons();
    syncSummaryActOptions();
    refreshAll();
  });
  card.querySelector(".add-object").addEventListener("click", () => {
    const list = card.querySelector(".objects-list");
    const idx = list.querySelectorAll(".object-row").length;
    list.insertAdjacentHTML("beforeend", objectRowHtml(null, idx));
    bindObjectEvents(card);
    refreshAct(card);
  });
  bindObjectEvents(card);
  card.querySelector(".act-name").addEventListener("input", () => { syncSummaryActOptions(); refreshAct(card); });
  card.querySelector(".act-date").addEventListener("change", () => {
    delete manuals[card.dataset.id];
    refreshAct(card);
  });
  card.querySelector(".act-reroll").addEventListener("click", () => reroll(card));
  card.querySelector(".act-lock").addEventListener("click", () => lockCurrent(card).catch((err) => msg(err.message, "bad")));
  card.querySelector(".act-send").addEventListener("click", () => dispatch(card).catch((err) => msg(err.message, "bad")));
}

function bindObjectEvents(card) {
  for (const row of card.querySelectorAll(".object-row")) {
    if (row.dataset.bound) continue;
    row.dataset.bound = "1";
    row.querySelector(".remove-object").addEventListener("click", () => {
      if (card.querySelectorAll(".object-row").length <= 1) {
        msg("В фиксации должен остаться хотя бы один объект.", "bad");
        return;
      }
      row.remove();
      refreshAct(card);
    });
    for (const inp of row.querySelectorAll("input")) {
      inp.addEventListener("input", () => {
        delete manuals[card.dataset.id];
        refreshAct(card);
      });
    }
  }
}

function updateRemoveButtons() {
  const cards = document.querySelectorAll(".act-card");
  for (const c of cards) {
    c.querySelector(".remove-act").hidden = cards.length <= 1;
  }
}

function addAct(act = null) {
  const id = act?.id || "act" + Date.now();
  const newAct = act || {
    id,
    name: "Фиксация " + (document.querySelectorAll(".act-card").length + 1),
    subject: "Фиксация ТТР {date} — {name}",
    body: "Добрый день.\n\nНаправляю фиксацию технических и трудовых ресурсов на {date} ({name}).\n\n{objects}\n\nС уважением,\nРахматуллин Ренат",
    to: [],
    cc: [],
    objects: [{ number: "1", name: "Объект 1", ranges: { workers: { min: 13, max: 15 }, itr: { min: 4, max: 5 }, tech: { min: 4, max: 5 } } }],
  };
  const card = createActCard(newAct, true);
  $("acts").appendChild(card);
  bindAct(card);
  updateRemoveButtons();
  syncSummaryActOptions();
  refreshAct(card);
  return card;
}

async function saveSettings() {
  if (!token()) {
    msg("Сначала вставь токен GitHub и нажми «Запомнить токен».", "bad");
    $("token").focus();
    return;
  }
  const settings = readForm();
  if (settings.mail.enabled && settings.acts.some(a => !a.to.length)) {
    msg("Включена автоотправка, но у какой-то фиксации нет адресатов. Укажи их в карточке.", "bad");
    return false;
  }
  if (settings.mail.enabled && !settings.mail.from) {
    msg("Нужен ящик, с которого уходит письмо.", "bad");
    return false;
  }
  const password = $("password").value;
  if (settings.mail.enabled && secretKnown === false && !password) {
    msg("Для ежедневной отправки нужен пароль Mail.ru. В репозиторий он не попадёт.", "bad");
    return false;
  }
  msg("Сохраняю настройки…", "info");
  await putJson("data/ttr/settings.json", settings, "ttr: настройки");
  saved = settings;
  if (password) {
    const key = await gh("GET", `/repos/${REPO}/actions/secrets/public-key`);
    const sodium = (await import("https://cdn.jsdelivr.net/npm/libsodium-wrappers@0.7.15/+esm")).default;
    await sodium.ready;
    const sealed = sodium.crypto_box_seal(
      sodium.from_string(password),
      sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL),
    );
    await gh("PUT", `/repos/${REPO}/actions/secrets/TTR_MAIL_PASSWORD`, {
      encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
      key_id: key.key_id,
    });
    $("password").value = "";
    secretKnown = true;
  }
  $("secret-state").textContent = secretKnown
    ? "Пароль Mail.ru сохранён в секрете GitHub."
    : "Пароль в секрете пока не видно. Если ещё не вводил — введи и сохрани.";
  msg("Настройки на GitHub. Папка data/ttr.", "ok");
  return true;
}

async function lockCurrent(card) {
  if (!token()) {
    msg("Чтобы числа дожили до утренней отправки, нужен токен GitHub.", "bad");
    return;
  }
  const id = card.dataset.id;
  const iso = actDate(card);
  const n = shownFor(card);
  journal.acts[id] ||= { days: {} };
  const prev = journal.acts[id].days[iso] || {};
  if ((prev.status === "sent" || prev.status === "archive") && !confirm("На эту дату фиксация уже есть. Заменить закреплённые числа?")) return;
  journal.acts[id].days[iso] = {
    ...prev,
    workers: n.workers,
    itr: n.itr,
    tech: n.tech,
    sum: n.sum,
    locked: true,
    status: prev.status === "sent" || prev.status === "archive" ? prev.status : "locked",
    error: "",
  };
  msg("Записываю числа в журнал…", "info");
  await putJson("data/ttr/journal.json", journal, "ttr: числа " + isoToRu(iso) + " " + card.querySelector(".act-name").value);
  delete manuals[id];
  msg("Числа на " + isoToRu(iso) + " закреплены.", "ok");
  await refreshAct(card);
  renderLog();
}

function reroll(card) {
  const id = card.dataset.id;
  const ranges = {
    workers: { min: Number(card.querySelector(".w-min").value), max: Number(card.querySelector(".w-max").value) },
    itr: { min: Number(card.querySelector(".i-min").value), max: Number(card.querySelector(".i-max").value) },
    tech: { min: Number(card.querySelector(".t-min").value), max: Number(card.querySelector(".t-max").value) },
  };
  const pick = (pair) => {
    const span = pair.max - pair.min + 1;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return pair.min + (buf[0] % span);
  };
  let next = { iso: actDate(card), workers: pick(ranges.workers), itr: pick(ranges.itr), tech: pick(ranges.tech) };
  const cur = shownFor(card);
  if (next.workers === cur.workers && next.itr === cur.itr && next.tech === cur.tech && ranges.workers.max + ranges.itr.max + ranges.tech.max > ranges.workers.min + ranges.itr.min + ranges.tech.min) {
    if (ranges.workers.max > ranges.workers.min) next.workers = next.workers === ranges.workers.max ? ranges.workers.min : next.workers + 1;
  }
  manuals[id] = next;
  refreshAct(card);
}

async function dispatch(card) {
  if (!token()) {
    msg("Чтобы отправить, запомни токен GitHub. Само письмо уйдёт с Mail.ru через GitHub, не из браузера.", "bad");
    return;
  }
  const id = card.dataset.id;
  const iso = actDate(card);
  const jact = journal.acts?.[id] || { days: {} };
  const day = jact.days?.[iso];
  if (day?.status === "sent" && !confirm("Фиксация за " + isoToRu(iso) + " уже отправлена. Отправить ещё раз?")) return;
  if (dirty()) {
    const ok = await saveSettings();
    if (!ok) return;
  }
  if (manuals[id] && manuals[id].iso === iso) await lockCurrent(card);
  msg("Ставлю отправку в очередь…", "info");
  await gh("POST", `/repos/${REPO}/actions/workflows/ttr-daily.yml/dispatches`, {
    ref: "main",
    inputs: { mode: "now", date: iso, act: id },
  });
  msg("Очередь приняла " + isoToRu(iso) + ". Письмо собирается на сервере, страницу можно закрыть. Статус появится в журнале через минуту.", "ok");
  pollJournal(id, iso);
}

async function pollJournal(actId, iso) {
  const before = JSON.stringify(journal.acts?.[actId]?.days?.[iso] || null);
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const fresh = await loadJson("data/ttr/journal.json");
      const day = fresh.acts?.[actId]?.days?.[iso];
      if (day && JSON.stringify(day) !== before && (day.status === "sent" || day.status === "error")) {
        journal = ensureJournal(fresh);
        await refreshAll();
        msg(day.status === "sent" ? "Письмо ушло." : "Не отправилось: " + (day.error || ""), day.status === "sent" ? "ok" : "bad");
        return;
      }
    } catch {
      /* страница могла не успеть обновиться */
    }
  }
}

const summaryDates = new Set([todayISO()]);

function syncSummaryActOptions() {
  const sel = $("summary-act");
  if (!sel) return false;
  const prev = sel.value;
  const cards = [...document.querySelectorAll(".act-card")];
  sel.replaceChildren();
  for (const card of cards) {
    const opt = document.createElement("option");
    opt.value = card.dataset.id;
    opt.textContent = card.querySelector(".act-name").value.trim() || "Фиксация";
    sel.appendChild(opt);
  }
  sel.disabled = cards.length === 0;
  const still = cards.some((card) => card.dataset.id === prev);
  if (still) sel.value = prev;
  return still || cards.length === 0;
}

function renderSummaryDates() {
  const box = $("summary-dates");
  if (!box) return;
  if (!summaryDates.size) summaryDates.add(todayISO());
  box.replaceChildren();
  for (const iso of [...summaryDates].sort()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "on";
    btn.dataset.date = iso;
    btn.textContent = isoToRu(iso);
    btn.title = "Убрать дату";
    box.appendChild(btn);
  }
}

function summaryIsoList() {
  const list = [...summaryDates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return list.length ? list : [todayISO()];
}

function fillSummary() {
  const area = $("summary-text");
  if (!area) return;
  const settings = readForm();
  const id = $("summary-act").value;
  const act = settings.acts.find((a) => a.id === id) || settings.acts[0];
  area.value = act ? summaryText(act, summaryIsoList(), journal) : "";
}

function bindSummary() {
  const dateInput = $("summary-add-date");
  if (dateInput && !dateInput.value) dateInput.value = todayISO();
  renderSummaryDates();
  syncSummaryActOptions();
  fillSummary();
  $("summary-act").addEventListener("change", fillSummary);
  $("summary-add-btn").addEventListener("click", () => {
    const value = $("summary-add-date").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
      msg("Выбери дату для сводки.", "bad");
      return;
    }
    summaryDates.add(value);
    renderSummaryDates();
    fillSummary();
  });
  $("summary-dates").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-date]");
    if (!btn) return;
    summaryDates.delete(btn.dataset.date);
    if (!summaryDates.size) summaryDates.add(todayISO());
    renderSummaryDates();
    fillSummary();
  });
  $("summary-generate").addEventListener("click", () => {
    fillSummary();
    msg("Сводка собрана.", "ok");
  });
  $("summary-copy").addEventListener("click", async () => {
    fillSummary();
    const text = $("summary-text").value;
    try {
      await navigator.clipboard.writeText(text);
      msg("Текст сводки скопирован.", "ok");
    } catch {
      $("summary-text").focus();
      $("summary-text").select();
      msg("Выделил текст — скопируй его вручную.", "info");
    }
  });
  $("summary-send").addEventListener("click", () => sendSummary().catch((err) => msg(err.message, "bad")));
}

async function sendSummary() {
  if (!token()) {
    msg("Чтобы отправить сводку, запомни токен GitHub.", "bad");
    return;
  }
  syncSummaryActOptions();
  const actId = $("summary-act").value;
  if (!actId) {
    msg("Выбери фиксацию.", "bad");
    return;
  }
  const isos = summaryIsoList();
  fillSummary();
  if (dirty()) {
    const ok = await saveSettings();
    if (!ok) return;
  }
  msg("Ставлю сводку в очередь…", "info");
  await gh("POST", `/repos/${REPO}/actions/workflows/ttr-daily.yml/dispatches`, {
    ref: "main",
    inputs: { mode: "summary", date: isos.join(","), act: actId },
  });
  msg("Сводка за " + isos.map(isoToRu).join(", ") + " поставлена в очередь. Письмо уйдёт текстом, без PDF.", "ok");
}

async function checkSecret() {
  if (!token()) {
    secretKnown = null;
    $("token-sum").textContent = "Токен GitHub — нужен, чтобы запоминать настройки";
    $("secret-state").textContent = "";
    return;
  }
  $("token-sum").textContent = "Токен GitHub сохранён в браузере";
  try {
    const list = await gh("GET", `/repos/${REPO}/actions/secrets?per_page=100`);
    secretKnown = (list.secrets || []).some((s) => s.name === "TTR_MAIL_PASSWORD");
    $("secret-state").textContent = secretKnown
      ? "Пароль Mail.ru уже лежит в секрете GitHub."
      : "Секрета с паролем ещё нет. Введи пароль и сохрани.";
  } catch (err) {
    secretKnown = null;
    $("secret-state").textContent = err.status === 403
      ? "Токен не видит секреты. Нужно право Secrets — Read and write."
      : "Не удалось проверить секрет: " + err.message;
  }
}

async function init() {
  buildDays();
  $("token").value = token();
  const rawSettings = await loadJson("data/ttr/settings.json");
  saved = normalizeSettings(rawSettings);
  journal = ensureJournal(await loadJson("data/ttr/journal.json"));
  writeMail(saved);
  for (const act of saved.acts) addAct(act);
  if (!saved.acts.length) addAct();
  bindSummary();
  await checkSecret();
  await refreshAll();

  $("add-act").addEventListener("click", () => addAct());
  $("save").addEventListener("click", () => saveSettings().catch((err) => msg(err.message, "bad")));
  $("save-token").addEventListener("click", () => {
    const value = $("token").value.trim();
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    checkSecret().catch((err) => msg(err.message, "bad"));
    msg(value ? "Токен запомнен в этом браузере." : "Токен удалён из браузера.", "ok");
  });
  $("log").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-iso]");
    if (!btn) return;
    const iso = btn.dataset.iso;
    const actId = btn.dataset.act;
    const card = document.querySelector(`.act-card[data-id="${actId}"]`);
    if (card) {
      card.querySelector(".act-date").value = iso;
      delete manuals[actId];
      card.classList.add("open");
      refreshAct(card);
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty() || Object.keys(manuals).length) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

init().catch((err) => msg(err.message || String(err), "bad"));
