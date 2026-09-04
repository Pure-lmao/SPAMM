//! Loop over the MMs and get their quotes for the bet then fill the bet from best to worst
//! CPI into the fill_quote function and update the outstanding liability amount for each MM and create the bet PDA
//!
//! Accounts: **13** then **9 × N** per MM (`N` = number of market makers).
//!
//! **(13)**
//! 0. `feepayer` (writable signer) — pays netting PDA rent if a fill inserts a new line
//! 1. `user` (readonly signer)
//! 2. `user_ata` (writable)
//! 3. `bet_pda` (writable)
//! 4. `bet_ata` (writable)
//! 5. `config_pda` (readonly)
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)
//! 8. `associated_token_program` (readonly)
//! 9. `rent_sysvar` (readonly)
//! 10. `system_program` (readonly)
//! 11. `instructions_sysvar` (readonly)
//! 12. `clock_sysvar` (readonly)
//!
//! **Per MM (9 each)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_event_state_pda` (writable on fill) — verified before quote CPI; readonly on quote CPI
//! 3. `mm_market_data_pda` (writable on fill) — verified before quote CPI; readonly on quote CPI
//! 4. `mm_quote_buffer` (writable)
//! 5. `mm_encumbrance_pda` (writable)
//! 6. `mm_liability_token_account` (writable)
//! 7. `mm_token_account` (writable)
//! 8. `mm_netting_pda` (writable) — real netting PDA, or **system program** if no netting account exists;
//!
//! Data (after router discriminator in `lib.rs`), [`FillBetIxData`]:
//!   `bet_id: u64`,
//!   `market_id: MarketId`,
//!   `side: u8` — two-outcome: `0` home, `1` away; three-sided `mkt` 1 or 5: `0` home, `1` away, `2` draw,
//!   `amount: u64`,
//!   `min_odds_scaled: u32`,
//!   `event_state_sequence: u16`,
//!   `event_game_state: EventGameState`,

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, 
   ProgramResult, 
   cpi::invoke, 
   error::ProgramError, hint::unlikely, 
   instruction::{InstructionAccount, InstructionView},
};

use pinocchio_log::log;
use crate::{
   constants::{MAX_NUMBER_OF_MMS, MIN_FILLER_AMOUNT}, errors::SpammError, helpers::{
      calc_potential_payout, calc_potential_profit, clock_unix_timestamp_u32, ensure_pda_unused, reject_duplicate_mm_programs, verify_associated_token_program, verify_clock_sysvar, verify_config_pda, verify_event_state, verify_instructions_sysvar, verify_mint, verify_mm_config_pda, verify_mm_encumbrance_pda, verify_mm_market_data_pda, verify_mm_program_executable, verify_netting_pda_or_placeholder, verify_quote_buffer, verify_rent_sysvar, verify_signer, verify_system_program, verify_token_account, verify_token_program,
      fill_helpers::{
         AuctionLiabilityRefund, compute_liability_shortfall, try_auction_liability_deposit,
         create_single_bet_account, parse_quote_return_for_mm,
      },
      freebet_helpers::{odds_in_freebet_range, require_freebet_operator_allowed, verify_freebet_for_fill},
      get_encumbrance, get_token_account_balance,
   }, state::{
      BET_ACCOUNT_DISCRIMINATOR, BetAccountHeader, BetFiller, FILL_QUOTE_IX_DISCRIMINATOR, FillBetIxData, FillQuoteIxData, GET_QUOTE_IX_DISCRIMINATOR, GetQuoteIxData, MMQuote, FreebetAccountData, account_bet::BetResult, account_netting::{NettingCalc, apply_netting, calculate_netting, ensure_netting_space_for_market}, event_id_wire_from_market_wire, other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET
   }, writers::write_i64_le_unchecked,
};
const MM_ACCOUNTS_PER_MM: usize = 9;

pub const FILL_BET_IX_DISCRIMINATOR: u8 = 10;

