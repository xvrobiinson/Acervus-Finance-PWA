// Money and rate primitives, ported from the desktop app (src/domain/money.rs).
//
// Money is always a whole number of minor units (cents) held in a JS number;
// every amount the app accepts is at most 1e12, far inside the 2^53 range.
// Rates are parts per million of 1.0 (100_000 = 10% per period). Products
// such as cents × ppm × days can exceed 2^53, so every multiplication that
// feeds a division is done in BigInt and rounded half away from zero, exactly
// like the desktop's i128 arithmetic. No floating point touches money.

export type Cents = number;
/** Rate per period in parts per million (1% = 10_000). */
export type Rate = number;

export const RATE_SCALE = 1_000_000;
/** Highest rate accepted on input: 100% per period. */
export const MAX_RATE: Rate = RATE_SCALE;
/** Largest single amount accepted on input: 1 trillion minor units. */
export const MAX_AMOUNT: Cents = 1_000_000_000_000;

/** Rounds `numerator / denominator` half away from zero. `denominator` > 0. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator >= 0n) return (numerator + denominator / 2n) / denominator;
  return -((-numerator + denominator / 2n) / denominator);
}

/** round(a × b ÷ c), half away from zero, without leaving integer math. */
export function mulDiv(a: number, b: number, c: number): number {
  return toSafe(divRoundHalfUp(BigInt(a) * BigInt(b), BigInt(c)));
}

/** round(a × b × c ÷ d), half away from zero. */
export function mulMulDiv(a: number, b: number, c: number, d: number): number {
  return toSafe(divRoundHalfUp(BigInt(a) * BigInt(b) * BigInt(c), BigInt(d)));
}

function toSafe(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error("amount out of range");
  return n;
}

/** True for a whole number of cents in the accepted range. */
export function isCents(v: unknown): v is Cents {
  return typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= MAX_AMOUNT * 1000;
}

export type ParseError =
  | { code: "empty" }
  | { code: "invalid" }
  | { code: "negative" }
  | { code: "too_many_decimals"; decimals: number }
  | { code: "too_large" };

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ParseError };

/**
 * Parses a non-negative decimal with at most `decimals` fractional digits into
 * an integer scaled by 10^decimals. Accepts thousands separators (`,`, a
 * space, `_`, a no-break space) and a leading currency symbol.
 */
function parseFixed(input: string, decimals: number): Parsed<number> {
  let s = Array.from(input.trim())
    .filter((c) => c !== "," && c !== " " && c !== "_" && c !== " ")
    .join("");
  if (s.startsWith("-")) return { ok: false, error: { code: "negative" } };
  s = s.replace(/^[^0-9.]+/, "");
  if (s === "") return { ok: false, error: { code: "empty" } };
  const dot = s.indexOf(".");
  const intPart = dot >= 0 ? s.slice(0, dot) : s;
  const fracPart = dot >= 0 ? s.slice(dot + 1) : "";
  if (intPart === "" && fracPart === "") return { ok: false, error: { code: "invalid" } };
  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]*$/.test(fracPart)) {
    return { ok: false, error: { code: "invalid" } };
  }
  if (fracPart.length > decimals) return { ok: false, error: { code: "too_many_decimals", decimals } };
  if (intPart.length > 15) return { ok: false, error: { code: "too_large" } };
  const intValue = intPart === "" ? 0n : BigInt(intPart);
  const frac = fracPart.padEnd(decimals, "0");
  const fracValue = frac === "" ? 0n : BigInt(frac);
  const value = intValue * 10n ** BigInt(decimals) + fracValue;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: { code: "too_large" } };
  return { ok: true, value: Number(value) };
}

/** Parses a typed money amount ("1,250.50", "$300") into cents. */
export function parseMoney(input: string): Parsed<Cents> {
  const r = parseFixed(input, 2);
  if (r.ok && r.value > MAX_AMOUNT) return { ok: false, error: { code: "too_large" } };
  return r;
}

/** Parses a percent with up to 4 decimals ("12.5", "12.5%") into ppm. */
export function parseRate(input: string): Parsed<Rate> {
  const s = input.trim().replace(/%+$/, "").trim();
  if (s === "") return { ok: false, error: { code: "empty" } };
  const r = parseFixed(s, 4);
  if (r.ok && r.value > MAX_RATE) return { ok: false, error: { code: "too_large" } };
  return r;
}

