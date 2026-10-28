//! Differential-test oracle: compiles the desktop app's own engine files
//! (read-only, by path) and writes random scenarios with their results as
//! JSON, for the PWA's TypeScript engine to reproduce exactly.
//!
//! Usage: engine-oracle <seed> <count> > vectors.json

#[macro_export]
macro_rules! tr {
    ($en:literal, $es:literal $(,)?) => {
        if $crate::i18n::is_es() { format!($es) } else { format!($en) }
    };
}

pub mod i18n {
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
    pub enum Lang {
        #[default]
        En,
        Es,
    }
    pub fn get() -> Lang {
        Lang::En
    }
    pub fn is_es() -> bool {
        false
    }
    pub fn t(en: &'static str, _es: &'static str) -> &'static str {
        en
    }
    pub fn month_name(_m: u32) -> &'static str {
        "month"
    }
}

pub mod utils {
    #[path = "C:/DEV/LOANS APP/src/utils/dates.rs"]
    pub mod dates;
}

#[allow(dead_code)]
pub mod domain {
    #[path = "C:/DEV/LOANS APP/src/domain/installments.rs"]
    pub mod installments;
    #[path = "C:/DEV/LOANS APP/src/domain/ledger.rs"]
    pub mod ledger;
    #[path = "C:/DEV/LOANS APP/src/domain/loans.rs"]
    pub mod loans;
    #[path = "C:/DEV/LOANS APP/src/domain/money.rs"]
    pub mod money;
    #[path = "C:/DEV/LOANS APP/src/domain/portfolio.rs"]
    pub mod portfolio;
}

use chrono::{Duration, NaiveDate};
use domain::installments::{self as inst, Applied, Installment, Instruction, Plan, PlanError, PlanPayment, PlanState};
use domain::ledger::{self, ContractStatus, LoanFacts, PaymentError, PaymentFact, PaymentInput, Position};
use domain::loans::{Frequency, Method, PeriodRate};
use domain::money::{Cents, Rate};
use domain::portfolio::{Account, Book, CapitalFact, CapitalKind, EntryFact, EntryKind, LoanBook};
use serde_json::{Value, json};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        lo + (self.next() % ((hi - lo + 1) as u64)) as i64
    }
    fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[(self.next() % xs.len() as u64) as usize]
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}

fn iso(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}
fn opt_iso(d: Option<NaiveDate>) -> Value {
    d.map(|d| Value::String(iso(d))).unwrap_or(Value::Null)
}

const TODAY: NaiveDate = NaiveDate::from_ymd_opt(2029, 12, 31).unwrap();

fn payment_error(e: &PaymentError) -> Value {
    match e {
        PaymentError::NotPositive => json!({"code": "not_positive"}),
        PaymentError::Overpayment { payoff } => json!({"code": "overpayment", "payoff": payoff}),
        PaymentError::BeforeStart => json!({"code": "before_start"}),
        PaymentError::BeforeLastPayment { last } => json!({"code": "before_last_payment", "last": iso(*last)}),
        PaymentError::InFuture => json!({"code": "in_future"}),
        PaymentError::LoanClosed => json!({"code": "loan_closed"}),
        PaymentError::FeeTooLarge => json!({"code": "fee_too_large"}),
    }
}

fn part_key(p: inst::Part) -> &'static str {
    match p {
        inst::Part::Fee => "fee",
        inst::Part::Interest => "interest",
        inst::Part::Principal => "principal",
    }
}

fn plan_error(e: &PlanError) -> Value {
    match e {
        PlanError::NotPositive => json!({"code": "not_positive"}),
        PlanError::InFuture => json!({"code": "in_future"}),
        PlanError::BeforeStart => json!({"code": "before_start"}),
        PlanError::LoanClosed => json!({"code": "loan_closed"}),
        PlanError::Overpayment { payoff } => json!({"code": "overpayment", "payoff": payoff}),
        PlanError::ExceedsInstallment { seq, owed } => json!({"code": "exceeds_installment", "seq": seq, "owed": owed}),
        PlanError::NoSuchInstallment(seq) => json!({"code": "no_such_installment", "seq": seq}),
        PlanError::SplitMismatch { allocated, amount } => {
            json!({"code": "split_mismatch", "allocated": allocated, "amount": amount})
        }
        PlanError::ExceedsPart { part, owed } => json!({"code": "exceeds_part", "part": part_key(*part), "owed": owed}),
    }
}

