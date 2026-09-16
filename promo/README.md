# Promo market maker

Separate SPAMM MM for ASM promo markets (`GET /promos?active=true`).

Promo markets are **mkt 9**, **side 0** only. Each market PDA is
`["market_data", market_id_body, operator]`. The operator is **not** part of the
SLEPMP market key — pass it as `--operator` (and the same pubkey must be on
`MarketId.operator` when the aggregator quotes/fills).

On `init_market`, an optional **allowlist** of user wallets is stored on the
market-data PDA. Empty allowlist (`allowed_count == 0`) means anyone may
quote/fill. If the list is non-empty, `get_quote` returns `(0, 0)` when the
user is not on it. Either way, a wallet that has already filled is rejected.
There is no instruction to edit the allowlist after init.

## Quick setup

From `promo/backend` (RPC + admin keypair from `backend/.env` and
`backend/keys/admin.json`):

```bash
cd promo/backend
bun install
bun run setup                    # init-program → activate → register-mm
bun run get-config               # config PDA + collateral ATA to fund
```

`setup` skips `init-program` if the config PDA already exists. Use
`--skip-register` if the MM is already on the aggregator.

### First promo market (one command)

After setup and funding collateral:

```bash
bun run init-promo -- \
  --market-key 1:1:12345:0:9: \
  --operator <operator_pubkey> \
  --allow <user_pk>[,user_pk…] \
  --start 1730000000 \
  --max-usdc 25 --max-total-usdc 5000 \
  --odds0 1.90
```

`--allow` may be repeated (`--allow pk1 --allow pk2`) and/or comma-separated
(1–150 unique pubkeys). Optional: `--odds1`, `--odds2`, `--outcomes 2|3`,
`--dry-run`.

One tx: init-event (if needed) → update-event-state (seq 1, PG 0-0) →
init-market (if needed) → set-odds.

## Program

Build and deploy `promo/program`, then set `PROMO_MM_PROGRAM_ID` if needed
(default: `ProMo6Ka3N1JLCaZrNTwnANQsCCfyKAm6R5TXM14LVQ`).

## Admin CLI

Every market command needs `--market-key` **and** `--operator`.

```bash
bun run promo-admin init-market --market-key 1:1:123:0:9: \
  --operator <pk> --allow <pk>[,pk…] \
  --start 1730000000 --max-usdc 25 --max-total-usdc 5000 --odds0 1.90
bun run promo-admin set-odds --market-key 1:1:123:0:9: --operator <pk> \
  --sequence 1 --odds0 1.90
bun run promo-admin set-max --market-key 1:1:123:0:9: --operator <pk> --max-usdc 25
bun run promo-admin set-max-total --market-key 1:1:123:0:9: --operator <pk> \
  --max-total-usdc 5000
bun run promo-admin close-market --market-key 1:1:123:0:9: --operator <pk>
bun run promo-admin withdraw [--dest <ata>]
bun run read-oracle --market-key 1:1:123:0:9: --operator <pk>
bun run sync-promos
```

`init-market` is the same bootstrap tx as `init-promo`.
`withdraw` (ix 150) sends the full MM collateral ATA to `--dest`, or the admin
ATA if omitted. `read-oracle` prints caps, allowlist, and filled bettors.

## Discord

Registered by the main alert bot. All of these take `operator`. Init also takes
a comma-separated `allow` list:

`/promo-init-market`, `/promo-set-odds`, `/promo-set-max`,
`/promo-set-max-total`, `/promo-status`, `/promo-close-market`.
