// What went wrong, in words. The backend sends a code and figures
// (convex/lib/errors.ts); this turns them into a sentence in the person's
// language with the business's money and date formats.

import { ConvexError } from "convex/values";
import type { PlanError } from "../../shared/domain/installments";
import type { PaymentError } from "../../shared/domain/ledger";
import type { ParseError } from "../../shared/domain/money";
import type { ScheduleError } from "../../shared/domain/installments";
import type { Fmt } from "./format";
import type { T } from "./i18n";
import { accountLabel } from "./labels";

export type ErrorData = { code: string } & Record<string, unknown>;

/** The structured error, or null for a network/unknown failure. */
export function errorData(e: unknown): ErrorData | null {
  if (e instanceof ConvexError && e.data && typeof e.data === "object" && "code" in e.data) return e.data as ErrorData;
  return null;
}

/** True when the request never got an answer (offline, connection lost). */
export function isNetworkError(e: unknown): boolean {
  if (errorData(e)) return false;
  const msg = e instanceof Error ? e.message : String(e);
  return /network|fetch|connection|websocket|offline|timed out|timeout|Failed to/i.test(msg) || !navigator.onLine;
}

export function parseErrorText(t: T, e: ParseError): string {
  switch (e.code) {
    case "empty":
      return t("Enter an amount", "Escribe un monto");
    case "invalid":
      return t("Use digits only, like 1250.00", "Usa solo números, como 1250.00");
    case "negative":
      return t("Amount must be positive", "El monto debe ser positivo");
    case "too_many_decimals":
      return t(`Use at most ${e.decimals} decimal places`, `Usa como máximo ${e.decimals} decimales`);
    case "too_large":
      return t("That value is too large", "Ese valor es demasiado grande");
  }
}

export function paymentErrorText(t: T, f: Fmt, e: PaymentError): string {
  switch (e.code) {
    case "not_positive":
      return t("Enter an amount greater than zero", "Escribe un monto mayor que cero");
    case "overpayment":
      return t(
        `This is more than the client owes (${f.money(e.payoff)} on this date)`,
        `Es más de lo que debe el cliente (${f.money(e.payoff)} en esta fecha)`,
      );
    case "before_start":
      return t("The date is before the loan started", "La fecha es anterior al inicio del préstamo");
    case "before_last_payment":
      return t("A later payment is already recorded", "Ya hay un pago registrado con fecha posterior");
    case "in_future":
      return t("The date is in the future", "La fecha está en el futuro");
    case "loan_closed":
      return t("This loan is closed", "Este préstamo está cerrado");
    case "fee_too_large":
      return t("The fee is larger than the payment", "El cargo es mayor que el pago");
  }
}

const partLabel = (t: T, p: "fee" | "interest" | "principal") =>
  p === "fee" ? t("late fees", "cargos por mora") : p === "interest" ? t("interest", "interés") : t("capital", "capital");

export function planErrorText(t: T, f: Fmt, e: PlanError): string {
  switch (e.code) {
    case "not_positive":
      return t("Enter an amount greater than zero", "Escribe un monto mayor que cero");
    case "in_future":
      return t("The date is in the future", "La fecha está en el futuro");
    case "before_start":
      return t("The date is before the loan started", "La fecha es anterior al inicio del préstamo");
    case "loan_closed":
      return t("The date is after the loan was marked as defaulted", "La fecha es posterior a cuando se marcó incobrable");
    case "overpayment":
      return t(
        `This is more than the client owes (${f.money(e.payoff)} on this date)`,
        `Es más de lo que debe el cliente (${f.money(e.payoff)} en esta fecha)`,
      );
    case "exceeds_installment":
      return t(
        `Installment ${e.seq} only owes ${f.money(e.owed)} on this date. Spread the payment to cover more.`,
        `La cuota ${e.seq} solo debe ${f.money(e.owed)} en esta fecha. Reparte el pago para cubrir más.`,
      );
    case "no_such_installment":
      return t(`There is no installment ${e.seq}`, `No existe la cuota ${e.seq}`);
    case "split_mismatch":
      return t(
        `The amounts add up to ${f.money(e.allocated)}, not ${f.money(e.amount)}`,
        `Los montos suman ${f.money(e.allocated)}, no ${f.money(e.amount)}`,
      );
    case "exceeds_part":
      return t(
        `Only ${f.money(e.owed)} of ${partLabel(t, e.part)} is owed on this date`,
        `Solo se deben ${f.money(e.owed)} de ${partLabel(t, e.part)} en esta fecha`,
      );
  }
}

