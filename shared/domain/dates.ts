// Calendar dates as ISO strings ("2026-10-21"), ported from the desktop app
// (src/utils/dates.rs). ISO strings compare correctly as plain strings, so
// `a < b` is date order. Arithmetic goes through UTC day numbers, never local
// time, so a device's time zone can't shift a date.

/** An ISO calendar date, YYYY-MM-DD. */
export type Day = string;

/** Later than any real date; used as "no limit". */
export const MAX_DAY: Day = "9999-12-31";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIso(s: string): Day | null {
  const m = ISO_RE.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function isDay(s: unknown): s is Day {
  return typeof s === "string" && parseIso(s) === s;
}

function parts(d: Day): [number, number, number] {
  return [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
}

export function makeDay(y: number, m: number, d: number): Day {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toNum(d: Day): number {
  const [y, m, day] = parts(d);
  return Math.round(Date.UTC(y, m - 1, day) / 86_400_000);
}

function fromNum(n: number): Day {
  const dt = new Date(n * 86_400_000);
  return makeDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(d: Day, n: number): Day {
  if (d === MAX_DAY) return d;
  return fromNum(toNum(d) + n);
}

/** Adds calendar months, clamping to the last day of shorter months
 *  (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d: Day, months: number): Day {
  const [y, m, day] = parts(d);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return makeDay(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function daysBetween(from: Day, to: Day): number {
  return toNum(to) - toNum(from);
}

export function monthStart(d: Day): Day {
  return `${d.slice(0, 7)}-01`;
}

export function minDay(a: Day, b: Day): Day {
  return a < b ? a : b;
}

export function maxDay(a: Day, b: Day): Day {
  return a > b ? a : b;
}

/** Today's date in a time zone (IANA name, e.g. "America/Santo_Domingo").
 *  Every business works in its own zone so "today" is the same on every
 *  device and on the server. */
export function todayIn(timeZone: string, now: Date = new Date()): Day {
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type DateStyle = "medium" | "iso" | "dmy" | "mdy";
export const DATE_STYLES: DateStyle[] = ["medium", "iso", "dmy", "mdy"];
export type Lang = "en" | "es";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function shortMonth(m: number, lang: Lang): string {
  const i = Math.min(Math.max(m, 1), 12) - 1;
  return lang === "es" ? MONTHS_ES[i] : MONTHS_EN[i];
}

export function formatDay(d: Day, style: DateStyle, lang: Lang): string {
  const [y, m, day] = parts(d);
  const dd = String(day).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  switch (style) {
    case "iso":
      return d;
    case "dmy":
      return `${dd}/${mm}/${y}`;
    case "mdy":
      return `${mm}/${dd}/${y}`;
    default:
      return lang === "es" ? `${day} ${shortMonth(m, lang)} ${y}` : `${shortMonth(m, lang)} ${day}, ${y}`;
  }
}

/** Short form without the year when it is the current year ("Oct 21"). */
export function formatDayShort(d: Day, today: Day, style: DateStyle, lang: Lang): string {
  const [y, m, day] = parts(d);
  if (style === "medium" && y === parts(today)[0]) {
    return lang === "es" ? `${day} ${shortMonth(m, lang)}` : `${shortMonth(m, lang)} ${day}`;
  }
  return formatDay(d, style, lang);
}

/** "October 2026" / "Octubre 2026". */
export function monthYear(d: Day, lang: Lang): string {
  const [y, m] = parts(d);
  return `${(lang === "es" ? MONTH_NAMES_ES : MONTH_NAMES_EN)[m - 1]} ${y}`;
}

/** "Oct 2026" / "oct 2026". */
export function shortMonthYear(d: Day, lang: Lang): string {
  const [y, m] = parts(d);
  return `${shortMonth(m, lang)} ${y}`;
}
