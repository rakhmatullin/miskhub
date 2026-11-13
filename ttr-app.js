import {
  addDays,
  composeLetter,
  ensureJournal,
  filenameFor,
  fill,
  isoToRu,
  normalizeSettings,
  numbersFor,
  objectsLetterBlock,
  parseList,
  peoplePhrase,
  todayISO,
} from "./ttr-core.js?v=10";

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
    const number = row.querySelector(".obj-number").value.trim() || "1";
    const key = id + ":" + number;
    let numbers;
    if (manuals[key] && manuals[key].iso === iso) {
      const m = manuals[key];
      numbers = { ...m, sum: m.workers + m.itr + m.tech, locked: false };
    } else {
      const jact = journal.acts?.[id] || { days: {} };
      numbers = numbersFor(iso, ranges, jact, number);
    }
    return {
      number,
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
  const people = peoplePhrase(totalW + totalI + totalT);
  card.querySelector(".day-status").textContent = statusText({ ...day, id }, first, iso) + extra + " · суммарно " + people;
  const preview = card.querySelector(".letter-preview");
  if (preview) {
    const lines = objs.map((o) => ({
      number: o.number,
      name: o.name,
      workers: o.numbers.workers,
      itr: o.numbers.itr,
      tech: o.numbers.tech,
      sum: o.numbers.sum,
    }));
    const totals = { workers: totalW, itr: totalI, tech: totalT, sum: totalW + totalI + totalT };
    const name = card.querySelector(".act-name").value.trim();
    const ctx = {
      date: isoToRu(iso),
      name,
      workers: totalW,
      itr: totalI,
      tech: totalT,
      sum: totals.sum,
      objects: objectsLetterBlock(lines, totals),
      filename: filenameFor(iso, name),
    };
    const subject = fill(card.querySelector(".act-subject")?.value || "", ctx);
    const body = fill(card.querySelector(".act-body-text")?.value || "", ctx);
    preview.textContent = (subject ? subject + "\n\n" : "") + body;
  }
}

async function refreshAll() {
  for (const card of document.querySelectorAll(".act-card")) {
    await refreshAct(card);
  }
  renderLog();
  if ($("letter-text")) refreshLetter();
}