export function scheduleErrorText(t: T, f: Fmt, e: ScheduleError): string {
  switch (e.code) {
    case "empty":
      return t("Add at least one installment", "Agrega al menos una cuota");
    case "unallocated": {
      const [a, p, d] = [f.money(e.allocated), f.money(e.principal), f.money(e.principal - e.allocated)];
      return t(
        `The installments repay ${a} of capital, not ${p} (${d} difference).`,
        `Las cuotas pagan ${a} de capital, no ${p} (diferencia de ${d}).`,
      );
    }
    case "negative":
      return t(`Installment ${e.seq} has a negative amount`, `La cuota ${e.seq} tiene un monto negativo`);
    case "date_order":
      return t(
        `Installment ${e.seq} must be due after the one before it (and after the loan date)`,
        `La cuota ${e.seq} debe vencer después de la anterior (y después de la fecha del préstamo)`,
      );
  }
}

function invalidText(t: T, d: ErrorData): string {
  switch (d.reason) {
    case "required":
      return t("Fill in the required fields", "Completa los campos obligatorios");
    case "too_long":
      return t(`That text is too long (${d.max} characters at most)`, `El texto es muy largo (máximo ${d.max} caracteres)`);
    case "one_line":
      return t("Write it on one line", "Escríbelo en una sola línea");
    case "future":
      return t("The date can't be in the future", "La fecha no puede ser futura");
    case "date":
      return t("Enter a valid date", "Escribe una fecha válida");
    case "email":
      return t("Enter a valid email address, or leave it empty", "Escribe un correo válido o déjalo vacío");
    case "phone":
      return t("Phone numbers may contain digits, spaces and + - ( )", "El teléfono solo puede tener números, espacios y + - ( )");
    case "positive":
      return t("Enter an amount greater than zero", "Escribe un monto mayor que cero");
    case "fee_too_large":
      return t("The fee is larger than the payment", "El cargo es mayor que el pago");
    case "automatic_late_fees":
      return t("Late fees on installment loans are charged automatically", "En préstamos por cuotas los cargos por mora se calculan solos");
    case "terms":
      return d.field === "installments"
        ? t("Enter between 1 and 1,000 installments", "Escribe entre 1 y 1,000 cuotas")
        : d.field === "rate" || d.field === "late_fee"
          ? t("The rate must be between 0% and 100% per period", "La tasa debe estar entre 0% y 100% por período")
          : t("Enter an amount greater than zero", "Escribe un monto mayor que cero");
    case "before_start":
      return t("The date is before the loan started", "La fecha es anterior al inicio del préstamo");
    case "before_last_payment":
      return t("The date is before the latest payment", "La fecha es anterior al último pago");
    case "photo":
      return t("Use a JPEG, PNG or WebP picture under 4 MB", "Usa una foto JPEG, PNG o WebP de menos de 4 MB");
    case "confirm_name":
      return t("Type the business name exactly as shown", "Escribe el nombre del negocio tal como aparece");
    case "logo":
      return t("Use a PNG, JPEG or WebP picture under 1 MB", "Usa una imagen PNG, JPEG o WebP de menos de 1 MB");
    default:
      return t("Check the values and try again", "Revisa los valores e inténtalo de nuevo");
  }
}

/** A sentence for any error a call can throw. */
export function describeError(t: T, f: Fmt, e: unknown): string {
  const d = errorData(e);
  if (!d) {
    return isNetworkError(e)
      ? t("No connection. Try again when you're online.", "Sin conexión. Inténtalo de nuevo cuando estés en línea.")
      : t("Something went wrong. Try again.", "Algo salió mal. Inténtalo de nuevo.");
  }
  return describeErrorData(t, f, d);
}

