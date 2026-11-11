import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import {
  ensureJournal,
  filenameFor,
  fill,
  isoToRu,
  minutesOf,
  moscowMinutesNow,
  normalizeSettings,
  numbersFor,
  summaryText,
  todayISO,
  weekdayIndex,
} from "../../ttr-core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settingsPath = path.join(root, "data/ttr/settings.json");
const journalPath = path.join(root, "data/ttr/journal.json");
const WEEK = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJournal(journal) {
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n");
}

function plainText(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

const mode = String(process.env.TTR_MODE || "auto").trim() || "auto";
const dry = process.env.TTR_DRY === "1";
const dateEnv = String(process.env.TTR_DATE || "");
const actEnv = String(process.env.TTR_ACT || "");
const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateEnv) ? dateEnv : todayISO();
const settings = normalizeSettings(readJson(settingsPath, {}));
let journal = ensureJournal(readJson(journalPath, {}));

function finish(message) {
  console.log(message);
  process.exit(0);
}

if (mode === "summary") {
  const act = settings.acts.find((a) => a.id === actEnv) || settings.acts[0];
  if (!act) finish("skip: фиксация не найдена");
  const isos = dateEnv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    .sort();
  if (!isos.length) finish("skip: нет дат для сводки");

  const text = summaryText(act, isos, journal);
  const toList = act.to && act.to.length ? act.to : settings.mail.to;
  const ccList = act.cc && act.cc.length ? act.cc : settings.mail.cc;
  if (!toList.length) finish("skip: нет адресатов");
  if (!settings.mail.from) finish("skip: нет отправителя");
  const password = process.env.TTR_MAIL_PASSWORD || "";
  if (!password && !dry) finish("skip: нет пароля");

  const from = settings.mail.fromName
    ? `"${settings.mail.fromName.replace(/"/g, "")}" <${settings.mail.from}>`
    : settings.mail.from;
  const subject = `Численность по объекту «${act.name || "объекту"}» (${isos.map(isoToRu).join(", ")})`;

  if (dry) {
    console.log(JSON.stringify({ mode: "summary", act: act.id, isos, subject, text }));
    finish("summary dry");
  }

  try {
    const transport = nodemailer.createTransport({
      host: settings.mail.smtpHost,
      port: settings.mail.smtpPort,
      secure: settings.mail.smtpPort === 465,
      requireTLS: settings.mail.smtpPort === 587,
      auth: { user: settings.mail.from, pass: password },
    });
    const info = await transport.sendMail({
      from,
      to: toList.join(", "),
      cc: ccList.length ? ccList.join(", ") : undefined,
      subject,
      text,
    });
    console.log(`summary sent ${isos.join(",")} ${act.id} -> ${toList.join(", ")} id=${info.messageId || ""}`);
  } catch (err) {
    console.error("summary error:", err && err.message ? err.message : String(err));
    process.exit(1);
  }
  finish("summary done");
}

