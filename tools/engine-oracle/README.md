# Engine oracle

Builds the desktop app's own engine files (`src/domain/*.rs`, `src/utils/dates.rs`)
read-only, by path, and writes random scenarios with their results as JSON for
`shared/domain/oracle.test.ts`.

The `#[path]` attributes in `src/main.rs` point at a local checkout of the
desktop repository (`C:/DEV/LOANS APP`); change them if yours is elsewhere.

```bash
cargo build --release
./target/release/engine-oracle 20261027 200 | gzip -9 > ../../shared/domain/fixtures/oracle-vectors.json.gz
./target/release/engine-oracle 99 3000 > big.json && ORACLE_VECTORS=big.json npx vitest run -t oracle
```
