import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { createMakePdf } from "../../ttr-pdf.js";
import {
  contextFor,
  ensureJournal,
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
const actEnv = String(process.env.TTR_ACT || "");
const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateEnv) ? dateEnv : todayISO();
const settings = normalizeSettings(readJson(settingsPath, {}));
let journal = ensureJournal(readJson(journalPath, {}));

if (mode === "summary") {
  const act = settings.acts.find(a => a.id === actEnv) || settings.acts[0];
  if (!act) finish("skip: фиксация не найдена");
  const isos = dateEnv.split(",").map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
  if (!isos.length) finish("skip: нет дат для сводки");

  function getNums(iso, obj) {
    const jact = journal.acts[act.id] || { days: {} };
    return numbersFor(iso, obj.ranges, jact);
  }

  const objectName = act.name || "объекту";
  const lines = [];
  lines.push("Добрый день!");
  lines.push("");
  lines.push(`Численность по объекту «${objectName}»:`);

  const dayData = [];
  for (const iso of isos) {
    const objs = (act.objects || []).map(obj => ({
      ...obj,
      numbers: getNums(iso, obj),
    }));
    const total = objs.reduce((s, o) => s + (o.numbers.sum || 0), 0);
    dayData.push({ iso, objs, total });
    lines.push(`${isoToRu(iso)} — ${total} человек`);
  }
  lines.push("");

  for (const day of dayData) {
    lines.push(isoToRu(day.iso));
    for (const o of day.objs) {
      const projLabel = o.number && /[0-9]{3,}-[0-9]{3,}/.test(o.number)
        ? `Проект ${o.number}`
        : (o.name || `Проект ${o.number || ""}`);
      lines.push(projLabel);
      lines.push(`Рабочие: ${o.numbers.workers}, ИТР: ${o.numbers.itr}, машинисты: ${o.numbers.tech}`);
      lines.push("");
    }
  }

  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const toList = (act.to && act.to.length) ? act.to : settings.mail.to;
  const ccList = (act.cc && act.cc.length) ? act.cc : settings.mail.cc;
  if (!toList.length) finish("skip: нет адресатов");
  if (!settings.mail.from) finish("skip: нет отправителя");
  const password = process.env.TTR_MAIL_PASSWORD || "";
  if (!password) finish("skip: нет пароля");

  const from = settings.mail.fromName
    ? `"${settings.mail.fromName.replace(/"/g, "")}" <${settings.mail.from}>`
    : settings.mail.from;

  const subject = `Численность по объекту «${objectName}» (${isos.map(isoToRu).join(", ")})`;

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

function finish(message) {
  console.log(message);
  process.exit(0);
}

async function sendOne(act, iso) {
  const jact = journal.acts[act.id] ||= { days: {} };
  const day = jact.days[iso] || {};
  const objects = act.objects || [{ number: "1", name: act.name, ranges: act.ranges || {} }];
  const objResults = objects.map((obj) => {
    const numbers = numbersFor(iso, obj.ranges, jact);
    return { ...obj, numbers };
  });
  const total = objResults.reduce((a, o) => ({
    workers: a.workers + o.numbers.workers,
    itr: a.itr + o.numbers.itr,
    tech: a.tech + o.numbers.tech,
    sum: a.sum + o.numbers.sum,
  }), { workers: 0, itr: 0, tech: 0, sum: 0 });
  const objectsText = objResults.map((o) =>
    `${o.number}. ${o.name}: рабочие — ${o.numbers.workers}, ИТР — ${o.numbers.itr}, техника — ${o.numbers.tech} (итого ${o.numbers.sum})`
  ).join("\n");
  const ctx = {
    date: isoToRu(iso),
    name: act.name,
    workers: total.workers,
    itr: total.itr,
    tech: total.tech,
    sum: total.sum,
    objects: objectsText,
    filename: filenameFor(iso, act.name),
  };
  const filename = filenameFor(iso, act.name);

  if (dry) {
    const makePdf = createMakePdf({ PDFDocument, rgb }, fontkit);
    const pdf = await makePdf(readFileSync(templatePath), readFileSync(fontPath), {
      dateLabel: `Дата: ${isoToRu(iso)}`,
      workers: numbers.workers,
      itr: numbers.itr,
      tech: numbers.tech,
    });
    const out = process.env.TTR_OUT || path.join("/tmp", `ttr-${act.id}-${iso}.pdf`);
    writeFileSync(out, pdf);
    console.log(JSON.stringify({ iso, act: act.id, numbers, filename, out }));
    return;
  }

  const already = day.status === "sent" || day.status === "archive";
  if (already && mode !== "now") { console.log(`skip ${iso} ${act.id}: уже ${day.status}`); return; }

  if (mode === "auto") {
    if (!settings.mail.enabled) { console.log("skip: автоотправка выключена"); return; }
    const wd = weekdayIndex(iso);
    if (!settings.mail.weekdays.includes(wd)) { console.log(`skip ${iso}: ${WEEK[wd]} не в расписании`); return; }
    if (moscowMinutesNow() < minutesOf(settings.mail.sendTime)) { console.log(`skip: ещё рано, отправка с ${settings.mail.sendTime} МСК`); return; }
    if (day.status === "error" && (day.attempts || 0) >= 4) { console.log("skip: четыре неудачные попытки, нужно поправить настройки"); return; }
  }

  const toList = (act.to && act.to.length) ? act.to : settings.mail.to;
  const ccList = (act.cc && act.cc.length) ? act.cc : settings.mail.cc;
  if (!toList.length) {
    dayFail(act, iso, numbers, filename, "Нет адресатов для этой фиксации. Укажи их в карточке и сохрани.");
    return;
  }
  if (!settings.mail.from) {
    dayFail(act, iso, numbers, filename, "Не указана почта отправителя.");
    return;
  }
  const password = process.env.TTR_MAIL_PASSWORD || "";
  if (!dry && !password) {
    dayFail(act, iso, numbers, filename, "Нет секрета TTR_MAIL_PASSWORD. Впиши пароль Mail.ru на странице и сохрани — в репозиторий он не попадает.");
    return;
  }

  const makePdf = createMakePdf({ PDFDocument, rgb }, fontkit);
  const attachments = [];
  for (const o of objResults) {
    const pdf = await makePdf(readFileSync(templatePath), readFileSync(fontPath), {
      dateLabel: `Дата: ${isoToRu(iso)}`,
      workers: o.numbers.workers,
      itr: o.numbers.itr,
      tech: o.numbers.tech,
    });
    const objFilename = filenameFor(iso, `${act.name} — ${o.number} ${o.name}`);
    attachments.push({ filename: objFilename, content: Buffer.from(pdf), contentType: "application/pdf" });
  }

  const from = settings.mail.fromName
    ? `"${settings.mail.fromName.replace(/"/g, "")}" <${settings.mail.from}>`
    : settings.mail.from;

  const subject = fill(act.subject || settings.mail.subject, ctx);
  const text = fill(act.body || settings.mail.body, ctx);

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
      attachments,
    });
    jact.days[iso] = {
      objects: objResults.map((o) => ({ number: o.number, name: o.name, ...o.numbers })),
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
    console.log(`sent ${iso} ${act.id} ${filename} -> ${toList.join(", ")}`);
  } catch (err) {
    dayFail(act, iso, numbers, filename, err && err.message ? err.message : String(err));
  }
}

function dayFail(act, iso, numbers, filename, message) {
  const text = String(message).replace(/\s+/g, " ").slice(0, 500);
  const jact = journal.acts[act.id] ||= { days: {} };
  jact.days[iso] = {
    workers: numbers.workers,
    itr: numbers.itr,
    tech: numbers.tech,
    sum: numbers.sum,
    locked: true,
    status: "error",
    error: text,
    failedAt: new Date().toISOString(),
    attempts: (jact.days[iso]?.attempts || 0) + 1,
    filename,
  };
  if (!dry) writeJournal(journal);
  console.error(`error ${iso} ${act.id}: ${text}`);
}

// Determine which acts to process
let actsToSend = settings.acts;
if (actEnv && mode === "now") {
  const one = settings.acts.find((a) => a.id === actEnv);
  if (!one) finish(`skip: акт ${actEnv} не найден`);
  actsToSend = [one];
}

for (const act of actsToSend) {
  await sendOne(act, iso);
}