async function sendOne(act, dayIso) {
  const jact = (journal.acts[act.id] ||= { days: {} });
  const day = jact.days[dayIso] || {};
  const objects = act.objects || [{ number: "1", name: act.name, ranges: act.ranges || {} }];
  const objResults = objects.map((obj) => ({
    ...obj,
    numbers: numbersFor(dayIso, obj.ranges, jact),
  }));
  const total = objResults.reduce(
    (a, o) => ({
      workers: a.workers + o.numbers.workers,
      itr: a.itr + o.numbers.itr,
      tech: a.tech + o.numbers.tech,
      sum: a.sum + o.numbers.sum,
    }),
    { workers: 0, itr: 0, tech: 0, sum: 0 },
  );
  const objectsText = objResults
    .map(
      (o) =>
        `${o.number}. ${o.name}: рабочие — ${o.numbers.workers}, ИТР — ${o.numbers.itr}, техника — ${o.numbers.tech} (итого ${o.numbers.sum})`,
    )
    .join("\n");
  const ctx = {
    date: isoToRu(dayIso),
    name: act.name,
    workers: total.workers,
    itr: total.itr,
    tech: total.tech,
    sum: total.sum,
    objects: objectsText,
    filename: filenameFor(dayIso, act.name),
  };
  const filename = filenameFor(dayIso, act.name);

  if (dry) {
    console.log(JSON.stringify({ iso: dayIso, act: act.id, total, filename, subject: fill(act.subject || settings.mail.subject, ctx), text: plainText(fill(act.body || settings.mail.body, ctx)) }));
    return;
  }

  const already = day.status === "sent" || day.status === "archive";
  if (already && mode !== "now") {
    console.log(`skip ${dayIso} ${act.id}: уже ${day.status}`);
    return;
  }

  if (mode === "auto") {
    if (!settings.mail.enabled) {
      console.log("skip: автоотправка выключена");
      return;
    }
    const wd = weekdayIndex(dayIso);
    if (!settings.mail.weekdays.includes(wd)) {
      console.log(`skip ${dayIso}: ${WEEK[wd]} не в расписании`);
      return;
    }
    if (moscowMinutesNow() < minutesOf(settings.mail.sendTime)) {
      console.log(`skip: ещё рано, отправка с ${settings.mail.sendTime} МСК`);
      return;
    }
    if (day.status === "error" && (day.attempts || 0) >= 4) {
      console.log("skip: четыре неудачные попытки, нужно поправить настройки");
      return;
    }
  }

  const toList = act.to && act.to.length ? act.to : settings.mail.to;
  const ccList = act.cc && act.cc.length ? act.cc : settings.mail.cc;
  if (!toList.length) {
    dayFail(act, dayIso, total, filename, "Нет адресатов для этой фиксации. Укажи их в карточке и сохрани.");
    return;
  }
  if (!settings.mail.from) {
    dayFail(act, dayIso, total, filename, "Не указана почта отправителя.");
    return;
  }
  const password = process.env.TTR_MAIL_PASSWORD || "";
  if (!password) {
    dayFail(act, dayIso, total, filename, "Нет секрета TTR_MAIL_PASSWORD. Впиши пароль Mail.ru на странице и сохрани — в репозиторий он не попадает.");
    return;
  }

  const from = settings.mail.fromName
    ? `"${settings.mail.fromName.replace(/"/g, "")}" <${settings.mail.from}>`
    : settings.mail.from;
  const subject = fill(act.subject || settings.mail.subject, ctx);
  const text = plainText(fill(act.body || settings.mail.body, ctx));

  try {
    const transport = nodemailer.createTransport({
      host: settings.mail.smtpHost,
      port: settings.mail.smtpPort,
      secure: settings.mail.smtpPort === 465,
      requireTLS: settings.mail.smtpPort === 587,
      auth: { user: settings.mail.from, pass: password },
    });
    const info = await transport.sendMail({
      from,
      to: toList.join(", "),
      cc: ccList.length ? ccList.join(", ") : undefined,
      subject,
      text,
    });
    jact.days[dayIso] = {
      objects: objResults.map((o) => ({ number: o.number, name: o.name, ...o.numbers })),
      workers: total.workers,
      itr: total.itr,
      tech: total.tech,
      sum: total.sum,
      locked: true,
      status: "sent",
      sentAt: new Date().toISOString(),
      to: toList,
      cc: ccList,
      filename,
      messageId: info.messageId || "",
      error: "",
      attempts: (day.attempts || 0) + 1,
    };
    writeJournal(journal);
    console.log(`sent ${dayIso} ${act.id} ${filename} -> ${toList.join(", ")}`);
  } catch (err) {
    dayFail(act, dayIso, total, filename, err && err.message ? err.message : String(err));
  }
}

function dayFail(act, dayIso, numbers, filename, message) {
  const text = String(message).replace(/\s+/g, " ").slice(0, 500);
  const jact = (journal.acts[act.id] ||= { days: {} });
  jact.days[dayIso] = {
    workers: numbers.workers,
    itr: numbers.itr,
    tech: numbers.tech,
    sum: numbers.sum,
    locked: true,
    status: "error",
    error: text,
    failedAt: new Date().toISOString(),
    attempts: (jact.days[dayIso]?.attempts || 0) + 1,
    filename,
  };
  if (!dry) writeJournal(journal);
  console.error(`error ${dayIso} ${act.id}: ${text}`);
}

let actsToSend = settings.acts;
if (actEnv && mode === "now") {
  const one = settings.acts.find((a) => a.id === actEnv);
  if (!one) finish(`skip: акт ${actEnv} не найден`);
  actsToSend = [one];
}

for (const act of actsToSend) {
  await sendOne(act, iso);
}
