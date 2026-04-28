# Overview

This is the SPAMM Aggregator program. It is responsible for filling user bets with offers from the integrated SPAMMs. The aggregator API is responsible for providing event and market ids. Each SPAMM is responsible for offering quotes on whatever markets they wish. Any client can call each SPAMM's get_quote function to get the offer, then build a tx to fill the bet with the 5 best quotes. The aggregator will then fill the bet with the quotes in order of best to worst odds.

Liability for paying out winning bets is held in a token account owned by the aggregator. This must be transferred by the SPAMM during the fill_bet function. 

The aggregator program is responsible for grading the bets. Funds are transferred to the winners by calling settle_bet on a graded bet.

--------------

# SPAMM Program Framework
When this framework description uses "MUST" the program MUST adhere to the requirement. If "should" is used, it is a recommendation.

## Overview
A SPAMM program is a program which complies with this framework and offers quotes for bets to the aggregator on sports markets. It should take advantage of low CU oracle account updates in order to land odds/state updates at the top of the block, before compute-heavy bet filling transactions.
Each mm MUST have a Quote Buffer account (owned by mm) and a Liability Token Account (owned by aggregator).
Each mm MUST have a token account (owned by the token program, obviously) with the authority of the mm quote buffer account since it will always be in the transfer ix.
Each event MUST have an Event State account (owned by mm).
Each market MUST have an Oracle account (owned by mm, not read by the aggregator).
Each event may have a Liability Netting account (owned by aggregator).

## Get_Quote function
The get_quote function is called by the RPC to get the price to build the tx for the user then again by the aggregator when filling the bet to get best odds at execution-time (no spoofing!). The function MUST return data using sol_set_return_data. The user is passed as a courtesy to allow you to potentially offer better odds to some users. 

The function MUST take the following accounts:
1. User
2. MM Market Data PDA
3. MM Event State PDA
4. MM Config PDA
5. MM Quote Buffer
The function MUST take the following data:
```rust
struct GetQuoteIxData {
   instruction_discriminator: u8 = 5,
   market_id: MarketId,
   side: u8,
   amount: u64,
   event_state_hash: [u8; 32],
   event_state_sequence: u16,
}
```
The function MUST return the following data:
```rust
struct GetQuoteReturnData {
   max_amount: u64, // the maximum amount the user can bet at the given odds
   odds_scaled: u32, // the decimal odds scaled by ODDS_SCALE from the prespective of the taking user
}
```
The function MUST return the data using sol_set_return_data.
If any of these values are 0, then nothing will attempt to be filled.

You can be filled at any amount from max_amount down to 0. You will be filled at odds_scaled.

You MUST then populate the MM Quote Buffer with the following data:
```rust
struct MMQuoteBuffer {
   discriminator: u8 = 2,
   is_used: u8 = 0, // set to 0 after giving quote
   user_address: Address,
   market_id: MarketId,
   side: u8,
   max_amount: u64,
   odds_scaled: u32,
   event_state_hash: [u8; 32],
   event_state_sequence: u16,
}
```
This data is later used by your fill_quote function to validate the quote was actually offered by yourself and is not spoofed.

## Fill_Quote function
The fill_quote function is called by the aggregator to fill the bet after receiving the quotes, filtering valid quote, and sorting them best to worst odds.

The function MUST take the following accounts:
1. User
2. MM Market Data PDA
3. MM Config PDA
4. MM Quote Buffer
5. MM Token Account
6. MM Liability Token Account

The function MUST take the following data:
```rust
struct FillQuoteIxData {
   instruction_discriminator: u8 = 6,
   market_id: MarketId,
   side: u8,
   amount_to_fill: u64,
   odds_scaled: u32,
   event_state_hash: [u8; 32],
   event_state_sequence: u16,
   amount_to_send: u64,
}
```
The function should then validate the quote matches the quote buffer data as proof the transaction is not spoofed.
The function MUST then transfer the amount_to_send to the liability token account. This is the amount of funds required to cover the net liability of the position. It will be <= `amount_to_fill * (odds_scaled - ODDS_SCALE)` (the user potential profit). If the new liability ends up being negative due to odds changes and liability netting, this amount will be 0 and the aggregator will refund the excess back to the mm token account.
The is_used field in the quote buffer MUST be set to 1 to indicate the quote has been filled and cannot be reused without being reset by the get_quote function.

## Config PDA
The config PDA is a PDA owned by the mm program. It MUST be of the seeds `["config"]`.
It contains the following data:
```rust
struct Config {
   discriminator: u8 = 1,
   bump: u8,
   auth_signer: Address, // used for interacting with THIS program for non-quoting functions
}
```

## Liability Netting PDA
The liability netting PDA is a PDA owned by the aggregator. It MUST be of the seeds `["liability_netting", mm_program_address, event_id]`.
It is created by the auth signer of the mm program calling the create_liability_netting_account function.
See the Liability Netting section below for more details.

