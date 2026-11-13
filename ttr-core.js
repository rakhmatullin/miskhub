export const DEFAULTS = {
  version: 2,
  mail: {
    enabled: false,
    from: "",
    fromName: "",
    smtpHost: "smtp.mail.ru",
    smtpPort: 465,
    sendTime: "09:00",
    timezone: "Europe/Moscow",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    to: [],
    cc: [],
    subject: "Фиксация ТТР {date} — {name}",
    body: "Добрый день.\n\nНаправляю фиксацию технических и трудовых ресурсов на {date} ({name}).\nРабочие — {workers}, ИТР — {itr}, машинисты спецтехники — {tech}. Итого — {sum}.\n\nС уважением,\nРахматуллин Ренат",
  },
  acts: [
    {
      id: "default",
      name: "Основной",
      subject: "Фиксация ТТР {date} — {name}",
      body: "Добрый день.\n\nНаправляю фиксацию технических и трудовых ресурсов на {date} ({name}).\n\n{objects}\n\nС уважением,\nРахматуллин Ренат",
      to: [],
      cc: [],
      objects: [
        {
          number: "1",
          name: "Основной объект",
          ranges: {
            workers: { min: 13, max: 15 },
            itr: { min: 4, max: 5 },
            tech: { min: 4, max: 5 },
          },
        },
      ],
    },
  ],
};

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clampPair(pair) {
  let min = Math.round(Number(pair?.min));
  let max = Math.round(Number(pair?.max));
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = min;
  min = Math.max(0, Math.min(999, min));
  max = Math.max(0, Math.min(999, max));
  if (max < min) {
    const t = min;
    min = max;
    max = t;
  }
  return { min, max };
}

function normalizeObject(raw, idx = 0) {
  const src = raw && typeof raw === "object" ? raw : {};
  const ranges = src.ranges && typeof src.ranges === "object" ? src.ranges : {};
  return {
    number: String(src.number || String(idx + 1)).trim() || String(idx + 1),
    name: String(src.name || `Объект ${idx + 1}`).trim() || `Объект ${idx + 1}`,
    ranges: {
      workers: clampPair(ranges.workers || { min: 13, max: 15 }),
      itr: clampPair(ranges.itr || { min: 4, max: 5 }),
      tech: clampPair(ranges.tech || { min: 4, max: 5 }),
    },
  };
}

function normalizeAct(raw, idx = 0) {
  const src = raw && typeof raw === "object" ? raw : {};
  const id = String(src.id || `act${idx + 1}`).trim() || `act${idx + 1}`;
  const name = String(src.name || `Фиксация ${idx + 1}`).trim() || `Фиксация ${idx + 1}`;
  let objects = Array.isArray(src.objects) ? src.objects.map(normalizeObject) : [];
  if (!objects.length) {
    // migrate from old ranges on the act
    const ranges = src.ranges && typeof src.ranges === "object" ? src.ranges : {};
    objects = [normalizeObject({ number: "1", name: name || "Объект", ranges })];
  }
  return {
    id,
    name,
    subject: String(src.subject || DEFAULTS.acts[0].subject),
    body: String(src.body ?? DEFAULTS.acts[0].body),
    to: parseList(src.to),
    cc: parseList(src.cc),
    objects,
  };
}

export function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const mail = src.mail && typeof src.mail === "object" ? src.mail : {};
  let weekdays = Array.isArray(mail.weekdays) ? mail.weekdays.map((n) => Number(n)).filter((n) => n >= 0 && n <= 6) : DEFAULTS.mail.weekdays.slice();
  weekdays = [...new Set(weekdays)];
  const sendTime = /^\d{2}:\d{2}$/.test(mail.sendTime || "") ? mail.sendTime : DEFAULTS.mail.sendTime;

  let acts = Array.isArray(src.acts) ? src.acts.map(normalizeAct) : [];
  if (!acts.length) {
    // migrate from v1 ranges
    const ranges = src.ranges && typeof src.ranges === "object" ? src.ranges : {};
    acts = [normalizeAct({ id: "default", name: "Основной", ranges })];
  }

  return {
    version: 2,
    mail: {
      enabled: Boolean(mail.enabled),
      from: String(mail.from || "").trim(),
      fromName: String(mail.fromName || "").trim(),
      smtpHost: String(mail.smtpHost || DEFAULTS.mail.smtpHost).trim(),
      smtpPort: Number(mail.smtpPort) === 587 ? 587 : 465,
      sendTime,
      timezone: "Europe/Moscow",
      weekdays,
      to: parseList(mail.to),
      cc: parseList(mail.cc),
      subject: String(mail.subject || DEFAULTS.mail.subject),
      body: String(mail.body ?? DEFAULTS.mail.body),
    },
    acts,
  };
}

