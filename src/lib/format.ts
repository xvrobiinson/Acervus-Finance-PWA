// Formatting figures and dates with the business's settings.

import { formatDay, formatDayShort, type DateStyle, type Day, type Lang } from "../../shared/domain/dates";
import {
  formatCompact,
  formatMoney,
  formatSigned,
  formatWhole,
  ratePercentLabel,
  type Cents,
  type MoneyFormat,
  type NumberStyle,
  type Rate,
} from "../../shared/domain/money";
import { currencySymbol } from "./labels";

export interface Fmt {
  money: (c: Cents) => string;
  signed: (c: Cents) => string;
  whole: (c: Cents) => string;
  compact: (c: Cents) => string;
  rate: (r: Rate) => string;
  day: (d: Day) => string;
  dayShort: (d: Day) => string;
  moneyFormat: MoneyFormat;
  symbol: string;
  lang: Lang;
}

export function makeFmt(
  s: { currencyCode: string; numberStyle: NumberStyle; dateStyle: DateStyle } | null | undefined,
  lang: Lang,
  today: Day,
): Fmt {
  const moneyFormat: MoneyFormat = { symbol: currencySymbol(s?.currencyCode ?? "DOP"), style: s?.numberStyle ?? "comma_dot" };
  const style = s?.dateStyle ?? "medium";
  return {
    money: (c) => formatMoney(moneyFormat, c),
    signed: (c) => formatSigned(moneyFormat, c),
    whole: (c) => formatWhole(moneyFormat, c),
    compact: (c) => formatCompact(moneyFormat, c),
    rate: (r) => {
      const label = ratePercentLabel(r);
      return moneyFormat.style === "comma_dot" ? label : label.replace(".", ",");
    },
    day: (d) => formatDay(d, style, lang),
    dayShort: (d) => formatDayShort(d, today, style, lang),
    moneyFormat,
    symbol: moneyFormat.symbol,
    lang,
  };
}