fn instruction_json(i: &Instruction) -> Value {
    match i {
        Instruction::Auto => json!({"kind": "auto"}),
        Instruction::Installment(seq) => json!({"kind": "installment", "seq": seq}),
        Instruction::Spread(parts) => {
            json!({"kind": "spread", "parts": parts.iter().map(|(s, a)| json!({"seq": s, "amount": a})).collect::<Vec<_>>()})
        }
        Instruction::Custom { principal, interest, fee } => {
            json!({"kind": "custom", "principal": principal, "interest": interest, "fee": fee})
        }
        Instruction::Fixed(_) => unreachable!(),
    }
}

fn applied_json(a: &[Applied]) -> Value {
    Value::Array(
        a.iter().map(|x| json!({"seq": x.seq, "principal": x.principal, "interest": x.interest, "fee": x.fee})).collect(),
    )
}

fn position_json(p: &Position) -> Value {
    json!({
        "principalOutstanding": p.principal_outstanding,
        "interestOutstanding": p.interest_outstanding,
        "interestChargedTotal": p.interest_charged_total,
        "interestPaid": p.interest_paid,
        "principalPaid": p.principal_paid,
        "feesPaid": p.fees_paid,
        "feesOutstanding": p.fees_outstanding,
        "paidTotal": p.paid_total,
        "lastEvent": opt_iso(p.last_event),
        "periods": p.periods.iter().map(|x| json!({
            "seq": x.seq, "starts": iso(x.starts), "due": iso(x.due), "balance": x.balance, "interest": x.interest
        })).collect::<Vec<_>>(),
    })
}

fn delinquency_json(q: &ledger::Delinquency) -> Value {
    json!({
        "overdueAmount": q.overdue_amount,
        "daysOverdue": q.days_overdue,
        "overdueSince": opt_iso(q.overdue_since),
        "nextDue": opt_iso(q.next_due),
        "nextDueAmount": q.next_due_amount,
    })
}

fn display_key(s: ledger::DisplayStatus) -> &'static str {
    use ledger::DisplayStatus::*;
    match s {
        Overdue => "overdue",
        DueSoon => "due_soon",
        Active => "active",
        Defaulted => "defaulted",
        Restructured => "restructured",
        PaidOff => "paid_off",
    }
}

fn state_json(s: &PlanState, today: NaiveDate) -> Value {
    json!({
        "installments": s.installments.iter().map(|x| json!({
            "seq": x.seq, "starts": iso(x.starts), "due": iso(x.due), "principal": x.principal,
            "interest": x.interest, "charged": x.charged, "balanceAtStart": x.balance_at_start,
            "fee": x.fee, "feeBase": x.fee_base, "feeAssessedOn": opt_iso(x.fee_assessed_on),
            "feeWaived": x.fee_waived, "paidPrincipal": x.paid_principal, "paidInterest": x.paid_interest,
            "paidFee": x.paid_fee,
            "status": format!("{:?}", x.status(today)),
        })).collect::<Vec<_>>(),
        "payments": s.payments.iter().map(|a| applied_json(a)).collect::<Vec<_>>(),
        "paidTotal": s.paid_total,
        "lastPayment": opt_iso(s.last_payment),
    })
}

struct Loan {
    facts: LoanFacts,
    method: Method,
    plan: Option<Plan>,
    /// Accepted payments in ledger order: (date, amount, fee, instruction).
    accepted: Vec<(NaiveDate, Cents, Cents, Instruction)>,
    /// Current splits of accepted payments.
    splits: Vec<Vec<Applied>>,
    facts_splits: Vec<PaymentFact>,
}

