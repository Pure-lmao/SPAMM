# Aggregator instruction coverage matrix

Mollusk suite beside this file. `H` = happy path with post-state / token deltas. `E` = exact `SpammError` or `ProgramError`. `B` = both sides of a numeric/time boundary. `L` = multi-ix lifecycle on one `Env`. Compute samples live in `cu_ledger.md`.

| Instruction | H | E | B | L | Notes |
|---|---|---|---|---|---|
| `init_program` | x | x | | | Wrong authority / already-init in `ix_init_program` |
| `change_config_status` | x | x | | x | Pause matrix in `ix_business_rules` |
| `register_mm` / `deregister_mm` | x | x | | x | Extra program-id copies in `ix_account_budget` |
| `fill_bet` | x | x | x | x | `MIN_BET_AMOUNT`; 2-MM fill; adversarial skip |
| `fill_parlay` | x | x | | | 2-leg + 20-leg safe odds; adversarial slippage / short |
| `fill_rfq_bet` | x | x | x | | Expiry; `MmNotRegistered`; adversarial short |
| `fill_rfq_parlay` | x | x | | | 40-leg product that fits `u32` |
| `freebet_fill_*` | x | x | x | x | Allowlist, odds, legs, used, expire |
| `grade_bets` / `grade_parlay` | x | x | | x | Cashed-out original → `InvalidInstructionData` unless `RolledBack` |
| `fill_cashout` / `fill_parlay_cashout` | x | x | x | x | Amount 0 / over remaining; live delay; odds drift |
| `fill_rfq_cashout` / `fill_rfq_parlay_cashout` | x | x | x | | Cashout RFQ expiry −1 / expiry |
| `claim` / `revert` cashout | x | x | x | | `created_at + LIVE_CASHOUT_DELAY` |
| `settle_*` including freebet | x | x | | x | `InvalidCashout` on cashed-out tickets |
| `get_*_quote_proxy` | x | | | | N that fits 64 accounts; N+1 cannot submit |
| netting add/remove/close | x | x | | x | Two-user line, withdraw, close PDA |
| `withdraw` | x | x | | x | Blocked while paused / open liability |

Host `#[cfg(test)]` math (odds, parlay product, `split_fillers`, liability shortfall, freebet settle map) lives next to the helpers under `aggregator/program/src/helpers/`.
