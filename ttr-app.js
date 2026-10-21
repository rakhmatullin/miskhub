import {
  addDays,
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
let journal = { days: {} };
let manual = null;
let templateBytes = null;
let fontBytes = null;
let pdfUrl = "";
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

function readRanges() {
  return normalizeSettings({
    ranges: {
      workers: { min: $("w-min").value, max: $("w-max").value },
      itr: { min: $("i-min").value, max: $("i-max").value },
      tech: { min: $("t-min").value, max: $("t-max").value },
    },
  }).ranges;
}

function selectedDays() {
  return [...document.querySelectorAll("#days button.on")].map((b) => Number(b.dataset.d));
}

function readForm() {
  const ranges = readRanges();
  return normalizeSettings({
    ranges,
    mail: {
      enabled: $("enabled").checked,
      from: $("from").value,
      fromName: $("from-name").value,
      smtpHost: $("smtp").value,
      smtpPort: $("port").value,
      sendTime: $("send-time").value,
      weekdays: selectedDays(),
      to: $("to").value,
      cc: $("cc").value,
      subject: $("subject").value,
      body: $("body").value,
    },
  });
}

function writeForm(settings) {
  const s = normalizeSettings(settings);
  $("w-min").value = s.ranges.workers.min;
  $("w-max").value = s.ranges.workers.max;
  $("i-min").value = s.ranges.itr.min;
  $("i-max").value = s.ranges.itr.max;
  $("t-min").value = s.ranges.tech.min;
  $("t-max").value = s.ranges.tech.max;
  $("enabled").checked = s.mail.enabled;
  $("from").value = s.mail.from;
  $("from-name").value = s.mail.fromName;
  $("smtp").value = s.mail.smtpHost;
  $("port").value = s.mail.smtpPort;
  $("send-time").value = s.mail.sendTime;
  $("to").value = s.mail.to.join("\n");
  $("cc").value = s.mail.cc.join("\n");
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

function dateVal() {
  return $("date").value || todayISO();
}

function shown() {
  const iso = dateVal();
  if (manual && manual.iso === iso) {
    const sum = manual.workers + manual.itr + manual.tech;
    return { ...manual, sum, locked: false, status: "draft", note: "" };
  }
  return numbersFor(iso, readRanges(), journal);
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

function statusText(day, numbers) {
  if (manual && manual.iso === dateVal()) return "Эти числа ещё не в журнале. Нажми «Зафиксировать», иначе утром уйдут другие.";
  if (!numbers.locked) return "Числа посчитаны из диапазонов. В момент отправки они запишутся и больше не изменятся.";
  if (day?.status === "sent") return "Отправлен " + (day.sentAt ? new Date(day.sentAt).toLocaleString("ru-RU") : "") + (day.to ? " → " + day.to.join(", ") : "");
  if (day?.status === "archive") return "Исходный акт, уже был. Сам повторно не уйдёт.";
  if (day?.status === "error") return "Не отправился: " + (day.error || "ошибка");
  if (day?.status === "locked") return "Числа зафиксированы. Письмо уйдёт в заданное время.";
  return "Дата зафиксирована.";
}

async function paint(bytes) {
  const canvas = $("sheet");
  const frame = $("frame");
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
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
    frame.hidden = true;
  } catch (err) {
    console.warn(err);
    canvas.hidden = true;
    frame.hidden = false;
    frame.src = pdfUrl;
  }
}

async function refreshPdf() {
  const iso = dateVal();
  const numbers = shown();
  $("n-workers").textContent = numbers.workers;
  $("n-itr").textContent = numbers.itr;
  $("n-tech").textContent = numbers.tech;
  $("n-sum").textContent = numbers.sum;
  $("fname").textContent = filenameFor(iso);
  const day = journal.days?.[iso];
  $("day-status").textContent = statusText(day, numbers);
  if (!templateBytes || !fontBytes) return;
  const bytes = await makePdf(templateBytes, fontBytes, {
    dateLabel: "Дата: " + isoToRu(iso),
    workers: numbers.workers,
    itr: numbers.itr,
    tech: numbers.tech,
  });
  await paint(bytes);
  renderLog();
}

function renderLog() {
  const keys = new Set(Object.keys(journal.days || {}));
  const today = todayISO();
  for (let i = -3; i <= 4; i++) keys.add(addDays(today, i));
  const rows = [...keys].sort().reverse();
  const head = "<tr><th>Дата</th><th>Раб.</th><th>ИТР</th><th>Тех.</th><th>Σ</th><th>Статус</th></tr>";
  const body = rows
    .map((iso) => {
      const nBase = numbersFor(iso, readRanges(), journal);
      const n = manual && manual.iso === iso
        ? { ...manual, sum: manual.workers + manual.itr + manual.tech }
        : nBase;
      const day = journal.days?.[iso] || {};
      const label = day.status === "sent" ? "отправлен" : day.status === "archive" ? "исходный" : day.status === "error" ? "ошибка" : day.status === "locked" || n.locked ? "ждут" : iso > today ? "план" : "не отправлялся";
      return `<tr><td><button type="button" class="act-dl" data-iso="${iso}">${isoToRu(iso)}</button></td><td>${n.workers}</td><td>${n.itr}</td><td>${n.tech}</td><td>${n.sum}</td><td>${label}</td></tr>`;
    })
    .join("");
  $("log").innerHTML = head + body;
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

async function saveSettings() {
  if (!token()) {
    msg("Сначала вставь токен GitHub и нажми «Запомнить токен».", "bad");
    $("token").focus();
    return;
  }
  const settings = readForm();
  if (settings.mail.enabled && !settings.mail.to.length) {
    msg("Включил отправку, но не указал, кому писать.", "bad");
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

async function lockCurrent() {
  if (!token()) {
    msg("Чтобы числа дожили до утренней отправки, нужен токен GitHub.", "bad");
    return;
  }
  const iso = dateVal();
  const n = shown();
  const prev = journal.days[iso] || {};
  if ((prev.status === "sent" || prev.status === "archive") && !confirm("На эту дату акт уже есть. Заменить закреплённые числа?")) return;
  journal.days[iso] = {
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
  await putJson("data/ttr/journal.json", journal, "ttr: числа " + isoToRu(iso));
  manual = null;
  msg("Числа на " + isoToRu(iso) + " закреплены.", "ok");
  await refreshPdf();
}

function reroll() {
  const ranges = readRanges();
  const pick = (pair) => {
    const span = pair.max - pair.min + 1;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return pair.min + (buf[0] % span);
  };
  let next = { iso: dateVal(), workers: pick(ranges.workers), itr: pick(ranges.itr), tech: pick(ranges.tech) };
  const cur = shown();
  if (next.workers === cur.workers && next.itr === cur.itr && next.tech === cur.tech && ranges.workers.max + ranges.itr.max + ranges.tech.max > ranges.workers.min + ranges.itr.min + ranges.tech.min) {
    if (ranges.workers.max > ranges.workers.min) next.workers = next.workers === ranges.workers.max ? ranges.workers.min : next.workers + 1;
  }
  manual = next;
  refreshPdf();
}

async function dispatch(mode) {
  if (!token()) {
    msg("Чтобы отправить, запомни токен GitHub. Само письмо уйдёт с Mail.ru через GitHub, не из браузера.", "bad");
    return;
  }
  const iso = dateVal();
  const day = journal.days[iso];
  if (mode === "resend" && !confirm("Отправить акт за " + isoToRu(iso) + " ещё раз?")) return;
  if (dirty()) {
    const ok = await saveSettings();
    if (!ok) return;
  }
  if (manual && manual.iso === iso) await lockCurrent();
  msg("Ставлю отправку в очередь…", "info");
  await gh("POST", `/repos/${REPO}/actions/workflows/ttr-daily.yml/dispatches`, {
    ref: "main",
    inputs: { mode, date: iso },
  });
  msg("Очередь приняла " + isoToRu(iso) + ". Письмо собирается на сервере, страницу можно закрыть. Статус появится в журнале через минуту.", "ok");
  pollJournal(iso);
}

async function pollJournal(iso) {
  const before = JSON.stringify(journal.days?.[iso] || null);
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const fresh = await loadJson("data/ttr/journal.json");
      const day = fresh.days?.[iso];
      if (day && JSON.stringify(day) !== before && (day.status === "sent" || day.status === "error")) {
        journal = fresh;
        await refreshPdf();
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

async function download() {
  if (!pdfUrl) return;
  const link = document.createElement("a");
  link.href = pdfUrl;
  link.download = filenameFor(dateVal());
  link.click();
}

async function init() {
  buildDays();
  $("date").value = todayISO();
  $("token").value = token();
  saved = normalizeSettings(await loadJson("data/ttr/settings.json"));
  journal = await loadJson("data/ttr/journal.json");
  journal.days ||= {};
  writeForm(saved);
  templateBytes = await loadAsset("data/ttr/template.pdf");
  fontBytes = await loadAsset("data/ttr/LiberationSerif-Regular.ttf");
  await checkSecret();
  await refreshPdf();

  for (const id of ["w-min", "w-max", "i-min", "i-max", "t-min", "t-max"]) {
    $(id).addEventListener("input", () => {
      manual = null;
      refreshPdf();
    });
  }
  $("date").addEventListener("change", () => {
    manual = null;
    refreshPdf();
  });
  $("download").addEventListener("click", download);
  $("reroll").addEventListener("click", reroll);
  $("lock").addEventListener("click", () => lockCurrent().catch((err) => msg(err.message, "bad")));
  $("save").addEventListener("click", () => saveSettings().catch((err) => msg(err.message, "bad")));
  $("send").addEventListener("click", () => dispatch("now").catch((err) => msg(err.message, "bad")));
  $("resend").addEventListener("click", () => dispatch("resend").catch((err) => msg(err.message, "bad")));
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
    $("date").value = btn.dataset.iso;
    manual = null;
    refreshPdf();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty() || manual) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

init().catch((err) => msg(err.message || String(err), "bad"));