function esc(s) {
  const map = {};
  map["&"] = "&" + "amp;";
  map["<"] = "&" + "lt;";
  map[">"] = "&" + "gt;";
  map['"'] = "&" + "quot;";
  map["'"] = "&" + "#39;";
  return String(s ?? "").replace(/[&<>"']/g, (c) => map[c]);
}

function finiteTriple(src) {
  if (!src) return null;
  const workers = Math.round(Number(src.workers));
  const itr = Math.round(Number(src.itr));
  const tech = Math.round(Number(src.tech));
  if (![workers, itr, tech].every(Number.isFinite)) return null;
  return { workers, itr, tech, sum: workers + itr + tech };
}

function logLines(actId, iso, jact, card) {
  const day = jact.days?.[iso] || {};
  const locked = Boolean(day.locked) || day.status === "sent" || day.status === "archive" || day.status === "locked";
  if (locked && Array.isArray(day.objects) && day.objects.length) {
    return day.objects.map((o, i) => {
      const t = finiteTriple(o) || { workers: 0, itr: 0, tech: 0, sum: 0 };
      return { number: String(o.number || i + 1), name: String(o.name || "Объект"), ...t };
    });
  }
  if (locked) {
    const t = finiteTriple(day);
    if (t) {
      const actName = card ? card.querySelector(".act-name").value : actId;
      return [{ number: "сводно", name: actName, ...t }];
    }
  }
  const rows = card ? [...card.querySelectorAll(".object-row")] : [];
  if (!rows.length) {
    const n = numbersFor(iso, { workers: { min: 13, max: 15 }, itr: { min: 4, max: 5 }, tech: { min: 4, max: 5 } }, jact);
    return [{ number: "1", name: actId, workers: n.workers, itr: n.itr, tech: n.tech, sum: n.sum }];
  }
  return rows.map((row) => {
    const ranges = {
      workers: { min: Number(row.querySelector(".w-min").value), max: Number(row.querySelector(".w-max").value) },
      itr: { min: Number(row.querySelector(".i-min").value), max: Number(row.querySelector(".i-max").value) },
      tech: { min: Number(row.querySelector(".t-min").value), max: Number(row.querySelector(".t-max").value) },
    };
    const number = row.querySelector(".obj-number").value.trim() || "1";
    const key = actId + ":" + number;
    let n;
    if (manuals[key] && manuals[key].iso === iso) {
      const m = manuals[key];
      n = { workers: m.workers, itr: m.itr, tech: m.tech, sum: m.workers + m.itr + m.tech };
    } else {
      n = numbersFor(iso, ranges, jact);
    }
    return {
      number,
      name: row.querySelector(".obj-name").value.trim() || "Объект",
      workers: n.workers,
      itr: n.itr,
      tech: n.tech,
      sum: n.workers + n.itr + n.tech,
    };
  });
}

function renderLog() {
  const rows = [];
  const today = todayISO();
  for (const [actId, jact] of Object.entries(journal.acts || {})) {
    const keys = new Set(Object.keys(jact.days || {}));
    for (let i = -1; i <= 3; i++) keys.add(addDays(today, i));
    const card = document.querySelector(`.act-card[data-id="${actId}"]`);
    const actName = card ? card.querySelector(".act-name").value : actId;
    for (const iso of [...keys].sort().reverse()) {
      const day = jact.days?.[iso] || {};
      const lines = logLines(actId, iso, jact, card);
      const totals = lines.reduce(
        (a, l) => ({ workers: a.workers + l.workers, itr: a.itr + l.itr, tech: a.tech + l.tech, sum: a.sum + l.sum }),
        { workers: 0, itr: 0, tech: 0, sum: 0 },
      );
      const label = day.status === "sent" ? "отправлен" : day.status === "archive" ? "исходный" : day.status === "error" ? "ошибка" : day.locked || day.status === "locked" ? "ждут" : iso > today ? "план" : "не отправлялся";
      rows.push(`<tr class="log-day"><td>${esc(actName)}</td><td><button type="button" class="act-dl" data-iso="${iso}" data-act="${esc(actId)}">${isoToRu(iso)}</button></td><td>${totals.workers}</td><td>${totals.itr}</td><td>${totals.tech}</td><td>${totals.sum}</td><td>${label}</td></tr>`);
      for (const line of lines) {
        rows.push(`<tr class="log-sub"><td colspan="2"><span class="log-num">${esc(line.number)}</span> <span class="log-name">${esc(line.name)}</span></td><td>${line.workers}</td><td>${line.itr}</td><td>${line.tech}</td><td>${line.sum}</td><td></td></tr>`);
      }
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
        <label class="field" style="margin:0;flex:1">Название<input class="obj-name" type="text" value="${(o.name || "").replace(/"/g, "&" + "quot;")}" /></label>
        <button type="button" class="remove-object" title="Удалить объект" style="align-self:flex-end">×</button>
      </div>
      <div class="obj-nums" style="display:flex;gap:12px;font-size:13px;color:var(--mute);margin-top:6px">
        <span>Раб. <b class="on-w">—</b></span>
        <span>ИТР <b class="on-i">—</b></span>
        <span>Тех. <b class="on-t">—</b></span>
        <span>Σ <b class="on-s">—</b></span>
      </div>
      <details class="fold obj-settings">
        <summary>Настройки объекта</summary>
        <div class="row2">
          <label class="field">Рабочие от<input class="w-min" type="number" min="0" max="999" value="${o.ranges.workers.min}" /></label>
          <label class="field">Рабочие до<input class="w-max" type="number" min="0" max="999" value="${o.ranges.workers.max}" /></label>
          <label class="field">ИТР от<input class="i-min" type="number" min="0" max="999" value="${o.ranges.itr.min}" /></label>
          <label class="field">ИТР до<input class="i-max" type="number" min="0" max="999" value="${o.ranges.itr.max}" /></label>
          <label class="field">Техника от<input class="t-min" type="number" min="0" max="999" value="${o.ranges.tech.min}" /></label>
          <label class="field">Техника до<input class="t-max" type="number" min="0" max="999" value="${o.ranges.tech.max}" /></label>
        </div>
      </details>
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
      <input class="act-name" value="${(act.name || "").replace(/"/g, "&" + "quot;")}" />
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
      <details class="fold">
        <summary>Шаблон ежедневного письма</summary>
        <label class="field">Тема
          <input class="act-subject" type="text" value="${(act.subject || "Фиксация ТТР {date} — {name}").replace(/"/g, "&" + "quot;")}" />
        </label>
        <label class="field">Текст
          <textarea class="act-body-text"></textarea>
        </label>
        <p class="hint">Переменные: <code>{date}</code> <code>{name}</code> <code>{objects}</code> <code>{sum}</code> <code>{workers}</code> <code>{itr}</code> <code>{tech}</code>. В <code>{objects}</code> на это число есть итог по объекту и суммарно за день.</p>
        <p class="hint">Как уйдёт это число</p>
        <div class="letter-preview"></div>
      </details>
      <div class="toolbar">
        <button type="button" class="act-reroll">Другие числа</button>
        <button type="button" class="act-lock">Зафиксировать</button>
        <button type="button" class="act-draft">В черновик</button>
        <button type="button" class="primary act-send">Отправить сейчас</button>
      </div>
      <p class="hint">«Отправить сейчас» — это число адресатам фиксации. «В черновик» — поправить текст или собрать несколько дат.</p>
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
    syncLetterActs();
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
  card.querySelector(".act-name").addEventListener("input", () => { syncLetterActs(); refreshAct(card); });
  card.querySelector(".act-date").addEventListener("change", () => {
    delete manuals[card.dataset.id];
    refreshAct(card);
  });
  card.querySelector(".act-reroll").addEventListener("click", () => reroll(card));
  card.querySelector(".act-lock").addEventListener("click", () => lockCurrent(card).catch((err) => msg(err.message, "bad")));
  card.querySelector(".act-draft").addEventListener("click", () => primeDraft(card));
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
  syncLetterActs();
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

