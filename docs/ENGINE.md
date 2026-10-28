# The financial engine and how it was verified

`shared/domain/` is a line-by-line TypeScript port of the desktop app's `src/domain/` and `src/utils/dates.rs` (Acervus Finance 0.5), plus the record-level parts of `src/services/` (`records.ts`: re-working every payment after a change, late-fee records, previews).

- Amounts are whole cents in JS numbers. Every amount the app accepts is at most 1e12, far below 2^53.
- Every multiplication that feeds a division (cents × ppm × days) is done in **BigInt** and rounded half away from zero, exactly like the desktop's `i128` arithmetic. No floating point touches money.
- Dates are ISO strings. Calendar math uses UTC day numbers, and "today" is computed in the business's time zone (`todayIn`), so every device and the server agree.

## Tests

1. **The desktop's own unit tests**, ported with the same hand-checked figures (`engine.test.ts`, 47 tests).
2. **A differential test against the Rust engine** (`oracle.test.ts`):
   - A scratch Rust program compiled the desktop's own `src/domain/*.rs` files **unchanged and read-only** (by path, not copied).
   - It generated random loans: every method and frequency, converted rates, 0–100% rates, 1 cent to 1e12 cents, edited schedules, waived fees and defaults.
   - It added random payment attempts: every allocation mode, plus backdated, too large, split mismatches, wrong installment and future-dated attempts.
   - It recorded the outcome of every attempt, every split, positions, delinquency and installment states at many dates, re-allocation after edited terms, and whole portfolios: summaries, both cash accounts, availability, shortfalls, monthly cash flow and history.
   - The TypeScript engine must reproduce every value exactly.
   - `fixtures/oracle-vectors.json.gz` holds 200 loans / 50 portfolios. A batch of **3,000 loans / 750 portfolios** was also run, with no differences.
   - A deliberately broken rounding rule makes these tests fail, so they do catch mistakes.

Re-run with a bigger batch: build `tools/engine-oracle` (its README), then run `ORACLE_VECTORS=<file> npx vitest run -t oracle`.