pub struct FillBetStake<'a> {
   pub token_account: &'a AccountView,
   pub authority: &'a AccountView,
   pub issuer_sign: Option<(u8, Address)>,
   pub freebet_id: u32,
   pub freebet: Option<&'a FreebetAccountData>,
}

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer,
      user,
      user_ata,
      bet_pda,
      bet_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      instructions_sysvar,
      clock_sysvar,
      mm_accounts @ ..,
   ] = accounts else {
      log!("fill_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   let parsed = FillBetIxData::decode(data)?;
   run_fill_bet(
      feepayer,
      user,
      bet_pda,
      bet_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      instructions_sysvar,
      clock_sysvar,
      mm_accounts,
      parsed,
      FillBetStake {
         token_account: user_ata,
         authority: user,
         issuer_sign: None,
         freebet_id: 0,
         freebet: None,
      },
   )
}

#[inline(never)]
pub(crate) fn run_fill_bet(
   feepayer: &AccountView,
   user: &AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &AccountView,
   config_pda: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   associated_token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   instructions_sysvar: &AccountView,
   clock_sysvar: &AccountView,
   mm_accounts: &mut [AccountView],
   parsed_data: FillBetIxData,
   stake: FillBetStake<'_>,
) -> ProgramResult {

   if mm_accounts.len() < MM_ACCOUNTS_PER_MM || mm_accounts.len() % MM_ACCOUNTS_PER_MM != 0 {
      log!("fill_bet: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   let number_of_mms = mm_accounts.len() / MM_ACCOUNTS_PER_MM;
   if number_of_mms > MAX_NUMBER_OF_MMS {
      log!("fill_bet: too many mm accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   reject_duplicate_mm_programs(mm_accounts, MM_ACCOUNTS_PER_MM)?;

   // -----ACCOUNT VERIFICATION-----
   verify_signer(feepayer)?;
   verify_signer(user)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_instructions_sysvar(instructions_sysvar)?;
   verify_clock_sysvar(clock_sysvar)?;
   verify_mint(mint)?;
   verify_token_account(true, stake.token_account, stake.authority, mint, token_program)?;
   verify_config_pda(config_pda, true)?;
   ensure_pda_unused(bet_pda, "fill_bet")?;

   let bet_id = parsed_data.bet_id;
   let amount = parsed_data.amount;
   let min_odds_scaled = parsed_data.min_odds_scaled;
   let market_id = parsed_data.market_id;
   let side = parsed_data.side;
   let event_game_state = parsed_data.event_game_state;
   let event_state_sequence = parsed_data.event_state_sequence;

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   if let Some(fb) = stake.freebet {
      verify_freebet_for_fill(fb, user.address(), amount, 1, now)?;
      require_freebet_operator_allowed(fb, &market_id.operator)?;
   }

   let market_wire = market_id.as_bytes();
   let event_id_wire = event_id_wire_from_market_wire(&market_wire);

   let get_quote_ix_data = GetQuoteIxData {
      instruction_discriminator: GET_QUOTE_IX_DISCRIMINATOR,
      amount,
      odds_scaled: min_odds_scaled,
      market_id,
      side,
      event_game_state,
      event_state_sequence,
   };
   #[cfg(feature = "log")]
   log!("fill_bet: get quote ix amount: {}", get_quote_ix_data.amount);
   #[cfg(feature = "log")]
   log!("fill_bet: get quote ix odds scaled: {}", get_quote_ix_data.odds_scaled);
   let mut get_quote_ix_buf = [0u8; GetQuoteIxData::WIRE_LEN];
   get_quote_ix_data.write_wire(&mut get_quote_ix_buf)?;

   let mut mm_quotes = [const { MaybeUninit::<MMQuote>::uninit() }; MAX_NUMBER_OF_MMS];
   let mut valid_quote_count = 0usize;

   for i in 0..number_of_mms {
      // 0. mm_program (readonly) — `verify_mm_program_executable`
      // 1. mm_config_pda (writable) — `verify_mm_config_pda`
      // 2. mm_event_state_pda (writable on fill) — `verify_event_state` before quote; readonly on quote CPI
      // 3. mm_market_data_pda (writable on fill) — `verify_mm_market_data_pda` before quote; readonly on quote CPI
      // 4. mm_quote_buffer (writable) — `verify_quote_buffer`
      // 5. mm_encumbrance_pda (writable) — `verify_mm_encumbrance_pda`
      // 6. mm_liability_token_account (writable) — `verify_token_account` (authority = encumbrance PDA)
      // 7. mm_token_account (writable) — `verify_token_account` (authority = mm config PDA)
      // 8. mm_netting_pda (writable) — `verify_netting_pda_or_placeholder`
      
      let base = i * MM_ACCOUNTS_PER_MM;
      let mm_program_account = &mm_accounts[base];
      let mm_config_pda = &mm_accounts[base + 1];
      let mm_event_state_pda = &mm_accounts[base + 2];
      let mm_market_data_pda = &mm_accounts[base + 3];
      let mm_quote_buffer = &mm_accounts[base + 4];
      let mm_encumbrance_pda = &mm_accounts[base + 5];
      let mm_liability_token_account = &mm_accounts[base + 6];
      let mm_token_account = &mm_accounts[base + 7];
      let mm_netting_pda = &mm_accounts[base + 8];

      if verify_mm_program_executable(mm_program_account).is_err() {
         #[cfg(feature = "log")]
         log!("fill_bet: mm program not executable");
         continue;
      }

      if let Some(fb) = stake.freebet {
         if !fb.mm_allowed(mm_program_account.address()) {
            #[cfg(feature = "log")]
            log!("fill_bet: mm not on freebet allow list");
            continue;
         }
      }

      let is_valid_mm_config_pda = verify_mm_config_pda(
         mm_config_pda,
         &mm_program_account,
      );
      if !is_valid_mm_config_pda {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid mm config pda");
         continue;
      }

      let is_valid_quote_buffer = verify_quote_buffer(
         mm_quote_buffer,
         mm_program_account,
      );
      if !is_valid_quote_buffer {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid quote buffer");
         continue;
      }

      let is_valid_market_data_pda = verify_mm_market_data_pda(
         mm_market_data_pda,
         mm_program_account,
         &market_wire,
      );
      if !is_valid_market_data_pda {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid market data pda");
         continue;
      }

      let is_valid_mm_token_account = verify_token_account(
         false,
         &mm_token_account, 
         &mm_config_pda, 
         mint, 
         token_program, 
      )?;
      if !is_valid_mm_token_account {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid mm token account");
         continue;
      }

      let Some(encumbrance_pda_bump) = verify_mm_encumbrance_pda(
         mm_encumbrance_pda,
         &mm_program_account,
      ) else {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid encumbrance pda");
         continue;
      };

      let is_valid_mm_liability_token_account = verify_token_account(
         false,
         &mm_liability_token_account, 
         &mm_encumbrance_pda,
         mint, 
         token_program, 
      )?;
      if !is_valid_mm_liability_token_account {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid mm liability token account");
         continue;
      }

      let is_valid_event_state = verify_event_state(
         mm_event_state_pda,
         mm_program_account,
         event_id_wire,
         &event_game_state,
         event_state_sequence,
      );
      if !is_valid_event_state {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid event state");
         continue;
      }

      let is_valid_mm_netting_pda = verify_netting_pda_or_placeholder(
         mm_netting_pda,
         mm_program_account,
         event_id_wire,
      );
      if !is_valid_mm_netting_pda {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid mm netting pda");
         continue;
      }

      // Get the quote via a CPI to the MM program and they will return the quote data from the ix
      let get_quote_ix_accounts = [
         InstructionAccount::new(user.address(), false, false),
         InstructionAccount::new(clock_sysvar.address(), false, false),
         InstructionAccount::new(mm_market_data_pda.address(), false, false),
         InstructionAccount::new(mm_event_state_pda.address(), false, false),
         InstructionAccount::new(mm_config_pda.address(), false, false),
         InstructionAccount::new(mm_quote_buffer.address(), true, false),
      ];
      let get_quote_ix = InstructionView {
         program_id: mm_program_account.address(),
         accounts: &get_quote_ix_accounts,
         data: &get_quote_ix_buf,
      };
      let Ok(()) = invoke(
         &get_quote_ix,
         &[
            user.as_ref(), 
            clock_sysvar.as_ref(),
            mm_market_data_pda.as_ref(),
            mm_event_state_pda.as_ref(),
            mm_config_pda.as_ref(),
            mm_quote_buffer.as_ref(),
         ],
      ) else {
         #[cfg(feature = "log")]
         log!("fill_bet: failed to invoke get quote ix");
         continue;
      };

      let mut max_amount = 0;
      let mut odds_scaled = 0;
      if let Some(parsed) = parse_quote_return_for_mm(mm_program_account) {
         (max_amount, odds_scaled) = parsed;
      }

      #[cfg(feature = "log")]
      log!("fill_bet: max_amount: {}, odds_scaled: {}", max_amount, odds_scaled);

      if max_amount == 0 {
         continue;
      }

      if odds_scaled < min_odds_scaled {
         continue;
      }
      if let Some(fb) = stake.freebet {
         if !odds_in_freebet_range(odds_scaled, fb) {
            #[cfg(feature = "log")]
            log!("fill_bet: freebet odds out of range");
            continue;
         }
      }

      mm_quotes[valid_quote_count].write(MMQuote {
         max_amount,
         odds_scaled,
         mm_address: mm_program_account.address(),
         mm_token_account,
         netting_pda_index: base + 8,
         mm_quote_buffer,
         mm_config_pda,
         mm_market_data_pda,
         mm_event_state_pda,
         encumbrance_pda_index: base + 5,
         encumbrance_pda_bump,
         mm_liability_token_account,
      });
      valid_quote_count += 1;
   }

   // SAFETY: the first `valid_quote_count` `MaybeUninit` slots were `write`n in the loop above.
   let valid_quotes = unsafe {
      core::slice::from_raw_parts_mut(
         mm_quotes.as_mut_ptr().cast::<MMQuote>(),
         valid_quote_count,
      )
   };

   valid_quotes.sort_unstable_by(|a, b| b.odds_scaled.cmp(&a.odds_scaled));

   // we now know that the quotes are sorted and valid so we can fill up the bet from the best to the worst

   let mut filled_amount: u64 = 0;
   let mut filled_payout: u64 = 0;
   let mut filler_count: usize = 0;
   let mut bet_fillers = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   for quote in valid_quotes.iter() {
      let remaining_amount = amount - filled_amount;
      #[cfg(feature = "log")]
      log!("fill_bet: remaining amount: {}", remaining_amount);
      if remaining_amount == 0 {
         #[cfg(feature = "log")]
         log!("fill_bet: remaining amount is 0, breaking out of loop");
         break;
      }
      let amount_to_fill = if quote.max_amount > remaining_amount {
         remaining_amount
      } else {
         quote.max_amount
      };
      if amount_to_fill < MIN_FILLER_AMOUNT {
         continue;
      }

      #[cfg(feature = "log")]
      log!("fill_bet: amount to fill: {}", amount_to_fill);

      // amount_to_fill >= MIN_FILLER_AMOUNT; max_amount == 0 quotes are filtered earlier
      // and remaining_amount == 0 already broke out of the loop

      // check if the mm has the free liability to cover the bet
      let Ok(mm_liability_account_balance_before) =
         get_token_account_balance(quote.mm_liability_token_account)
      else {
         #[cfg(feature = "log")]
         log!("fill_bet: failed to get mm liability account balance before");
         continue;
      };

      let outstanding_liability = {
         let mm_encumbrance_pda = &mm_accounts[quote.encumbrance_pda_index];
         match get_encumbrance(mm_encumbrance_pda) {
            Ok(v) => v,
            Err(_) => {
               #[cfg(feature = "log")]
               log!("fill_bet: failed to get encumbrance");
               continue;
            }
         }
      };

      // Stage netting: grow if this fill inserts a new line, then compute Δpeak without writing.
      // apply_netting runs after the MM deposit is confirmed.
      let netting_calc: Option<NettingCalc> = {
         let mm_netting_pda = &mut mm_accounts[quote.netting_pda_index];
         if mm_netting_pda.is_data_empty() {
            None
         } else if ensure_netting_space_for_market(
            mm_netting_pda,
            &market_id,
            feepayer,
            rent_sysvar,
         )
         .is_err()
         {
            // MM netting PDA / resize is MM-controlled — skip this quote, do not abort the auction.
            continue;
         } else {
            calculate_netting(
               mm_netting_pda,
               &market_id,
               side,
               amount_to_fill,
               quote.odds_scaled,
            )
         }
      };
      let is_potentially_netted = netting_calc.is_some();

      let Ok(gross_margin_u64) = calc_potential_profit(amount_to_fill, quote.odds_scaled) else {
         #[cfg(feature = "log")]
         log!("fill_bet: failed to calc potential profit");
         continue;
      };
      let gross_margin_i64: i64 = match gross_margin_u64.try_into() {
         Ok(v) => v,
         Err(_) => continue,
      };

      let delta_i64: i64 = if is_potentially_netted {
         netting_calc.map(|c| c.delta).unwrap_or(0)
      } else {
         gross_margin_i64
      };

      let Ok((amount_to_send, new_outstanding_liability)) = compute_liability_shortfall(
         mm_liability_account_balance_before,
         outstanding_liability,
         delta_i64,
      ) else {
         continue;
      };

      let fill_quote_ix_data = FillQuoteIxData {
         instruction_discriminator: FILL_QUOTE_IX_DISCRIMINATOR,
         side,
         event_state_sequence,
         amount_to_fill,
         odds_scaled: quote.odds_scaled,
         market_id,
         event_game_state,
         amount_to_send,
      };
      let mut fill_quote_ix_buf = [0u8; FillQuoteIxData::WIRE_LEN];
      let Ok(()) = fill_quote_ix_data.write_wire(&mut fill_quote_ix_buf) else {
         continue;
      };

      let fill_quote_ix_account_metas = [
         InstructionAccount::new(user.address(), false, false),
         InstructionAccount::new(quote.mm_market_data_pda.address(), true, false),
         InstructionAccount::new(quote.mm_event_state_pda.address(), true, false),
         InstructionAccount::new(quote.mm_config_pda.address(), true, false),
         InstructionAccount::new(quote.mm_quote_buffer.address(), true, false),
         InstructionAccount::new(quote.mm_token_account.address(), true, false),
         InstructionAccount::new(quote.mm_liability_token_account.address(), true, false),
         InstructionAccount::new(mint.address(), false, false),
         InstructionAccount::new(token_program.address(), false, false),
         InstructionAccount::new(instructions_sysvar.address(), false, false),
      ];

      let fill_quote_invoke_accounts = [
         user.as_ref(),
         quote.mm_market_data_pda.as_ref(),
         quote.mm_event_state_pda.as_ref(),
         quote.mm_config_pda.as_ref(),
         quote.mm_quote_buffer.as_ref(),
         quote.mm_token_account.as_ref(),
         quote.mm_liability_token_account.as_ref(),
         mint.as_ref(),
         token_program.as_ref(),
         instructions_sysvar.as_ref(),
      ];

      let fill_quote_ix = InstructionView {
         program_id: quote.mm_address,
         accounts: &fill_quote_ix_account_metas,
         data: &fill_quote_ix_buf,
      };
      let Ok(()) = invoke(
         &fill_quote_ix,
         &fill_quote_invoke_accounts,
      ) else {
         continue;
      };

      if !try_auction_liability_deposit(
         quote.mm_liability_token_account,
         mm_liability_account_balance_before,
         amount_to_send,
         AuctionLiabilityRefund {
            mm_encumbrance_pda: &mut mm_accounts[quote.encumbrance_pda_index],
            encumbrance_bump: quote.encumbrance_pda_bump,
            mm_address: quote.mm_address,
            mm_liability: quote.mm_liability_token_account,
            mm_token: quote.mm_token_account,
         },
      ) {
         continue;
      }
   
      filled_amount = match filled_amount.checked_add(amount_to_fill) {
         Some(v) => v,
         None => {
            log!("fill_bet: filled_amount overflow after deposit");
            return Err(ProgramError::ArithmeticOverflow);
         }
      };

      let Ok(addl_payout) = calc_potential_payout(amount_to_fill, quote.odds_scaled) else {
         log!("fill_bet: payout overflow after deposit");
         return Err(ProgramError::ArithmeticOverflow);
      };
      
      filled_payout = match filled_payout.checked_add(addl_payout) {
         Some(v) => v,
         None => {
            log!("fill_bet: filled_payout overflow after deposit");
            return Err(ProgramError::ArithmeticOverflow);
         }
      };

      if let Some(NettingCalc { write: netting_write, .. }) = netting_calc {
         // Deposit already confirmed. Reverting the token transfer is not practical here;
         // fail the tx atomically rather than swallowing netting and freezing settle (P1).
         apply_netting(&mm_accounts[quote.netting_pda_index], &netting_write)?;
      }

      unsafe {
         write_i64_le_unchecked(
            mm_accounts[quote.encumbrance_pda_index].data_mut_ptr(),
            MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
            new_outstanding_liability
         );
      }

      bet_fillers[filler_count].write(BetFiller {
         mm_address: *quote.mm_address,
         amount: amount_to_fill,
         reserved_profit: gross_margin_u64,
         odds_scaled: quote.odds_scaled,
         is_potentially_netted,
      });
      filler_count += 1;

   }

   if unlikely(filled_amount == 0) {
      log!("fill_bet: no quotes were filled");
      return Err(SpammError::NoQuotesAvailable.into());
   }
   if stake.freebet.is_some() && filled_amount != amount {
      log!("fill_bet: freebet not fully filled");
      return Err(SpammError::FreebetAmountMismatch.into());
   }

   let live_fillers = unsafe {
      core::slice::from_raw_parts(bet_fillers.as_ptr().cast::<BetFiller>(), filler_count)
   };

   let header = BetAccountHeader {
      discriminator: BET_ACCOUNT_DISCRIMINATOR,
      bump: 0,
      owner: *user.address(),
      feepayer: *feepayer.address(),
      bet_id,
      market_id,
      side,
      amount: filled_amount,
      payout: filled_payout,
      timestamp: now,
      freebet_id: stake.freebet_id,
      event_state_sequence,
      event_game_state,
      result: BetResult::Pending,
      num_fillers: filler_count as u8,
   };
   create_single_bet_account(
      feepayer,
      user,
      stake.token_account,
      stake.authority,
      bet_pda,
      bet_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      &header,
      live_fillers,
      stake.issuer_sign,
      "fill_bet",
   )?;

   Ok(())
}

