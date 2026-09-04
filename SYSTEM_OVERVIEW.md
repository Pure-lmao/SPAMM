# SPAMM — system overview (for agents)

Agent-oriented map of how the **aggregator** and **SPAMMs** fit together. Prefer this over reading the whole repo first.

| Doc | Use for |
| --- | --- |
| [`README.md`](README.md) | Instruction account tables, `MUST` SPAMM contract, full flows, errors |
| [`id-system.md`](id-system.md) | `mkt` / period / side encoding |
| [`Why-SPAMMs.md`](Why-SPAMMs.md) | Product motivation |
| This file | Mental model, repo map, where code lives, caps, disc ranges |

**Out of scope:** `score_predict/`, UI, API internals, example MM pricing math.

Programs are **Pinocchio** (`no_std`), not Anchor. Clients use **`@solana/kit`**, not `@solana/web3.js`.

---

## Idea

SPAMMs are Solana programs that **quote sports bets**. The **aggregator** routes fills, holds **MM liability** (encumbrance PDA → liability ATA), and settles. Each `MarketId` embeds a **market operator** who grades; aggregator config `authority` is grade fallback only.

| Path | Competition | Authenticity |
| --- | --- | --- |
| **Auction** | Re-`get_quote` on-chain; fill best odds first (singles ≤5 MMs; parlays **1** MM) | Quote **buffer** written on quote, checked on fill |
| **RFQ** | Off-chain signed firm quote; one MM | **ed25519** vs on-chain `rfq_signer` |

Also: **cashout** (novate a stake slice to a filling MM), **freebets** (issuer ATA funds stake; profit to user / stake back to issuer on win).

---

## Mental model

User stake → **bet ATA** (authority = bet PDA). MM profit collateral → **liability ATA** (authority = aggregator **encumbrance PDA**). Optional **peak-reserve netting** posts only `max(open P per outcome)` per line, not Σ tickets. Operator grades result bytes; **anyone** settles. API publishes ids / live snapshots and RFQ fan-out — **no funds**.

---

## Repo map

| Path | Role |
| --- | --- |
| `aggregator/program` | Aggregator. Router: `lib.rs` → `instructions/mod.rs`. Ix bodies: `state/ix_*.rs` + `ix_common.rs`. CPI packets: `state/mm_*.rs`. Shared: `helpers/`. |
| `aggregator/sdk/ts` | Kit SDK: codecs, ix builders, PDAs, RFQ builders, errors |
| `aggregator/client` | Dev scripts only — not the protocol |
| `market_maker/program` | Example SPAMM (framework CPI surface; stub pricing) |
| `market_maker/sdk/ts` | Example MM builders |
| `market_maker/backend` | Example: API → `init_event` / `init_market` / odds updates |
| `api/` | Catalog, live `EventGameState`+sequence, RFQ hub |
| `.cursor/rules/mollusk-tests.mdc` | How to build-sbf + run Mollusk tests |

---

## Actors (trust in one line)

| Actor | Trust |
| --- | --- |
| Aggregator authority | Pause, deregister, grade fallback, admin tooling |
| Market operator | Honest grades on markets bearing their pubkey in `MarketId` |
| MM admin / `rfq_signer` | Odds quality / firm RFQ — **not** custody of user stake |
| Feepayer | Rent for bet PDA/ATA; returned on close |
| Freebet issuer | Funds promo stake; optional MM + operator whitelists |

**Re-quote at fill time** makes spoofing build-time auction quotes pointless. RFQ parlays trust the **signed message** (no per-leg PDAs). Betting mint + `RFQ_NETWORK_DOMAIN` are **baked** (`constants.rs`). Program id: `5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H`.

---

## Identifiers (sketch — details in README / `id-system.md`)

- **`EventId`**: `event:u64` + `league:u16` + `sport:u8` (`Sport` in `state/ids.rs`).
- **`MarketId`**: `EventId` + `player` + `mkt` + `period` + `is_pregame` + **`operator`**. Market-data PDA seeds use body + operator separately.
- **Event state** (MM PDA `["event_state", event_id]`): `sequence` 0=uninit, **1=pregame**, **≥2=live** + 8-byte `EventGameState`. Auction/RFQ singles must match fill snapshot or the MM is skipped/fails.
- **Odds**: `ODDS_SCALE = 10_000`. Profit = `amount * (odds − scale) / scale`. Parlay ticket odds = product of **positive** leg odds; `0` leg odds = same-event companion (SGP).
- **`bet_id`**: user `u64`. Seeds `["bet"|"parlay", user, bet_id_le]`.

