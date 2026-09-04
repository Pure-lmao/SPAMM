# Overview

A Sports Programmatic Automated Market Maker (SPAMM) is a program that offers quotes for bets on sports markets. SPAMMs are inspired by propAMMs and their ability to offer better spreads than Binance (in-depth report on this [here](https://x.com/minnus/status/2059730629319680352)). Why can't bettors get better odds than on sportsbooks? As SPAMMs compete for flow, the odds they offer will improve and eventually beat sportsbooks. By aggregating these offers, bettors will have access to great odds via a single transaction. A non-technical overview of SPAMMs can be found [here](Why-SPAMMs.md).

The idea behind the framework could be further extended to binary or vanilla options, major prediction markets with a fair reference price (elections), or my as-yet-to-be-published idea of sports line options.

This is the **SPAMM Aggregator** program and framework. The framework defines what a **SPAMM** must do to be compliant with the aggregator and how to integrate with the aggregator.
The **aggregator** is responsible for filling user bets with offers from the integrated SPAMMs. The **market operator API** is responsible for providing **event and market ids**. Each SPAMM is responsible for offering quotes on whatever markets they wish. Any client can call each SPAMM's `get_quote` function to get the offer, then build a tx to fill the bet with the **5 best** quotes. The aggregator will then call `get_quote` again to get the **best execution-time** offers and fill the bet with the quotes in order of **best to worst odds**.

**Liability** for paying out winning bets is held in a token account whose **authority is the aggregator’s encumbrance PDA** for that MM (Token Program owns the ATA). This collateral must be transferred by the SPAMM during the `fill_quote` function.

Each market carries a **market operator** address on its `MarketId`; that operator (or the aggregator config `authority` when the operator is delinquent) grades outcomes via `grade_bets` / `grade_parlay`. Funds are transferred to the winners by calling `settle_bet` / `settle_parlay` on a graded bet.

In addition to the competitive, onchain `get_quote` / `fill_quote` auction, a SPAMM can fill via **RFQ**: an off-chain ed25519-signed quote (keyed by the MM’s `rfq_signer`) that the user submits through `fill_rfq_bet` / `fill_rfq_parlay`.

The aggregator also supports **cashout** for bets and parlays. For single bets, an onchain auction takes place between the 5 best offchain quotes and the bet is purchased by the highest bidding SPAMM. For parlays, the frontend gets the best quote and the cashout is purchased by that SPAMM. An RFQ path is also available for cashout.

Freebets can be issued by any Frontend Issuer to any user. The freebets are PDA that allow for a user to place a bet without any risk to themselves. Funds are transferred from the Issuer to the bet at placement time. If the user wins, they get the profit from the market maker and the freebet funds are returned to the Issuers. If the user loses, the market maker gets the stake. For this reason, the Issuer can limit the use of the freebet to specific `Market Operators` (to ensure it is used with a trusted source) and market makers to allow for using it at an affiliated SPAMM(s) so the funds come back to the Issuer.

There are many ways SPAMMs could work:

- one might generally quote most markets based on a sports data feed and add basic vig and risk management.
- one might try to capture losing-bettor flow by gathering lots of data and filling their config PDA with those wallets that they want to give an odds boost to.
- one might focus on a specific league such as NBA and try to quote it very tightly to get almost 100% of the flow.
- one might be run by a team that originates their own odds for a league like NFL, and quotes it with a skew vs the wider market in order to get a position without leaking alpha to the market by betting into it directly.
- one might avoid competing against sharper MMs on major markets and only offer quotes on smaller leagues and esports, where the sharper MMs are less likely to be, with higher vig.
- one might only offer parlays and quote them competitively to get most of the parlay flow.
- one might fill the config PDA and market data PDAs with lots of correlation data to offer accurate same-game parlay quotes.
- one might be run by a frontend and offer odds boosts on specific markets to specific users as a user retention method by only quoting that market and filling the market data PDA with the allowed users.
- one might be run by a frontend to offer to fill the freebets the frontend is giving out which are locked exclusively to their own SPAMM, so the wins and losses net out like a traditional sportsbook freebet.
- one might simply pull orderbooks from other exchanges, dump them in the market data PDAs, and offer based on that.
- since markets are not controlled by the actual SPAMM aggregator in any way (the API is really just "suggested" market ids so everyone is on the same page about them), a product could build on top of the framework for something niche and offer their own markets on their own SPAMM for their own frontend users (although I am always willing to add new things to the API because forcing SPAMMs to compete is what makes odds great for users)

## Roles

| Role | Description |
| --- | --- |
| Aggregator | A Solana program responsible for handling bets, funds, creating accounts, netting liability, settling bets, etc. |
| Admin | The admin of the aggregator program. Can pause all aggregator functions, as well as grade bets of a delinquent `Market Operator`. |
| Market Operator | A public key that is in charge of markets. They publish them to their API and are responsible for grading bets made on those markets. Anyone can be a market operator - they just need to have at least one `Market Maker` for them and a `Frontend` to display them. Since markets are just IDs in an API, there is no limit on the number of markets they can publish - the limit is just what a `Market Maker` is willing to support. |
| Market Maker | A person or team who runs a `SPAMM`. They define how the SPAMM should work (by writing the SPAMM code) and on what markets (by having the SPAMM `Authority` key create Event and Market data PDAs). They should hook the SPAMM backend up to some odds source and update the onchain values for the markets. |
| SPAMM | A Solana program that does onchain pricing of markets based on onchain data updated by the offchain backend. |
| User | A wallet that places bets - usually via a `Frontend` but could be via pulling the API and building the transaction themselves. |
| Frontend | A way to display markets, fetch quotes, and construct Solana transactions for placing bets. Frontends might act as a `Feepayer` for users, and call `settle_bet` on behalf of the user for a better experience. |
| Feepayer | A key that pays the fees for transactions. They rent is returned to the Feepayer upon the bet being settled. |
| Freebet Issuer | A key that issues and funds freebet to users (usually a `Frontend`). Since all bets are filled by a `SPAMM`, the funds for a freebet must be collateralised at fill time, meaning the Issuer must have funds to transfer. The freebet data can limit the use to specific `Market Operators` (to ensure it is used with a trusted source) and `SPAMM`s (to allow for using at affiliated SPAMMs so the funds are more circular if desired). |

## Deployment

The **SPAMM Aggregator** program is deployed to Solana **mainnet** at `5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H` with USDC as the betting token and a frontend is hosted at [automaticsportsmarkets.com](https://automaticsportsmarkets.com). It is also on **devnet** at the address `5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H`. The betting token is `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` which you can get [here](https://spl-token-faucet.com/). If the devnet SOL airdrop is 429, you can get some [here](https://faucet.solana.com/).

**Breaking changes** are to be expected. The **aggregator admin** can delete Aggregator PDAs (like Bet Accounts) at any time.

Contact pure_lmao on [X](https://x.com/pure_lmao) / [Discord](https://discord.com/users/223573305410584577) / [Telegram](https://t.me/pure_lmao) if you are interested in this idea and you can give feedback and be updated on framework changes if you build a SPAMM.

## Fees and Rebates

There are currently no fees within the system. This also means there are no rebates. Market makers profit simply by filling bets and being profitable. In the future, once there is plenty of data gathered, the aggregator may charge a small fee. If the data shows that market makers are making plenty of profit, the fee will be paid by market makers. If the data shows market makers struggle to profit, the fee will be charge to the users. The fee will likely be a small percentage of profit, paid upon settlement of the bet.

---

# SPAMM Program Framework

When this framework description uses **"MUST"** the program **MUST** adhere to the requirement. If **"should"** is used, it is a recommendation.

## Overview

A SPAMM program is a program which complies with this framework and offers quotes for bets to the aggregator on sports markets. It should take advantage of low CU oracle account updates in order to land odds/state updates at the top of the block, before compute-heavy bet filling transactions.

Quote functions are complex calculation functions, so to keep the process of placing a bet within CU limits, they are only called once. When giving a quote, you write to a Quote Buffer PDA which can then be read if your quote is accepted by the aggregator when filling the bet. This makes fill functions very lightweight. You know the quote in the buffer is valid because only your SPAMM can write to it.

## get_quote function

Discriminator: **120**

The `get_quote` function is called by the RPC to get the price to build the tx for the user then again by the **aggregator** when filling the bet to get best odds at **execution-time**. The second call is to prevent spoofing. The function **MUST** return data using `sol_set_return_data`. The function **MUST** NEVER return an error. You **MUST** catch all program errors and return a valid (0, 0) quote. You should use the `QuoteResult` return type, rather than `ProgramResult`, and you can wrap the response in `quote_ok` to return a `ProgramResult` in your dispatch handler.

**I will state that again: YOU MUST CATCH ALL PROGRAM ERRORS AND RETURN A VALID (0, 0) QUOTE. No program errors EVER or your SPAMM will be dropped from the lists frontends use for transactions and you will get no flow.**

Data:

```rust
struct GetQuoteIxData {
   instruction_discriminator: u8, // 120
   amount: u64,
   odds_scaled: u32,
   market_id: MarketId,
   side: u8, // based on the market id and the side of the selection (e.g. 0 for home win)
   event_game_state: EventGameState,
   event_state_sequence: u16,
}
```

The function **MUST** take the following accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | Pass-through for pricing; not required to sign when invoked via CPI |
| 1 | Clock sysvar | readonly | |
| 2 | MM Market Data PDA | readonly | Quote CPIs MUST NOT write this account |
| 3 | MM Event State PDA | readonly | Quote CPIs MUST NOT write this account |
| 4 | MM Config PDA | readonly | |
| 5 | MM Quote Buffer | writable | Written by `get_quote`; CPI destination for fill replay protection |

Quote CPIs (`get_quote`, `get_quote_parlay`, `get_cashout_quote`, `get_cashout_quote_parlay`) **MUST NOT** write Market Data or Event State. Those PDAs are written by Doppler (market data), `update_event_state` (event header), and fill CPIs that include them (`fill_quote`, `fill_bet_rfq`, `fill_cashout_quote`, `fill_cashout_rfq`). The quote buffer **is** writable on quote.

The function **MUST** return the following data for a valid quote:

```rust
struct GetQuoteReturnData {
   max_amount: u64, // the maximum amount the user can bet at the given odds
   odds_scaled: u32, // the decimal odds scaled by ODDS_SCALE from the perspective of the taking user
}
```

The function **MUST** return the data using `sol_set_return_data`.
If **any of these values are 0**, then nothing will attempt to be filled.

You can be filled at any amount from max_amount down to MIN_FILLER_AMOUNT ($0.10 at 6 decimals = 100_000). The auction skips any slice below MIN_FILLER_AMOUNT. You will be filled at odds_scaled.

You **MUST** then populate the **MM Quote Buffer** with the following data:

```rust
struct MMQuoteBuffer {
   discriminator: u8 = 102,
   is_used: u8 = 0, // set to 0 after issuing quote, set to 1 after filling
   user_address: Address,
   market_id: MarketId,
   side: u8, // same encoding as GetQuoteIxData.side
   max_amount: u64,
   odds_scaled: u32,
   event_game_state: EventGameState,
   event_state_sequence: u16,
}
```

This data is later used by your `fill_quote` function to validate the quote was actually offered by yourself and is **not spoofed**.

The user is passed as a courtesy to allow you to potentially offer better odds to some users. Your Config PDA data beyond the header can be used for storing any global data you want (user profiles, global risk limits, etc). Your Market Data PDA data beyond the header can be used for storing any market-specific data you want (odds, liquidity, etc). Your Event State PDA data beyond the header can be used for storing any event-specific data you want (start times, correlation data, event exposure, etc).

## fill_quote function

Discriminator: **121**

The `fill_quote` function is called by the **aggregator** to fill the bet after receiving the quotes, **filtering valid quotes**, and sorting them **best to worst odds**. The function should verify that the caller is a CPI via the aggregator and that all accounts are as expected.

Data:

```rust
struct FillQuoteIxData {
   instruction_discriminator: u8, // 121
   amount_to_fill: u64,
   odds_scaled: u32,
   market_id: MarketId,
   side: u8,
   event_game_state: EventGameState,
   event_state_sequence: u16,
   amount_to_send: u64,
}
```

The function **MUST** take the following accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | |
| 1 | MM Market Data PDA | writable | |
| 2 | MM Event State PDA | writable | |
| 3 | MM Config PDA | writable | |
| 4 | MM Quote Buffer | writable | |
| 5 | MM Token Account | writable | |
| 6 | MM Liability Token Account | writable | |
| 7 | Mint | readonly | |
| 8 | Token Program | readonly | |
| 9 | Instructions sysvar | readonly | |

The function **should** then validate the quote matches the quote buffer data as proof the call to the function is **not spoofed**—it must have been preceded by a valid `get_quote` invocation. This avoids having to do an expensive re-computation of the quote.

The function **MUST** then transfer the `amount_to_send` to the **liability token account**. This is the amount of funds required to cover the **net liability** of the position. It will be <= the user potential profit (`amount_to_fill * (odds_scaled - ODDS_SCALE)`). If the new liability ends up being negative due to **liability netting**, the amount can be **0**.

The `is_used` field in the quote buffer **MUST** be set to **1** to indicate the quote has been filled and **cannot be reused** without being reset by a valid invocation of the `get_quote` function. Failure to do so could result in an exploit.
During this function, you can change your Config PDA, Market Data PDA, and Event State PDA tail if you wish.

## get_quote_parlay function

Discriminator: **122**

The `get_quote_parlay` function is invoked the same way as `get_quote`, but for **multiple legs**: each leg has its own market data / event state accounts and `ParlayLegSel` fields in the instruction `data`. The function **MUST** return data using `sol_set_return_data`. The function **MUST** NEVER return an error. You **MUST** catch all program errors and return a valid (0, 0) quote. As with `get_quote`, you should use the `QuoteResult` return type, rather than `ProgramResult`, and you can wrap the response in `quote_ok` to return a `ProgramResult` in your dispatch handler.

Data:

```rust
struct GetQuoteParlayIxData {
   instruction_discriminator: u8, // 122
   amount: u64,
   odds_scaled: u32, // minimum acceptable combined parlay odds (scaled);
   num_legs: u8,     // L, 2..=MAX_PARLAY_LEGS
   legs: [ParlayLegSel; num_legs],
}
struct ParlayLegSel {
   market_id: MarketId,
   side: u8,
   event_state_sequence: u16,
   event_game_state: EventGameState,
}
```

The function **MUST** take the following accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | Pass-through for pricing; not required to sign when invoked via CPI |
| 1 | Clock sysvar | readonly | |
| 2 | MM Config PDA | readonly | |
| 3 | MM Parlay Quote Buffer | writable | |

Then for each leg:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | MM Market Data PDA | readonly | |
| 1 | MM Event State PDA | readonly | |

The function **MUST** return the following data for a valid quote:

```rust
struct GetQuoteParlayReturnData {
   max_amount: u64, // the maximum amount the user can bet at the given combined odds
   odds_scaled: u32, // the combined decimal odds scaled by ODDS_SCALE from the perspective of the taking user. Must be = Π(leg_odds_scaled)
   num_legs: u8, // L, 2..=MAX_PARLAY_LEGS (max 20)
   leg_odds_scaled: [u32; num_legs], // per-leg decimal odds scaled by ODDS_SCALE
}
```

The function **MUST** return the data using `sol_set_return_data`.
If `max_amount` or `odds_scaled` are **0**, then nothing will attempt to be filled.

The MM should validate each leg’s market data / event state PDAs and that per-leg `event_game_state` and `event_state_sequence` match the instruction (and the on-chain event-state account). The MM should be careful when quoting parlays with legs in the same event (Same-Game Parlays - SGPs), but this is not policed at the aggregator level. If there are multiple legs with the same event id, only one leg is required to have odds, and the others can have 0 - this links the grading of them together such that one being cancelled, all legs from that event are cancelled. The example MM simply combines per-leg scaled odds from market data and writes a full snapshot into the **MM Parlay Quote Buffer**:

```rust
struct MMParlayQuoteBuffer {
   discriminator: u8 = 103,
   is_used: u8 = 0,
   user_address: Address,
   max_amount: u64,
   odds_scaled: u32,
   num_legs: u8,
   legs: [ParlayLegQuoted; MAX_PARLAY_LEGS], // snapshot of the quoted legs (sel + per-leg odds)
}
```

## fill_parlay_quote function

Discriminator: **123**

The `fill_parlay_quote` function is called by the aggregator after a valid `get_quote_parlay` response, to move collateral from the MM token account to the aggregator’s MM liability ATA for the parlay stake. Parlay fills cannot be netted in any way. The function should verify that the caller is a CPI via the aggregator and that all accounts are as expected.

Data:

```rust
struct FillParlayQuoteIxData {
   instruction_discriminator: u8, // 123
   amount_to_fill: u64,
   odds_scaled: u32,
   amount_to_send: u64,
}
```

The function **MUST** take these accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | |
| 1 | MM Config PDA | writable | |
| 2 | MM Parlay Quote Buffer | writable | |
| 3 | MM Token Account | writable | MM collateral source |
| 4 | MM Liability Token Account | writable | Aggregator-owned destination |
| 5 | Mint | readonly | |
| 6 | Token program | readonly | |
| 7 | Instructions sysvar | readonly | Introspect parent `fill_parlay` |

The MM should decode the parlay quote buffer, verify it matches the instruction (user, odds, amounts), transfer `amount_to_send` to the liability account, then **MUST** set `is_used` on the parlay buffer to **1** so the quote **cannot be replayed** without a fresh `get_quote_parlay`. The amount to send may be less than the calculated user profit (or 0) if you have free collateral in the MM liability account.

## set_rfq_signer function

Discriminator: **101**

The `set_rfq_signer` function updates the `rfq_signer` pubkey on the MM config PDA. That key signs off-chain RFQ quote messages; the aggregator verifies the signature against the on-chain config when filling `fill_rfq_bet` / `fill_rfq_parlay`.

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | Admin | writable, signer | must match config `admin` |
| 1 | MM Config PDA | writable | |
| 2 | RFQ signer | readonly | new pubkey written into the config header |

`init_program` will also set the initial `rfq_signer` (defaults to admin if omitted).

## fill_bet_rfq function

Discriminator: **130**

The `fill_bet_rfq` function is the MM CPI entry for a single-market RFQ fill. It is invoked by the aggregator under parent instruction `fill_rfq_bet` (disc **12**). There is **no quote buffer**; authenticity comes from the ed25519 signature checked by the aggregator before CPI.

Data:

```rust
struct FillRfqIxData {
   instruction_discriminator: u8, // 130
   amount_to_send: u64,
}
```

Accounts **(9)**:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | |
| 1 | MM Market Data PDA | writable | reserved for MM market updates |
| 2 | MM Event State PDA | writable | reserved for MM event updates |
| 3 | MM Config PDA | writable | |
| 4 | MM Token Account | writable | |
| 5 | MM Liability Token Account | writable | |
| 6 | Mint | readonly | |
| 7 | Token Program | readonly | |
| 8 | Instructions sysvar | readonly | |

The function **MUST** transfer `amount_to_send` from the MM token account to the liability account (config PDA as signer), same liability rules as `fill_quote`.

## fill_parlay_rfq function

Discriminator: **131**

The `fill_parlay_rfq` function is the MM CPI entry for a multi-leg RFQ fill. It is invoked by the aggregator under parent instruction `fill_rfq_parlay` (disc **13**).

Data:

```rust
struct FillRfqIxData {
   instruction_discriminator: u8, // 131
   amount_to_send: u64,
}
```

Accounts **(7)** — omits **both** `mm_market_data_pda` and `mm_event_state_pda` present on `fill_bet_rfq` **(9)**:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | |
| 1 | MM Config PDA | writable | |
| 2 | MM Token Account | writable | |
| 3 | MM Liability Token Account | writable | |
| 4 | Mint | readonly | |
| 5 | Token Program | readonly | |
| 6 | Instructions sysvar | readonly | parent must be aggregator `fill_rfq_parlay` |

## get_cashout_quote function

Discriminator: **140**

The `get_cashout_quote` function is called by the RPC / proxy to price a cashout, then again by the **aggregator** under `fill_cashout` to get the best **payment** at execution-time. The second call is to prevent spoofing. The function **MUST** return data using `sol_set_return_data`. The function **MUST** NEVER return an error. You **MUST** catch all program errors and return a valid `max_payment = 0` quote. You should use the `QuoteResult` return type, rather than `ProgramResult`, and you can wrap the response in `quote_ok` to return a `ProgramResult` in your dispatch handler.

Data:

```rust
struct GetCashoutQuoteIxData {
   instruction_discriminator: u8, // 140
   amount: u64,                   // stake slice being cashed
   payout: u64,                   // proportional payout removed from the ticket
   min_payout: u64,               // floor on payment; return 0 if you cannot meet it
   market_id: MarketId,
   side: u8,
   event_game_state: EventGameState,
   event_state_sequence: u16,
}
```

The function **MUST** take the following accounts (same six-account layout as `get_quote`):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | Pass-through for pricing; not required to sign when invoked via CPI |
| 1 | Clock sysvar | readonly | |
| 2 | MM Market Data PDA | readonly | Quote CPIs MUST NOT write this account |
| 3 | MM Event State PDA | readonly | Quote CPIs MUST NOT write this account |
| 4 | MM Config PDA | readonly | |
| 5 | MM Quote Buffer | writable | Written by `get_cashout_quote`; CPI destination for fill replay protection |

Quote CPIs **MUST NOT** write Market Data or Event State (same rule as `get_quote`).

The function **MUST** return the following data for a valid quote:

```rust
struct CashoutQuoteReturn {
   max_payment: u64, // maximum tokens the MM will pay for this cashout slice
}
```

The function **MUST** return the data using `sol_set_return_data`.
If `max_payment` is **0**, the aggregator will not use that MM’s cashout quote for the fill.

You **MUST** then populate the **MM Quote Buffer** so `fill_cashout_quote` can prove the quote was issued (same `MMQuoteBuffer` layout as `get_quote`). Store the quoted payment in `max_amount`; the cashout fill matcher does not require `odds_scaled` (the example MM writes `0`):

```rust
struct MMQuoteBuffer {
   discriminator: u8 = 102,
   is_used: u8 = 0, // set to 0 after issuing quote, set to 1 after filling
   user_address: Address,
   market_id: MarketId,
   side: u8,
   max_amount: u64, // quoted max_payment
   odds_scaled: u32, // unused for cashout ranking; example MM sets 0
   event_game_state: EventGameState,
   event_state_sequence: u16,
}
```

## fill_cashout_quote function

Discriminator: **141**

The `fill_cashout_quote` function is called by the **aggregator** under parent `fill_cashout` after selecting the best `get_cashout_quote` payment. The aggregator may already have paid free liability into the payment dest; this CPI transfers `amount_to_send` (the remainder, which may be **0**) from the MM token ATA and still marks the quote buffer used. The function should verify that the caller is a CPI via the aggregator and that all accounts are as expected.

Data:

```rust
struct FillCashoutQuoteIxData {
   instruction_discriminator: u8, // 141
   amount: u64,                   // stake slice being cashed
   amount_to_send: u64,           // remainder after free liability; may be 0
   market_id: MarketId,
   side: u8,
   event_game_state: EventGameState,
   event_state_sequence: u16,
}
```

The function **MUST** take the following accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | |
| 1 | MM Market Data PDA | writable | |
| 2 | MM Event State PDA | writable | Unverified; MM may write the account tail on fill |
| 3 | MM Config PDA | writable | |
| 4 | MM Quote Buffer | writable | |
| 5 | MM Token Account | writable | MM collateral source for remainder |
| 6 | Payment dest | writable | User ATA (pregame) or escrow ATA (live delay) |
| 7 | Mint | readonly | |
| 8 | Token Program | readonly | |
| 9 | Instructions sysvar | readonly | parent must be aggregator `fill_cashout` |

The function **should** then validate the quote matches the quote buffer data as proof the call is **not spoofed**—it must have been preceded by a valid `get_cashout_quote` invocation. `amount_to_send` **MUST** be ≤ the buffer’s `max_amount` (quoted payment).

The function **MUST** transfer `amount_to_send` from the MM token account to the **payment dest** when `amount_to_send > 0` (config PDA as signer). The CPI **MUST** still run when `amount_to_send` is **0** so the quote buffer can be marked used.

The `is_used` field in the quote buffer **MUST** be set to **1** so the quote **cannot be reused** without a fresh `get_cashout_quote`. Failure to do so could result in an exploit.
During this function, you can change your Config PDA, Market Data PDA, and Event State PDA tail if you wish.

## fill_cashout_rfq function

Discriminator: **144**

The `fill_cashout_rfq` function is the MM CPI entry for a single-market RFQ cashout fill. It is invoked by the aggregator under parent instruction `fill_rfq_cashout` (disc **72**). There is **no quote buffer**; authenticity comes from the ed25519 signature checked by the aggregator before CPI. The aggregator may already have paid free liability into the payment dest; this CPI transfers `amount_to_send` (remainder, may be **0**) from the MM token ATA.

Data:

```rust
struct FillRfqIxData {
   instruction_discriminator: u8, // 144
   amount_to_send: u64,
}
```

Accounts **(9)**:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | |
| 1 | MM Market Data PDA | writable | reserved for MM market updates |
| 2 | MM Event State PDA | writable | Unverified; MM may write the account tail on fill |
| 3 | MM Config PDA | writable | |
| 4 | MM Token Account | writable | MM collateral source for remainder |
| 5 | Payment dest | writable | User ATA (pregame) or escrow ATA (live delay) |
| 6 | Mint | readonly | |
| 7 | Token Program | readonly | |
| 8 | Instructions sysvar | readonly | parent must be aggregator `fill_rfq_cashout` |

The function **MUST** transfer `amount_to_send` from the MM token account to the payment dest when `amount_to_send > 0` (config PDA as signer).

## get_cashout_quote_parlay function

Discriminator: **142**

Parlay twin of `get_cashout_quote`. Soft-fail: catch all errors and return `max_payment = 0`. Quote CPIs **MUST NOT** write market-data or event-state.

Data:

```rust
struct GetCashoutQuoteParlayIxData {
   instruction_discriminator: u8, // 142
   amount: u64,                   // stake slice being cashed
   payout: u64,                   // proportional payout removed from the ticket
   min_payout: u64,               // floor on payment
   num_legs: u8,                  // L, 2..=MAX_PARLAY_LEGS
   legs: [ParlayLegSel; num_legs],
}
```

Accounts **(4 + 2×L)** where `L` is `num_legs` (2..=20):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | Pass-through for pricing |
| 1 | Clock sysvar | readonly | |
| 2 | MM Config PDA | readonly | |
| 3 | MM Parlay Quote Buffer | writable | Written by this quote |
| 4+2*i | MM Market Data PDA | readonly | Per leg *i* |
| 5+2*i | MM Event State PDA | readonly | Per leg *i* |

Return data: 8-byte LE `max_payment` (`CashoutQuoteReturn`). Populate the **MM Parlay Quote Buffer** so `fill_cashout_quote_parlay` can prove the quote was issued.

## fill_cashout_quote_parlay function

Discriminator: **143**

Called by the aggregator under parent `fill_parlay_cashout` after selecting the best `get_cashout_quote_parlay` payment. Transfers `amount_to_send` (remainder after free liability; may be **0**) and marks the parlay quote buffer used.

Data:

```rust
struct FillCashoutQuoteParlayIxData {
   instruction_discriminator: u8, // 143
   amount: u64,
   amount_to_send: u64,
}
```

Accounts **(8)**:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | |
| 1 | MM Config PDA | writable | |
| 2 | MM Parlay Quote Buffer | writable | |
| 3 | MM Token Account | writable | |
| 4 | Payment dest | writable | User ATA (pregame) or escrow ATA (live delay) |
| 5 | Mint | readonly | |
| 6 | Token Program | readonly | |
| 7 | Instructions sysvar | readonly | parent must be aggregator `fill_parlay_cashout` |

## fill_parlay_cashout_rfq function

Discriminator: **145**

MM CPI entry for a multi-leg RFQ cashout fill under parent `fill_rfq_parlay_cashout` (disc **73**). No quote buffer; authenticity from the ed25519 signature checked by the aggregator before CPI.

Data:

```rust
struct FillRfqIxData {
   instruction_discriminator: u8, // 145
   amount_to_send: u64,
}
```

Accounts **(7)**:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | User | readonly | |
| 1 | MM Config PDA | writable | |
| 2 | MM Token Account | writable | |
| 3 | Payment dest | writable | |
| 4 | Mint | readonly | |
| 5 | Token Program | readonly | |
| 6 | Instructions sysvar | readonly | |

## Config PDA

The **config PDA** is a PDA owned by the mm program. It **MUST** be of the seeds `["config"]`.
It contains the following data:

```rust
struct Config {
   discriminator: u8 = 101,
   bump: u8,
   admin: Address, // used for interacting with the aggregator program for non-quoting functions
   rfq_signer: Address, // pubkey that signs off-chain RFQ quotes (set at init_program or via set_rfq_signer)
   //...
   //...anything else you want
   // for example
   global_risk_limit: u64,
   global_risk: u64, // updated on fill_quote
   favourable_bettors: [Address; N], // read on get_quote to safely offer them a 5% bonus odds to increase chance of being filled, knowing they are losing bettors
   smart_bettors: [Address; N], // read on get_quote to reduce odds, knowing that fills are usually unfavourable from these bettors
}
```

The on-wire MM config header used by the aggregator is `MmAccountConfig`: `discriminator`, `bump`, `admin`, `rfq_signer`. Anything after that header is free for the SPAMM.

## Event Liability Netting PDA

The **event liability netting PDA** is a PDA owned by the **aggregator**. It **MUST** be of the seeds `["netting", mm_program_address, event_id]`.

It is created by the admin of the mm program calling the create_netting_account function.

See the Liability Netting section below for more details.

## Market Data PDA

Each market **MUST** have a **Market Data PDA** owned by mm.

```rust
struct MarketData {
   discriminator: u8 = 100,
   bump: u8,
   // anything else you want
   // e.g.
   // calculate the odds you want to offer offchain and just list them
   last_update: i64, //ensure each new update is greater than the last so old txs cant land late
   odds0: u32, // updated in oracle hot path
   odds1: u32, // updated in oracle hot path
   position0: i64, // updated on fill_quote
   position1: i64 // updated on fill_quote

   // or skew from midpoint
   last_valid_timestamp: i64, // oracle hot path
   midpoint_odds: u32, // oracle hot path
   liability: i64, // on fill_quote
   market_risk_grade: u8 // set on init_market

   // or per-update inventory
   slot: u64, // oracle hot path
   odds0: u32, // oracle hot path
   odds1: u32, // oracle hot path
   remaining0: // reset on oracle hot path then decrement on fill_quote
   remaining1: // reset on oracle hot path then decrement on fill_quote
}
```

It **MUST** have the seeds `["market_data", market_id_body_wire, operator]`. The full on-wire `MarketId` includes an `operator` address (see Market Operators under the aggregator). Because Solana PDA seeds are capped at 32 bytes each, the market-id body (everything before `operator`) is one seed and `operator` is a second seed — helpers: `market_id_pda_seed_parts` / SDK `getMmMarketDataPda`. The account can contain any data that you want to store for the market. The **aggregator verifies** the Market Data PDA exists with the expected seed..

It is recommended you use something like Doppler ([https://github.com/blueshift-gg/doppler](https://github.com/blueshift-gg/doppler)) for 21 CU updates and incorporate it as a hot path into your program (although you must modify it to include the bump seed in the account data. This can be seen in the example market maker program). You can hot update the odds at the top of the account and then slow-update other data in the account via an instruction or the fill_quote function.

## Event State PDA

An **Event State PDA** **MUST** start with the on-wire header `EventStateData` (see `spamm_aggregator::state::EventStateData`). The account **may be longer**; bytes after the header are MM-chosen (exposure, clocks, bettor stats, …). The aggregator verifies **only the header** (discriminator, bump/PDA, `sequence`, `game_state`) on **quote** paths. Quote CPIs **MUST NOT** write this account. Write paths: `update_event_state` (header), fill CPIs that include event-state (`fill_quote`, `fill_bet_rfq`, `fill_cashout_quote`, `fill_cashout_rfq` — tail only; the aggregator does not re-verify on fill). `init_event` writes the header then any extra body supplied in the instruction. You can add an `update_event_body` instruction to update the bytes outside the header however you want.

```rust
struct EventStateDataHeader {
   discriminator: u8 = 104,
   bump: u8,
   event_id: EventId,
   sequence: u16,
   game_state: EventGameState,
}
```

```rust
struct EventGameState {
   game_phase: [u8; 4], // 4 ASCII bytes, 0-padded right
   home_primary: u8, // main score
   away_primary: u8, // main score
   home_secondary: u8, // sport-dependent extras (for example red cards in soccer)
   away_secondary: u8, // sport-dependent extras (for example red cards in soccer)
}
```

The sequence is incremented by 1 for each new state. The initial state has a sequence of 0 and the following activities increment the state:

- Event quoting starts (sequence 1, game_phase is `"PG"` scores are 0-0, 0-0)
- Event starts (sequence 2, game_phase is sport initial period scores are 0-0, 0-0)
- Goal is scored (soccer, ice hockey)
- Red card (soccer)
- Goal is cancelled (soccer, ice hockey)
- Red card is cancelled (soccer)
- Any points increase (american football)
- Any points increase is cancelled (american football)
- Run is scored (baseball)
- Run is cancelled (baseball)
- Match period progress (All sports - per the list below)

An activity being cancelled refers to when the data feed updates to show the activity has happened and then reverted, NOT when the activity is pending. This is to allow reverting bets which are placed at odds which should not have existed.

For example, if the state is 1-0 "1H", with sequence of 3 (1 - initial state of pregame, 2 - event started, 3 - first goal scored) and the data feed updates to show a goal is scored, the state should be updated to 1-1 "1H" with sequence of 4. If the data feed then updates to show the goal is cancelled, the state should be updated to 1-0 "1H" with sequence of 5. Any bets or cashouts with a sequence of 4 are invalid and will be rolled back.

The `(sequence, EventGameState)` of a market maker event PDA **must match** the `(sequence, EventGameState)` used to construct the fill tx (typically from the aggregator API snapshot), or the market maker is considered **to not be in sync** and **won't be used to fill bets**.

`EventGameState` is constructed based on data which varies by sport:
(P prefix meaning "pre-")

```rust
soccer (sport_id = 1): {
   game_phase: "PG"|"1H"|"HT"|"2H"|"PET"|"1ET"|"HTET"|"2ET"|"PPen"|"Pen" encoded as [u8; 4],
   home_primary: home team score,
   away_primary: away team score,
   home_secondary: home team red cards,
   away_secondary: away team red cards,
}

american_football (sport_id = 2): {
   game_phase: "PG"|"1Q"|"P2Q"|"2Q"|"HT"|"3Q"|"P4Q"|"4Q"|"POT"|"OT" encoded as [u8; 4],
   home_primary: home team score,
   away_primary: away team score,
   home_secondary: 0,
   away_secondary: 0,
}

baseball (sport_id = 3): {
   game_phase: "PG"|"T1"|"B1"|"P2"|"T2"|"B2"|"P3"... encoded as [u8; 4],
   home_primary: home team score,
   away_primary: away team score,
   home_secondary: 0,
   away_secondary: 0,
}

basketball (sport_id = 4): {
   game_phase: "PG"|"1Q"|"P2Q"|"2Q"|"HT"|"3Q"|"P4Q"|"4Q"|"POT"|"OT"|"POTx"|"OTx" encoded as [u8; 4],
   home_primary: 0, // score is omitted as constant updates would be excessive
   away_primary: 0,
   home_secondary: 0,
   away_secondary: 0,
}

ice_hockey (sport_id = 5): {
   game_phase: "PG"|"1P"|"P2P"|"2P"|"P3P"|"3P"|"POT"|"OT"|"PSO"|"SO" encoded as [u8; 4],
   home_primary: home team score,
   away_primary: away team score,
   home_secondary: 0,
   away_secondary: 0,
}

tennis (sport_id = 6): {
   game_phase: "PG"|"1S"|"P2S"|"2S"|"P3S"|"3S"|"P4S"|"4S"|"P5S"|"5S" encoded as [u8; 4],
   home_primary: home player sets won,
   away_primary: away player sets won,
   home_secondary: home player games won in current set,
   away_secondary: away player games won in current set,
}

cs2 (sport_id = 101): {
   game_phase: "PG"|"Maps"|"1M"|"P2M"|"2M"|"P3M"|"3M"|"P4M"|"4M"|"P5M"|"5M" encoded as [u8; 4],
   home_primary: home team maps won,
   away_primary: away team maps won,
   home_secondary: home team rounds won in current map,
   away_secondary: away team rounds won in current map,
}

dota (sport_id = 102): {
   game_phase: "PG"|"P1M"||"1M"|"P2M"|"2M"|"P3M"|"3M"|"P4M"|"4M"|"P5M"|"5M" encoded as [u8; 4],
   home_primary: home team games won,
   away_primary: away team games won,
   home_secondary: 0,
   away_secondary: 0,
}

lol (sport_id = 103): {
   game_phase: "PG"|"P1M"|"1M"|"P2M"|"2M"|"P3M"|"3M"|"P4M"|"4M"|"P5M"|"5M" encoded as [u8; 4],
   home_primary: home team games won,
   away_primary: away team games won,
   home_secondary: 0,
   away_secondary: 0,
}

valorant (sport_id = 104): {
   game_phase: "PG"|"Maps"|"P1M"|"1M"|"P2M"|"2M"|"P3M"|"3M"|"P4M"|"4M"|"P5M"|"5M" encoded as [u8; 4],
   home_primary: home team maps won,
   away_primary: away team maps won,
   home_secondary: home team rounds won in current map,
   away_secondary: away team rounds won in current map,
}

```

## Accounts at a Glance

MM-owned account discriminators are **≥ 100** so they are not confused with aggregator accounts.

| Account | Discriminator | Seed | Notes |
| --- | --- | --- | --- |
| MM Market Data PDA | 100 | ["market_data", market_id_body, market_operator] | created in init_market with a custom body |
| MM Config PDA | 101 | ["config"] | created in init_program |
| MM Quote Buffer | 102 | ["mm_quote_buffer"] | created in init_program |
| MM Parlay Quote Buffer | 103 | ["mm_parlay_quote_buffer"] | created in init_program |
| MM Event State | 104 | ["event_state", event_id] | `EventStateData` header + optional MM body; created in `init_event` at **sequence 0**; admin advances `game_state` / `sequence` via `update_event_state` |
| MM Token Account | n/a | n/a | authority is the MM Config PDA, created in init_program |

MM accounts owned by the aggregator:

| Account | Discriminator | Seed | Notes |
| --- | --- | --- | --- |
| MM Encumbrance PDA | 5 | ["encumbrance", mm_program_address] | created in register_mm |
| MM Liability Token Account | n/a | n/a | authority is the MM Encumbrance PDA, created in register_mm |

## MM program instruction discriminators (router)

The Oracle hot-path in the example implementation is a (very efficient) suggestion. It uses xx CU per update. You can update your Market Data PDAs how you want, and might use 2 functions: one Doppler for frequent odds updates then a more complex function for less frequent updates.
The first byte of instruction data routes the MM program (oracle hot-path **0** is handled separately in implementations that use **Doppler**). Values **MUST** match `spamm_market_maker` and the CPI bytes embedded in `spamm_aggregator` for quote instructions.

| Discriminator | Instruction | Notes |
| --- | --- | --- |
| 0 | Oracle hot path | Doppler / similar; **not** in the Pinocchio router. Triggered by **2 accounts**, not by this disc table |
| 100 | `init_program` | Creates config PDA, single-leg quote buffer, parlay quote buffer, MM ATA; may set `rfq_signer` |
| 101 | `set_rfq_signer` | Admin updates config `rfq_signer` |
| 110 | `init_event` | Creates event state PDA `["event_state", event_id]` at **sequence 0**; optional extra body after the header |
| 111 | `init_market` | Creates market/oracle body under `["market_data", market_id_body, operator]` |
| 112 | `close_event` | |
| 113 | `close_market` | |
| 114 | `update_event_state` | |
| 120 | `get_quote` | Single market; CPI from aggregator `fill_bet` or RPC to build tx |
| 121 | `fill_quote` | Single market; CPI from aggregator `fill_bet` |
| 122 | `get_quote_parlay` | Multi-leg; CPI from aggregator `fill_parlay` or RPC to build tx |
| 123 | `fill_parlay_quote` | Multi-leg; CPI from aggregator `fill_parlay` |
| 130 | `fill_bet_rfq` | CPI from aggregator `fill_rfq_bet`; collateral transfer |
| 131 | `fill_parlay_rfq` | CPI from aggregator `fill_rfq_parlay`; collateral transfer |
| 140 | `get_cashout_quote` | Soft-fail; return 8-byte LE `max_payment`; CPI from `fill_cashout` / proxy |
| 141 | `fill_cashout_quote` | Transfer `amount_to_send` remainder from MM ATA; set quote buffer `is_used`; CPI from aggregator `fill_cashout` |
| 142 | `get_cashout_quote_parlay` | Soft-fail parlay cashout quote; return 8-byte LE `max_payment` |
| 143 | `fill_cashout_quote_parlay` | Transfer `amount_to_send` remainder; set parlay quote buffer `is_used`; CPI from aggregator `fill_parlay_cashout` |
| 144 | `fill_cashout_rfq` | Transfer `amount_to_send` remainder; CPI from aggregator `fill_rfq_cashout` |
| 145 | `fill_parlay_cashout_rfq` | Transfer `amount_to_send` remainder; CPI from aggregator `fill_rfq_parlay_cashout` |
| 150 | `withdraw_from_token_account` | Admin withdraw from MM collateral ATA |
| 254 | `write_arbitrary_data` | Admin / dev tooling; may grow PDA |
| 255 | `force_close_pda` | Admin / dev tooling |

## Integration Lifecycle

1. Write your SPAMM program and ensure that account structs/headers match as expected and you have implemented `get_quote` / `fill_quote` and, if you support parlays, `get_quote_parlay` / `fill_parlay_quote` correctly. If you support RFQ, implement `fill_bet_rfq` / `fill_parlay_rfq` and set an `rfq_signer`. If you support cashout, implement `get_cashout_quote` / `fill_cashout_quote`, `get_cashout_quote_parlay` / `fill_cashout_quote_parlay`, and for RFQ cashout `fill_cashout_rfq` / `fill_parlay_cashout_rfq`.
2. Deploy the SPAMM program.
3. Init the required SPAMM-owned accounts.
4. Register the SPAMM with the aggregator by calling register_mm.
5. Connect to an operator API to get events and markets. For RFQ, connect to the market-maker WebSocket (`/ws/mm`) with a signed `mm.hello`.
6. Create event state PDAs for events you wish to quote.
7. Create market data PDAs for markets you wish to quote.
8. If you want to net liabilities on a market, create a liability netting PDA for the event by calling `create_netting_account` and add lines to the netting account by calling `add_line_to_netting_account` (passing `period` and `mkt` for each spread/total line you want reserved). The main win market (FT in soccer, ML in non-soccer) is added by default.
9. Update the Event State PDA (`game_state` and `sequence`) as the event progresses, at least to sequence 1 for pre-game (accounts are initialized to sequence 0 to signal preparation stage).
10. Update the Market Data PDA as the market odds change.
11. Clients can now call the get_quote function of your SPAMM to get quotes for markets you are quoting. You should verify accounts that are passed and calculate the odds you want to offer based on the Market Data PDA and any data you have stored in your Config PDA and Event State PDA. For RFQ, clients POST `/api/rfq` and your MM replies with a signed quote over the WebSocket.
12. If your quote is in the top 5, the client will build a tx to attempt to fill the user bet. The aggregator will call the `get_quote` function again to get the best execution-time offers and then the `fill_quote` function if you are still offering the best odds. You can update the Config PDA, Market Data PDA, and Event State PDA tail here if you wish. RFQ fills use `fill_rfq_bet` /`fill_rfq_parlay` instead (one MM, signed quote, no quote buffer).
13. You can close the netting account by calling close_netting_account once an event is over.
14. You can manage your own Event State and Market Data PDAs as needed.

---

# SPAMM Aggregator

The aggregator is responsible for filling user bets with offers from the integrated SPAMMs. **Market operators** grade outcomes on their markets; the aggregator config `authority` will grade only as a fallback when an operator is delinquent. Anyone may settle graded tickets.

## Design Decisions

To be honest, I did not want the aggregator to be responsible for **grading** the bets or **holding any funds**, to reflect how propAMMs and their aggregators are designed. However, they are also simpler in that the only info needed for the quote is the two token mints, and once the swap is complete, that is the interaction over with. For betting, linking an **event/market id** for every single SPAMM using their own system would be nearly impossible, never mind trying to do it onchain. Therefore a **unified system of ids** is needed that **all SPAMMs must use**. This already puts the aggregator in a position of **responsibility for the bets**.

By offering **liability netting** on most markets, the aggregator massively improves the **capital efficiency** of each SPAMM and encourages them to try to **balance liabilities** which can increase the quality of the quotes offered. Without netting, each SPAMM would need to have a lot more capital on hand to be able to fill every bet. With the netting, the aggregator **must hold on to some of the funds** in order to distribute them to the winners. This puts **more responsibility on the aggregator**.

Settling bets could be the responsibility of the SPAMM if netting was not involved, but I believe it is a major improvement to have. As it is, the aggregator already holds a lot of responsibility so settling bets fairly is a natural extension. The alternative is no netting, SPAMMs hold the bet accounts, and users specify which SPAMMs are allowed to fill the bet based on the user trust of the SPAMM (similar to users opting out of Singbet filling orders on Mollybet since they are known to cancel bets for no reason). Forcing the user to profile every SPAMM is not a good user experience and would hinder new SPAMMs joining the network.

Parlays use two leg caps. **Auction / MM quote-buffer fills** (`fill_parlay`, `get_quote_parlay`) allow `MAX_PARLAY_LEGS = 20`: each leg still needs market-data + event-state accounts (packet size with ALTs is the practical limit). **RFQ parlays** (`fill_rfq_parlay`) allow `MAX_RFQ_PARLAY_LEGS = 40` since they pass **no** per-leg market/event PDAs (legs are covered by the MM’s ed25519-signed quote).

Event start times are **not** published onchain as part of the Event Id despite it probably being useful. The reason for this is that event times can change, like tennis and esports where the schedule is flexible, or due to weather etc. Market makers are likely to use event start time (as minutes until event start) as part of the quoting and, if the event time was published onchain, the aggregator would be responsible for keeping this correct. It is beyond the scope of the aggregator responsibility to keep this up to date to manage market maker risk, so market makers should be responsible for managing their own understanding of the event start time by posting it in the event state or market data PDAs. The onchain aggregator program should be as minimal as possible. Event start times (of best effort) are provided in the API, along with any other non-essential metadata.

## Market Operators

Every `MarketId` includes an `operator` address — the key responsible for grading bets on that market:

```rust
struct MarketId {
   event_id: EventId,
   player: u64,
   mkt: u16,
   period: u8,
   is_pregame: bool,
   operator: Address, // grades this market
}
```

The operator is baked into the market id at fill time (auction and RFQ paths alike). MM market-data PDAs derive from `["market_data", market_id_body_wire, operator]` so two operators never collide on the same PDA for the same selection.

`grade_bets` and `grade_parlay` accept a signer that is either that market’s `operator` or the aggregator config `authority` (fallback). For parlays, authority is checked **per graded leg** against that leg’s `market_id.operator`.

## Trust Assumptions

The **aggregator API** is responsible for providing **event and market ids** and linking them to a **real-world event**. The SPAMMs and users access this API and **trust these will be correct**. Each market’s **operator** grades bets; the aggregator `authority` is a fallback only. Everyone must trust that **bet grading** will reflect the **true outcome** of the market.

Since the aggregator **checks quotes at execution-time** and only selects the **best valid quotes**, **spoofing** quote responses to the client at the tx-building stage is **pointless**.

For **RFQ parlays**, fill-time trust is the MM `rfq_signer`: the aggregator does not re-verify on-chain market-data / event-state PDAs against the leg, only that the quote passed is correctly signed by the `rfq_signer`.

Everyone must trust that the **aggregator program** will **not** be upgraded to a **malicious version** that will steal the funds in pending bets and the liability token accounts.

## Pricing and Game Theory

Every bet is priced using a blind auction. Each SPAMM must offer their best price to win the right to fill the bet during the RPC tx-building stage, and then again during the actual onchain execution stage. A SPAMM could, theoretically, tell the difference between the two calls and lie during the tx-building stage but they would not get filled as other SPAMMs would be offering a better price. This makes the Nash Equilibrium of the SPAMM behaviour reach being honest at all times, and offering the most competitive price possible.

The addition of `min_odds_scaled` in the instruction data also ensures that all SPAMMs cannot collaborate to show a good price but then offer worse odds during the execution stage other than griefing. However, it just takes one honest SPAMM to act honestly and the bet would be filled.

## User Bet Flow

The **user bet flow** is as follows (single-leg `fill_bet`; parlay `fill_parlay` is the same pattern with multi-leg quotes and **no netting**):

1. The user (or UI) uses the aggregator API to find an event and market.
2. The user (or UI) uses the RPC to call the get_quote function of each SPAMM.
3. The user (or UI) uses these quotes to build a tx, including the 5 best quotes which fills the desired amount.
4. The user signs the tx and sends it to the network.
5. The aggregator checks the `get_quote` function of each SPAMM to ensure the user's fill is **as good as can be** at **execution-time**.
6. The aggregator works through the **valid quotes** in order and calls the `fill_quote` function of each SPAMM to fill as much as possible of the bet amount at odds **no worse than requested**.
7. The aggregator ensures that the `fill_quote` function was **successful** and the funds were transferred to the **mm liability token account**.
8. If the market is FT/ML, total or spread (pre-game or live), the aggregator will net the liability on the market for each market maker if they have opted into position netting for the event by creating a netting account data PDA.
9. The aggregator creates a bet PDA for the user and stores the stake funds in the bet ATA.
10. After the result is known, the bet is graded (`grade_bets` for single bets; `grade_parlay` for parlays).
11. Anyone can settle a graded ticket (`settle_bet` / `settle_parlay`).

### RFQ bet flow

RFQ is an alternate fill path for a **single MM** that has already signed a firm quote off-chain:

1. The MM sets `rfq_signer` on its config (`init_program` or `set_rfq_signer`) and connects to the aggregator RFQ WebSocket with a signed `mm.hello`.
2. The user (or UI) POSTs an RFQ request to `/api/rfq` with selections.
3. The hub fans the request to connected MMs; each MM may reply with a signed quote (`maxStake`, `oddsScaled`, `offerExpiry`, signature, and for parlays `legOddsScaled`).
4. The client picks a quote and builds `fill_rfq_bet` or `fill_rfq_parlay` (amount ≤ `maxStake`, before `offerExpiry`).
5. The aggregator verifies the ed25519 signature over the canonical RFQ message against the MM’s on-chain `rfq_signer`, CPIs `fill_bet_rfq` / `fill_parlay_rfq` for collateral, then opens the bet PDA (one filler). Netting on single-bet RFQ follows the same rules as `fill_bet`. `fill_rfq_parlay` does **not** pass or re-check market-data / event-state PDAs — the signed message (including each leg’s `market_id`, `event_game_state`, and `event_state_sequence`) is the source of truth at fill.

### Freebet flow

Issuer-sponsored stake: the **issuer ATA** (not the user ATA) funds the bet. Ticket headers store `freebet_id`. Fills are **all-or-nothing** (`ix.amount` must equal the freebet PDA amount and the auction/RFQ must fill that exact stake). Each fill is also gated by the voucher’s **MM whitelist** and **operator whitelist** (market `operator` on every leg). Freebets cannot be cashed out. Settle uses `settle_freebet` / `settle_freebet_parlay`: if the bet wins, the profit is paid to the user and the stake is returned to the issuer. If the bet loses, the stake goes to the market maker. Push / Cancelled / RolledBack reinstates the voucher (same amount, expiry `now + 3 days`). HalfWon / HalfLost reinstates at `amount / 2`.

1. Issuer auth calls `init_freebet_issuer`, deposits tokens, then `issue_freebet`.
2. User calls `freebet_fill_bet` / `freebet_fill_parlay` / RFQ siblings. Ix data is `freebet_id: u32` then the existing fill body; RFQ message signatures stay the same.
3. Grade as usual (`grade_bets` / `grade_parlay`).
4. Anyone calls `settle_freebet` / `settle_freebet_parlay`.

## Liability Netting

Liability netting is a **peak-reserve** feature in major **pre-game and live** markets (FT, BTTS (soccer), ML (non-soccer), Spread, Totals). Reserved collateral on a line is `max(open P on each outcome)`, not the sum of every ticket and not a mixed `+profit/−stake` book. A balanced 10@1.9/10@1.9 hedge posts **9**, not 18. A **rolled-back** live ticket is unwound on settle the same way as a void: that ticket’s profit is subtracted from the outcome it was filled on. Liability netting does **NOT** flatten the whole event: spread and total style netting is tracked per `(period, market)` line (`open_0` / `open_1`), while the main win market uses the header `open_home` / `open_away` / `open_draw`. For soccer, that header applies to `mkt` **1** `period` **1** (1X2). For non-soccer, it applies to `mkt` **0** `period` **0** (ML) (`open_draw` stays 0).
This requires you to have created a **liability netting PDA** for the event via `create_netting_account`. The PDA is owned by the aggregator. It **MUST** be of the seeds `["netting", mm_program_address, event_id]`.

The account is created with the win market in the header plus **10 spare line slots**. Fills **auto-insert** a new eligible `(period, mkt)` and **realloc** when those slots are full (**feepayer** pays the extra rent). Hard cap is **255**. MM admin can also `add_line_to_netting_account`, if you want to pre-declare lines you intend to quote.

You can remove a line from the netting account by calling the `remove_line_from_netting_account` function with the `event_id`, `period`, and `mkt` to be removed. Remove and close **fail** while any open profit remains on that PDA.

Spread/total lines in account data are stored in sorted order by `period` ascending, then `mkt` ascending. Each line is packed `period` (u8), `mkt` (u16), `open_0` (u64 LE), `open_1` (u64 LE). Eligible line markets (BTTS / OU / AH) may use **any** period; FT 1X2/ML stays in the header only. Soccer HT win (`period` **2**, `mkt` **1**) cannot be netted.

When a single bet is settled **lost**, the stake is paid into the **mm liability token account** owned by the **aggregator**. **Encumbrance** is the sum of per-line peaks plus unnetted ticket profit; excess above that can be withdrawn by calling `withdraw_from_liability_account`.

## API

The **operator API** will be responsible for providing:

- a map of sports to sport ids
- a map of leagues to league ids
- a map of events to event ids
- a defined system of period ids
- a defined system of market ids
- a map of players to player ids
- the `EventGameState` snapshot and `sequence` for each event

**SPAMMs should NOT** rely on the published snapshot in reflecting reality to the millisecond. If you have access to a **faster data feed**, you should use it to advance `sequence` and refresh `game_state` so your quotes **match reality** as closely as possible. Keep your Market Data PDA and Event State PDA in sync with each other to avoid filling at **stale odds or stale game state**.

### RFQ bet flow

The API hosts an RFQ collect path for signed-quote fills:

- `POST /api/rfq` — fan-out the request to connected MMs, wait up to **2 seconds** (`RFQ_COLLECT_TIMEOUT_MS`), return `{ requestId, quotes, timedOut, mmCount }`.
- `WS /ws/mm` — market-maker sockets. On connect, send signed `mm.hello` (`mmProgramId`, `rfqSigner`, `timestamp`); the hub checks the MM is on the aggregator `mm_list`, that on-chain `rfq_signer` matches, and that the ed25519 hello signature verifies (`|Δt| ≤ 60s`). Ack: `mm.hello.ack`. Quotes arrive as `rfq.quote` replies to hub `rfq.request` messages.

Request body shape: `{ user, betId, amount, selections[] }` — each selection carries `marketId`, `side`, `eventStateSequence`, `eventGameState`. Quote shape: `{ mmProgramId, maxStake, oddsScaled, offerExpiry, signature (base64), legOddsScaled[] }` (parlay quotes must supply one scaled odds per leg).

Offer expiry is the number of seconds from the current time that the offer is valid for and must be set only a short time in the future to avoid quote replays. A quote cannot be replayed while the bet account is open, so the expiry must be no further in the future than the bet settling. In practice, you should be setting an expiry about 10-60 seconds in the future - enough time for the UI to display the offer and the user to sign the transaction. Too long and you risk a quote being held by the user until the odds move in their favour. Too short and you risk a quote being rejected because the user was not fast enough to sign the transaction.

| `RFQ_NETWORK_DOMAIN` | Cluster |
| --- | --- |
| 1 | mainnet |
| 2 | devnet |
| 3 | local |

| `Kind` | Message |
| --- | --- |
| 1 | bet |
| 2 | parlay |
| 3 | cashout bet |
| 4 | cashout parlay |

## Accounts at a Glance

| Account | Discriminator | Seed/Auth | Notes |
| --- | --- | --- | --- |
| Bet PDA Accounts | 1 | ["bet", user_address, bet_id] | created in fill_bet / fill_rfq_bet |
| Parlay Bet PDA Accounts | 2 | ["parlay", user_address, bet_id] | header + `num_legs` live `ParlayLegWire`s |
| Bet Token Account | n/a | ATA(bet/parlay_pda, mint) | authority is the Bet PDA Account, created in fill_bet |
| MM List PDA | 3 | ["mm_list"] | created in init_program, used by clients to find SPAMMs to reach for quotes |
| Config PDA | 4 | ["config"] | created in init_program |
| MM Encumbrance PDA | 5 | ["encumbrance", mm_program_address] | created in register_mm |
| MM Liability Token Account | n/a | ATA(encumbrance_pda, mint) | authority is the MM Encumbrance PDA, created in register_mm |
| MM Netting PDA | 6 | ["netting", mm_program_address, event_id] | created with create_netting_account; see Liability Netting for line layout |
| Cashout Escrow PDA | 7 | ["cashout_escrow", user_address, orig_bet_id] | live cashout delay escrow; holds payment until claim/revert |
| Cashout Account PDA | 8 | ["cashout", filling_mm, cashout_id] | novated single-bet slice owned by filling MM; settleable like a bet |
| Cashout Parlay Account PDA | 9 | ["cashout_parlay", filling_mm, cashout_id] | novated parlay slice owned by filling MM |
| Freebet Issuer PDA | 10 | ["freebet_issuer", auth] | promo fund authority; `open_count` of in-flight freebets |
| Freebet PDA | 11 | ["freebet", auth, freebet_id] | Available/Used voucher; trailing MM whitelist (`num_mms == 0` = any MM) then operator whitelist (`num_operators == 0` = any operator) |
| Issuer Token Account | n/a | ATA(freebet_issuer_pda, mint) | funds bet atas at placement |

## Aggregator Instructions

The first byte of aggregator instruction `data` selects the handler.

| Discriminator | Instruction |
| --- | --- |
| 0 | `init_program` |
| 1 | `change_config_status` |
| 2 | `register_mm` |
| 3 | `deregister_mm` |
| 10 | `fill_bet` |
| 11 | `fill_parlay` |
| 12 | `fill_rfq_bet` |
| 13 | `fill_rfq_parlay` |
| 15 | `freebet_fill_bet` |
| 16 | `freebet_fill_parlay` |
| 17 | `freebet_fill_rfq_bet` |
| 18 | `freebet_fill_rfq_parlay` |
| 20 | `grade_bets` |
| 21 | `grade_parlay` |
| 25 | `settle_bet` |
| 26 | `settle_parlay` |
| 27 | `settle_freebet` |
| 28 | `settle_freebet_parlay` |
| 30 | `get_quote_proxy` |
| 31 | `get_parlay_quote_proxy` |
| 32 | `get_market_quotes_proxy` |
| 33 | `get_cashout_quote_proxy` |
| 34 | `get_parlay_cashout_quote_proxy` |
| 40 | `create_netting_account` |
| 41 | `add_line_to_netting_account` |
| 42 | `remove_line_from_netting_account` |
| 43 | `close_netting_account` |
| 50 | `withdraw_from_liability_account` |
| 60 | `init_freebet_issuer` |
| 61 | `remove_freebet_issuer` |
| 62 | `withdraw_freebet_funds` |
| 63 | `issue_freebet` |
| 64 | `revoke_freebet` |
| 70 | `fill_cashout` |
| 71 | `fill_parlay_cashout` |
| 72 | `fill_rfq_cashout` |
| 73 | `fill_rfq_parlay_cashout` |
| 74 | `claim_cashout_escrow` |
| 75 | `revert_cashout` |
| 254 | `write_arbitrary_data` |
| 255 | `force_close_pda` |

### init_program

Discriminator: **0**

This is called by the aggregator admin to initialize the program and set up program-owned accounts.

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | aggregator authority | writable, signer | Set as initial `authority` in config PDA |
| 1 | config pda | writable | Must be uninitialized. |
| 2 | mm list pda | writable | Must be uninitialized. |
| 3 | rent sysvar | readonly | Must be the rent sysvar |
| 4 | system program | readonly | Must be the system program |

### change_config_status

Discriminator: **1**

This is called by the aggregator admin to change the status of the aggregator config.

Data:

```rust
struct ChangeConfigStatusIxData {
   discriminator: u8, // 1
   status: u8, // 0 = paused, 1 = unpaused
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | aggregator authority | writable, signer | Must match `authority` in config PDA |
| 1 | config pda | writable | |

### register_mm

Discriminator: **2**

This is called by a SPAMM admin to register the SPAMM with the aggregator. Registration **verifies** the signer matches the MM config `admin`; it does **not** set or change that field.

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm admin | writable, signer | Pays rent / resize; must match MM config `admin` (verified, not set by registration) |
| 1 | mm program | readonly | Must be executable (a program) |
| 2 | mm config pda | readonly | Must be **initialized**; signer verified as MM config `admin` |
| 3 | mm encumbrance pda | writable | Must be uninitialized |
| 4 | mm liability token account | writable | Must be uninitialized; authority is the MM Encumbrance PDA |
| 5 | aggregator config pda | readonly | Must be the Aggregator Config PDA |
| 6 | mm list pda | writable | |
| 7 | mint | readonly | Must be the mint |
| 8 | token program | readonly | Must be the token program |
| 9 | associated token program | readonly | Must be the associated token program |
| 10 | rent sysvar | readonly | Must be the rent sysvar |
| 11 | system program | readonly | Must be the system program |
| 12 | mm token account | readonly | |
| 13 | mm quote buffer | readonly | |
| 14 | mm parlay quote buffer | readonly | |

### deregister_mm

Discriminator: **3**

Called by the aggregator admin after off-chain checks that the MM has no open bets. Reverses `register_mm`: sweeps liability tokens to the MM collateral ATA, closes the liability ATA and encumbrance PDA (rent to `mm_admin`), and removes the MM program id from `mm_list`.

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | aggregator authority | writable, signer | Must match `authority` in aggregator config PDA |
| 1 | mm admin | writable | Receives rent from closed encumbrance PDA and liability ATA; must match MM config admin |
| 2 | mm program | readonly | Must be executable |
| 3 | mm config pda | readonly | |
| 4 | mm encumbrance pda | writable | Must exist; `encumbrance` field must be **0** |
| 5 | mm liability token account | writable | Closed after transferring tokens to MM collateral ATA |
| 6 | aggregator config pda | readonly | |
| 7 | mm list pda | writable | MM program id removed from list |
| 8 | mint | readonly | |
| 9 | token program | readonly | |
| 10 | associated token program | readonly | |
| 11 | rent sysvar | readonly | |
| 12 | system program | readonly | |
| 13 | mm token account | writable | Receives liability ATA token balance |
| 14 | mm quote buffer | readonly | |
| 15 | mm parlay quote buffer | readonly | |

### init_freebet_issuer

Discriminator: **60**

Called by an issuer authority to create the Freebet Issuer PDA and its classic ATA. Auth pays rent.

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | auth | writable, signer | Pays rent; becomes issuer `auth` |
| 1 | issuer pda | writable | Must be uninitialized; seeds `["freebet_issuer", auth]` |
| 2 | issuer ata | writable | Must be uninitialized; classic ATA of issuer PDA |
| 3 | mint | readonly | |
| 4 | token program | readonly | |
| 5 | associated token program | readonly | |
| 6 | rent sysvar | readonly | |
| 7 | system program | readonly | |

### remove_freebet_issuer

Discriminator: **61**

Requires `open_count == 0`. Drains the issuer ATA to the auth ATA, then closes the ATA and issuer PDA (rent to auth).

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | auth | writable, signer | Must match issuer PDA `auth`; receives rent |
| 1 | issuer pda | writable | Closed after drain |
| 2 | issuer ata | writable | Drained then closed |
| 3 | auth ata | writable | Receives issuer ATA token balance |
| 4 | mint | readonly | |
| 5 | token program | readonly | |
| 6 | associated token program | readonly | |
| 7 | system program | readonly | |

### withdraw_freebet_funds

Discriminator: **62**

Transfers `amount` from the issuer ATA to the dest ATA (issuer PDA signs). No encumbrance math.

Data:

```rust
struct WithdrawFreebetFundsIxData {
   discriminator: u8, // 62
   amount: u64,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | auth | signer | Must match issuer PDA `auth` |
| 1 | issuer pda | readonly | PDA signer for the transfer |
| 2 | issuer ata | writable | Source |
| 3 | dest ata | writable | Must be auth-owned ATA for the mint |
| 4 | mint | readonly | |
| 5 | token program | readonly | |

### issue_freebet

Discriminator: **63**

Creates a freebet PDA for `user` and increments issuer `open_count`. Max **10** MMs and **5** operators.

Data:

```rust
struct IssueFreebetIxData {
   discriminator: u8, // 63
   freebet_id: u32,   // must be > 0
   expiry: u32,       // unix seconds; must be > now
   amount: u64,
   min_odds_scaled: u32,
   max_odds_scaled: u32,
   min_legs: u8,
   num_mms: u8,       // 0..=10; 0 = any MM
   num_operators: u8, // 0..=5; 0 = any market operator
   allowed_mms: [Address; num_mms],
   allowed_operators: [Address; num_operators],
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | auth | writable, signer | Must match issuer PDA `auth` |
| 1 | issuer pda | writable | |
| 2 | user | readonly | Recipient; not required to sign |
| 3 | freebet pda | writable | Must be uninitialized; seeds `["freebet", auth, freebet_id]` |
| 4 | rent sysvar | readonly | |
| 5 | system program | readonly | |
| 6 | clock sysvar | readonly | Expiry must be in the future |

### revoke_freebet

Discriminator: **64**

Auth-only revoke.

Data:

```rust
struct RevokeFreebetIxData {
   discriminator: u8, // 64
   freebet_id: u32,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | auth | writable, signer | Must match freebet `issuer_auth`; receives rent |
| 1 | issuer pda | writable | |
| 2 | freebet pda | writable | Must be `Available` |

### fill_bet

Discriminator: **10**

This is called by a user to place a bet.

Data:

```rust
struct FillBetIxData {
   discriminator: u8, // 10
   bet_id: u64,
   market_id: MarketId,
   side: u8, // two-outcome: 0 or 1; three-sided mkt 1 or 5: 0, 1, or 2
   amount: u64,
   min_odds_scaled: u32,
   event_state_sequence: u16,
   event_game_state: EventGameState,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays rent for bet PDA / ATA and extra netting-line rent if a fill inserts a new line |
| 1 | user | readonly, signer | Must match user ATA owner |
| 2 | user ata | writable | |
| 3 | bet pda | writable | Must be uninitialized |
| 4 | bet ata | writable | Must be uninitialized; authority is the Bet PDA Account |
| 5 | config pda | readonly | Aggregator config |
| 6 | mint | readonly | |
| 7 | token program | readonly | |
| 8 | associated token program | readonly | |
| 9 | rent sysvar | readonly | |
| 10 | system program | readonly | |
| 11 | instructions sysvar | readonly | Passed through to MM `fill_quote` CPI |
| 12 | Clock sysvar | readonly | Passed through to MM `get_quote` CPI |

Then for each MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | Must be executable (a program) |
| 1 | mm config pda | writable | |
| 2 | mm event state pda | writable | Forwarded to MM `fill_quote` (unverified on fill) |
| 3 | mm market data pda | writable | |
| 4 | mm quote buffer | writable | |
| 5 | mm encumbrance pda | writable | |
| 6 | mm liability token account | writable | |
| 7 | mm token account | writable | |
| 8 | mm netting pda | writable | Must match expected but can be uninitialized |

### fill_parlay

Discriminator: **11**

This is called by a user to place a multi-leg parlay.

Data:

```rust
struct FillParlayIxData {
   discriminator: u8, // 11
   bet_id: u64,
   amount: u64,
   min_odds_scaled: u32,
   num_legs: u8,         // L, must be 2..=MAX_PARLAY_LEGS (20)
   legs: [ParlayLegSel; L],
}
```

The MM **parlay quote buffer** account stores fixed `MAX_PARLAY_LEGS` slots (pad when writing the buffer).

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays rent for parlay bet PDA / ATA |
| 1 | user | readonly, signer | Must match user ATA owner |
| 2 | user ata | writable | Stake source |
| 3 | bet pda | writable | Must be uninitialized |
| 4 | bet ata | writable | Must be uninitialized; authority is bet pda |
| 5 | config pda | readonly | Aggregator config |
| 6 | mint | readonly | |
| 7 | token program | readonly | |
| 8 | associated token program | readonly | |
| 9 | rent sysvar | readonly | |
| 10 | system program | readonly | |
| 11 | instructions sysvar | readonly | Passed through to MM `fill_parlay_quote` CPI |
| 12 | Clock sysvar | readonly | Passed through to MM `get_quote_parlay` CPI |

Then the MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | Must be executable (a program) |
| 1 | mm config pda | writable | |
| 2 | mm parlay quote buffer | writable | |
| 3 | mm encumbrance pda | writable | |
| 4 | mm liability token account | writable | |
| 5 | mm token account | writable | |

Then for each leg:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm market data | readonly | |
| 1 | mm event state | readonly | |

### fill_rfq_bet

Discriminator: **12**

Signed-quote single-market fill against **one** MM (no quote buffer, no competitive auction). The aggregator verifies an ed25519 signature over the canonical RFQ message using the MM config’s `rfq_signer`, CPIs MM `fill_bet_rfq`, then opens the bet PDA with that MM as the sole filler. Netting uses the same rules as `fill_bet`.

Data:

```rust
struct FillRfqBetIxData {
   discriminator: u8, // 12
   bet_id: u64,
   market_id: MarketId,
   side: u8,
   amount: u64,         // MIN_BET_AMOUNT ≤ amount requested by the user ≤ max_stake
   odds_scaled: u32,
   event_state_sequence: u16,
   event_game_state: EventGameState,
   max_stake: u64,        // signed amount offered by the mm; max offered by the mm
   offer_expiry: u32,        // unix seconds; tx must execute before this
   signature: [u8; 64],
}
```

Canonical signed message

`domain | kind=1 | user_address | bet_id | market_id | event_game_state | event_state_sequence | side | max_stake | odds_scaled | offer_expiry | mm_program_id`

Note: fill `amount` is **not** in the signed message — only `max_stake`.

Accounts (**13** fixed):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays rent for bet PDA / ATA and extra netting-line rent if a fill inserts a new line |
| 1 | user | readonly, signer | Must match user ATA owner |
| 2 | user ata | writable | |
| 3 | bet pda | writable | Must be uninitialized |
| 4 | bet ata | writable | Must be uninitialized; authority is the Bet PDA Account |
| 5 | config pda | readonly | Aggregator config |
| 6 | mint | readonly | |
| 7 | token program | readonly | |
| 8 | associated token program | readonly | |
| 9 | rent sysvar | readonly | |
| 10 | system program | readonly | |
| 11 | instructions sysvar | readonly | Passed through to MM `fill_bet_rfq` CPI |
| 12 | Clock sysvar | readonly | Offer expiry check; passed through to MM CPI |

Then the MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | Must be executable |
| 1 | mm config pda | writable | Holds `rfq_signer` |
| 2 | mm event state pda | writable | Aggregator verifies (`verify_event_state`) before MM CPI; MM CPI may ignore |
| 3 | mm market data pda | writable | Aggregator verifies (`verify_mm_market_data_pda`) before MM CPI; MM CPI may ignore |
| 4 | mm encumbrance pda | writable | |
| 5 | mm liability token account | writable | |
| 6 | mm token account | writable | |
| 7 | mm netting pda | writable | Real netting PDA, or system program if none |

### fill_rfq_parlay

Discriminator: **13**

Signed-quote multi-leg fill against **one** MM. Verifies ed25519 over the parlay RFQ message, CPIs MM `fill_parlay_rfq`, opens a parlay bet PDA. No netting. `num_legs` must be **2..=MAX_RFQ_PARLAY_LEGS (40)**; product of per-leg `odds_scaled` must match the ticket `odds_scaled`.

**No** per-leg market-data or event-state accounts — those values are assumed to be verified offchain by the mm before signature.

Data:

```rust
struct FillRfqParlayIxHeader {
   bet_id: u64,
   amount: u64,
   odds_scaled: u32,
   max_stake: u64,
   offer_expiry: u32,
   num_legs: u8,
   legs: [ParlayLegQuoted; num_legs],
   signature: [u8; 64],
}
```

Canonical signed message (real legs only — **not** padded; kind **2**):

`domain | kind=2 | user | bet_id | max_stake | odds_scaled | offer_expiry | mm_program_id | num_legs | ParlayLegQuoted×num_legs`

Accounts (**13** fixed — no quote buffer, netting, or per-leg PDAs):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays rent for parlay bet PDA / ATA |
| 1 | user | readonly, signer | Must match user ATA owner |
| 2 | user ata | writable | Stake source |
| 3 | bet pda | writable | Must be uninitialized |
| 4 | bet ata | writable | Must be uninitialized; authority is bet pda |
| 5 | config pda | readonly | Aggregator config |
| 6 | mint | readonly | |
| 7 | token program | readonly | |
| 8 | associated token program | readonly | |
| 9 | rent sysvar | readonly | |
| 10 | system program | readonly | |
| 11 | instructions sysvar | readonly | Passed through to MM `fill_parlay_rfq` CPI |
| 12 | Clock sysvar | readonly | Offer expiry check; passed through to MM CPI |

Then the MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | writable | |
| 2 | mm encumbrance pda | writable | |
| 3 | mm liability token account | writable | |
| 4 | mm token account | writable | |

### fill_cashout

Discriminator: **70**

Auction cashout of an open single-bet ticket. CPIs each MM’s `get_cashout_quote`, picks the best **payment**, then pays that amount to the dest (user ATA pregame, or escrow ATA when live delay applies): the aggregator spends **free** tokens on the filling MM’s liability ATA first (`balance − max(encumbrance, 0)`), then CPIs `fill_cashout_quote` with `amount_to_send` = remainder from the MM token ATA (CPI still runs when remainder is 0 so the quote buffer is marked used). Dest must rise by the **full** quoted payment. Novates the cashed slice onto a **Cashout Account** owned by the filling MM, and moves stake from the bet ATA to the cashout ATA. Encumbrance is not written.

- **Pregame** (market `is_pregame` and both ticket and quoted event sequence `< 2`): payment is sent immediately to the user; full cashout closes the original bet; partial leaves remaining stake `Pending`.
- **Live** (not pregame, or either sequence ≥ 2): payment lands in a **Cashout Escrow** for `LIVE_CASHOUT_DELAY` (30s). Full cashout sets original `result = CashedOut (9)`; claim closes escrow (+ original if still `CashedOut`). `RolledBack` on original or cashout → claim fails with `CashoutMustRevert`; use `revert_cashout`.
- Quoted `event_state_sequence` must be **≥** the original ticket (or per-leg) sequence (`InvalidInstructionData` if older).

Data:

```rust
struct FillCashoutIxData {
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,       // stake slice to cash (≤ ticket amount)
   min_payout: u64,   // floor on payment
   event_state_sequence: u16, // must be >= ticket sequence
   event_game_state: EventGameState,
}
```

Accounts (**18** fixed, then **8 × N** MM blocks; `N` ≤ `MAX_NUMBER_OF_MMS` **(5)**):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays rent for cashout (+ escrow if live) |
| 1 | ticket feepayer | writable | Original ticket `feepayer`; rent dest on full pregame close |
| 2 | user | readonly, signer | Ticket owner |
| 3 | user ata | writable | Receives payment pregame |
| 4 | bet pda | writable | Original ticket |
| 5 | bet ata | writable | |
| 6 | cashout pda | writable | Seeds: `["cashout", filling_mm, cashout_id]` |
| 7 | cashout ata | writable | |
| 8 | escrow pda | writable | Can be system program if original bet and current event state are not live |
| 9 | escrow ata | writable | Can be system program if original bet and current event state are not live |
| 10 | config pda | readonly | |
| 11 | mint | readonly | |
| 12 | token program | readonly | |
| 13 | associated token program | readonly | |
| 14 | rent sysvar | readonly | |
| 15 | system program | readonly | |
| 16 | instructions sysvar | readonly | |
| 17 | clock sysvar | readonly | |

Then for each MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | writable | |
| 2 | mm event state pda | writable | |
| 3 | mm market data pda | writable | |
| 4 | mm quote buffer | writable | |
| 5 | mm encumbrance pda | writable | |
| 6 | mm liability token account | writable | |
| 7 | mm token account | writable | |

### fill_parlay_cashout

Discriminator: **71**

Single-MM cashout of an open parlay. Same delay / escrow / novation rules; cashout PDA seeds `["cashout_parlay", filling_mm, cashout_id]`. Same free-liability-then-remainder payment as `fill_cashout`.

Data:

```rust
struct FillParlayCashoutIxData {
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,       // stake slice to cash (≤ ticket amount)
   min_payout: u64,   // floor on payment
   num_legs: u8,      // must be 2..=MAX_PARLAY_LEGS (20)
   snapshots: [CashoutSnapshot; num_legs],
}

struct CashoutSnapshot {
   event_state_sequence: u16, // must be >= that leg’s ticket sequence
   event_game_state: EventGameState,
}
```

Accounts (**18** fixed):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays rent for cashout (+ escrow if live) |
| 1 | ticket feepayer | writable | Original ticket `feepayer`; rent dest on full pregame close |
| 2 | user | readonly, signer | Ticket owner |
| 3 | user ata | writable | Receives payment pregame |
| 4 | bet pda | writable | Original parlay ticket |
| 5 | bet ata | writable | |
| 6 | cashout pda | writable | Seeds: `["cashout_parlay", filling_mm, cashout_id]` |
| 7 | cashout ata | writable | |
| 8 | escrow pda | writable | Can be system program if not live |
| 9 | escrow ata | writable | Can be system program if not live |
| 10 | config pda | readonly | |
| 11 | mint | readonly | |
| 12 | token program | readonly | |
| 13 | associated token program | readonly | |
| 14 | rent sysvar | readonly | |
| 15 | system program | readonly | |
| 16 | instructions sysvar | readonly | |
| 17 | clock sysvar | readonly | |

Then the MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | writable | |
| 2 | mm parlay quote buffer | writable | |
| 3 | mm encumbrance pda | writable | |
| 4 | mm liability token account | writable | |
| 5 | mm token account | writable | |

Then for each leg:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm market data | readonly | |
| 1 | mm event state | readonly | |

### fill_rfq_cashout

Discriminator: **72**

Signed RFQ cashout of a single bet against one MM. Verifies ed25519 over the cashout RFQ message (signed `max_payment` is the **full** cash). The aggregator spends free liability first, then CPIs MM `fill_cashout_rfq` (disc **144**) with `amount_to_send` = remainder.

Canonical message: `domain | kind=3 | user | orig_bet_id | cashout_id | amount | max_payment | offer_expiry | event_state_sequence | event_game_state | mm_program_id`.

Data:

```rust
struct FillRfqCashoutIxData {
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,
   min_payout: u64,
   max_payment: u64,   // signed full cash; payment dest must rise by this
   offer_expiry: u32,
   event_state_sequence: u16,
   event_game_state: EventGameState,
   signature: [u8; 64],
}
```

Accounts (**18** fixed):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays rent for cashout (+ escrow if live) |
| 1 | ticket feepayer | writable | Original ticket `feepayer`; rent dest on full pregame close |
| 2 | user | readonly, signer | Ticket owner |
| 3 | user ata | writable | Receives payment pregame |
| 4 | bet pda | writable | Original ticket |
| 5 | bet ata | writable | |
| 6 | cashout pda | writable | Seeds: `["cashout", filling_mm, cashout_id]` |
| 7 | cashout ata | writable | |
| 8 | escrow pda | writable | Unused pregame (may be system program) |
| 9 | escrow ata | writable | Unused pregame (may be system program) |
| 10 | config pda | readonly | |
| 11 | mint | readonly | |
| 12 | token program | readonly | |
| 13 | associated token program | readonly | |
| 14 | rent sysvar | readonly | |
| 15 | system program | readonly | |
| 16 | instructions sysvar | readonly | |
| 17 | clock sysvar | readonly | |

Then the MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | writable | |
| 2 | mm event state pda | writable | |
| 3 | mm market data pda | writable | |
| 4 | mm encumbrance pda | writable | |
| 5 | mm liability token account | writable | |
| 6 | mm token account | writable | |

### fill_rfq_parlay_cashout

Discriminator: **73**

Signed RFQ cashout of a parlay. CPIs MM `fill_parlay_cashout_rfq` with `amount_to_send` remainder after free liability. Signed `max_payment` is the full cash.

Canonical message: `domain | kind=4 | user | orig_bet_id | cashout_id | amount | max_payment | offer_expiry | mm_program_id | num_legs | CashoutSnapshot×num_legs`.

Data:

```rust
struct FillRfqParlayCashoutIxData {
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,
   min_payout: u64,
   max_payment: u64,
   offer_expiry: u32,
   num_legs: u8,      // 2..=MAX_RFQ_PARLAY_LEGS (40)
   snapshots: [CashoutSnapshot; num_legs],
   signature: [u8; 64],
}
```

Accounts (**18** fixed):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays rent for cashout (+ escrow if live) |
| 1 | ticket feepayer | writable | Original ticket `feepayer`; rent dest on full pregame close |
| 2 | user | readonly, signer | Ticket owner |
| 3 | user ata | writable | Receives payment pregame |
| 4 | bet pda | writable | Original parlay ticket |
| 5 | bet ata | writable | |
| 6 | cashout pda | writable | Seeds: `["cashout_parlay", filling_mm, cashout_id]` |
| 7 | cashout ata | writable | |
| 8 | escrow pda | writable | Unused pregame (may be system program) |
| 9 | escrow ata | writable | Unused pregame (may be system program) |
| 10 | config pda | readonly | |
| 11 | mint | readonly | |
| 12 | token program | readonly | |
| 13 | associated token program | readonly | |
| 14 | rent sysvar | readonly | |
| 15 | system program | readonly | |
| 16 | instructions sysvar | readonly | |
| 17 | clock sysvar | readonly | |

Then the MM (**5** — no per-leg PDAs):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | writable | |
| 2 | mm encumbrance pda | writable | |
| 3 | mm liability token account | writable | |
| 4 | mm token account | writable | |

### claim_cashout_escrow

Discriminator: **74**

Permissionless claim after `LIVE_CASHOUT_DELAY`. Closes escrow ATA → user ATA and escrow PDA → `rent_recipient` (must equal stored `escrow.feepayer`). If original ticket `result == CashedOut`, closes the original bet ATA (any leftover dust → user ATA) **then** the original bet PDA. Fails with `CashoutDelayNotElapsed` too early; `CashoutMustRevert` if original or cashout is `RolledBack`.

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Tx fee payer; not the rent destination |
| 1 | rent recipient | writable | Must equal `escrow.feepayer`; receives escrow PDA / ATA close lamports |
| 2 | ticket feepayer | writable | Original ticket `feepayer`; receives orig PDA/ATA rent on full cashout |
| 3 | user | readonly | Escrow owner |
| 4 | user ata | writable | Receives escrowed payment |
| 5 | escrow pda | writable | |
| 6 | escrow ata | writable | |
| 7 | original bet pda | writable | Closed if result is `CashedOut` |
| 8 | original bet ata | writable | Closed if result is `CashedOut` |
| 9 | cashout pda | readonly | Used to detect `RolledBack` |
| 10 | config pda | readonly | |
| 11 | mint | readonly | |
| 12 | token program | readonly | |
| 13 | system program | readonly | |
| 14 | clock sysvar | readonly | Delay elapsed check |

### revert_cashout

Discriminator: **75**

Permissionless when original or cashout is `RolledBack`. Restores stake/fillers onto the original ticket, returns escrowed payment to the filling MM **liability ATA**, closes cashout + escrow PDAs/ATAs.

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Tx fee payer; not the rent destination |
| 1 | rent recipient | writable | Must equal `escrow.feepayer` |
| 2 | user | readonly | Original ticket owner / escrow owner |
| 3 | user ata | writable | Dust destination for ATA closes |
| 4 | original bet pda | writable | |
| 5 | original bet ata | writable | |
| 6 | cashout pda | writable | |
| 7 | cashout ata | writable | |
| 8 | escrow pda | writable | |
| 9 | escrow ata | writable | |
| 10 | mm program | readonly | Filling MM |
| 11 | mm config pda | readonly | |
| 12 | mm encumbrance pda | readonly | Authority of the liability ATA |
| 13 | mm liability token account | writable | Receives escrowed payment |
| 14 | config pda | readonly | |
| 15 | mint | readonly | |
| 16 | token program | readonly | |
| 17 | system program | readonly | |

### get_quote_proxy

Discriminator: **30**

Read-only quote aggregation for the UI: CPI each MM’s `get_quote`, collect valid quotes, and return them via `sol_set_return_data` (no bet PDA, no token moves). `bet_id` is decoded but **not used**.

Data:

```rust
struct FillBetIxData {
   bet_id: u64,           // decoded but unused
   market_id: MarketId,
   side: u8,
   amount: u64,
   min_odds_scaled: u32,
   event_state_sequence: u16,
   event_game_state: EventGameState,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | user | readonly | Passed to each MM `get_quote` CPI |
| 1 | Clock sysvar | readonly | Passed to each MM `get_quote` CPI |

Then for each MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | readonly | |
| 2 | mm event state pda | readonly | |
| 3 | mm market data pda | readonly | |
| 4 | mm quote buffer | writable | |

Return data: concatenation of zero or more:

```rust
struct ProxyQuoteData {
   mm_address: Address,   // MM program id
   max_amount: u64,
   odds_scaled: u32,
}
```

Invalid or empty MM quotes are skipped; duplicate MM program ids fail the instruction.

### get_market_quotes_proxy

Discriminator: **32**

Like `get_quote_proxy`, but CPIs each MM’s `get_quote` once per side for the market (`mkt` → side count per `id-system.md`).

Data:

```rust
struct FillBetIxData {
   bet_id: u64,           // decoded but unused
   market_id: MarketId,
   side: u8,              // decoded but unused
   amount: u64,
   min_odds_scaled: u32,
   event_state_sequence: u16,
   event_game_state: EventGameState,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | user | readonly | Passed to each MM `get_quote` CPI |
| 1 | Clock sysvar | readonly | Passed to each MM `get_quote` CPI |

Then for each MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | readonly | |
| 2 | mm event state pda | readonly | |
| 3 | mm market data pda | readonly | |
| 4 | mm quote buffer | writable | |

`N` must be ≤ `min(20, floor(1024 / (32 + num_sides × 4)))` so return data fits the 1024-byte cap (e.g. at most **15** MMs for 9-side markets, **20** for 2-side markets).

Return data: concatenation of MM chunks:

```rust
struct MarketQuotesProxyChunk {
   mm_address: Address,
   odds_scaled: [u32; num_sides], // amounts are not returned
}
```

MMs with no valid quote on any side are omitted. Failed sides for an included MM are zero-filled.

### get_parlay_quote_proxy

Discriminator: **31**

CPIs MM `get_quote_parlay` for each registered MM. `bet_id` is decoded but unused.

Data:

```rust
struct FillParlayIxData {
   bet_id: u64,           // decoded but unused
   amount: u64,
   min_odds_scaled: u32,
   num_legs: u8,         // 2..=MAX_PARLAY_LEGS (20)
   legs: [ParlayLegSel; num_legs],
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | user | readonly | |
| 1 | Clock sysvar | readonly | |

Then for each MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | readonly | |
| 2 | mm parlay quote buffer | writable | |

Then for each leg of that MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm market data | readonly | |
| 1 | mm event state | readonly | |

Return data: concatenation of zero or more `ProxyParlayQuoteData` entries. Entries are **variable length** — each carries only its own `num_legs` odds, so decoders must read `num_legs` at offset 44 and advance by `45 + num_legs × 4` rather than assuming a fixed stride.

```rust
struct ProxyParlayQuoteData {
   mm_address: Address,   // MM program id
   max_amount: u64,
   odds_scaled: u32,      // combined ticket odds
   num_legs: u8,
   leg_odds: [u32; num_legs],
}
```

### get_cashout_quote_proxy

Discriminator: **33**

Simulate-only auction for cashout of an open single ticket. Soft-fails dead MMs (same as other proxies). `cashout_id` is decoded but unused.

Data:

```rust
struct FillCashoutIxData {
   orig_bet_id: u64,
   cashout_id: u64,       // decoded but unused
   amount: u64,
   min_payout: u64,
   event_state_sequence: u16,
   event_game_state: EventGameState,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | user | readonly | |
| 1 | Clock sysvar | readonly | |
| 2 | original bet pda | readonly | |

Then for each MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | readonly | |
| 2 | mm event state pda | readonly | |
| 3 | mm market data pda | readonly | |
| 4 | mm quote buffer | writable | |

Return data: concatenation of:

```rust
struct ProxyCashoutQuoteData {
   mm_address: Address,  // MM program id
   max_payment: u64,     // payment the MM will pay
}
```

### get_parlay_cashout_quote_proxy

Discriminator: **34**

Simulate-only auction for cashout of an open parlay. Soft-fails dead MMs (same as other proxies).

Data:

```rust
struct FillParlayCashoutIxData {
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,
   min_payout: u64,
   num_legs: u8,
   snapshots: [CashoutSnapshot; num_legs], // event_state_sequence + event_game_state per leg
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | user | readonly | |
| 1 | Clock sysvar | readonly | |
| 2 | original parlay pda | readonly | |

Then for each MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | readonly | |
| 2 | mm parlay quote buffer | writable | |

Then for each leg of that MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm market data | readonly | |
| 1 | mm event state | readonly | |

Return data: concatenation of:

```rust
struct ProxyCashoutQuoteData {
   mm_address: Address,
   max_payment: u64,
}
```

### grade_bets

Discriminator: **20**

Grades **Bet** PDAs (disc **1**) and **Cashout** PDAs (disc **8**). `CashedOut` / `Pending` / `ModifiedWin` are invalid grade targets for cashouts.

Data:

```rust
struct GradeBetsIxData {
   discriminator: u8, // 20
   results: [u8; N], // N = number of bet accounts; each byte is BetResult
}
```

Valid result bytes: **1–7** (`Won` … `RolledBack`). `Pending` **(0)**, `ModifiedWin` **(8)**, and `CashedOut` **(9)** are rejected as grade targets.

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | authority | writable, signer | Must be the bet’s `market_id.operator` **or** aggregator config `authority` (fallback) |
| 1 | config pda | readonly | |

Then for each ticket:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | bet pda | writable | Disc 1 (single bet) or disc 8 (cashout) |

`BetResult` values:

```rust
enum BetResult {
   Pending = 0,
   Won = 1,
   Lost = 2,
   HalfWon = 3,
   HalfLost = 4,
   Push = 5,
   Cancelled = 6,
   RolledBack = 7,
   ModifiedWin = 8, // parlay ticket only — voids/halves; settle recomputes payout
   CashedOut = 9,   // original ticket fully cashout-escrowed; only set by cashing out, not grading
}
```

### grade_parlay

Discriminator: **21**

Grades **one** parlay bet PDA (disc **2**) or **cashout-parlay** PDA (disc **9**) **leg by leg**, then folds the ticket-level `result`.

Data:

```rust
struct GradeParlayIxData {
   discriminator: u8, // 21
   results: [u8; num_legs], // data.len() == num_legs; no padding to 20/40
}
```

Each byte is a grade **1–7**, or `255` (`GRADE_PARLAY_LEG_SKIP`) to leave that leg unchanged.

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | authority | writable, signer | For each graded leg: that leg’s `market_id.operator` **or** aggregator config `authority` (fallback) |
| 1 | config pda | readonly | |
| 2 | parlay or cashout-parlay pda | writable | Disc **2** (parlay) or disc **9** (cashout-parlay) |

Rules:

- An already-graded leg **may be re-graded** (same as `grade_bets`); the ticket is refolded from all leg bytes afterwards, so corrections propagate. Use `255` to leave a leg untouched.
- After updates, ticket `result` is folded:
  - any **Lost** → ticket **Lost**
  - all void (Push / Cancelled / Void / RolledBack) → ticket **Cancelled**
  - all **Won** → ticket **Won**
  - any **Pending** → ticket **Pending** (a RolledBack leg among pending legs stays on the ticket; settle treats that leg as void / Cancelled)
  - mix of wins / voids / halves → ticket `ModifiedWin` **(8)**; `settle_parlay` recomputes payout from remaining leg odds

### settle_bet

Discriminator: **25**

This is called by **anyone** to settle a bet which has been graded. The last account in each filler block is the netting PDA for the event of the bet or the system program if not netted. Lost / void leftovers go to the **liability ATA**. Lamports go to the original bet fee payer.

Data: `None`

Accounts (fixed prefix, **11**):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | signer | writable, signer | Anyone; pays tx fees |
| 1 | bet pda | writable | |
| 2 | bet ata | writable | |
| 3 | bet feepayer | writable | Must match `feepayer` stored on bet |
| 4 | user | readonly | Ticket owner; on a cashout ticket this is the filling MM program id |
| 5 | user ata | writable | User ATA, or filling-MM **liability ATA** on cashout settle |
| 6 | config pda | readonly | |
| 7 | mint | readonly | |
| 8 | token program | readonly | |
| 9 | cashout escrow pda | readonly | Must be unused for this ticket (`["cashout_escrow", owner, bet_id]`; cashout uses orig owner + orig bet id) |
| 10 | dest encumbrance | readonly | Filling MM encumbrance when settling a cashout; ignored otherwise |

Then for each filler. Pass only live fillers — no padded unused slots.

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly, executable | Must match that filler’s `mm_address` |
| 1 | mm config pda | readonly | |
| 2 | mm encumbrance pda | writable | |
| 3 | mm liability token account | writable | |
| 4 | mm netting pda | writable if netted, else readonly | Real netting PDA if the fill was netted; otherwise system program |

### settle_parlay

Discriminator: **26**

This is called by **anyone** to settle a graded parlay. Lost stake and leftover profit stay in the **liability ATA**. Won profit is paid from the liability ATA to the user (or issuer) ATA.

Data: `None`

Accounts (**15**):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | signer | writable, signer | Anyone; pays tx fees |
| 1 | parlay bet pda | writable | |
| 2 | bet ata | writable | |
| 3 | bet feepayer | writable | Must match `feepayer` stored on bet |
| 4 | user | readonly | Bet owner; filling MM program id on cashout |
| 5 | user ata | writable | User ATA, or filling-MM liability ATA on cashout |
| 6 | config pda | readonly | |
| 7 | mint | readonly | |
| 8 | token program | readonly | |
| 9 | mm program | readonly | Must match filler_address on the parlay bet |
| 10 | mm config pda | readonly | |
| 11 | mm encumbrance pda | writable | |
| 12 | mm liability token account | writable | |
| 13 | cashout escrow pda | readonly | Must be unused for this ticket |
| 14 | dest encumbrance | readonly | Filling MM encumbrance on cashout settle; ignored otherwise |

### settle_freebet

Discriminator: **27**

Requires `freebet_id != 0`. Stake from the bet ATA go to the **issuer ATA** if user won; profit still goes **user ATA**. Then reinstates or consumes the freebet PDA (see Freebet flow). Freebets cannot be cashed out so no `cashout_escrow_pda` or `dest_encumbrance`.

Data: `None`

Accounts (**14** fixed, then **5 × N** fillers):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | signer | writable, signer | Anyone; pays tx fees |
| 1 | bet pda | writable | |
| 2 | bet ata | writable | |
| 3 | bet feepayer | writable | Must match `feepayer` stored on bet |
| 4 | user | readonly | Ticket owner |
| 5 | user ata | writable | Profit destination |
| 6 | issuer auth | writable | Rent dest when freebet PDA closes |
| 7 | issuer pda | writable | |
| 8 | issuer ata | writable | Stake / dust destination |
| 9 | freebet pda | writable | |
| 10 | config pda | readonly | Aggregator config |
| 11 | mint | readonly | |
| 12 | token program | readonly | |
| 13 | clock sysvar | readonly | Reinstatement expiry math |

Then for each live filler:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly, executable | Must match that filler’s `mm_address` |
| 1 | mm config pda | readonly | |
| 2 | mm encumbrance pda | writable | |
| 3 | mm liability token account | writable | |
| 4 | mm netting pda | writable if netted, else readonly | Real netting PDA if the fill was netted; otherwise system program |

### settle_freebet_parlay

Discriminator: **28**

Data: `None`

Accounts (**18**):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | signer | writable, signer | Anyone; pays tx fees |
| 1 | parlay bet pda | writable | |
| 2 | bet ata | writable | |
| 3 | bet feepayer | writable | Must match `feepayer` stored on bet |
| 4 | user | readonly | Ticket owner |
| 5 | user ata | writable | Profit destination |
| 6 | issuer auth | writable | |
| 7 | issuer pda | writable | |
| 8 | issuer ata | writable | Stake / dust destination |
| 9 | freebet pda | writable | |
| 10 | config pda | readonly | Aggregator config |
| 11 | mint | readonly | |
| 12 | token program | readonly | |
| 13 | clock sysvar | readonly | Reinstatement expiry math |
| 14 | mm program | readonly | Must match `filler_address` on the parlay bet |
| 15 | mm config pda | readonly | |
| 16 | mm encumbrance pda | writable | |
| 17 | mm liability token account | writable | |

### freebet_fill_bet

Discriminator: **15**

Same as `fill_bet`, except stake comes from the issuer ATA and:
- All-or-nothing: `ix.amount` must equal the voucher and the tx must fill that exact stake.
- Auction MMs not on the MM whitelist are skipped like a bad quote, if MM whitelist is not empty.
- A market whose `operator` is not on the operator whitelist fails if operator whitelist is not empty.
- Marks the freebet **Used**.

Data:

```rust
struct FreebetFillBetIxData {
   freebet_id: u32,                  // must be > 0
   bet_id: u64,
   market_id: MarketId,
   side: u8,
   amount: u64,
   min_odds_scaled: u32,
   event_state_sequence: u16,
   event_game_state: EventGameState,
}
```

Accounts (**15** fixed — replaces `user_ata` with issuer + freebet accounts):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays netting PDA rent if a fill inserts a new line |
| 1 | user | readonly, signer | |
| 2 | issuer pda | readonly | PDA signer for the stake transfer |
| 3 | issuer ata | writable | Stake source |
| 4 | freebet pda | writable | Marked used after a successful fill |
| 5 | bet pda | writable | |
| 6 | bet ata | writable | |
| 7 | config pda | readonly | |
| 8 | mint | readonly | |
| 9 | token program | readonly | |
| 10 | associated token program | readonly | |
| 11 | rent sysvar | readonly | |
| 12 | system program | readonly | |
| 13 | instructions sysvar | readonly | |
| 14 | clock sysvar | readonly | |

Then for each MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | Must be executable |
| 1 | mm config pda | writable | |
| 2 | mm event state pda | writable | |
| 3 | mm market data pda | writable | |
| 4 | mm quote buffer | writable | |
| 5 | mm encumbrance pda | writable | |
| 6 | mm liability token account | writable | |
| 7 | mm token account | writable | |
| 8 | mm netting pda | writable | Must match expected but can be uninitialized |

### freebet_fill_parlay

Discriminator: **16**

Same as `fill_parlay`, except stake comes from the issuer ATA.

Data:

```rust
struct FreebetFillParlayIxData {
   freebet_id: u32,                  // must be > 0
   bet_id: u64,
   amount: u64,
   min_odds_scaled: u32,
   num_legs: u8,
   legs: [ParlayLegSel; num_legs],
}
```

Accounts (**15** fixed — replaces `user_ata` with issuer + freebet accounts):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays netting PDA rent if a fill inserts a new line |
| 1 | user | readonly, signer | |
| 2 | issuer pda | readonly | PDA signer for the stake transfer |
| 3 | issuer ata | writable | Stake source |
| 4 | freebet pda | writable | Marked used after a successful fill |
| 5 | bet pda | writable | |
| 6 | bet ata | writable | |
| 7 | config pda | readonly | |
| 8 | mint | readonly | |
| 9 | token program | readonly | |
| 10 | associated token program | readonly | |
| 11 | rent sysvar | readonly | |
| 12 | system program | readonly | |
| 13 | instructions sysvar | readonly | |
| 14 | clock sysvar | readonly | |

Then the MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | Must be executable |
| 1 | mm config pda | writable | |
| 2 | mm parlay quote buffer | writable | |
| 3 | mm encumbrance pda | writable | |
| 4 | mm liability token account | writable | |
| 5 | mm token account | writable | |

Then for each leg:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm market data | readonly | |
| 1 | mm event state | readonly | |

### freebet_fill_rfq_bet

Discriminator: **17**

Same as `fill_rfq_bet`, except stake comes from the issuer ATA. RFQ ed25519 still verifies the **unprefixed** message (no `freebet_id` in the signed bytes).

Data:

```rust
struct FreebetFillRfqBetIxData {
   freebet_id: u32,                  // must be > 0
   bet_id: u64,
   market_id: MarketId,
   side: u8,
   amount: u64,
   odds_scaled: u32,
   event_state_sequence: u16,
   event_game_state: EventGameState,
   max_stake: u64,
   offer_expiry: u32,
   signature: [u8; 64],
}
```

Accounts (**15** fixed — replaces `user_ata` with issuer + freebet accounts):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays netting PDA rent if a fill inserts a new line |
| 1 | user | readonly, signer | |
| 2 | issuer pda | readonly | PDA signer for the stake transfer |
| 3 | issuer ata | writable | Stake source |
| 4 | freebet pda | writable | Marked used after a successful fill |
| 5 | bet pda | writable | |
| 6 | bet ata | writable | |
| 7 | config pda | readonly | |
| 8 | mint | readonly | |
| 9 | token program | readonly | |
| 10 | associated token program | readonly | |
| 11 | rent sysvar | readonly | |
| 12 | system program | readonly | |
| 13 | instructions sysvar | readonly | |
| 14 | clock sysvar | readonly | |

Then the MM:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | Must be executable |
| 1 | mm config pda | writable | |
| 2 | mm event state pda | writable | |
| 3 | mm market data pda | writable | |
| 4 | mm encumbrance pda | writable | |
| 5 | mm liability token account | writable | |
| 6 | mm token account | writable | |
| 7 | mm netting pda | writable | Real netting PDA, or system program if none |

### freebet_fill_rfq_parlay

Discriminator: **18**

Same as `fill_rfq_parlay`, except stake comes from the issuer ATA. RFQ ed25519 still verifies the **unprefixed** message (no `freebet_id` in the signed bytes).

Data:

```rust
struct FreebetFillRfqParlayIxData {
   freebet_id: u32,                  // must be > 0
   bet_id: u64,
   amount: u64,
   odds_scaled: u32,
   max_stake: u64,
   offer_expiry: u32,
   num_legs: u8,
   legs: [ParlayLegQuoted; num_legs],
   signature: [u8; 64],
}
```

Accounts (**15** fixed — replaces `user_ata` with issuer + freebet accounts):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | feepayer | writable, signer | Pays netting PDA rent if a fill inserts a new line |
| 1 | user | readonly, signer | |
| 2 | issuer pda | readonly | PDA signer for the stake transfer |
| 3 | issuer ata | writable | Stake source |
| 4 | freebet pda | writable | Marked used after a successful fill |
| 5 | bet pda | writable | |
| 6 | bet ata | writable | |
| 7 | config pda | readonly | |
| 8 | mint | readonly | |
| 9 | token program | readonly | |
| 10 | associated token program | readonly | |
| 11 | rent sysvar | readonly | |
| 12 | system program | readonly | |
| 13 | instructions sysvar | readonly | |
| 14 | clock sysvar | readonly | |

Then the MM (**5** — no per-leg PDAs):

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm program | readonly | |
| 1 | mm config pda | writable | |
| 2 | mm encumbrance pda | writable | |
| 3 | mm liability token account | writable | |
| 4 | mm token account | writable | |

### create_netting_account

Discriminator: **40**

This is called by the SPAMM admin to create a liability netting account for an event.

Data:

```rust
struct CreateNettingAccountIxData {
   discriminator: u8, // 40
   event_id: EventId,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm admin | writable, signer | Must be the MM admin in the MM Config PDA |
| 1 | mm program | readonly | Must be executable (a program) |
| 2 | mm config pda | readonly | Verified by `verify_mm_admin` |
| 3 | netting pda | writable | Must be uninitialized |
| 4 | rent sysvar | readonly | |
| 5 | system program | readonly | |

### add_line_to_netting_account

Discriminator: **41**

This is called by the SPAMM admin to add a line to the liability netting account for an event.

Data:

```rust
struct AddLineToNettingIxData {
   discriminator: u8, // 41
   event_id: EventId,
   period: u8,
   mkt: u16,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm admin | writable, signer | Must match MM admin in MM Config PDA; pays extra rent if the PDA must grow |
| 1 | mm program | readonly, executable | |
| 2 | mm config pda | readonly | |
| 3 | netting pda | writable | |
| 4 | rent sysvar | readonly | |
| 5 | system program | readonly | Always present; System Transfer when the PDA must grow |

### remove_line_from_netting_account

Discriminator: **42**

This is called by the SPAMM admin to remove a line from the liability netting account for an event.

Data:

```rust
struct RemoveLineFromNettingIxData {
   discriminator: u8, // 42
   event_id: EventId,
   period: u8,
   mkt: u16,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm admin | writable, signer | Must match MM admin in MM Config PDA |
| 1 | mm program | readonly, executable | |
| 2 | mm config pda | readonly | |
| 3 | netting pda | writable | |

### close_netting_account

Discriminator: **43**

This is called by the SPAMM admin to close the liability netting account for an event.

Data:

```rust
struct CloseNettingAccountIxData {
   discriminator: u8, // 43
   event_id: EventId,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm admin | writable, signer | Must match MM admin in MM Config PDA |
| 1 | mm program | readonly, executable | |
| 2 | mm config pda | readonly | Verified by `verify_mm_admin` |
| 3 | netting pda | writable | Will be closed; rent to admin |
| 4 | system program | readonly | |

### withdraw_from_liability_account

Discriminator: **50**

This is called by the SPAMM admin to withdraw excess funds from the liability token account.

Data:

```rust
struct WithdrawFromLiabilityAccountIxData {
   discriminator: u8, // 50
   amount: u64,
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | mm authority | writable, signer | Must match MM admin in MM Config PDA |
| 1 | mm program | readonly | Must be executable (a program) |
| 2 | mm config pda | readonly | Not written; ATA owner for the MM token account |
| 3 | mm encumbrance pda | writable | Signs the liability → MM token transfer |
| 4 | mm liability token account | writable | |
| 5 | mm token account | writable | Destination of the transfer |
| 6 | config pda | readonly | Aggregator config; pause-checked |
| 7 | mint | readonly | |
| 8 | token program | readonly | |

### write_arbitrary_data

Discriminator: **254**

This is called by the aggregator admin to write arbitrary data to a PDA on devnet.

Data:

```rust
struct WriteArbitraryDataIxData {
   discriminator: u8, // 254
   data: [u8; N], // N = number of bytes to write
}
```

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | aggregator authority | writable, signer | Must match `authority` in config PDA |
| 1 | config pda | readonly | |
| 2 | account | writable | Any program-owned account to write to |

### force_close_pda

Discriminator: **255**

This is called by the aggregator admin to force close a PDA on devnet.

Data: `None`

Accounts:

| Index | Account | Role | Notes |
| --- | --- | --- | --- |
| 0 | aggregator authority | writable, signer | Must match `authority` in the aggregator Config PDA |
| 1 | config pda | readonly | |
| 2 | pda | writable | Any program-owned PDA to close |
| 3 | system program | readonly | |

## Custom errors

Failures a client is expected to branch on return `ProgramError::Custom(code)`. Everything else (bad account count, malformed instruction data, seed mismatch, overflow) keeps its built-in `ProgramError` variant. Codes are stable and append-only; see `aggregator/program/src/errors.rs` and the `SpammErrorCode` mirror in `aggregator/sdk/ts/src/errors.ts`.

| Code | Name | Meaning |
| --- | --- | --- |
| 1 | `ProgramPaused` | Aggregator config status is PAUSED |
| 2 | `MmNotRegistered` | MM config PDA is not a valid PDA of the given MM program |
| 3 | `AccountAlreadyExists` | PDA for this seed already exists |
| 4 | `BetNotGraded` | Settle attempted before grading |
| 5 | `NoQuotesAvailable` | No MM returned a usable quote, or nothing could be filled |
| 6 | `SlippageExceeded` | Quoted odds came back below `min_odds_scaled` |
| 7 | `InsufficientMmLiquidity` | MM could not cover the potential payout |
| 8 | `StakeExceedsMaxStake` | `amount` exceeds the signed `max_stake` |
| 9 | `QuoteExpired` | RFQ `offer_expiry` is in the past |
| 10 | `InvalidRfqSignature` | RFQ ed25519 signature did not verify |
| 11 | `InvalidParlayLegCount` | `num_legs` outside the allowed range |
| 12 | `ParlayOddsMismatch` | Leg odds product ≠ ticket `odds_scaled` |
| 13 | `ParlayEventRuleViolation` | An event group has no positive-odds leg, or the ticket has duplicate `MarketId`s |
| 14 | `CashoutDelayNotElapsed` | Live cashout escrow claim before `LIVE_CASHOUT_DELAY` |
| 15 | `InvalidCashout` | Cashout amount, floor, ticket state, or escrow invalid |
| 16 | `CashoutMustRevert` | Escrow/ticket RolledBack — use `revert_cashout` |
| 17 | `FreebetExpired` | Freebet `expiry` is in the past |
| 18 | `FreebetNotAvailable` | Freebet is `Used` (or not `Available`) |
| 19 | `FreebetAmountMismatch` | Fill `amount` does not match the freebet PDA |
| 20 | `FreebetOddsOutOfRange` | Quoted / filled odds outside `[min_odds, max_odds]` |
| 21 | `FreebetLegCount` | Ticket has fewer legs than the freebet requires |
| 22 | `FreebetMmNotAllowed` | Filling MM is not on the freebet allow list |
| 23 | `InvalidFreebet` | Wrong settle/cashout path, or freebet accounts mismatch |
| 24 | `FreebetOperatorNotAllowed` | Market operator is not on the freebet allow list |

## Tests

Mollusk SBF integration tests live under `aggregator/program/tests/spamm_mollusk/`. They execute compiled BPF `.so` files — not `cargo check` alone.

**Prerequisites:** Solana/Agave toolchain with `cargo build-sbf` on PATH.

**Build both artifacts** (from repo root; re-run after changing aggregator or example MM):

```powershell
cargo build-sbf --arch v3 --manifest-path aggregator/program/Cargo.toml --features devnet
cargo build-sbf --arch v3 --manifest-path market_maker/program/Cargo.toml
```

For mainnet deploys: `--no-default-features --features bpf-entrypoint,mainnet`.

**Run** (from `aggregator/program`; `--features test-sbf` is required):

```powershell
cargo test -p spamm_aggregator --features test-sbf --test spamm_mollusk -- --test-threads=1
```

On Windows use `--test-threads=1` to avoid file-lock errors while the harness copies `spamm_market_maker.so` into `aggregator/program/target/deploy/`. The harness prefers the MM artifact at `market_maker/program/target/deploy/spamm_market_maker.so` — rebuild the MM crate after MM changes, not only the aggregator.

Coverage is decent for fill/settle/RFQ/cashout/freebet paths via the example SPAMM; routing across multiple real MM programs is not exercised. See also `.cursor/rules/mollusk-tests.mdc` and `SYSTEM_OVERVIEW.md` §22.

## Token

There is no token. I'm only saying this because people made a token claiming to be a previous project claiming to be real and hopefully this stops it happening here.
