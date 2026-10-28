// Receipt wording people can change in Settings (port of the desktop's
// src/services/receipt_text.rs). Stored in settings.receiptText under the
// desktop's own keys and encoding ("=" + text; rule lists as
// "when<TAB>text" lines), so the same settings mean the same in both apps.
// Unset keys print the built-in wording in the receipt's language.

import type { Method } from "../../shared/domain/loans";
import type { T } from "../lib/i18n";
import { methodExplanation } from "../lib/labels";

export type RuleSet = "declining" | "flat" | "interest_only";
export type When = "always" | "converted" | "late_fee" | "edited";
export interface RuleLine {
  text: string;
  when: When;
}

const RULE_KEYS: Record<RuleSet, string> = {
  declining: "receipt_rules_declining",
  flat: "receipt_rules_flat",
  interest_only: "receipt_rules_interest_only",
};

export const TEXT_KEYS = {
  heading: "receipt_rules_heading",
  clientSign: "receipt_client_sign",
  lenderSign: "receipt_lender_sign",
  paymentFooter: "receipt_payment_footer",
  loanFooter: "receipt_loan_footer",
} as const;

export function whenHint(t: T, w: When): string | null {
  switch (w) {
    case "converted":
      return t("Only when the rate is converted", "Solo si la tasa se convierte");
    case "late_fee":
      return t("Only when the loan has a late fee", "Solo si el préstamo tiene mora");
    case "edited":
      return t("Only when the schedule was set by hand", "Solo si el calendario se fijó a mano");
    default:
      return null;
  }
}

export function tagList(t: T): [string, string][] {
  return [
    ["{amount}", t("amount lent", "monto prestado")],
    ["{interest}", t("interest per payment", "interés por pago")],
    ["{late_fee}", t("late fee rate", "tasa de mora")],
    ["{conversion}", t("how the rate converts", "cómo se convierte la tasa")],
    ["{example_payment}", t("example payment (interest only)", "pago de ejemplo (solo interés)")],
    ["{example_capital}", t("its capital part", "su parte de capital")],
    ["{next_interest}", t("the interest after it", "el interés después")],
    ["{company}", t("company name", "nombre de la empresa")],
  ];
}

export function defaultRules(t: T, set: RuleSet): RuleLine[] {
  const lines: RuleLine[] = [
    { when: "always", text: methodExplanation(t, set as Method) },
    {
      when: "converted",
      text: t("The rate is converted on a 30-day month: {conversion}.", "La tasa se convierte sobre un mes de 30 días: {conversion}."),
    },
  ];
  if (set === "interest_only") {
    lines.push(
      {
        when: "always",
        text: t(
          "Paying {interest} each time covers the interest; the capital stays at {amount}.",
          "Si paga {interest} cada vez, cubre el interés y el capital sigue en {amount}.",
        ),
      },
      {
        when: "always",
        text: t(
          "Anything paid above the interest lowers the capital. For example, paying {example_payment} is {interest} of interest and {example_capital} of capital, and the next interest drops to {next_interest}.",
          "Todo lo que pague por encima del interés baja el capital. Por ejemplo, si paga {example_payment}, son {interest} de interés y {example_capital} de capital, y el próximo interés baja a {next_interest}.",
        ),
      },
      {
        when: "always",
        text: t(
          "The loan can be paid off at any time with the capital owed plus the interest due. It closes when the capital reaches zero.",
          "El préstamo se puede saldar en cualquier momento con el capital adeudado más el interés pendiente. Se cierra cuando el capital llega a cero.",
        ),
      },
    );
  } else {
    lines.push(
      {
        when: "late_fee",
        text: t(
          "An installment not fully paid by its due date is charged a late fee of {late_fee} of what is still unpaid, once, the day after.",
          "Una cuota que no se pague completa a su vencimiento tiene un cargo por mora de {late_fee} de lo que falte, una sola vez, al día siguiente.",
        ),
      },
      {
        when: "always",
        text: t(
          "Payments cover late fees first, then interest, then capital. The loan can be paid off early with the capital owed plus the interest due.",
          "Los pagos cubren primero los cargos por mora, luego el interés y después el capital. El préstamo se puede saldar antes con el capital adeudado más el interés pendiente.",
        ),
      },
      { when: "edited", text: t("This schedule was set by agreement.", "Este calendario se fijó de común acuerdo.") },
    );
  }
  return lines;
}

const defaults = (t: T) => ({
  heading: t("How payments work", "Cómo funcionan los pagos"),
  clientSign: t("Client", "Cliente"),
  lenderSign: t("For {company}", "Por {company}"),
  paymentFooter: t("Thank you for your payment.", "Gracias por su pago."),
  loanFooter: "",
});

