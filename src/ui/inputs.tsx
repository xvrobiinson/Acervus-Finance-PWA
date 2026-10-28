// Inputs for money, rates and dates. Money and rates are typed as text and
// parsed with the engine's own parsers (whole cents, ppm), never as floats.

import { useState } from "react";
import { parseMoney, parseRate, type Cents, type ParseError, type Rate } from "../../shared/domain/money";
import { parseErrorText } from "../lib/errors";
import { useT } from "../lib/i18n";

export interface Parsed<T> {
  text: string;
  value: T | null;
  error: ParseError | null;
}

export function useMoney(initial: Cents | null = null): [Parsed<Cents>, (text: string) => void, (c: Cents | null) => void] {
  const [text, setText] = useState(initial === null ? "" : (initial / 100).toFixed(2));
  const r = parseMoney(text);
  const state: Parsed<Cents> = { text, value: r.ok ? r.value : null, error: r.ok ? null : r.error };
  return [state, setText, (c) => setText(c === null ? "" : (c / 100).toFixed(2))];
}

export function useRate(initial: Rate | null = null): [Parsed<Rate>, (text: string) => void] {
  const [text, setText] = useState(initial === null ? "" : String(initial / 10_000));
  const r = parseRate(text);
  return [{ text, value: r.ok ? r.value : null, error: r.ok ? null : r.error }, setText];
}

/** The error to show under a parsed field once something was typed (or the
 *  form was submitted). */
export function useParseError() {
  const t = useT();
  return (p: Parsed<unknown>, shown: boolean) => (p.error && (shown || p.text !== "") ? parseErrorText(t, p.error) : null);
}

export function MoneyInput({
  id,
  value,
  onChange,
  symbol,
  invalid,
  placeholder = "0.00",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  symbol: string;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="affix">
      <span className="prefix">{symbol}</span>
      <input
        id={id}
        className={`input money with-prefix ${invalid ? "invalid" : ""}`}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function RateInput({ id, value, onChange, invalid }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <div className="affix">
      <input
        id={id}
        className={`input money with-suffix ${invalid ? "invalid" : ""}`}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="suffix">%</span>
    </div>
  );
}

/** The phone's own date picker; values are ISO dates. */
export function DateInput({ id, value, onChange, max, min }: { id: string; value: string; onChange: (v: string) => void; max?: string; min?: string }) {
  return <input id={id} type="date" className="input" value={value} max={max} min={min} onChange={(e) => onChange(e.target.value)} required />;
}
