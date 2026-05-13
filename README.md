# Overview

A Sports Programmatic Automated Market Maker (SPAMM) is a program that offers quotes for bets on sports markets. SPAMMs are inspired by propAMMs and their ability to offer better spreads than Binance. Why can't bettors get better odds than on sportsbooks? As SPAMMs compete for flow, the odds they offer will improve and eventually beat sportsbooks. By aggregating these offers, bettors will have access to great odds via a single transaction. A non-technical overview of SPAMMs can be found [here](Why-SPAMMs.md).

The idea behind the framework could be further extended to binary or vanilla options, major prediction markets with a fair reference price (elections), or my as-yet-to-be-published idea of sports line options.

This is the **SPAMM Aggregator** program and framework. The framework defines what a **SPAMM** must do to be compliant with the aggregator and how to integrate with the aggregator.
The **aggregator** is responsible for filling user bets with offers from the integrated SPAMMs. The **aggregator API** is responsible for providing **event and market ids**. Each SPAMM is responsible for offering quotes on whatever markets they wish. Any client can call each SPAMM's **`get_quote`** function to get the offer, then build a tx to fill the bet with the **5 best** quotes. The aggregator will then call **`get_quote`** again to get the **best execution-time** offers and fill the bet with the quotes in order of **best to worst odds**. 

**Liability** for paying out winning bets is held in a token account **owned by the aggregator**. This must be transferred by the SPAMM during the **`fill_quote`** function. 

The aggregator program is responsible for **grading** the bets. Funds are transferred to the winners by calling **`settle_bet`** on a graded bet.

## Deployment