const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim(); // eslint-disable-line no-control-regex
const decode = (v: string | undefined): string | null => (v !== undefined && v.startsWith("=") ? v.slice(1) : null);
const encode = (v: string | null): string => (v === null ? "" : `=${oneLine(v)}`);

/** Receipt wording: custom values (null = built-in) read from settings. */
export class Wording {
  constructor(
    private map: Record<string, string>,
    private t: T,
  ) {}

  private text(key: keyof typeof TEXT_KEYS): string {
    return decode(this.map[TEXT_KEYS[key]]) ?? defaults(this.t)[key];
  }
  custom(key: keyof typeof TEXT_KEYS): string | null {
    return decode(this.map[TEXT_KEYS[key]]);
  }
  heading = () => this.text("heading");
  clientSign = () => this.text("clientSign");
  lenderSign = () => this.text("lenderSign");
  paymentFooter = () => this.text("paymentFooter");
  loanFooter = () => this.text("loanFooter");

  customRules(set: RuleSet): RuleLine[] | null {
    const raw = decode(this.map[RULE_KEYS[set]]);
    if (raw === null) return null;
    return raw
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => {
        const tab = l.indexOf("\t");
        const w = tab >= 0 ? (l.slice(0, tab) as When) : null;
        return w && ["always", "converted", "late_fee", "edited"].includes(w)
          ? { when: w, text: l.slice(tab + 1) }
          : { when: "always" as When, text: l };
      });
  }
  rules(set: RuleSet): RuleLine[] {
    return this.customRules(set) ?? defaultRules(this.t, set);
  }
}

/** The settings map with one value changed (null = back to built-in). */
export function withText(map: Record<string, string>, key: keyof typeof TEXT_KEYS, value: string | null): Record<string, string> {
  const next = { ...map };
  if (value === null) delete next[TEXT_KEYS[key]];
  else next[TEXT_KEYS[key]] = encode(value);
  return next;
}

export function withRules(map: Record<string, string>, set: RuleSet, lines: RuleLine[] | null): Record<string, string> {
  const next = { ...map };
  if (lines === null) delete next[RULE_KEYS[set]];
  else next[RULE_KEYS[set]] = `=${lines.map((l) => `${l.when}\t${oneLine(l.text)}`).join("\n")}`;
  return next;
}

/** Problems that stop the wording being saved, or null. */
export function wordingProblem(t: T, map: Record<string, string>): string | null {
  const w = new Wording(map, t);
  const long = (v: string | null, max: number) => v !== null && [...v].length > max;
  if (long(w.custom("heading"), 80)) return t("The heading is too long (80 characters at most)", "El título es muy largo (máximo 80 caracteres)");
  if (long(w.custom("clientSign"), 80) || long(w.custom("lenderSign"), 80)) {
    return t("A signature caption is too long (80 characters at most)", "Un texto de firma es muy largo (máximo 80 caracteres)");
  }
  if (long(w.custom("paymentFooter"), 300) || long(w.custom("loanFooter"), 300)) {
    return t("A closing line is too long (300 characters at most)", "Una línea final es muy larga (máximo 300 caracteres)");
  }
  for (const set of Object.keys(RULE_KEYS) as RuleSet[]) {
    const lines = w.customRules(set);
    if (!lines) continue;
    if (lines.length > 20) return t("Use 20 lines at most", "Usa 20 líneas como máximo");
    if (lines.some((l) => [...l.text].length > 500)) return t("A line is too long (500 characters at most)", "Una línea es muy larga (máximo 500 caracteres)");
  }
  return null;
}

export interface Tags {
  amount: string;
  interest: string;
  late_fee: string;
  conversion: string;
  example_payment: string;
  example_capital: string;
  next_interest: string;
  company: string;
}

export function fill(text: string, tags: Partial<Tags>): string {
  return Object.entries(tags).reduce((s, [k, v]) => s.split(`{${k}}`).join(v ?? ""), text);
}

/** The lines a loan's receipt prints: those that apply, with tags filled. */
export function linesFor(lines: RuleLine[], tags: Partial<Tags>, converted: boolean, lateFee: boolean, edited: boolean): string[] {
  return lines
    .filter((l) => l.when === "always" || (l.when === "converted" && converted) || (l.when === "late_fee" && lateFee) || (l.when === "edited" && edited))
    .map((l) => fill(l.text, tags))
    .filter((l) => l.trim() !== "");
}