fn random_frequency(r: &mut Rng) -> Frequency {
    r.pick(&[Frequency::Daily, Frequency::Weekly, Frequency::Biweekly, Frequency::Monthly])
}

fn random_rate(r: &mut Rng) -> i64 {
    match r.range(0, 9) {
        0 => 0,
        1 => 50_000,
        2 | 3 => 100_000,
        4 => 150_000,
        5 => 33_333,
        6 => 71_234,
        7 => 1_000_000,
        _ => r.range(1, 300_000),
    }
}

fn random_principal(r: &mut Rng) -> i64 {
    match r.range(0, 9) {
        0 => r.range(1, 99),
        1 => 100_000,
        2 => 1_000_000,
        3 => 333_333,
        4 => 999_999_999_999,
        _ => r.range(100, 50_000_000),
    }
}

/// Re-runs every accepted payment plus a candidate, the way the desktop
/// services do (reallocate_loan). Returns the new splits or the error.
fn try_payments(
    loan: &Loan,
    candidate: &[(NaiveDate, Cents, Cents, Instruction)],
) -> Result<(Vec<Vec<Applied>>, Vec<PaymentFact>), Value> {
    match &loan.plan {
        None => {
            let inputs: Vec<PaymentInput> =
                candidate.iter().map(|(d, a, f, _)| PaymentInput { paid_on: *d, amount: *a, fee: *f }).collect();
            let allocs = ledger::reallocate(&loan.facts, &inputs, TODAY)
                .map_err(|(i, e)| json!({"index": i, "error": payment_error(&e)}))?;
            let facts: Vec<PaymentFact> = candidate
                .iter()
                .zip(&allocs)
                .map(|((d, ..), a)| PaymentFact { paid_on: *d, principal: a.principal, interest: a.interest, fee: a.fee })
                .collect();
            let splits =
                allocs.iter().map(|a| vec![Applied { seq: 0, principal: a.principal, interest: a.interest, fee: a.fee }]).collect();
            Ok((splits, facts))
        }
        Some(plan) => {
            let pays: Vec<PlanPayment> = candidate
                .iter()
                .map(|(d, a, _, i)| PlanPayment { paid_on: *d, amount: *a, instruction: i.clone() })
                .collect();
            let as_of = candidate.last().map_or(TODAY, |p| TODAY.max(p.0));
            let state = inst::run(&loan.facts, plan, &pays, as_of, as_of)
                .map_err(|(i, e)| json!({"index": i, "error": plan_error(&e)}))?;
            let facts = candidate
                .iter()
                .zip(&state.payments)
                .map(|((d, ..), a)| PaymentFact {
                    paid_on: *d,
                    principal: a.iter().map(|x| x.principal).sum(),
                    interest: a.iter().map(|x| x.interest).sum(),
                    fee: a.iter().map(|x| x.fee).sum(),
                })
                .collect();
            Ok((state.payments.clone(), facts))
        }
    }
}