const letterDates = new Set([todayISO()]);
let letterDirty = false;
let recipientsTouched = false;

function syncLetterActs() {
  const box = $("letter-acts");
  if (!box) return;
  const prevIds = new Set([...box.querySelectorAll("input")].map((el) => el.value));
  const prevOn = new Set([...box.querySelectorAll("input:checked")].map((el) => el.value));
  const cards = [...document.querySelectorAll(".act-card")];
  box.replaceChildren();
  for (const card of cards) {
    const id = card.dataset.id;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = id;
    input.checked = prevIds.size ? prevOn.has(id) || !prevIds.has(id) : true;
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = card.querySelector(".act-name").value.trim() || "Фиксация";
    label.append(input, span);
    box.appendChild(label);
  }
  if (box.querySelector("input") && ![...box.querySelectorAll("input")].some((el) => el.checked)) {
    box.querySelector("input").checked = true;
  }
}

function renderLetterDates() {
  const box = $("letter-dates");
  if (!box) return;
  box.replaceChildren();
  if (!letterDates.size) {
    const note = document.createElement("p");
    note.className = "hint dates-empty";
    note.textContent = "Дат нет. Выбери нужные отдельно.";
    box.appendChild(note);
  } else {
    for (const iso of [...letterDates].sort()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "on";
      btn.dataset.date = iso;
      btn.textContent = isoToRu(iso) + " ×";
      btn.title = "Убрать это число";
      box.appendChild(btn);
    }
  }
  syncPresetHighlight();
}

function syncPresetHighlight() {
  const isos = letterIsoList();
  const today = todayISO();
  const one = {
    today,
    yesterday: addDays(today, -1),
    tomorrow: addDays(today, 1),
    after: addDays(today, 2),
  };
  for (const btn of document.querySelectorAll("#letter-presets [data-preset]")) {
    const hit = isos.length === 1 && isos[0] === one[btn.dataset.preset];
    btn.classList.toggle("on", hit);
    btn.setAttribute("aria-pressed", hit ? "true" : "false");
  }
}

