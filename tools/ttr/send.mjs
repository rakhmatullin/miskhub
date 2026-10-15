import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { createMakePdf } from "../../ttr-pdf.js";
import {
  contextFor,
  filenameFor,
  fill,
  isoToRu,
  minutesOf,
  moscowMinutesNow,
  normalizeSettings,
  numbersFor,
  todayISO,
  weekdayIndex,
} from "../../ttr-core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settingsPath = path.join(root, "data/ttr/settings.json");
const journalPath = path.join(root, "data/ttr/journal.json");
const templatePath = path.join(root, "data/ttr/template.pdf");
const fontPath = path.join(root, "data/ttr/LiberationSerif-Regular.ttf");
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

const mode = String(process.env.TTR_MODE || "auto").trim() || "auto";
const dry = process.env.TTR_DRY === "1";
const dateEnv = String(process.env.TTR_DATE || "");
const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateEnv) ? dateEnv : todayISO();
const settings = normalizeSettings(readJson(settingsPath, {}));
const journal = readJson(journalPath, { days: {} });
journal.days ||= {};
const day = journal.days[iso] || {};
const numbers = numbersFor(iso, settings.ranges, journal);
const ctx = contextFor(iso, numbers);
const filename = filenameFor(iso);

if (dry) {
  const makePdf = createMakePdf({ PDFDocument, rgb }, fontkit);
  const pdf = await makePdf(readFileSync(templatePath), readFileSync(fontPath), {
    dateLabel: `Дата: ${isoToRu(iso)}`,
    workers: numbers.workers,
    itr: numbers.itr,
    tech: numbers.tech,
  });
  const out = process.env.TTR_OUT || path.join("/tmp", `ttr-${iso}.pdf`);
  writeFileSync(out, pdf);
  console.log(JSON.stringify({ iso, numbers, filename, out }));
  process.exit(0);
}

function finish(message) {
  console.log(message);
  process.exit(0);
}

const already = day.status === "sent" || day.status === "archive";
if (already && mode !== "resend") finish(`skip ${iso}: уже ${day.status}`);

if (mode === "auto") {
  if (!settings.mail.enabled) finish("skip: автоотправка выключена");
  const wd = weekdayIndex(iso);
  if (!settings.mail.weekdays.includes(wd)) finish(`skip ${iso}: ${WEEK[wd]} не в расписании`);
  if (moscowMinutesNow() < minutesOf(settings.mail.sendTime)) finish(`skip: ещё рано, отправка с ${settings.mail.sendTime} МСК`);
  if (day.status === "error" && (day.attempts || 0) >= 4) finish("skip: четыре неудачные попытки, нужно поправить настройки");
}

if (!settings.mail.to.length) {
  dayFail("Нет адресатов. Укажи их на странице акта и сохрани.");
}
if (!settings.mail.from) {
  dayFail("Не указана почта отправителя.");
}
const password = process.env.TTR_MAIL_PASSWORD || "";
if (!dry && !password) {
  dayFail("Нет секрета TTR_MAIL_PASSWORD. Впиши пароль Mail.ru на странице и сохрани — в репозиторий он не попадает.");
}

const makePdf = createMakePdf({ PDFDocument, rgb }, fontkit);
const pdf = await makePdf(readFileSync(templatePath), readFileSync(fontPath), {
  dateLabel: `Дата: ${isoToRu(iso)}`,
  workers: numbers.workers,
  itr: numbers.itr,
  tech: numbers.tech,
});

const from = settings.mail.fromName
  ? `"${settings.mail.fromName.replace(/"/g, "")}" <${settings.mail.from}>`
  : settings.mail.from;

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
    to: settings.mail.to.join(", "),
    cc: settings.mail.cc.length ? settings.mail.cc.join(", ") : undefined,
    subject: fill(settings.mail.subject, ctx),
    text: fill(settings.mail.body, ctx),
    attachments: [{ filename, content: Buffer.from(pdf), contentType: "application/pdf" }],
  });
  journal.days[iso] = {
    ...numbers,
    sum: numbers.sum,
    locked: true,
    status: "sent",
    sentAt: new Date().toISOString(),
    to: settings.mail.to,
    cc: settings.mail.cc,
    filename,
    messageId: info.messageId || "",
    error: "",
    attempts: (day.attempts || 0) + 1,
  };
  writeJournal(journal);
  console.log(`sent ${iso} ${filename} -> ${settings.mail.to.join(", ")}`);
} catch (err) {
  dayFail(err && err.message ? err.message : String(err));
}

function dayFail(message) {
  const text = String(message).replace(/\s+/g, " ").slice(0, 500);
  journal.days[iso] = {
    workers: numbers.workers,
    itr: numbers.itr,
    tech: numbers.tech,
    sum: numbers.sum,
    locked: true,
    status: "error",
    error: text,
    failedAt: new Date().toISOString(),
    attempts: (day.attempts || 0) + 1,
    filename,
  };
  if (!dry) writeJournal(journal);
  console.error(`error ${iso}: ${text}`);
  process.exit(0);
}