/** The rate as a percent string, trimmed of trailing zeros ("12.5%"). */
export function ratePercentLabel(rate: Rate): string {
  const whole = Math.trunc(rate / 10_000);
  const frac = rate % 10_000;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(4, "0").replace(/0+$/, "")}%`;
}

/** A rate for an editable input ("12.5"). */
export function rateInputValue(rate: Rate): string {
  return ratePercentLabel(rate).replace(/%$/, "");
}

export type NumberStyle = "comma_dot" | "dot_comma" | "space_comma";
export const NUMBER_STYLES: NumberStyle[] = ["comma_dot", "dot_comma", "space_comma"];

export function numberStyleLabel(style: NumberStyle): string {
  return { comma_dot: "1,234.56", dot_comma: "1.234,56", space_comma: "1 234,56" }[style];
}

function separators(style: NumberStyle): [string, string] {
  switch (style) {
    case "dot_comma":
      return [".", ","];
    case "space_comma":
      return [" ", ","];
    default:
      return [",", "."];
  }
}

export interface MoneyFormat {
  symbol: string;
  style: NumberStyle;
}

export const DEFAULT_MONEY_FORMAT: MoneyFormat = { symbol: "$", style: "comma_dot" };

function group(fmt: MoneyFormat, n: bigint): string {
  const [sep] = separators(fmt.style);
  const parts: string[] = [];
  for (;;) {
    if (n < 1000n) {
      parts.push(String(n));
      break;
    }
    parts.push(String(n % 1000n).padStart(3, "0"));
    n /= 1000n;
  }
  return parts.reverse().join(sep);
}

/** "$1,234.56"; negatives as "−$1,234.56". */
export function formatMoney(fmt: MoneyFormat, cents: Cents): string {
  const [, dec] = separators(fmt.style);
  const neg = cents < 0;
  const abs = BigInt(Math.abs(cents));
  return `${neg ? "−" : ""}${fmt.symbol}${group(fmt, abs / 100n)}${dec}${String(abs % 100n).padStart(2, "0")}`;
}

/** Always signed: "+$12.00" / "−$12.00" / "$0.00". */
export function formatSigned(fmt: MoneyFormat, cents: Cents): string {
  return cents > 0 ? `+${formatMoney(fmt, cents)}` : formatMoney(fmt, cents);
}

/** Whole units without cents, for chart axes: "$12,500". */
export function formatWhole(fmt: MoneyFormat, cents: Cents): string {
  const neg = cents < 0;
  const units = (BigInt(Math.abs(cents)) + 50n) / 100n;
  return `${neg ? "−" : ""}${fmt.symbol}${group(fmt, units)}`;
}

/** Compact axis label: "$1.2k", "$3.4M". Display only, never stored. */
export function formatCompact(fmt: MoneyFormat, cents: Cents): string {
  const units = cents / 100;
  const abs = Math.abs(units);
  const sign = units < 0 ? "−" : "";
  const [, dec] = separators(fmt.style);
  const trim = (v: number, suffix: string) => `${v.toFixed(1).replace(/0+$/, "").replace(/\.$/, "")}${suffix}`;
  const body = abs >= 1_000_000 ? trim(abs / 1_000_000, "M") : abs >= 1_000 ? trim(abs / 1_000, "k") : abs.toFixed(0);
  return `${sign}${fmt.symbol}${body.replace(".", dec)}`;
}

/** Plain amount for an editable input ("1250.00"), no symbol or grouping. */
export function moneyInputValue(cents: Cents): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A ratio as a percent with one decimal ("12.3%"); `null` when undefined. */
export function ratioLabel(numerator: Cents, denominator: Cents): string | null {
  if (denominator === 0) return null;
  let num = BigInt(numerator) * 1000n;
  let den = BigInt(denominator);
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const tenths = divRoundHalfUp(num, den);
  const neg = tenths < 0n;
  const abs = neg ? -tenths : tenths;
  return `${neg ? "−" : ""}${abs / 10n}.${abs % 10n}%`;
}

export function sum(values: Iterable<number>): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
