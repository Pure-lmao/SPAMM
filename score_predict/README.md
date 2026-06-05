# Score Predict

On-chain prediction entry PDAs + API contests + UI.

## Deploy program

1. `cd score_predict/program && cargo build-sbf` (or project SBF toolchain).
2. Deploy and set `PROGRAM_ID` in `program/src/constants.rs` and `sdk/ts/src/constants.ts`.
3. Set `ADMIN` in the same files (placeholder is `[0u8; 32]` until replaced).

## Contest admin

```bash
cd score_predict/bot
bun install
bun run contest-cli.ts create --date 2026-06-03 --deadline 2026-06-03T20:00:00Z \
  --kind match_score --title "World Cup daily" --description "…" \
  --tweet-template "I am predicting {prediction} in {title} …"  # entry id is appended automatically
```

## Client CLI

```bash
cd score_predict/client
bun install
bun run cli.ts fetch user <pubkey>
```