fn scenario(r: &mut Rng, id: usize) -> (Value, Loan) {
    let start = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap() + Duration::days(r.range(0, 500));
    let method = r.pick(&[Method::Declining, Method::Declining, Method::Flat, Method::InterestOnly, Method::InterestOnly]);
    let frequency = random_frequency(r);
    let interest_period = if r.chance(50) { frequency } else { random_frequency(r) };
    let rate = random_rate(r);
    let principal = random_principal(r);
    let any_count = r.range(1, 60) as u32;
    let count = if method == Method::InterestOnly { 0 } else { r.pick(&[1, 2, 3, 5, 12, 24, any_count]) };
    let any_fee = r.range(1, 200_000);
    let fee_rate = r.pick(&[0, 50_000, 50_000, 100_000, any_fee]);
    let facts = LoanFacts {
        principal,
        rate: PeriodRate::new(Rate(rate), interest_period, frequency),
        frequency,
        start_date: start,
        status: ContractStatus::Active,
        closed_on: None,
    };
    let mut plan = None;
    let mut edited = false;
    if method != Method::InterestOnly {
        let mut schedule = inst::proposed_schedule(&facts, method, count);
        if r.chance(25) {
            // Hand-edited schedule: change some interest and one due date.
            for x in schedule.iter_mut() {
                if r.chance(40) {
                    x.interest = r.range(0, x.interest.max(1) * 2);
                }
            }
            if schedule.len() > 1 && r.chance(50) {
                let k = r.range(0, schedule.len() as i64 - 2) as usize;
                let lo = if k == 0 { start } else { schedule[k - 1].due };
                let gap = (schedule[k].due - lo).num_days();
                if gap > 1 {
                    schedule[k].due = lo + Duration::days(r.range(1, gap - 1));
                }
            }
            edited = true;
        }
        let waived: Vec<u32> = schedule.iter().filter(|_| r.chance(10)).map(|x| x.seq).collect();
        plan = Some(Plan { method, schedule, edited, fee_rate: Rate(fee_rate), waived, payments: Vec::new() });
    }
    let mut loan = Loan { facts, method, plan, accepted: Vec::new(), splits: Vec::new(), facts_splits: Vec::new() };

    let mut attempts = Vec::new();
    let mut last = start;
    let n = r.range(0, 14);
    for _ in 0..n {
        let on = if r.chance(12) { last - Duration::days(r.range(1, 20)) } else { last + Duration::days(r.range(0, 45)) };
        let on = if r.chance(3) { TODAY + Duration::days(1) } else { on };
        // What is owed right before it, to pick sensible amounts.
        let owed: Cents = match &loan.plan {
            None => ledger::owed_at_payment(&loan.facts, &loan.facts_splits, on).payoff(),
            Some(plan) => {
                let pays: Vec<PlanPayment> = loan
                    .accepted
                    .iter()
                    .filter(|p| p.0 <= on)
                    .map(|(d, a, _, i)| PlanPayment { paid_on: *d, amount: *a, instruction: i.clone() })
                    .collect();
                inst::run(&loan.facts, plan, &pays, on, TODAY).map(|s| s.payoff()).unwrap_or(0)
            }
        };
        let amount = match r.range(0, 9) {
            0 => owed,
            1 => owed + 1,
            2 => 0,
            3 => r.range(1, 100),
            _ => r.range(1, owed.max(2)),
        };
        let fee = if loan.plan.is_none() && r.chance(15) { r.range(0, amount.max(1) + 5) } else { 0 };
        let instruction = match &loan.plan {
            None => Instruction::Auto,
            Some(plan) => {
                let n = plan.schedule.len() as i64;
                match r.range(0, 5) {
                    0 | 1 => Instruction::Auto,
                    2 => Instruction::Installment(r.range(1, n + 1) as u32),
                    3 => {
                        let k = r.range(1, n.min(4));
                        let mut left = amount;
                        let mut parts = Vec::new();
                        for j in 0..k {
                            let seq = r.range(1, n) as u32;
                            let a = if j == k - 1 { left } else { r.range(0, left) };
                            left -= a;
                            if a > 0 && !parts.iter().any(|(s, _)| *s == seq) {
                                parts.push((seq, a));
                            }
                        }
                        Instruction::Spread(parts)
                    }
                    _ => {
                        let fee = r.range(0, amount / 4);
                        let interest = r.range(0, amount - fee);
                        Instruction::Custom { principal: amount - fee - interest, interest, fee }
                    }
                }
            }
        };
        // Insert in ledger order: after every payment dated on or before it.
        let mut candidate = loan.accepted.clone();
        let at = candidate.iter().position(|p| p.0 > on).unwrap_or(candidate.len());
        candidate.insert(at, (on, amount, fee, instruction.clone()));
        let result = try_payments(&loan, &candidate);
        let outcome = match result {
            Ok((splits, facts)) => {
                loan.accepted = candidate;
                loan.splits = splits.clone();
                loan.facts_splits = facts;
                last = last.max(on);
                json!({"ok": true, "splits": splits.iter().map(|a| applied_json(a)).collect::<Vec<_>>()})
            }
            Err(e) => json!({"ok": false, "error": e}),
        };
        attempts.push(json!({
            "paidOn": iso(on), "amount": amount, "fee": fee, "instruction": instruction_json(&instruction),
            "outcome": outcome,
        }));
    }

    // Final contract status: sometimes defaulted after the last payment.
    let paid_off = match &loan.plan {
        None => !loan.facts_splits.is_empty() && ledger::position(&loan.facts, &loan.facts_splits, TODAY).payoff() == 0 && {
            let p = ledger::position(&loan.facts, &loan.facts_splits, last);
            p.principal_outstanding == 0
        },
        Some(plan) => {
            let pays: Vec<PlanPayment> = loan
                .accepted
                .iter()
                .zip(&loan.splits)
                .map(|((d, a, _, _), s)| PlanPayment { paid_on: *d, amount: *a, instruction: Instruction::Fixed(s.clone()) })
                .collect();
            inst::run(&loan.facts, plan, &pays, last, TODAY).map(|s| s.paid_off()).unwrap_or(false)
        }
    };
    if paid_off {
        loan.facts.status = ContractStatus::PaidOff;
    } else if r.chance(15) {
        loan.facts.status = ContractStatus::Defaulted;
        loan.facts.closed_on = Some(last + Duration::days(r.range(0, 90)));
    }

    // Checkpoints.
    let mut dates = vec![start - Duration::days(1), start, start + Duration::days(1)];
    for p in &loan.accepted {
        dates.push(p.0);
        dates.push(p.0 + Duration::days(1));
    }
    dates.extend([last + Duration::days(16), last + Duration::days(61), last + Duration::days(400)]);
    let mut checkpoints = Vec::new();
    for as_of in dates {
        let cp = match &loan.plan {
            None => {
                let pos = ledger::position(&loan.facts, &loan.facts_splits, as_of);
                let q = ledger::delinquency(&loan.facts, &loan.facts_splits, as_of);
                let owed = ledger::owed_at_payment(&loan.facts, &loan.facts_splits, as_of);
                json!({
                    "asOf": iso(as_of),
                    "position": position_json(&pos),
                    "owedAtPayment": position_json(&owed),
                    "delinquency": delinquency_json(&q),
                    "display": display_key(ledger::display_status(&loan.facts, &q, as_of)),
                    "periodStates": ledger::period_states(&pos, as_of).iter().map(|(p, s, paid)| json!({
                        "seq": p.seq, "state": format!("{s:?}"), "paid": paid
                    })).collect::<Vec<_>>(),
                })
            }
            Some(plan) => {
                let pays: Vec<PlanPayment> = loan
                    .accepted
                    .iter()
                    .zip(&loan.splits)
                    .map(|((d, a, _, _), s)| PlanPayment { paid_on: *d, amount: *a, instruction: Instruction::Fixed(s.clone()) })
                    .collect();
                match inst::run(&loan.facts, plan, &pays, as_of, TODAY) {
                    Ok(s) => {
                        let q = s.delinquency(loan.facts.status, as_of);
                        json!({
                            "asOf": iso(as_of),
                            "state": state_json(&s, as_of),
                            "position": position_json(&s.position()),
                            "delinquency": delinquency_json(&q),
                            "display": display_key(ledger::display_status(&loan.facts, &q, as_of)),
                        })
                    }
                    Err((i, e)) => json!({"asOf": iso(as_of), "error": {"index": i, "error": plan_error(&e)}}),
                }
            }
        };
        checkpoints.push(cp);
    }

    // Reallocation after an edit of the terms (interest-only loans).
    let realloc = if loan.plan.is_none() {
        let edited = LoanFacts {
            principal: random_principal(r),
            rate: PeriodRate::new(Rate(random_rate(r)), random_frequency(r), loan.facts.frequency),
            start_date: start + Duration::days(r.range(-10, 10)),
            ..loan.facts.clone()
        };
        let inputs: Vec<PaymentInput> =
            loan.accepted.iter().map(|(d, a, f, _)| PaymentInput { paid_on: *d, amount: *a, fee: *f }).collect();
        let res = match ledger::reallocate(&edited, &inputs, TODAY) {
            Ok(allocs) => json!({"ok": true, "allocations": allocs.iter().map(|a| json!({
                "interest": a.interest, "principal": a.principal, "fee": a.fee,
                "principalBefore": a.principal_before, "principalAfter": a.principal_after, "interestAfter": a.interest_after,
            })).collect::<Vec<_>>()}),
            Err((i, e)) => json!({"ok": false, "index": i, "error": payment_error(&e)}),
        };
        json!({
            "principal": edited.principal, "rate": edited.rate.rate.0, "interestPeriod": edited.rate.per.key(),
            "startDate": iso(edited.start_date), "result": res,
        })
    } else {
        Value::Null
    };

    let loan_json = json!({
        "principal": principal, "rate": rate, "interestPeriod": interest_period.key(), "frequency": frequency.key(),
        "startDate": iso(start), "method": method.key(),
        "installments": if method == Method::InterestOnly { Value::Null } else { json!(count) },
        "lateFeeRate": fee_rate,
        "schedule": loan.plan.as_ref().map(|p| p.schedule.iter().map(|x: &Installment| json!({
            "seq": x.seq, "due": iso(x.due), "principal": x.principal, "interest": x.interest
        })).collect::<Vec<_>>()),
        "edited": edited,
        "waived": loan.plan.as_ref().map(|p| p.waived.clone()).unwrap_or_default(),
        "finalStatus": loan.facts.status.key(), "closedOn": opt_iso(loan.facts.closed_on),
    });
    (json!({"id": id, "loan": loan_json, "attempts": attempts, "checkpoints": checkpoints, "realloc": realloc}), loan)
}

