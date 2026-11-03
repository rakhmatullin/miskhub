import {
  addDays,
  ensureJournal,
  filenameFor,
  isoToRu,
  normalizeSettings,
  numbersFor,
  todayISO,
} from "./ttr-core.js";
import { createMakePdf } from "./ttr-pdf.js";

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
const makePdf = createMakePdf(globalThis.PDFLib, globalThis.fontkit);

let saved = null;
let journal = { acts: {} };
let manuals = {};
let templateBytes = null;
let fontBytes = null;
let pdfUrls = {};
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
    subject: $("subject").value,
    body: $("body").value,
  };
}

function readActs() {
  const cards = document.querySelectorAll(".act-card");
  return [...cards].map((card) => {
    const id = card.dataset.id;
    const name = card.querySelector(".act-name").value.trim() || "Фиксация";
    const ranges = {
      workers: { min: card.querySelector(".w-min").value, max: card.querySelector(".w-max").value },
      itr: { min: card.querySelector(".i-min").value, max: card.querySelector(".i-max").value },
      tech: { min: card.querySelector(".t-min").value, max: card.querySelector(".t-max").value },
    };
    const to = (card.querySelector(".act-to")?.value || "").split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const cc = (card.querySelector(".act-cc")?.value || "").split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    return { id, name, ranges, to, cc };
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
  $("subject").value = s.mail.subject;
  $("body").value = s.mail.body;
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

async function paint(card, bytes) {
  const canvas = card.querySelector(".act-canvas");
  const frame = card.querySelector(".act-frame");
  const id = card.dataset.id;
  if (pdfUrls[id]) URL.revokeObjectURL(pdfUrls[id]);
  pdfUrls[id] = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  try {
    const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const width = canvas.parentElement.clientWidth || 320;
    const viewport = page.getViewport({ scale: Math.min(1.7, width / base.width) });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    canvas.hidden = false;
    if (frame) frame.hidden = true;
  } catch (err) {
    console.warn(err);
    canvas.hidden = true;
    if (frame) {
      frame.hidden = false;
      frame.src = pdfUrls[id];
    }
  }
}

async function refreshAct(card) {
  const id = card.dataset.id;
  const iso = actDate(card);
  const numbers = shownFor(card);
  card.querySelector(".n-workers").textContent = numbers.workers;
  card.querySelector(".n-itr").textContent = numbers.itr;
  card.querySelector(".n-tech").textContent = numbers.tech;
  card.querySelector(".n-sum").textContent = numbers.sum;
  const name = card.querySelector(".act-name").value.trim();
  card.querySelector(".fname").textContent = filenameFor(iso, name);
  const jact = journal.acts?.[id] || { days: {} };
  const day = jact.days?.[iso];
  card.querySelector(".day-status").textContent = statusText({ ...day, id }, numbers, iso);
  if (!templateBytes || !fontBytes) return;
  const bytes = await makePdf(templateBytes, fontBytes, {
    dateLabel: "Дата: " + isoToRu(iso),
    workers: numbers.workers,
    itr: numbers.itr,
    tech: numbers.tech,
  });
  await paint(card, bytes);
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

function createActCard(act, open = true) {
  const card = document.createElement("div");
  card.className = "act-card" + (open ? " open" : "");
  card.dataset.id = act.id;
  card.innerHTML = `
    <div class="act-header">
      <span class="chevron">▸</span>
      <input class="act-name" value="${act.name.replace(/"/g, "&quot;")}" />
      <button type="button" class="remove-act" title="Удалить">×</button>
    </div>
    <div class="act-body">
      <label class="field">Дата фиксации
        <input class="act-date" type="date" value="${todayISO()}" />
      </label>
      <div class="nums">
        <div><b class="n-workers">—</b><span>рабочие</span></div>
        <div><b class="n-itr">—</b><span>ИТР</span></div>
        <div><b class="n-tech">—</b><span>техника</span></div>
        <div><b class="n-sum">—</b><span>итого</span></div>
      </div>
      <p class="hint day-status"></p>
      <p class="hint">В акте у плана стоит звёздочка, факт без неё. Сумма считается сама. Время в бланке остаётся 10:00.</p>
      <div class="row2">
        <label class="field">Рабочие от<input class="w-min" type="number" min="0" max="999" value="${act.ranges.workers.min}" /></label>
        <label class="field">Рабочие до<input class="w-max" type="number" min="0" max="999" value="${act.ranges.workers.max}" /></label>
        <label class="field">ИТР от<input class="i-min" type="number" min="0" max="999" value="${act.ranges.itr.min}" /></label>
        <label class="field">ИТР до<input class="i-max" type="number" min="0" max="999" value="${act.ranges.itr.max}" /></label>
        <label class="field">Техника от<input class="t-min" type="number" min="0" max="999" value="${act.ranges.tech.min}" /></label>
        <label class="field">Техника до<input class="t-max" type="number" min="0" max="999" value="${act.ranges.tech.max}" /></label>
      </div>
      <label class="field">Кому (адресаты этой фиксации, по одному в строке)
        <textarea class="act-to" placeholder="name@company.ru">${(act.to || []).join("\n")}</textarea>
      </label>
      <label class="field">Копия
        <textarea class="act-cc" placeholder="необязательно">${(act.cc || []).join("\n")}</textarea>
      </label>
      <div class="toolbar">
        <button type="button" class="primary act-download">Скачать PDF</button>
        <button type="button" class="act-reroll">Другие числа</button>
        <button type="button" class="act-lock">Зафиксировать</button>
        <button type="button" class="primary act-send">Отправить сейчас</button>
      </div>
      <p class="hint fname"></p>
      <div class="sheet-wrap">
        <canvas class="act-canvas"></canvas>
        <iframe class="act-frame" title="Предпросмотр" hidden></iframe>
      </div>
    </div>
  `;
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
    refreshAll();
  });
  card.querySelector(".act-name").addEventListener("input", () => refreshAct(card));
  card.querySelector(".act-date").addEventListener("change", () => {
    delete manuals[card.dataset.id];
    refreshAct(card);
  });
  for (const cls of [".w-min", ".w-max", ".i-min", ".i-max", ".t-min", ".t-max"]) {
    card.querySelector(cls).addEventListener("input", () => {
      delete manuals[card.dataset.id];
      refreshAct(card);
    });
  }
  card.querySelector(".act-download").addEventListener("click", () => download(card));
  card.querySelector(".act-reroll").addEventListener("click", () => reroll(card));
  card.querySelector(".act-lock").addEventListener("click", () => lockCurrent(card).catch((err) => msg(err.message, "bad")));
  card.querySelector(".act-send").addEventListener("click", () => dispatch(card).catch((err) => msg(err.message, "bad")));
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
    ranges: { workers: { min: 13, max: 15 }, itr: { min: 4, max: 5 }, tech: { min: 4, max: 5 } },
    to: [],
    cc: [],
  };
  const card = createActCard(newAct, true);
  $("acts").appendChild(card);
  bindAct(card);
  updateRemoveButtons();
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

function download(card) {
  const id = card.dataset.id;
  const url = pdfUrls[id];
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  const name = card.querySelector(".act-name").value.trim();
  link.download = filenameFor(actDate(card), name);
  link.click();
}

async function init() {
  buildDays();
  $("token").value = token();
  const rawSettings = await loadJson("data/ttr/settings.json");
  saved = normalizeSettings(rawSettings);
  journal = ensureJournal(await loadJson("data/ttr/journal.json"));
  writeMail(saved);
  for (const act of saved.acts) {
    addAct(act);
  }
  if (!saved.acts.length) addAct();
  templateBytes = await loadAsset("data/ttr/template.pdf");
  fontBytes = await loadAsset("data/ttr/LiberationSerif-Regular.ttf");
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