---

## Accounts at a glance

**Aggregator-owned** (discs **0–99**): config `["config"]`, mm_list, bet/parlay, bet ATA, encumbrance `["encumbrance", mm]`, liability ATA, netting `["netting", mm, event]`, cashout escrow/account/parlay, freebet issuer + freebet PDAs. Full table: README “Accounts at a Glance”.

**MM-owned** (discs **≥100**): config `["config"]` (`admin`, `rfq_signer`), quote buffers (`102` / `103`), event state `104`, market data `100`, MM collateral ATA. Quote buffers are **one per MM program** — concurrent auction quotes race.

| Cap | Value |
| --- | --- |
| Auction MMs / cashout auction MMs | 5 |
| Quote proxy MMs | ≤20 (return-data limited) |
| Auction / buffer parlay legs | 20 |
| RFQ parlay legs | 40 |
| Freebet whitelist MMs / operators | 10 / 5 (`0` = any) |

---

## Flows (what happens, not account metas)

**Auction single** → simulate proxies optional → `fill_bet` (re-quote → sort → `fill_quote` CPI → stake in → netting?) → `grade_bets` → `settle_bet`.

**Auction parlay** → same with `fill_parlay` / one MM / **no netting** / legs 2..=20.

**RFQ** → MM `rfq_signer` + `/ws/mm` hello → `POST /api/rfq` → signed quote → `fill_rfq_bet` / `fill_rfq_parlay`. Domain byte + kind `1`–`4` in `state/rfq_message.rs`. Open-quote signature covers `max_stake`, **not** fill `amount`. RFQ parlay: **no** per-leg PDAs.

**Cashout** → novate slice to `["cashout"|"cashout_parlay", filling_mm, cashout_id]`. Auction `70`/`71`, RFQ `72`/`73`. Payment = free liability first, then MM `amount_to_send` remainder. Pregame → user; live → escrow + `LIVE_CASHOUT_DELAY` → `claim_cashout_escrow` / `revert_cashout` on rollback. **Freebets cannot cash out.** Settle cashouts pay filling MM **liability ATA**.

**Freebet** → issuer ATA funds stake (`freebet_fill_*` 15–18: `freebet_id` prefix + fill body; RFQ sig still **unprefixed**). All-or-nothing amount. Settle `27`/`28`: leftovers → issuer; profit → user; reinstate on void/half.

**Netting** → peak-reserve on eligible FT/ML/BTTS/OU/AH lines; unnetted = full `P` (parlays, player mkts, soccer HT 1X2, missing PDA). Details: README “Liability Netting”.

---

## Discriminators (ranges)

**Aggregator:** `0–3` admin/register · `10–13` fills · `15–18` freebet fills · `20–21` grade · `25–28` settle · `30–34` proxies · `40–43` netting · `50` withdraw liability · `60–64` freebet issuer · `70–75` cashout · `254–255` devnet admin.

**MM:** `100–101` init/signer · `110–114` event/market · `120–123` auction quote/fill · `130–131` RFQ fill · `140–145` cashout quote/fill · `150` withdraw · `254–255` admin. Quote CPIs **must never error** — return `(0,0)` / `max_payment=0`.

Full names: README tables.

---

## Where to change code

| Task | Start |
| --- | --- |
| Fill / settle / cashout / freebet math | `instructions/`, `helpers/fill_helpers.rs`, `helpers/cashout_helpers.rs`, `helpers/freebet_helpers.rs`, `state/account_netting.rs` |
| Ids / sides / netting eligibility | `state/ids.rs`, `id-system.md`, `state/ix_common.rs` |
| User ix wire | `state/ix_*.rs` |
| RFQ bytes | `state/rfq_message.rs`, `sdk/ts/src/rfq.ts` |
| New aggregator ix | `instructions/mod.rs` + `state/ix_*.rs` + SDK |
| New SPAMM | README framework + `market_maker/program` handlers |
| Client txs | `aggregator/sdk/ts` only |

**Tests:** Mollusk needs `cargo build-sbf` for aggregator **and** example MM, then `cargo test -p spamm_aggregator --features test-sbf --test spamm_mollusk -- --test-threads=1`. See `.cursor/rules/mollusk-tests.mdc`.