fn summary_json(s: &domain::portfolio::Summary) -> Value {
    json!({
        "contributions": s.contributions, "withdrawals": s.withdrawals, "principalDisbursed": s.principal_disbursed,
        "principalRepaid": s.principal_repaid, "interestCollected": s.interest_collected, "feesCollected": s.fees_collected,
        "capitalExpenses": s.capital_expenses, "interestExpenses": s.interest_expenses, "capitalIncome": s.capital_income,
        "otherIncome": s.other_income, "capitalAdjustments": s.capital_adjustments,
        "interestAdjustments": s.interest_adjustments, "availableCapital": s.available_capital,
        "availableInterest": s.available_interest, "availableCash": s.available_cash,
        "outstandingPrincipal": s.outstanding_principal, "interestReceivable": s.interest_receivable,
        "feesReceivable": s.fees_receivable, "defaultedPrincipal": s.defaulted_principal,
        "defaultedInterest": s.defaulted_interest, "portfolioValue": s.portfolio_value, "activeLoans": s.active_loans,
        "overdueLoans": s.overdue_loans, "dueSoonLoans": s.due_soon_loans, "overdueAmount": s.overdue_amount,
        "expectedMonthlyInterest": s.expected_monthly_interest,
        "netInvested": s.net_invested(), "gain": s.gain(),
    })
}