function letterIsoList() {
  return [...letterDates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

function selectedLetterActs() {
  const ids = new Set([...document.querySelectorAll("#letter-acts input:checked")].map((el) => el.value));
  const acts = readForm().acts;
  const chosen = acts.filter((a) => ids.has(a.id));
  return chosen.length ? chosen : acts.slice(0, 1);
}

function letterShape() {
  return "detail";
}

function rangeDays(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  let a = from;
  let b = to;
  if (a > b) [a, b] = [b, a];
  const out = [];
  let cur = a;
  for (let i = 0; i < 62 && cur <= b; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function presetDates(kind) {
  const today = todayISO();
  if (kind === "today") return [today];
  if (kind === "yesterday") return [addDays(today, -1)];
  if (kind === "tomorrow") return [addDays(today, 1)];
  if (kind === "after") return [addDays(today, 2)];
  return [];
}

function setLetterDates(list, add) {
  if (!add) letterDates.clear();
  for (const iso of list) if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) letterDates.add(iso);
  renderLetterDates();
  refreshLetter();
}

function buildLetter() {
  const isos = letterIsoList();
  if (!isos.length) return { subject: "", text: "", grand: 0, days: [] };
  return composeLetter({
    acts: selectedLetterActs(),
    isos: letterIsoList(),
    journal,
    shape: letterShape(),
    signName: $("from-name")?.value.trim() || "Рахматуллин Ренат",
  });
}

function fillRecipientsFromActs(force) {
  if (recipientsTouched && !force) return;
  const acts = selectedLetterActs();
  const to = [...new Set(acts.flatMap((a) => a.to || []))];
  const cc = [...new Set(acts.flatMap((a) => a.cc || []))];
  if ($("letter-to")) $("letter-to").value = to.join("\n");
  if ($("letter-cc")) $("letter-cc").value = cc.join("\n");
}

function showLetterMeta(built) {
  const el = $("letter-meta");
  if (!el || !built) return;
  if (!built.days.length) {
    el.textContent = "Дат нет. Выбери нужные отдельно.";
    return;
  }
  const manyActs = new Set(built.days.map((d) => d.actId)).size > 1;
  const parts = built.days.map((d) => `${manyActs ? d.actName + " " : ""}${isoToRu(d.iso)} — ${peoplePhrase(d.people)}`);
  const extra = built.days.length > 1 ? ". Всего " + peoplePhrase(built.grand) : "";
  el.textContent = parts.join(" · ") + extra;
}

function refreshLetter(force) {
  if (!$("letter-text")) return null;
  const built = buildLetter();
  showLetterMeta(built);
  fillRecipientsFromActs(false);
  if (letterDirty && !force) {
    $("letter-dirty").hidden = false;
    return built;
  }
  $("letter-subject").value = built.subject;
  $("letter-text").value = built.text;
  letterDirty = false;
  if ($("letter-dirty")) $("letter-dirty").hidden = true;
  return built;
}

function primeDraft(card) {
  const iso = actDate(card);
  letterDates.clear();
  letterDates.add(iso);
  renderLetterDates();
  for (const input of document.querySelectorAll("#letter-acts input")) input.checked = input.value === card.dataset.id;
  recipientsTouched = false;
  letterDirty = false;
  fillRecipientsFromActs(true);
  refreshLetter(true);
  $("letter-compose")?.scrollIntoView({ behavior: "smooth", block: "start" });
  msg("Это число собрано в черновик. Текст можно поправить — уйдёт именно он.", "ok");
}

function ensureLetterText() {
  if (!$("letter-text").value.trim()) refreshLetter(true);
}

async function copyLetter() {
  ensureLetterText();
  const text = $("letter-text").value;
  try {
    await navigator.clipboard.writeText(text);
    msg("Текст письма скопирован.", "ok");
  } catch {
    $("letter-text").focus();
    $("letter-text").select();
    msg("Выделил текст — скопируй его вручную.", "info");
  }
}

function openLetterMail() {
  ensureLetterText();
  const to = parseList($("letter-to").value);
  const cc = parseList($("letter-cc").value);
  const subject = $("letter-subject").value.trim() || "Численность";
  const body = $("letter-text").value;
  if (!to.length) {
    msg("Укажи, кому открыть письмо.", "bad");
    $("letter-to").focus();
    return;
  }
  const q = new URLSearchParams();
  if (cc.length) q.set("cc", cc.join(","));
  q.set("subject", subject);
  const withBody = new URLSearchParams(q);
  withBody.set("body", body);
  const full = `mailto:${to.join(",")}?${withBody.toString()}`;
  if (full.length > 1800) {
    navigator.clipboard.writeText(body).catch(() => {});
    window.location.href = `mailto:${to.join(",")}?${q.toString()}`;
    msg("Текст длинный для окна почты — скопировал его. Вставь в письмо.", "info");
    return;
  }
  window.location.href = full;
}

async function sendLetter() {
  if (!token()) {
    msg("Чтобы отправить с рабочей почты, запомни токен GitHub. Или открой письмо в своей почте.", "bad");
    return;
  }
  ensureLetterText();
  const subject = $("letter-subject").value.trim();
  const text = $("letter-text").value;
  const to = parseList($("letter-to").value);
  const cc = parseList($("letter-cc").value);
  if (!subject || !text.trim()) {
    msg("В черновике нет темы или текста.", "bad");
    return;
  }
  if (!to.length) {
    msg("Укажи адресатов этого письма.", "bad");
    $("letter-to").focus();
    return;
  }
  if (!confirm("Отправить письмо «" + subject + "» на " + to.join(", ") + "?")) return;
  msg("Записываю черновик и ставлю отправку…", "info");
  await putJson("data/ttr/outbox.json", {
    subject,
    text,
    to,
    cc,
    createdAt: new Date().toISOString(),
  }, "ttr: черновик письма");
  await gh("POST", `/repos/${REPO}/actions/workflows/ttr-daily.yml/dispatches`, {
    ref: "main",
    inputs: { mode: "letter", date: letterIsoList().join(","), act: selectedLetterActs()[0]?.id || "" },
  });
  msg("Письмо поставлено в очередь. Уйдёт текст черновика, как он сейчас на экране.", "ok");
}

function bindLetter() {
  const from = $("letter-from");
  const to = $("letter-to-date");
  const today = todayISO();
  if (from && !from.value) from.value = today;
  if (to && !to.value) to.value = today;
  renderLetterDates();
  syncLetterActs();
  refreshLetter(true);
  $("letter-acts").addEventListener("change", () => {
    fillRecipientsFromActs(false);
    refreshLetter(false);
  });
  $("letter-presets").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-preset]");
    if (!btn) return;
    setLetterDates(presetDates(btn.dataset.preset), false);
  });
  $("letter-dates").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-date]");
    if (!btn) return;
    letterDates.delete(btn.dataset.date);
    renderLetterDates();
    refreshLetter(false);
  });
  $("letter-add-range").addEventListener("click", () => {
    const days = rangeDays($("letter-from").value, $("letter-to-date").value);
    if (!days.length) {
      msg("Укажи период: дата «с» и дата «по».", "bad");
      return;
    }
    setLetterDates(days, true);
  });
  $("letter-add-one").addEventListener("click", () => {
    const value = $("letter-from").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
      msg("Выбери дату в поле «с».", "bad");
      return;
    }
    setLetterDates([value], true);
  });
  $("letter-clear-dates").addEventListener("click", () => setLetterDates([], false));
  const markDirty = () => {
    letterDirty = true;
    if ($("letter-dirty")) $("letter-dirty").hidden = false;
  };
  $("letter-subject").addEventListener("input", markDirty);
  $("letter-text").addEventListener("input", markDirty);
  $("letter-to").addEventListener("input", () => { recipientsTouched = true; });
  $("letter-cc").addEventListener("input", () => { recipientsTouched = true; });
  $("letter-use-acts").addEventListener("click", () => {
    fillRecipientsFromActs(true);
    recipientsTouched = true;
    msg("Адресаты подставлены из выбранных фиксаций.", "ok");
  });
  $("letter-build").addEventListener("click", () => {
    refreshLetter(true);
    msg("Черновик собран заново. На каждое число написано, сколько человек суммарно.", "ok");
  });
  $("letter-copy").addEventListener("click", () => copyLetter().catch((err) => msg(err.message, "bad")));
  $("letter-mailto").addEventListener("click", openLetterMail);
  $("letter-send").addEventListener("click", () => sendLetter().catch((err) => msg(err.message, "bad")));
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
  bindLetter();
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