export function describeErrorData(t: T, f: Fmt, d: ErrorData): string {
  switch (d.code) {
    case "unauthenticated":
      return t("Your session ended. Sign in again.", "Tu sesión terminó. Inicia sesión de nuevo.");
    case "email_not_verified":
      return t("Confirm your email address first.", "Primero confirma tu correo.");
    case "forbidden":
      return t("Your role doesn't allow this. Ask an admin.", "Tu rol no permite esto. Pídeselo a un administrador.");
    case "not_found":
      return t("That record no longer exists.", "Ese registro ya no existe.");
    case "invalid":
      return invalidText(t, d);
    case "conflict":
      return t(
        "Someone changed this record while you were editing it. Review the current values and try again.",
        "Alguien cambió este registro mientras lo editabas. Revisa los valores actuales e inténtalo de nuevo.",
      );
    case "stale":
      return t(
        "The loan changed after this payment was entered (another payment may have been recorded). Review the loan, then confirm or discard.",
        "El préstamo cambió después de anotar este pago (quizá se registró otro pago). Revisa el préstamo y luego confirma o descarta.",
      );
    case "insufficient_cash": {
      const avail = f.money(Number(d.available));
      return d.account
        ? t(`Only ${avail} is available in ${accountLabel(t, d.account as "capital").toLowerCase()}.`, `Solo hay ${avail} en ${accountLabel(t, d.account as "capital").toLowerCase()}.`)
        : t(`Only ${avail} is available to lend on that date.`, `Solo hay ${avail} disponibles para prestar en esa fecha.`);
    }
    case "cash_shortfall": {
      const day = f.day(String(d.date));
      return t(
        `This would leave an account below zero on ${day}, because the money was already lent, spent or withdrawn.`,
        `Esto dejaría una cuenta por debajo de cero el ${day}, porque el dinero ya se prestó, gastó o retiró.`,
      );
    }
    case "payment":
    case "plan": {
      const [amount, date] = [f.money(Number(d.amount)), f.day(String(d.paidOn))];
      const why =
        d.code === "payment" ? paymentErrorText(t, f, d.error as PaymentError) : planErrorText(t, f, d.error as PlanError);
      return t(`The payment of ${amount} on ${date} doesn't fit: ${why}`, `El pago de ${amount} del ${date} no cuadra: ${why}`);
    }
    case "schedule":
      return scheduleErrorText(t, f, d.error as ScheduleError);
    case "loan_closed":
      return t("This loan is closed", "Este préstamo está cerrado");
    case "archived_client":
      return t("This client is archived. Restore the client first.", "Este cliente está archivado. Restáuralo primero.");
    case "client_has_loans":
      return t(
        "This client has loans. Delete the loans, or move them to another client, first.",
        "Este cliente tiene préstamos. Primero elimínalos o pásalos a otro cliente.",
      );
    case "loan_not_active":
      return t("Only active loans can be marked as defaulted", "Solo los préstamos activos pueden marcarse como incobrables");
    case "loan_not_defaulted":
      return t("Only defaulted loans can be reinstated", "Solo los préstamos incobrables pueden reactivarse");
    case "no_late_fee":
      return t("There is no late fee on that installment", "Esa cuota no tiene cargo por mora");
    case "nothing_to_adjust":
      return t("Nothing to adjust: the amounts already match.", "No hay nada que ajustar: los montos ya coinciden.");
    case "rate_limited":
      return t("Too many attempts. Wait a while and try again.", "Demasiados intentos. Espera un rato e inténtalo de nuevo.");
    case "last_admin":
      return t("A business needs at least one admin.", "Un negocio necesita al menos un administrador.");
    case "already_member":
      return t("That person is already a member.", "Esa persona ya es miembro.");
    case "invite_invalid":
      return t("This invitation is no longer valid. Ask for a new one.", "Esta invitación ya no es válida. Pide una nueva.");
    case "invite_other_email":
      return t(
        `This invitation is for ${d.email}. Sign in with that address.`,
        `Esta invitación es para ${d.email}. Inicia sesión con ese correo.`,
      );
    default:
      return t("Something went wrong. Try again.", "Algo salió mal. Inténtalo de nuevo.");
  }
}

/** Codes after which retrying the same operation can never work: a person
 *  has to look at it (convex/lib/errors.ts PERMANENT, plus role changes). */
export const NEEDS_PERSON = new Set([
  "forbidden",
  "not_found",
  "invalid",
  "stale",
  "conflict",
  "insufficient_cash",
  "cash_shortfall",
  "payment",
  "plan",
  "loan_closed",
  "archived_client",
  "email_not_verified",
]);
