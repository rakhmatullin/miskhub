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
      ranges: {
        workers: { min: 13, max: 15 },
        itr: { min: 4, max: 5 },
        tech: { min: 4, max: 5 },
      },
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

function normalizeAct(raw, idx = 0) {
  const src = raw && typeof raw === "object" ? raw : {};
  const id = String(src.id || `act${idx + 1}`).trim() || `act${idx + 1}`;
  const name = String(src.name || `Акт ${idx + 1}`).trim() || `Акт ${idx + 1}`;
  const ranges = src.ranges && typeof src.ranges === "object" ? src.ranges : {};
  return {
    id,
    name,
    ranges: {
      workers: clampPair(ranges.workers || DEFAULTS.acts[0].ranges.workers),
      itr: clampPair(ranges.itr || DEFAULTS.acts[0].ranges.itr),
      tech: clampPair(ranges.tech || DEFAULTS.acts[0].ranges.tech),
    },
    to: parseList(src.to),
    cc: parseList(src.cc),
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

export function weekdayIndex(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function filenameFor(iso, name = "") {
  const base = `Фиксация ТТР ${isoToRu(iso)}`;
  return name ? `${base} — ${name}.pdf` : `${base}.pdf`;
}

export function fill(template, ctx) {
  return String(template || "").replace(/\{(date|workers|itr|tech|sum|filename|name)\}/g, (_, key) => String(ctx[key] ?? ""));
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

function lockedOf(journalAct, iso) {
  const day = journalAct?.days?.[iso];
  if (!day || !day.locked) return null;
  const workers = Math.round(Number(day.workers));
  const itr = Math.round(Number(day.itr));
  const tech = Math.round(Number(day.tech));
  if (![workers, itr, tech].every(Number.isFinite)) return null;
  return { workers, itr, tech, sum: workers + itr + tech, status: day.status || "locked", note: day.note || "" };
}

export function numbersFor(iso, ranges, journalAct) {
  const locked = lockedOf(journalAct, iso);
  if (locked) return { ...locked, locked: true };
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