export function parseList(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  return String(value || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function todayISO(timeZone = "Europe/Moscow") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export function isoToRu(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function peoplePhrase(n) {
  const abs = Math.abs(Math.round(Number(n) || 0));
  const n10 = abs % 10;
  const n100 = abs % 100;
  const word = n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? "человека" : "человек";
  return `${abs} ${word}`;
}

export function weekdayIndex(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function filenameFor(iso, name = "") {
  const base = `Фиксация ТТР ${isoToRu(iso)}`;
  return name ? `${base} — ${name}` : base;
}

function sumParts(lines) {
  return (lines || []).reduce(
    (a, l) => ({
      workers: a.workers + (Number(l.workers) || 0),
      itr: a.itr + (Number(l.itr) || 0),
      tech: a.tech + (Number(l.tech) || 0),
      sum: a.sum + (Number(l.sum) || 0),
    }),
    { workers: 0, itr: 0, tech: 0, sum: 0 },
  );
}

function actSlice(journal, act) {
  if (!journal || typeof journal !== "object") return { days: {} };
  if (journal.acts && act?.id && journal.acts[act.id]) return journal.acts[act.id];
  if (journal.days) return journal;
  return { days: {} };
}

export function dayBreakdown(act, iso, journal) {
  const jact = actSlice(journal, act);
  const day = jact.days?.[iso] || {};
  const locked = Boolean(day.locked) || day.status === "sent" || day.status === "archive" || day.status === "locked";
  const spec = Array.isArray(act?.objects) && act.objects.length
    ? act.objects
    : [{ number: "1", name: act?.name || "Объект", ranges: {} }];

  if (locked && Array.isArray(day.objects) && day.objects.length) {
    const lines = day.objects.map((o, i) => {
      const t = lockedTriple(o) || { workers: 0, itr: 0, tech: 0 };
      const sum = t.workers + t.itr + t.tech;
      return {
        number: String(o.number ?? i + 1),
        name: String(o.name || "Объект"),
        workers: t.workers,
        itr: t.itr,
        tech: t.tech,
        sum,
      };
    });
    return { iso, lines, totals: sumParts(lines), locked: true };
  }

  if (locked) {
    const t = lockedTriple(day);
    if (t) {
      const sum = t.workers + t.itr + t.tech;
      const only = spec.length === 1 ? spec[0] : null;
      return {
        iso,
        lines: [{
          number: only ? String(only.number || "") : "",
          name: only ? String(only.name || act?.name || "Объект") : String(act?.name || "Сводно"),
          workers: t.workers,
          itr: t.itr,
          tech: t.tech,
          sum,
        }],
        totals: { workers: t.workers, itr: t.itr, tech: t.tech, sum },
        locked: true,
      };
    }
  }

  const lines = spec.map((obj, i) => {
    const ref = String(obj.number || i + 1);
    const ranges = obj.ranges || { workers: { min: 0, max: 0 }, itr: { min: 0, max: 0 }, tech: { min: 0, max: 0 } };
    const n = numbersFor(iso, ranges, jact, ref);
    const sum = n.workers + n.itr + n.tech;
    return { number: ref, name: String(obj.name || "Объект"), workers: n.workers, itr: n.itr, tech: n.tech, sum };
  });
  return { iso, lines, totals: sumParts(lines), locked: false };
}

export function objectsLetterBlock(lines, totals) {
  const chunks = (lines || []).map((o) => {
    const head = [o.number, o.name].filter(Boolean).join(". ");
    return `${head}: рабочие — ${o.workers}, ИТР — ${o.itr}, машинисты — ${o.tech}. Итого ${peoplePhrase(o.sum)}.`;
  });
  const t = totals || sumParts(lines || []);
  chunks.push(`Суммарно за день: рабочие — ${t.workers}, ИТР — ${t.itr}, машинисты — ${t.tech}. Всего ${peoplePhrase(t.sum)}.`);
  return chunks.join("\n");
}

function objectDetailBlock(o) {
  const head = [o.number, o.name].filter(Boolean).join(". ");
  return `${head}\nРабочие: ${o.workers}, ИТР: ${o.itr}, машинисты: ${o.tech}. Итого ${peoplePhrase(o.sum)}.`;
}

export function composeLetter({ acts, isos, journal, shape = "detail", signName = "Рахматуллин Ренат" } = {}) {
  const list = (Array.isArray(acts) ? acts : []).filter(Boolean);
  const dates = [...new Set((isos || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const days = [];
  for (const act of list) {
    for (const iso of dates) days.push({ act, ...dayBreakdown(act, iso, journal) });
  }
  const grand = days.reduce((s, d) => s + (d.totals?.sum || 0), 0);
  const names = list.map((a) => a.name).filter(Boolean);
  const dateLabel = dates.length === 1
    ? isoToRu(dates[0])
    : dates.length > 1
      ? `${isoToRu(dates[0])}–${isoToRu(dates[dates.length - 1])}`
      : "";
  const subject = `Численность${dateLabel ? " " + dateLabel : ""}${names.length ? " — " + names.join(", ") : ""}`;
  const lines = ["Добрый день!", ""];
  if (!list.length || !dates.length) {
    lines.push("Нет данных для письма.");
  } else if (shape === "short") {
    lines.push(list.length === 1 ? `Численность по «${list[0].name || "объекту"}».` : "Численность.", "");
    let lastAct = null;
    for (const day of days) {
      if (list.length > 1 && day.act !== lastAct) {
        if (lastAct) lines.push("");
        lines.push(day.act.name || "Фиксация");
        lastAct = day.act;
      }
      lines.push(`${isoToRu(day.iso)} — ${peoplePhrase(day.totals.sum)}`);
    }
  } else {
    let started = false;
    let lastAct = null;
    for (const day of days) {
      if (list.length > 1 && day.act !== lastAct) {
        lines.push(day.act.name || "Фиксация", "");
        lastAct = day.act;
      } else if (list.length === 1 && !started) {
        lines.push(`Численность по «${list[0].name || "объекту"}».`, "");
      }
      started = true;
      lines.push(`${isoToRu(day.iso)} — суммарно ${peoplePhrase(day.totals.sum)}`);
      for (const o of day.lines) lines.push(objectDetailBlock(o), "");
    }
  }
  if (dates.length > 1 || list.length > 1) lines.push("", `Суммарно за выбранные даты: ${peoplePhrase(grand)}.`);
  lines.push("", "С уважением,", signName || "Рахматуллин Ренат");
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return {
    subject,
    text,
    grand,
    days: days.map((d) => ({
      actId: d.act?.id || "",
      actName: d.act?.name || "",
      iso: d.iso,
      people: d.totals.sum,
      totals: d.totals,
      lines: d.lines,
    })),
  };
}

export function summaryText(act, isos, journal) {
  return composeLetter({ acts: act ? [act] : [], isos, journal, shape: "detail" }).text;
}

export function fill(template, ctx) {
  return String(template || "").replace(/\{(date|workers|itr|tech|sum|filename|name|objects)\}/g, (_, key) => String(ctx[key] ?? ""));
}

function rollBetween(iso, key, min, max) {
  const span = max - min + 1;
  if (span <= 1) return min;
  return min + (hash(`${iso}|${key}|ttr-v1`) % span);
}

function rollDay(iso, ranges) {
  return {
    workers: rollBetween(iso, "workers", ranges.workers.min, ranges.workers.max),
    itr: rollBetween(iso, "itr", ranges.itr.min, ranges.itr.max),
    tech: rollBetween(iso, "tech", ranges.tech.min, ranges.tech.max),
  };
}

function sameTriple(a, b) {
  return a.workers === b.workers && a.itr === b.itr && a.tech === b.tech;
}

function nudge(n, ranges, iso) {
  const order = ["workers", "itr", "tech"];
  const h = hash(`${iso}|nudge`);
  for (let k = 0; k < 3; k++) {
    const key = order[(h + k) % 3];
    const { min, max } = ranges[key];
    if (max <= min) continue;
    const dir = h & 1 ? 1 : -1;
    let v = n[key] + dir;
    if (v > max) v = min;
    if (v < min) v = max;
    if (v !== n[key]) return { ...n, [key]: v };
  }
  return n;
}

function lockedTriple(src) {
  const workers = Math.round(Number(src?.workers));
  const itr = Math.round(Number(src?.itr));
  const tech = Math.round(Number(src?.tech));
  if (![workers, itr, tech].every(Number.isFinite)) return null;
  return { workers, itr, tech };
}

function lockedOf(journalAct, iso) {
  const day = journalAct?.days?.[iso];
  if (!day || !day.locked) return null;
  let triple = lockedTriple(day);
  if (!triple && Array.isArray(day.objects) && day.objects.length === 1) triple = lockedTriple(day.objects[0]);
  if (!triple) return null;
  return { ...triple, sum: triple.workers + triple.itr + triple.tech, status: day.status || "locked", note: day.note || "" };
}

export function numbersFor(iso, ranges, journalAct, objectRef) {
  const ref = objectRef == null ? "" : String(objectRef);
  if (ref) {
    const day = journalAct?.days?.[iso];
    if (day && Array.isArray(day.objects) && day.objects.length) {
      const hit = day.objects.find((o) => String(o.number) === ref);
      const triple = hit ? lockedTriple(hit) : null;
      const dayLocked = Boolean(day.locked) || day.status === "sent" || day.status === "archive" || day.status === "locked" || Boolean(hit?.locked);
      if (triple && dayLocked) {
        return {
          workers: triple.workers,
          itr: triple.itr,
          tech: triple.tech,
          sum: triple.workers + triple.itr + triple.tech,
          locked: true,
          status: day.status || "locked",
          note: day.note || "",
        };
      }
      if (!dayLocked) {
        const locked = lockedOf(journalAct, iso);
        if (locked) return { ...locked, locked: true };
      }
    } else {
      const locked = lockedOf(journalAct, iso);
      if (locked) return { ...locked, locked: true };
    }
  } else {
    const locked = lockedOf(journalAct, iso);
    if (locked) return { ...locked, locked: true };
  }
  let n = rollDay(iso, ranges);
  const prevIso = addDays(iso, -1);
  const prev = lockedOf(journalAct, prevIso) || rollDay(prevIso, ranges);
  if (sameTriple(n, prev)) n = nudge(n, ranges, iso);
  return {
    workers: n.workers,
    itr: n.itr,
    tech: n.tech,
    sum: n.workers + n.itr + n.tech,
    locked: false,
    status: "",
    note: "",
  };
}

export function contextFor(iso, numbers, name = "") {
  return {
    date: isoToRu(iso),
    workers: numbers.workers,
    itr: numbers.itr,
    tech: numbers.tech,
    sum: numbers.sum,
    filename: filenameFor(iso, name),
    name,
  };
}

export function minutesOf(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function moscowMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h * 60 + m;
}

export function ensureJournal(journal) {
  const j = journal && typeof journal === "object" ? journal : {};
  if (!j.acts) {
    // migrate v1
    j.acts = { default: { days: j.days || {} } };
    delete j.days;
  }
  j.acts ||= {};
  return j;
}