The **SPAMM Aggregator** program is deployed to Solana **devnet** at the address **`5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H`**. The betting token is **`Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`** which you can get [here](https://spl-token-faucet.com/). If the devnet SOL aidrop is 429, you can get some [here](https://faucet.solana.com/).

**Breaking changes** are to be expected. The **aggregator admin** can delete Aggregator PDAs (like Bet Accounts) at any time.

Contact pure_lmao on [X](https://x.com/pure_lmao) / [Discord](https://discord.com/users/223573305410584577) / [Telegram](https://t.me/pure_lmao) if you are interested in this idea and you can give feedback and be updated on framework changes if you build a SPAMM.

--------------

# SPAMM Program Framework
When this framework description uses **"MUST"** the program **MUST** adhere to the requirement. If **"should"** is used, it is a recommendation.

## Overview
A SPAMM program is a program which complies with this framework and offers quotes for bets to the aggregator on sports markets. It should take advantage of low CU oracle account updates in order to land odds/state updates at the top of the block, before compute-heavy bet filling transactions. 

## Get_Quote function
The **`get_quote`** function is called by the RPC to get the price to build the tx for the user then again by the **aggregator** when filling the bet to get best odds at **execution-time** (**no spoofing**). The function **MUST** return data using **`sol_set_return_data`**.

The function **MUST** take the following accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | User | readonly | Pass-through for pricing; not required to sign when invoked via CPI |
| 1 | MM Market Data PDA | writable | |
| 2 | MM Event State PDA | readonly | |
| 3 | MM Config PDA | readonly |  |
| 4 | MM Quote Buffer | readonly |  |

The function **MUST** take the following data:
```rust
struct GetQuoteIxData {
   discriminator: u8, // 5
   amount: u64,
   odds_scaled: u32,
   market_id: MarketId,
   side: u8, // two-outcome markets: 0 or 1; soccer mkt 1 or 5: 0, 1, or 2
   event_state_hash: [u8; 32],
   event_state_sequence: u16,
}
```
The function **MUST** return the following data for a valid quote:
```rust
struct GetQuoteReturnData {
   max_amount: u64, // the maximum amount the user can bet at the given odds
   odds_scaled: u32, // the decimal odds scaled by ODDS_SCALE from the perspective of the taking user
}
```
The function **MUST** return the data using **`sol_set_return_data`**.
If **any of these values are 0**, then nothing will attempt to be filled.

You can be filled at any amount from max_amount down to 0. You will be filled at odds_scaled.

You **MUST** then populate the **MM Quote Buffer** with the following data:
```rust
struct MMQuoteBuffer {
   discriminator: u8 = 2,
   is_used: u8 = 0, // set to 0 after giving quote
   user_address: Address,
   market_id: MarketId,
   side: u8, // same encoding as GetQuoteIxData.side
   max_amount: u64,
   odds_scaled: u32,
   event_state_hash: [u8; 32],
   event_state_sequence: u16,
}
```
This data is later used by your **`fill_quote`** function to validate the quote was actually offered by yourself and is **not spoofed**.

The user is passed as a courtesy to allow you to potentially offer better odds to some users. Your Config PDA data beyond the header can be used for storing any global data you want (user profiles, global risk limits, etc). Your Market Data PDA data beyond the header can be used for storing any market-specific data you want (odds, liquidity, etc).

## Fill_Quote function
The **`fill_quote`** function is called by the **aggregator** to fill the bet after receiving the quotes, **filtering valid quotes**, and sorting them **best to worst odds**. The function should verify that the caller is a CPI via the aggregator and that all accounts are as expected.

The function **MUST** take the following accounts:

| Index | Account | Role |
|-------|---------|------|
| 0 | User | readonly |
| 1 | MM Market Data PDA | writable |
| 2 | MM Config PDA | writable |
| 3 | MM Quote Buffer | writable |
| 4 | MM Token Account | writable |
| 5 | MM Liability Token Account | writable |
| 6 | Mint | readonly |
| 7 | Token Program | readonly |

The function **MUST** take the following data:
```rust
struct FillQuoteIxData {
   discriminator: u8, // 6
   amount_to_fill: u64,
   odds_scaled: u32,
   market_id: MarketId,
   side: u8,
   event_state_hash: [u8; 32],
   event_state_sequence: u16,
   amount_to_send: u64,
}
```
The function **should** then validate the quote matches the quote buffer data as proof the call to the function is **not spoofed**—it must have been preceded by a valid **`get_quote`** invocation. This avoids having to do an expensive re-computation of the quote.

The function **MUST** then transfer the **`amount_to_send`** to the **liability token account**. This is the amount of funds required to cover the **net liability** of the position. It will be <= the user potential profit (`amount_to_fill * (odds_scaled - ODDS_SCALE)`). If the new liability ends up being negative due to **liability netting**, the amount can be **0**.

The **`is_used`** field in the quote buffer **MUST** be set to **1** to indicate the quote has been filled and **cannot be reused** without being reset by a valid invocation of the **`get_quote`** function.
During this function, you can change your Config PDA and Market Data PDA data if you wish.

## Get_Quote_Parlay function
The `get_quote_parlay` function is invoked the same way as `get_quote`, but for **multiple legs**: each leg has its own market data / event state accounts and `ParlayLegWire` fields in the instruction `data`. It **MUST** return data using **`sol_set_return_data`** (`max_amount: u64` LE, `odds_scaled: u32` LE) for a valid quote. The max number of legs, *L*, is 5.

The function **MUST** take the following accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | User | readonly | Pass-through for pricing; not required to sign when invoked via CPI |
| 1 | MM Config PDA | readonly |  |
| 2 | MM Parlay Quote Buffer | readonly | |
| 2 + 1×*L* | MM Market Data PDA (leg *L*) | readonly | One per leg |
| 2 + 2×*L* | MM Event State PDA (leg *L*) | readonly | One per leg |

The function **MUST** take the following instruction `data`:

```rust
struct GetQuoteParlayIxData {
   instruction_discriminator: u8, // 7
   amount: u64,
   odds_scaled: u32, // minimum acceptable combined parlay odds (scaled);
   num_legs: u8,     // L
   legs: [ParlayLegWire; MAX_PARLAY_LEGS], // fixed-size table on wire; only indices 0..L-1 are used
}
struct ParlayLegWire {
   market_id: MarketId,
   side: u8, // two-outcome: 0 or 1; soccer mkt 1 or 5: 0, 1, or 2
   event_state_sequence: u16,
   event_state_hash: [u8; 32],
}
```

The MM should validate each leg’s market data / event state PDAs and that per-leg state hash and sequence match the instruction. The MM should be careful when quoting parlays with legs in the same event (Same-Game Parlays - SGPs), but this is not policed at the aggregator level. The example MM simply combines per-leg scaled odds from market data and writes a full snapshot into the **MM Parlay Quote Buffer**:

```rust
struct MMParlayQuoteBuffer {
   discriminator: u8 = 3,
   is_used: u8 = 0,
   user_address: Address,
   max_amount: u64,
   odds_scaled: u32,
   num_legs: u8,
   legs: [ParlayLegWire; MAX_PARLAY_LEGS], // snapshot of the quoted legs
}
```

If `max_amount` or `odds_scaled` in return data are **0**, the aggregator will not use that MM’s parlay quote for the fill.

## Fill_Parlay_Quote function
The `fill_parlay_quote` function is called by the aggregator after a valid `get_quote_parlay` response, to move collateral from the MM token account to the aggregator’s MM liability ATA for the parlay stake. Parlay fills cannot be netted in any way. The function should verify that the caller is a CPI via the aggregator and that all accounts are as expected.

The function **MUST** take these accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | User | readonly |  |
| 1 | MM Config PDA | writable |  |
| 2 | MM Parlay Quote Buffer | writable |  |
| 3 | MM Token Account | writable | MM collateral source |
| 4 | MM Liability Token Account | writable | Aggregator-owned destination |
| 5 | Mint | readonly | |
| 6 | Token program | readonly | |

The function **MUST** take the following `data`:

```rust
struct FillParlayQuoteIxData {
   instruction_discriminator: u8, // 8
   amount_to_fill: u64,
   odds_scaled: u32,
   amount_to_send: u64,
}
```

The MM should decode the parlay quote buffer, verify it matches the instruction (user, odds, amounts), transfer **`amount_to_send`** to the liability account, then **MUST** set **`is_used`** on the parlay buffer to **1** so the quote **cannot be replayed** without a fresh **`get_quote_parlay`**. The amount to send may be less than the calulated user profit (or 0) if you have free collateral in the MM liability account.

## Config PDA
The **config PDA** is a PDA owned by the mm program. It **MUST** be of the seeds **`["config"]`**.
It contains the following data:
```rust
struct Config {
   discriminator: u8 = 1,
   bump: u8,
   admin: Address, // used for interacting with the aggreagtor program for non-quoting functions
   //...anything else you want
   // for example
   global_risk_limit: u64,
   global_risk: u64, // updated on fill_quote
   favourable_bettors: [Address; N], // read on get_quote to safely offer them a 5% bonus odds to increase chance of being filled, knowing they are losing bettors
   smart_bettors: [Adrress; N], // read on get_quote to reduce odds, knowing that fills are usually unfavourable from these bettors
}
```

## Event Liability Netting PDA
The **event liability netting PDA** is a PDA owned by the **aggregator**. It **MUST** be of the seeds **`["netting", mm_program_address, event_id]`**.

It is created by the admin of the mm program calling the create_netting_account function.

See the Liability Netting section below for more details.

## Market Data PDA
Each market **MUST** have a **Market Data PDA** owned by mm.
```rust
struct MarketData {
   discriminator: u8 = 0,
   bump: u8,
   // anything else you want
   // e.g.
   // calculate the odds you want to offer offchain and just list them 
   last_update: i64, //ensure each new update is greater than the last so old txs cant land late
   odds0: u33, // updated in oracle hot path
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
It **MUST** have the seeds **`["market_data", market_id]`** using the wire **`MarketId`** bytes. The account can contain any data that you want to store for the market. The **aggregator verifies** the Market Data PDA exists with the expected seed. You should perform additional checks as needed such as the **sequence** and **data validation**.

It is recommended you use something like Doppler (https://github.com/blueshift-gg/doppler) for 21 CU updates and incorporate it as a hot path into your program (although you must modify it to include the bump seed in the account data. This can be seen in the example market maker program). You can hot update the odds at the top of the account and then slow-update other data in the account via an instruction or the fill_quote function.

## Event State PDA
An **Event State PDA** **MUST** have the following structure:
```rust
struct EventState {
   discriminator: u8 = 4,
   bump: u8,
   event_id: EventId,
   sequence: u16,
   state_hash: [u8; 32],
}
```
The sequence is incremented by 1 for each new state. The inital state has a sequence of 1 and the following activities increment the state:
- Event starts
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

For example, if the state is 1-0 "1H", with sequence of 3 (1 - inital state of pregame, 2 - event started, 3 - first goal scored) and the data feed updates to show a goal is scored, the state should be updated to 1-1 "1H" with sequence of 4. If the data feed then updates to show the goal is cancelled, the state should be updated to 1-0 "1H" with sequence of 5. Any bets with a sequence of 4 are invalid and will be rolled back.

The event state hash and sequence of a market maker event PDA **must match** the **aggregator API** state hash and sequence which is used to construct the fill tx for the user or the market maker is considered **to not be in sync** and **won't be used to fill bets**.

The state hash is constructed based on data which varies by sport:
(P prefix meaning "pre-")
```rust
soccer (sport_id = 1): (
   home_team_score as u8, 
   away_team_score as u8, 
   home_team_red_cards as u8, 
   away_team_red_cards as u8, 
   "PG"|"1H"|"HT"|"2H"|"PET"|"1ET"|"HTET"|"2ET"|"PPen"|"Pen" as str
)

american_football (sport_id = 2): (
   home_team_score as u8, 
   away_team_score as u8, 
   "PG"|"1Q"|"P2Q"|"2Q"|"HT"|"3Q"|"P4Q"|"POT"|"OT" as str
)

baseball (sport_id = 3): (
   home_team_score as u8, 
   away_team_score as u8, 
   "PG"|"T1"|"B1"|"P2"|"T2"|"B2"|"P3"... as str
)

basketball (sport_id = 4): (
   //score is omitted as constant updates would be excessive
   "PG"|"1Q"|"P2Q"|"2Q"|"HT"|"3Q"|"P4Q"|"POT"|"OT"|"POTx"|"OTx" as str
   //where x > 1 of the double/triple overtimes
)

ice_hockey (sport_id = 5): (
   home_team_score as u8, 
   away_team_score as u8, 
   "PG"|"1P"|"P2P"|"2P"|"P3P"|"P3"|"POT"|"OT"|"PSO"|"SO" as str
)
```

The hash is constructed as **`sha256(sport_id || state_tuple) => [u8; 32]`**.

## Accounts at a Glance
| Account | Discriminator | Seed | Notes |
|---------|---------------|------|-------|
| Oracle PDA | 0 | ["oracle", market_id] | created in init_market with a custom body |
| MM Config PDA | 1 | ["config"] | created in init_program |
| MM Quote Buffer | 2 | ["mm_quote_buffer"] | created in init_program |
| MM Parlay Quote Buffer | 3 | ["mm_parlay_quote_buffer"] | created in init_program; used for parlay get/fill |
| MM Event State | 4 | ["event_state", event_id] | created in init_event |
| MM Token Account | n/a | n/a | authority is the MM Config PDA, created in init_program |

MM accounts owned by the aggregator:

| Account | Discriminator | Seed | Notes |
|---------|---------------|------|-------|
| MM Encumbrance PDA | 5 | ["encumbrance", mm_program_address] | created in register_mm |
| MM Liability Token Account | n/a | n/a | authority is the MM Encumbrance PDA, created in register_mm |

## MM program instruction discriminators (router)
The first byte of instruction data routes the MM program (oracle hot-path **0** is handled separately in implementations that use **Doppler**). Values **MUST** match **`spamm_market_maker`** and the CPI bytes embedded in **`spamm_aggregator`** for quote instructions.

| Discriminator | Instruction | Notes |
|---------------|-------------|--------|
| 1 | `init_program` | Creates config PDA, single-leg quote buffer, parlay quote buffer, MM ATA |
| 5 | `get_quote` | Single market; CPI from aggregator `fill_bet` or RPC to build tx |
| 6 | `fill_quote` | Single market; CPI from aggregator `fill_bet` |
| 7 | `get_quote_parlay` | Multi-leg; CPI from aggregator `fill_parlay` or RPC to build tx |
| 8 | `fill_parlay_quote` | Multi-leg; CPI from aggregator `fill_parlay` |
| 9 | `init_event` | Creates event state PDA `["event_state", event_id]` |
| 10 | `init_market` | Creates market/oracle body under `["market_data", market_id]` |
| 11 | `close_event` | |
| 12 | `close_market` | |
| 13 | `update_event_state` | |
| 255 | `force_close_pda` | Admin / dev tooling |

## Integration Lifecycle

1. Write your SPAMM program and ensure that account structs/headers match as expected and you have implemented **`get_quote` / `fill_quote`** and, if you support parlays, **`get_quote_parlay` / `fill_parlay_quote`** correctly.
2. Deploy the SPAMM program.
3. Init the required SPAMM-owned accounts.
4. Register the SPAMM with the aggregator by calling register_mm.
5. Connect to the aggregator API to get events and markets.
6. Create event state PDAs for events you wish to quote.
7. Create market data PDAs for markets you wish to quote.
8. If you want to net liabilities on a market, create a liability netting PDA for the event by calling create_netting_account and add lines to the netting account by calling add_line_to_netting_account (passing `period` and `mkt` for each spread/total line you want reserved). The main win market (FT in soccer, ML in non-soccer) is added by default.
9. Update the Event State PDA as the event progresses.
10. Update the Market Data PDA as the market odds change.
11. Clients can now call the get_quote function of your SPAMM to get quotes for markets you are quoting. You should verify accounts that are passed and calculate the odds you want to offer based on the Market Data PDA and any data you have stored in your Config PDA.
12. If your quote is in the top 5, the client will build a tx to attempt to fill the user bet. The aggregator will call the get_quote function again to get the best execution-time offers and then the fill_quote function if you are still offering the best odds. You can update the Config PDA and Market Data PDA here if you wish, for reference in the future.
13. You can remove lines from the netting account by calling remove_line_from_netting_account and close the netting account by calling close_netting_account once an event is over.
14. You can manage your own Event State and Market Data PDAs as needed.


------------------------------------------------------------------------------------------------

# SPAMM Aggregator

The aggregator is responsible for filling user bets with offers from the integrated SPAMMs. It is also responsible for grading the bets.

## Design Decisions

To be honest, I did not want the aggregator to be responsible for **grading** the bets or **holding any funds**, to reflect how propAMMs and their aggregators are designed. However, they are also simpler in that the only info needed for the quote is the two token mints, and once the swap is complete, that is the interaction over with. For betting, linking an **event/market id** for every single SPAMM using their own system would be nearly impossible, never mind trying to do it onchain. Therefore a **unified system of ids** is needed that **all SPAMMs must use**. This already puts the aggregator in a position of **responsibility for the bets**.

By offering **liability netting** on most markets, the aggregator massively improves the **capital efficiency** of each SPAMM and encourages them to try to **balance liabilities** which can increase the quality of the quotes offered. Without netting, each SPAMM would need to have a lot more capital on hand to be able to fill every bet. With the netting, the aggregator **must hold on to some of the funds** in order to distribute them to the winners. This puts **more responsibility on the aggregator**.

Settling bets could be the responsibility of the SPAMM if netting was not involved, but I believe it is a major improvement to have. As it is, the aggregator already holds a lot of responsibility so settling bets fairly is a natural extension. The alternative is no netting, SPAMMs hold the bet accounts, and users specify which SPAMMs are allowed to fill the bet based on the user trust of the SPAMM (similar to users opting out of Singbet filling orders on Mollybet since they are known to cancel bets for no reason). Forcing the user to profile every SPAMM is not a good user experience and would hinder new SPAMMs joining the network.

Parlays allow combining up to 5 legs. It is on the SPAMM to check they arent linked or price them correctly if they are (SGPs). There are only 5 legs per bet and no execution-time routing because of the tx size limit and I can't be bothered dealing with Account Lookup Tables at this time.

## Trust Assumptions

The **aggregator API** is responsible for providing **event and market ids** and linking them to a **real-world event**. The SPAMMs and users access this API and **trust these will be correct**. The aggregator is also responsible for **grading bets** (currently via an **admin key**). Everyone must trust that **bet grading** will reflect the **true outcome** of the market.

Since the aggregator **checks quotes at execution-time** and only selects the **best valid quotes**, **spoofing** quote responses to the client at the tx-building stage is **pointless**.

Everyone must trust that the **aggregator program** will **not** be upgraded to a **malicious version** that will steal the funds in **pending bets** and the **liability token accounts**.

## Pricing and Game Theory

Every bet is priced using a blind auction. Each SPAMM must offer their best price to win the right to fill the bet during the RPC tx-building stage, and then again during the actual onchain execution stage. A SPAMM could, theoretically, tell the difference between the two calls and lie during the tx-building stage but they would not get filled as other SPAMMs would be offering a better price. This makes the Nash Equilibrium of the SPAMM behaviour reach being honest at all times, and offering the most competitive price possible. 

The addition of `min_odds_scaled` in the instruction data also ensures that all SPAMMs cannot collaborate to show a good price but then offer worse odds during the execution stage other than griefing. However, it just takes one honest SPAMM to act honestly and the bet would be filled.

## User Bet Flow

The **user bet flow** is as follows (single-leg **`fill_bet`**; parlay **`fill_parlay`** is the same pattern with multi-leg quotes and **no netting**):
1. The user (or UI) uses the aggregator API to find an event and market.
2. The user (or UI) uses the RPC to call the get_quote function of each SPAMM.
3. The user (or UI) uses these quotes to build a tx, including the 5 best quotes which fills the desired amount.
4. The user signs the tx and sends it to the network.
5. The aggregator checks the **`get_quote`** function of each SPAMM to ensure the user's fill is **as good as can be** at **execution-time**.
6. The aggregator works through the **valid quotes** in order and calls the **`fill_quote`** function of each SPAMM to fill as much as possible of the bet amount at odds **no worse than requested**.
7. The aggregator ensures that the **`fill_quote`** function was **successful** and the funds were transferred to the **mm liability token account**.
8. If the market is pre-game and FT/ML, total or spread, the aggregator will net the liability on the market for each market maker if they have opted into position netting for the event by creating a netting account data PDA.
9. The aggregator creates a bet PDA for the user and stores the stake in the bet ATA.
10. After the result is known, the bet is graded.
11. Anyone can call settle_bet on any bet with a non-PENDING result and initiate the transfer of funds to the winners.


## Liability Netting
Liability netting is a feature in major **pre-game** markets (FT, BTTS (soccer), ML (non-soccer), Spread, Totals) to allow you to gain more **capital efficiency** by netting liabilities on opposing outcomes and returning excess funds to your token account. It is **NOT** available in **live markets** due to the chance of a bet being **rolled back** due to an invalid event state change which makes the netting invalid. It does **NOT** consider the whole event position; spread and total style netting is tracked per **`(period, market)`** line, while the main win market uses the header **`home` / `draw` / `away`** fields. For soccer, that header applies to **`mkt` 1, `period` 1** (1X2). For non-soccer, it applies to **`mkt` 0, `period` 0** (ML) (the `draw` value is left at 0).
This requires you to have created a **liability netting PDA** for the event via **`create_netting_account`**. This PDA should be a PDA owned by **THIS** program. It **MUST** be of the seeds **`["netting", mm_program_address, event_id]`**.

The account is initiated with the win market and 10 blank lines. They are auto-populated each time a bet of a valid market is filled. Additionally, you can add a line to the netting account by calling the add_line_to_netting_account function with the `event_id`, `period`, and `mkt` to be added. This should be done when you want to specify the lines you intend on quoting or expect to be popular.

You can remove a line from the netting account by calling the remove_line_from_netting_account function with the `event_id`, `period`, and `mkt` to be removed. This should be done when you no longer want that line to be netted in favour of adding a more popular line.

Spread/total lines in account data are stored in sorted order by `period` ascending, then `mkt` ascending. Each line is 21 bytes (packed): `period` (u8), `mkt` (u32 little-endian), `outcome_0` (i64 LE), `outcome_1` (i64 LE). Both Teams To Score **`mkt` 4** and any period ML **`mkt` 0, `period` 2, etc** can also be netted. Half-time 1X2 **`mkt` 4, `period` 2** **can NOT** be netted. 

When a bet is on a market that is **eligible for liability netting**, the profit is paid back to the **mm liability token account** owned by the **aggregator**, not the mm token account owned by the mm program. This is so that offsetting funds are still accessible to the mm program for paying winning bettors. Your **total outstanding liability** is tracked by a PDA and any excess funds can be withdrawn by calling the **`withdraw_from_liability_account`** function.

## API

The **aggregator API** will be responsible for providing:
- a map of sports to sport ids
- a map of leagues to league ids
- a map of events to event ids
- a defined system of period ids
- a defined system of market ids
- a map of players to player ids (deterministic)
- the event state hash and sequence for each event

**SPAMMs should NOT** rely on the event state hash and sequence in reflecting reality to the millisecond. If you have access to a **faster data feed**, you should use it to update the event state hash and sequence so your quotes **match reality** as closely as possible. This means your **Market Data PDA** and **Event State PDA** will be **in sync** with each other, and avoids filling bets at **stale odds/event states**.

## Accounts at a Glance

| Account | Discriminator | Seed | Notes |
|---------|---------------|------|-------|
| Bet PDA Accounts | 1 | ["bet", user_address, bet_id] | created in fill_bet |
| Parlay Bet PDA Accounts | 2 | ["parlay", user_address, bet_id] | created in fill_parlay |
| Bet Token Account | n/a | n/a | authority is the Bet PDA Account, created in fill_bet |
| Config PDA | 2 | ["config"] | created in init_program |
| MM List PDA | 3 | ["mm_list"] | created in init_program, used by clients to find SPAMMs to reach for quotes |
| MM Encumbrance PDA | 5 | ["encumbrance", mm_program_address] | created in register_mm |
| MM Liability Token Account | n/a | n/a | authority is the MM Encumbrance PDA, created in register_mm |
| MM Netting PDA | 6 | ["netting", mm_program_address, event_id] | created with create_netting_account; see Liability Netting for line layout |

## Aggregator Instructions

The first byte of aggregator instruction `data` selects the handler.

| Discriminator | Instruction |
|---------------|---------------|
| 0 | `init_program` |
| 1 | `change_config_status` |
| 2 | `register_mm` |
| 3 | `fill_bet` |
| 4 | `fill_parlay` |
| 5 | `grade_bets` |
| 6 | `settle_bet` |
| 7 | `settle_parlay` |
| 50 | `create_netting_account` |
| 51 | `add_line_to_netting_account` |
| 52 | `remove_line_from_netting_account` |
| 53 | `close_netting_account` |
| 100 | `withdraw_from_liability_account` |
| 254 | `write_arbitrary_data` |
| 255 | `force_close_pda` |

### init_program
Discriminator: **0**

Data:

```rust
struct InitProgramIxData {
   discriminator: u8, // 0
   recent_slot: u64, // LE — ALT PDA derivation + create CPI; slot must appear in `SlotHashes` when the transaction executes
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | aggregator admin | writable, signer | Set as initial admin in config pda |
| 1 | config pda | writable | Must be uninitialized. |
| 2 | mm list pda | writable | Must be uninitialized. |
| 3 | system program | readonly | Must be the system program |
| 4 | lookup table | writable | Must be uninitialized. Seeds: `[config_pda, recent_slot]` under the Address Lookup Table program |
| 5 | address lookup table program | readonly | Must be the Address Lookup Table program |

This is called by the aggregator admin to initialize the program and set up program-owned accounts. It creates an address lookup table authorized by the config PDA, seeds it with core addresses (config PDA, mint, token programs, system program, rent, clock), and stores the ALT pubkey on the config account.

### change_config_status
Discriminator: **1**

Data:

```rust
struct ChangeConfigStatusIxData {
   discriminator: u8, // 1
   status: u8, // 0 = paused, 1 = unpaused
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | aggregator admin | writable, signer | Must match `admin` in config PDA |
| 1 | config pda | writable | |

This is called by the aggregator admin to change the status of the aggregator config.

### register_mm
Discriminator: **2**

Data: `None`

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | mm admin | writable, signer | Pays rent / resize; is set as the MM admin in the MM Config PDA |
| 1 | mm program | readonly | Must be executable (a program) |
| 2 | mm config pda | readonly | Must be uninitialized |
| 3 | mm encumbrance pda | writable | Must be uninitialized |
| 4 | mm liability token account | writable | Must be uninitialized; authority is the MM Encumbrance PDA |
| 5 | aggregator config pda | readonly | Must be the Aggregator Config PDA |
| 6 | mm list pda | writable | |
| 7 | mint | readonly | Must be the mint |
| 8 | token program | readonly | Must be the token program |
| 9 | associated token program | readonly | Must be the associated token program |
| 10 | system program | readonly | Must be the system program |
| 11 | lookup table | writable | Aggregator ALT referenced by the aggregator config PDA |
| 12 | address lookup table program | readonly | Must be the Address Lookup Table program |
| 13 | mm token account | readonly | |
| 14 | mm quote buffer | readonly | |
| 15 | mm parlay quote buffer | readonly | |

This is called by a SPAMM admin to register the SPAMM with the aggregator. The MM program id, MM config PDA, quote buffers, encumbrance PDA, collateral ATA, and liability ATA are appended to that address lookup table so transactions can reference them via the ALT.

### fill_bet
Discriminator: **3**

Data:

```rust
struct FillBetIxData {
   discriminator: u8, // 3
   bet_id: u64,
   market_id: MarketId,
   side: u8, // two-outcome markets: 0 or 1; soccer mkt 1 or 5: 0, 1, or 2
   amount: u64,
   min_odds_scaled: u32,
   event_state_sequence: u16,
   event_state_hash: [u8; 32],
}
```

Accounts (fixed prefix):

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | feepayer | writable, signer | Pays rent for bet PDA / ATA |
| 1 | user | signer | Must match user ATA owner |
| 2 | user ata | writable |  |
| 3 | bet pda | writable | Must be uninitialized |
| 4 | bet ata | writable | Must be uninitialized; authority is the Bet PDA Account |
| 5 | config pda | readonly | Aggregator config |
| 6 | mint | readonly | |
| 7 | token program | readonly | |
| 8 | associated token program | readonly | |
| 9 | system program | readonly | |

Per MM (currently 5 max):

| Offset | Account | Role | Notes |
|--------|---------|------|-------|
| 10+0*N | mm program | readonly | Must be executable (a program) |
| 10+1*N | mm config pda | writable | |
| 10+2*N | mm event state pda | readonly |  |
| 10+3*N | mm market data pda | writable | |
| 10+4*N | mm quote buffer | writable |  |
| 10+5*N | mm encumbrance pda | writable |  |
| 10+6*N | mm liability token account | writable | |
| 10+7*N | mm token account | writable | |
| 10+8*N | mm netting pda | writable | Must match expected but can be uninitialized |

This is called by a user to place a bet.

### fill_parlay
Discriminator: **4**.

Data:

```rust
struct FillParlayIxData {
   discriminator: u8, // 4
   bet_id: u64,
   amount: u64,
   min_odds_scaled: u32,
   num_legs: u8,         // L, must be 2..=5
   legs: [ParlayLegWire; MAX_PARLAY_LEGS], // fixed table; legs[0..L) used — see `ParlayLegWire` under Get_Quote_Parlay
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | feepayer | writable, signer | Pays rent for parlay bet PDA / ATA |
| 1 | user | signer | Must match user ATA owner |
| 2 | user ata | writable | Stake source |
| 3 | bet pda | writable | Must be uninitialized |
| 4 | bet ata | writable | Must be uninitialized; authority is bet pda |
| 5 | config pda | readonly | Aggregator config |
| 6 | mint | readonly | |
| 7 | token program | readonly | |
| 8 | associated token program | readonly | |
| 9 | system program | readonly | |
| 10 | mm program | readonly | Must be executable (a program) |
| 11 | mm config pda | writable | |
| 12 | mm parlay quote buffer | writable | |
| 13 | mm encumbrance pda | writable | |
| 14 | mm liability token account | writable | |
| 15 | mm token account | writable | |
| 16+1*L | mm market data (leg *L*) | writable | |
| 16+2*L | mm event state (leg *L*) | readonly | |

This is called by a user to place a multi-leg parlay.

### grade_bets
Discriminator: **5**

Data:

```rust
struct GradeBetsIxData {
   discriminator: u8, // 5
   results: [u8; N], // N = number of bet accounts; each byte is BetResult
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | aggregator admin | writable, signer | Must match config admin |
| 1 | config pda | readonly | |
| 1+N | bet pda (×`N`) | writable |  |

This is called by the aggregator admin to set the `result` of multiple bets.

### settle_bet
Discriminator: **6**

Data: `None`

Accounts (fixed prefix):

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | signer | writable, signer | Anyone; pays tx fees |
| 1 | bet pda | writable | |
| 2 | bet ata | writable | |
| 3 | bet feepayer | writable | Must match `feepayer` stored on bet |
| 4 | user | readonly | Bet owner |
| 5 | user ata | writable | |
| 6 | config pda | readonly | |
| 7 | mint | readonly | |
| 8 | token program | readonly | |

Per filler (currently 5):

| Offset | Account | Role | Notes |
|--------|---------|------|-------|
| 9+0*N | mm program | readonly, executable | Unused fillers use `111...` |
| 9+1*N | mm config pda | readonly | Unused fillers use `111...` |
| 9+2*N | mm encumbrance pda | writable | Unused fillers use `111...` |
| 9+3*N | mm liability token account | writable | Unused fillers use `111...` |
| 9+4*N | mm token account | writable | Unused fillers use `111...` |

This is called by **anyone** to settle a bet which has been graded. The tokens go to the user ata / mm ata / liability ata as needed and the lamports go to the original bet fee payer.

### settle_parlay
Discriminator: **7**

Data: `None`

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | signer | writable, signer | Anyone; pays tx fees |
| 1 | parlay bet pda | writable | |
| 2 | bet ata | writable | |
| 3 | bet feepayer | writable | Must match `feepayer` stored on bet |
| 4 | user | readonly | Bet owner |
| 5 | user ata | writable | |
| 6 | config pda | readonly | |
| 7 | mint | readonly | |
| 8 | token program | readonly | |
| 9 | mm program | readonly | Must match filler_address on the parlay bet |
| 10 | mm config pda | readonly | |
| 11 | mm encumbrance pda | writable | |
| 12 | mm liability token account | writable | |
| 13 | mm token account | writable | |

This is called by **anyone** to settle a graded parlay.

### create_netting_account
Discriminator: **50**

Data:

```rust
struct CreateNettingAccountIxData {
   discriminator: u8, // 50
   event_id: EventId,
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | mm admin | writable, signer | Must be the MM admin in the MM Config PDA |
| 1 | mm config pda | readonly |  |
| 2 | mm program | readonly | Must be executable (a program) |
| 3 | netting pda | writable | Must be uninitialized |
| 4 | system program | readonly | |

This is called by the SPAMM admin to create a liability netting account for an event.

### add_line_to_netting_account
Discriminator: **51**

Data:

```rust
struct AddLineToNettingIxData {
   discriminator: u8, // 51
   event_id: EventId,
   period: u8,
   mkt: u32,
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | mm admin | writable, signer | Must match MM admin in MM Config PDA |
| 1 | mm program | readonly, executable | |
| 2 | mm config pda | readonly | |
| 3 | netting pda | writable | |

This is called by the SPAMM admin to add a line to the liability netting account for an event.

### remove_line_from_netting_account
Discriminator: **52**

Data:

```rust
struct RemoveLineFromNettingIxData {
   discriminator: u8, // 52
   event_id: EventId,
   period: u8,
   mkt: u32,
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | mm admin | writable, signer | Must match MM admin in MM Config PDA |
| 1 | mm program | readonly, executable | |
| 2 | mm config pda | readonly | |
| 3 | netting pda | writable | |

This is called by the SPAMM admin to remove a line from the liability netting account for an event.

### close_netting_account
Discriminator: **53**

Data:

```rust
struct CloseNettingAccountIxData {
   discriminator: u8, // 53
   event_id: EventId,
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | mm admin | writable, signer | Must match MM admin in MM Config PDA |
| 1 | mm config pda | readonly | |
| 2 | mm program | readonly, executable | |
| 3 | netting pda | writable | Will be closed; rent to admin |
| 4 | system program | readonly | |

This is called by the SPAMM admin to close the liability netting account for an event.

### withdraw_from_liability_account
Discriminator: **100**

Data:

```rust
struct WithdrawFromLiabilityAccountIxData {
   discriminator: u8, // 100
   amount: u64,
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | mm authority | writable, signer | Must match MM admin in MM Config PDA |
| 1 | mm program | readonly | Must be executable (a program) |
| 2 | mm config pda | readonly | |
| 3 | mm encumbrance pda | writable | |
| 4 | mm liability token account | writable | |
| 5 | mm token account | writable | Destination of the transfer |
| 6 | mint | readonly | |
| 7 | token program | readonly | |

This is called by the SPAMM admin to withdraw excess funds from the liability token account.

### write_arbitrary_data
Discriminator: **254**

Data:

```rust
struct WriteArbitraryDataIxData {
   discriminator: u8, // 254
   data: [u8; N], // N = number of bytes to write
}
```

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | aggregator admin | writable, signer | Must match config authority |
| 1 | config pda | readonly | |
| 2 | account | writable | Any program-owned account to write to |

This is called by the aggregator admin to write arbitrary data to a PDA on devnet. 

### force_close_pda
Discriminator: **255**

Data: `None`

Accounts:

| Index | Account | Role | Notes |
|-------|---------|------|-------|
| 0 | aggregator admin | writable, signer | Must match MM admin in MM Config PDA |
| 1 | config pda | readonly | |
| 2 | pda | writable | Any program-owned PDA to close |

This is called by the aggregator admin to force close a PDA on devnet.

## Tests

There are some Mollusk integration tests that I got AI to write. There should be decent enough coverage (although only the example SPAMM is used so routing etc isn't tested) but I cannot be bothered to actually write them myself because Mollusk is a pain in the arse to write with manually and no one really care right now.

### Token

There is no token. I'm only saying this because people made a token claiming to be a previous project claiming to be real and hopefully this stops it happening here. 