fn book(r: &mut Rng, loans: Vec<Loan>, ids: Vec<usize>) -> Value {
    let mut first = NaiveDate::from_ymd_opt(2030, 1, 1).unwrap();
    let mut book_loans = Vec::new();
    for (i, l) in loans.into_iter().enumerate() {
        first = first.min(l.facts.start_date);
        let plan = l.plan.map(|mut p| {
            p.payments = l
                .accepted
                .iter()
                .zip(&l.splits)
                .map(|((d, a, _, _), s)| PlanPayment { paid_on: *d, amount: *a, instruction: Instruction::Fixed(s.clone()) })
                .collect();
            p
        });
        let _ = l.method;
        book_loans.push(LoanBook { id: i as i64, client_id: 1, facts: l.facts, payments: l.facts_splits, plan });
    }
    let mut capital = Vec::new();
    let mut entries = Vec::new();
    let mut moves = Vec::new();
    for _ in 0..r.range(1, 6) {
        let kind = if r.chance(75) { CapitalKind::Contribution } else { CapitalKind::Withdrawal };
        let on = first + Duration::days(r.range(-30, 500));
        let amount = r.range(1, 100_000_000);
        capital.push(CapitalFact { id: capital.len() as i64, kind, amount, occurred_on: on });
        moves.push(json!({"type": "capital", "kind": kind.key(), "amount": amount, "occurredOn": iso(on)}));
    }
    for _ in 0..r.range(0, 8) {
        let kind = r.pick(&[EntryKind::Expense, EntryKind::Income, EntryKind::Transfer, EntryKind::Adjustment]);
        let account = r.pick(&[Account::Capital, Account::Interest]);
        let on = first + Duration::days(r.range(-10, 600));
        let mut amount = r.range(1, 5_000_000);
        if kind == EntryKind::Adjustment && r.chance(50) {
            amount = -amount;
        }
        entries.push(EntryFact { id: entries.len() as i64, kind, account, amount, occurred_on: on });
        moves.push(
            json!({"type": "entry", "kind": kind.key(), "account": account.key(), "amount": amount, "occurredOn": iso(on)}),
        );
    }
    let book = Book { loans: book_loans, capital, entries };
    let mut points = Vec::new();
    for k in 0..8 {
        let as_of = first + Duration::days(k * 97 - 5);
        let s = book.summary(as_of);
        let b = book.balances_on(as_of);
        points.push(json!({
            "asOf": iso(as_of),
            "summary": summary_json(&s),
            "balances": {"capital": b.capital, "interest": b.interest},
            "availableAll": book.available_from(as_of, None),
            "availableCapital": book.available_from(as_of, Some(Account::Capital)),
            "availableInterest": book.available_from(as_of, Some(Account::Interest)),
        }));
    }
    let to = first + Duration::days(700);
    let flows = book.monthly_cash_flow(to);
    let hist = book.history(first, first + Duration::days(r.range(0, 500)));
    json!({
        "loanIds": ids,
        "moves": moves,
        "points": points,
        "shortfall": book.shortfall().map(|s| json!({
            "date": iso(s.date), "account": s.account.map(|a| a.key()), "balance": s.balance
        })),
        "flowsTo": iso(to),
        "flows": flows.iter().map(|f| json!({
            "month": iso(f.month), "contributions": f.contributions, "withdrawals": f.withdrawals,
            "disbursed": f.disbursed, "principalReturned": f.principal_returned,
            "interestReceived": f.interest_received, "feesReceived": f.fees_received,
            "expenses": f.expenses, "income": f.income, "endingCash": f.ending_cash,
        })).collect::<Vec<_>>(),
        "historyFrom": iso(first),
        "historyTo": hist.last().map(|h| iso(h.date)),
        "history": hist.iter().map(|h| json!({
            "date": iso(h.date), "portfolioValue": h.portfolio_value, "netInvested": h.net_invested,
            "interestCollected": h.interest_collected,
        })).collect::<Vec<_>>(),
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seed: u64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(42);
    let count: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(300);
    let mut r = Rng(seed.max(1));
    let mut scenarios = Vec::new();
    let mut books = Vec::new();
    let mut pending: Vec<(usize, Loan)> = Vec::new();
    for id in 0..count {
        let (json, loan) = scenario(&mut r, id);
        scenarios.push(json);
        pending.push((id, loan));
        if pending.len() == 4 {
            let (ids, loans): (Vec<usize>, Vec<Loan>) = pending.drain(..).unzip();
            books.push(book(&mut r, loans, ids));
        }
    }
    println!("{}", json!({"seed": seed, "today": iso(TODAY), "scenarios": scenarios, "books": books}));
}
