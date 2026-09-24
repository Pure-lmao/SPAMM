This program is provided as a clean base for building a market maker program from. It will be audited in future to give you peace of mind that it is secure. It currently returns quotes of 0 for all requests. To build upon it, all you need to do is implement the placeholder functions in `price.rs`, change the `constants.rs` to be based on your program id, and change the market data pda struct/init/update functions to suit the quoting method you wish to use. It currently uses a basic function for market data pda updates, but you probably want to use something like a Doppler update, like in the program in the `market_maker` example. This means updates take fewer CUs.


The most basic system for odds might be something like setting each outcome odds in the market data pda, and quoting up to a market exposure limit:

```rust
struct MarketData {
   discriminator: u8,
   sequence: u64,
   odds0_scaled: u32,
   odds1_scaled: u32,
   market_max_exposure: u64,
   side0_exposure: u64,
   side1_exposure: u64,
}

// init market with initial odds, max exposure, and side exposures of 0

// update market with new odds via modified Doppler
// update max market exposure via a normal function since its less frequent

fn get_quote(req_side: u8, req_min_odds: u32, req_max_stake: u64) -> QuoteResult {
   let market_data = MarketData::get(market_data_pda);
   let (this_side_odds, this_side_exposure) = if req_side == 0 {
      (market_data.odds0_scaled, market_data.side0_exposure)
   } else {
      (market_data.odds1_scaled, market_data.side1_exposure)
   };
   if this_side_odds < req_min_odds {
      return QuoteResult {0, 0}
   }
   let addl_exposure = req_max_stake * (this_side_odds - ODDS_SCALE) / ODDS_SCALE;
   if addl_exposure + this_side_exposure > market_data.market_max_exposure {
      return QuoteResult {0, 0}
   }
   return QuoteResult {
      max_amount: req_max_stake,
      odds_scaled: this_side_odds,
   };
}

fn fill_quote(amount_to_send: u64) {
   // read from the quote buffer, verify it, and send the tokens as required by the framework
   let quote = read_quote_buffer();
   verify_quote(quote);
   send_tokens(amount_to_send);
   
   // update the market data pda with the new exposure
   let mut market_data = MarketData::get(market_data_pda);
   let current_exposure = if req_side == 0 {
      market_data.side0_exposure
   } else {
      market_data.side1_exposure
   };
   let addl_exposure = quote.amount * (quote.odds - ODDS_SCALE) / ODDS_SCALE;
   MarketData::update_exposure(market_data_pda, quote.side, addl_exposure + current_exposure);
}
```

Your program config pda is passed on quotes and fills, so you can use this as a global data blob. This is useful for data that should apply to every quote you give. For example, you might have profiled a user as being a whale with uninformed flow.

```rust
struct ConfigPda {
   // required header by the framework
   pub discriminator: u8,
   pub bump: u8,
   pub admin: Address,
   pub rfq_signer: Address,
   // optional for your use
   pub status: u8, // 0 = offline, 1 = online
   pub num_whales: u16,
   pub whale_addresses: [Address; num_whales],
}

// add_whale function in normal program code increments num_whales and adds the address to the array

fn get_quote(req_side: u8, req_min_odds: u32, req_max_stake: u64) -> QuoteResult {
   let [user, ..] = accounts else {
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   let market_data = MarketData::get(market_data_pda);
   let config = ConfigPda::get(config_pda);
   if config.status == 0 {
      return QuoteResult {0, 0};
   }
   let whales = config.whale_addresses;
   let mut (max_stake, max_odds) = calculate_quote(req_side, req_min_odds, req_max_stake, market_data);
   if whales.contains(&user.address) {
      max_stake = max_stake * 10; // offer 10x more stake to known whales
      max_odds = max_odds + (0.02 * ODDS_SCALE); // offer 0.02 decimal odds boost to known whales to secure the fill
   }
   return QuoteResult {
      max_amount: max_stake,
      odds_scaled: max_odds,
   };
}
```

You might choose to offer an orderbook-like quote system where smaller amounts fill at better odds, and larger amounts experience slippage as they fill through steps. To make this more efficient, you can use a spline-based system in the market pda.

```rust 
struct MarketData {
   discriminator: u8,
   sequence: u64,
   quote_side0: bool,
   quote_side1: bool,
   midpoint_odds_scaled: u32,
   distance_from_midpoint: [u32; 5],
   quote_amounts0: [u64; 5],
   quote_amounts1: [u64; 5],
}

// update midpoint_odds_scaled via modified Doppler for lightweight updates
// restore amounts to quote_amounts and adjust distance_from_midpoint via normal function since its less frequent

fn get_quote(req_side: u8, req_min_odds: u32, req_max_stake: u64) -> QuoteResult {
   let market_data = MarketData::get(market_data_pda);
   let (this_quote_active, this_quote_amounts) = if req_side == 0 {
      (market_data.quote_side0, market_data.quote_amounts0)
   } else {
      (market_data.quote_side1, market_data.quote_amounts1)
   };
   if !this_quote_active {
      return QuoteResult {0, 0}
   }
   let mut odds_amount_steps = [(0, 0); 5];
   for i in 0..5 {
      let odds = market_data.midpoint_odds_scaled - market_data.distance_from_midpoint[i];
      let amount = this_quote_amounts[i];
      odds_amount_steps[i] = (odds, amount);
   }

   // steps are best odds first; each amount is the size available at that step
   let mut filled = 0u64;
   let mut odds_stake = 0u64;
   let mut remaining = req_max_stake;
   for (odds, amount) in odds_amount_steps {
      if remaining == 0 || odds < req_min_odds {
         break;
      }
      let take = if amount < remaining { amount } else { remaining };
      filled += take;
      odds_stake += odds as u64 * take;
      remaining -= take;
   }
   if filled == 0 {
      return QuoteResult {0, 0}
   }
   return QuoteResult {
      max_amount: filled,
      odds_scaled: (odds_stake / filled) as u32,
   };
}

fn fill_quote(amount_to_send: u64) {
   // read and verify buffer etc

   // update market data pda to account for the filled amount
   let mut market_data = MarketData::get(market_data_pda);
   let mut quote_amounts = if req_side == 0 {
      market_data.quote_amounts0
   } else {
      market_data.quote_amounts1
   };
   let mut amount_filled = quote.amount;
   for i in 0..5 {
      if amount_filled == 0 {
         break;
      }
      let take = if quote_amounts[i] < amount_filled { quote_amounts[i] } else { amount_filled };
      quote_amounts[i] -= take;
      amount_filled -= take;
   }
   if req_side == 0 {
      market_data.quote_amounts0 = quote_amounts;
   } else {
      market_data.quote_amounts1 = quote_amounts;
   }
   MarketData::update(market_data_pda, market_data);
}
```