## Market Data PDA
Each market MUST have an Market Data PDA owned by mm.
```rust
struct MarketData {
   discriminator: u8 = 0,
   bump: u8,
   // anything else you want
}
```
It MUST have the seeds `["market_data", market_id]` HOWEVER, the market_id for soccer should be modified to have mkt of 1 when mkt is 1, 2, 3, keeping FT odds together in one Oracle account to match API data feeds, and modified to be 5 when mkt is 5, 6, 7, keeping Double Chance odds together. It can contain any data that you want to store for the market. The aggregator verifies the market data pda exists with the expected seed. You should perform additional checks as needed such as the sequence and data validation.
It is recommended you use something like Doppler (https://github.com/blueshift-gg/doppler) and incorporate it as a hot path into your program (although you must modify it to include the bump seed in the account data. This can be seen in the example market maker program). It has 21 CU updates, or 49 if you include the update authority key in the account.

## Event State PDA
Event State PDA MUST have the following structure:
```rust
struct EventState {
   discriminator: u8 = 3,
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
The event state hash and sequence of a market maker event PDA must match the aggregator API state hash and sequence which is used to construct the fill tx for the user or the market maker is considered to not be in sync and wont be used to fill bets.

The state hash is constructed based on data which varies by sport:
(P prefix meaning "pre-")
```rust
soccer: (
   home_team_score as u8, 
   away_team_score as u8, 
   home_team_red_cards as u8, 
   away_team_red_cards as u8, 
   "PG"|"1H"|"HT"|"2H"|"PET"|"1ET"|"HTET"|"2ET"|"PPen"|"Pen" as str
)
ice_hockey: (
   home_team_score as u8, 
   away_team_score as u8, 
   "PG"|"1P"|"P2P"|"2P"|"P3P"|"P3"|"POT"|"OT"|"PSO"|"SO" as str
)
american_football: (
   home_team_score as u8, 
   away_team_score as u8, 
   "PG"|"1Q"|"P2Q"|"2Q"|"HT"|"3Q"|"P4Q"|"POT"|"OT" as str
)

basketball: (
   //score is omitted as constant updates would be excessive
   "PG"|"1Q"|"P2Q"|"2Q"|"HT"|"3Q"|"P4Q"|"POT"|"OT"|"POTx"|"OTx" as str
   //where x > 1 of the double/triple overtimes
)

baseball: (
   home_team_score as u8, 
   away_team_score as u8, 
   "PG"|"T1"|"B1"|"P2"|"T2"|"B2"|"P3"... as str
)
```

The hash is constructed as `sha256(sport_name || state_tuple) => [u8; 32]`.

## Accounts at a Glance
| Account | Discriminator | Seed | Notes |
|---------|---------------|------|-------|
| Oracle PDA | 0 | ["oracle", market_id] | created in init_market with a custom body |
| MM Config PDA | 1 | ["config"] | created in init_program |
| MM Quote Buffer | 2 | ["mm_quote_buffer"] | created in init_program |
| MM Event State | 3 | ["event_state", event_id] | created in init_event |
| MM Token Account | n/a | n/a | authority is the MM Config PDA, created in init_program |

MM accounts owned by the aggregator:
| MM Liability Token Account | n/a | n/a | authority is the aggregator config PDA, created in init_program |

------------------------------------------------------------------------------------------------

# SPAMM Aggregator

The aggreator is responsible for filling user bets with offers from the integrated SPAMMs.

## User bet flow
The user bet flow is as follows:
1. The user (or UI) uses the aggragator API to find and event and market.
2. The user (or UI) uses the RPC to call the get_quote function of each SPAMM.
3. The user (or UI) uses these quotes to build a tx, including the 5 best quotes which fills the desired amount.
4. The user signs the tx and sends it to the network.
5. The aggragator checks the get_quote function of each SPAMM to ensure the user's fill is as good as can be at execution-time.
6. The aggregator works through the valid quotes in order and calls the fill_quote function of each SPAMM to fill as much as possible of the bet amount at odds no worse than requested.
7. The aggregator ensures that the fill_quote function was successful and the funds were transferred to the mm liability token account.
8. If the market is pre-game and FT/ML, total or spread, the aggregator will net the liability on the market for each market maker if they have opted into position netting for the event by making an data PDA.
9. The aggregator creates a bet PDA for the user and stores the stake in the bet PDA.
10. After the result is known, the bet is graded.
11. Anyone can call settle_bet on any bet with a non-PENDING result and initiate the transfer of funds to the winners.


## Liability Netting
Liability netting is a feature in major pre-game markets (FT (soccer), ML (non-soccer), Spread, Totals) to allow you to gain more capital efficiency by netting liabilities on opposing outcomes and returning excess funds to your token account. It is NOT avalivable in live markets due to the chance of a bet being rolled back due to an invalid event state change which make the netting invalid. It does NOT consider the whole event position, only on a per market basis.
This requires you to have created a liability netting PDA for the event. This PDA should be a PDA owned by THIS program. It MUST be of the seeds `["liability_netting", mm_program_address, event_id].
The account is initiated with 10 blank lines (for spreads and totals). They are auto-populted each time a bet of a valid market is filled. Additionally, you can add a line to the netting account by calling the add_line_to_liability_netting_account function with the event_id and mkt to be added. This should be done when you want to specify the lines you intend on quoting or expect to be popular.
You can remove a line from the netting account by calling the remove_line_from_liability_netting_account function with the event_id and mkt to be removed. This should be done when you no longer want that line to be netted in favour of adding a more popular line.

## Accounts at a Glance
| Account | Discriminator | Seed | Notes |
|---------|---------------|------|-------|
| Bet PDA Accounts | 1 | ["bet", user_address, bet_id] | created in fill_bet |
| Bet Token Account | n/a | n/a | authority is the Bet PDA Account, created in fill_bet |
| Config PDA | 2 | ["config"] | created in init_program |
| MM List PDA | 3 | ["mm_list"] | created in init_program |
| MM Liability Token Account | n/a | ["liability_token_account", mm_program_address, mint_address] | created in register_mm |
| MM Netting PDA | 4 | ["netting", mm_program_address, event_id] | created with create_netting_account |