//! Loop over the MMs and get their quotes for the bet then fill the bet from best to worst
//! CPI into the fill_quote function and update the outstanding liability amount for each MM and create the bet PDA
//!
//! Accounts: **12** then **9 × N** per MM (`N` = number of market makers).
//!
//! **(12)**
//! 0. `feepayer` (writable signer)
//! 1. `user` (readonly signer)
//! 2. `user_ata` (writable)
//! 3. `bet_pda` (writable)
//! 4. `bet_ata` (writable)
//! 5. `config_pda` (readonly)
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)
//! 8. `associated_token_program` (readonly)
//! 9. `system_program` (readonly)
//! 10. `instructions_sysvar` (readonly)
//! 11. `clock_program` (readonly)
//!
//! **Per MM (9 each)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_event_state_pda` (readonly)
//! 3. `mm_market_data_pda` (writable)
//! 4. `mm_quote_buffer` (writable)
//! 5. `mm_encumbrance_pda` (writable)
//! 6. `mm_liability_token_account` (writable)
//! 7. `mm_token_account` (writable)
//! 8. `mm_netting_pda` (writable) — real netting PDA, or **system program** if no netting account exists;
//!
//! Data (after router discriminator in `lib.rs`): `[
//!   bet_id (u64),
//!   market_id (MarketId),
//!   side (u8): two-outcome — `0` home, `1` away; soccer `mkt` 1 or 5 — `0` home, `1` away, `2` draw,
//!   amount (u64),
//!   min_odds_scaled (u32),
//!   event_state_sequence (u16),
//!   event_game_state (EventGameState: game_phase [u8;4], home_primary, away_primary, home_secondary, away_secondary),
//! ]`

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, 
   ProgramResult, 
   address::address_eq, 
   cpi::{Seed, Signer, invoke}, 
   error::ProgramError, hint::unlikely, 
   instruction::{InstructionAccount, InstructionView},
   sysvars::clock::Clock,
};

use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_system::{ID as SYSTEM_ID, instructions::CreateAccount};
use pinocchio_token::instructions::Transfer;
use crate::{ID, 
   constants::MAX_NUMBER_OF_MMS, 
   helpers::{calc_potential_payout, calc_potential_profit, get_rent_local, verify_associated_token_program, verify_config_pda, verify_event_state, verify_instructions_sysvar, verify_mint, verify_mm_config_pda, verify_mm_encumbrance_pda, verify_mm_market_data_pda, verify_netting_pda_or_placeholder, verify_quote_buffer, verify_signer, verify_system_program, verify_token_account, verify_token_program}, 
   instructions::fill_helpers::{parse_quote_return_for_mm, refund_liability_deposit_mismatch},
   parsers::{get_encumbrance, get_token_account_balance, parse_fill_bet_data}, 
   state::{
      BET_ACCOUNT_DISCRIMINATOR, BET_ACCOUNT_LEN, BET_ACCOUNT_SEED, BetAccountData, BetFiller, EventGameState, FILL_QUOTE_IX_DISCRIMINATOR, FillQuoteIxData, GET_QUOTE_IX_DISCRIMINATOR, GetQuoteIxData, MMQuote, MarketId, account_bet::BetResult, account_netting::{NettingCalc, apply_netting, calculate_netting}, other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET
   }, writers::write_i64_le_unchecked,
};
const MM_ACCOUNTS_PER_MM: usize = 9;

pub const FILL_BET_IX_DISCRIMINATOR: u8 = 3;

#[inline(never)]
pub fn fill_bet(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer, //verified as signer
      user, //verified as signer
      user_ata, //verified by verify_token_account
      bet_pda, //verified by find_program_address
      bet_ata, //verified by verify_token_account after creation
      config_pda, //verified by verify_config_pda
      mint, //verified by verify_mint
      token_program, //verified by equ const
      associated_token_program, //verified by equ const
      system_program, //verified by equ const
      instructions_sysvar, //verified by verify_instructions_sysvar
      clock_program, //verified by equ const
      mm_accounts @ ..,
   ] = accounts else {
      log!("fill_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if mm_accounts.len() < MM_ACCOUNTS_PER_MM || mm_accounts.len() % MM_ACCOUNTS_PER_MM != 0 {
      log!("fill_bet: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   // -----ACCOUNT VERIFICATION-----
   verify_signer(&feepayer)?;
   verify_signer(&user)?;
   verify_token_program(&token_program)?;
   verify_associated_token_program(&associated_token_program)?;
   verify_system_program(&system_program)?;
   verify_instructions_sysvar(&instructions_sysvar)?;
   verify_mint(&mint)?;
   verify_token_account(true, user_ata, user, mint, token_program)?;
   verify_config_pda(&config_pda, true)?;
   // verify_clock_program(&clock_program)?; checked by from_account_view_unchecked

   // Amount, odds, side, sport, and event_state_sequence vs is_pregame are validated in `parse_fill_bet_data`.
   let parsed_data = parse_fill_bet_data(data)?;
   let bet_id = parsed_data.bet_id;
   let amount = parsed_data.amount;
   let min_odds_scaled = parsed_data.min_odds_scaled;
   let market_id = parsed_data.market_id;
   let side = parsed_data.side;
   let event_game_state = parsed_data.event_game_state;
   let event_state_sequence = parsed_data.event_state_sequence;

   let bet_id_bytes = bet_id.to_le_bytes();
   let bet_pda_seed = [
      BET_ACCOUNT_SEED, 
      user.address().as_ref(), 
      &bet_id_bytes
   ];

   let number_of_mms = mm_accounts.len() / MM_ACCOUNTS_PER_MM;
   if number_of_mms > MAX_NUMBER_OF_MMS {
      log!("fill_bet: too many mm accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   }


   let mut mm_quotes = [const { MaybeUninit::<MMQuote>::uninit() }; MAX_NUMBER_OF_MMS];
   let mut valid_quote_count = 0usize;
   let mut previous_mms = [&SYSTEM_ID; MAX_NUMBER_OF_MMS];

   for i in 0..number_of_mms {
      // 0. program_id (readonly) - verified as executable
      // 1. mm_config_pda (readonly) - verified as owned by the mm program
      // 2. mm_event_state_pda (readonly) - validated by verify_event_state
      // 3. mm_market_data_pda (readonly) - validated by checking exists and owned by the mm program
      // 4. mm_quote_buffer (writable) - validated by verify_quote_buffer
      // 5. mm_encumbrance_pda (writable) - validated by verify_encumbrance_pda
      // 6. mm_liability_token_account (writable) - validated by verify_liability_token_account
      // 7. mm_token_account (writable) - validated by verify_token_account
      // 8. mm_netting_pda (writable), - validated by verify_netting_pda
      
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

      // Reject duplicate MMs
      if previous_mms[..i]
         .iter()
         .any(|prev| address_eq(mm_program_account.address(), *prev))
      {
         log!("fill_bet: duplicate mm program account");
         return Err(ProgramError::InvalidInstructionData);
      }
      previous_mms[i] = mm_program_account.address();


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
         &mm_program_account,
         &market_id,
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
         &mm_program_account,
         &market_id.event_id,
         &event_game_state,
         &event_state_sequence,
      );
      if !is_valid_event_state {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid event state");
         continue;
      }

      let is_valid_mm_netting_pda = verify_netting_pda_or_placeholder(
         mm_netting_pda,
         &mm_program_account,
         &market_id.event_id,
      );
      if !is_valid_mm_netting_pda {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid mm netting pda");
         continue;
      }

      // Get the quote via a CPI to the MM program and they will return the quote data from the ix
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
      let Ok(()) = get_quote_ix_data.write_wire(&mut get_quote_ix_buf) else {
         #[cfg(feature = "log")]
         log!("fill_bet: invalid get quote ix data");
         continue;
      };
      let get_quote_ix_accounts = [
         InstructionAccount::new(user.address(), false, false),
         InstructionAccount::new(clock_program.address(), false, false),
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
            clock_program.as_ref(),
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

      if max_amount == 0 && odds_scaled == 0 {
         continue;
      }

      if odds_scaled < min_odds_scaled {
         continue;
      }


      mm_quotes[valid_quote_count].write(MMQuote {
         max_amount,
         odds_scaled,
         mm_address: *mm_program_account.address(),
         mm_token_account,
         netting_pda: mm_netting_pda,
         mm_quote_buffer,
         mm_config_pda,
         mm_market_data_pda,
         encumbrance_pda_index: base + 5,
         encumbrance_pda_bump,
         mm_liability_token_account,
      });
      valid_quote_count += 1;
   }

   // SAFETY: `MMQuote` is `repr(C)`; exactly the first `valid_quote_count` `MaybeUninit` slots were
   // fully initialized in the loop above.
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

      #[cfg(feature = "log")]
      log!("fill_bet: amount to fill: {}", amount_to_fill);

      // we know the amount to fill is > 0 because the quote amount of 0 is filtered out
      // and if the remaining amount is = 0 then we already broke out of the loop

      // check if the mm has the free liability to cover the bet
      let Ok(mm_liability_account_balance_before) =
         get_token_account_balance(quote.mm_liability_token_account)
      else {
         #[cfg(feature = "log")]
         log!("fill_bet: failed to get mm liability account balance before");
         continue;
      };

      let Ok(mm_liability_account_balance_i64): Result<i64, _> =
         mm_liability_account_balance_before.try_into()
      else {
         #[cfg(feature = "log")]
         log!("fill_bet: failed to convert mm liability account balance before to i64");
         continue;
      };

      let mm_encumbrance_pda = &mut mm_accounts[quote.encumbrance_pda_index];

      let Ok(outstanding_liability) = get_encumbrance(&mm_encumbrance_pda) else {
         #[cfg(feature = "log")]
         log!("fill_bet: failed to get encumbrance");
         continue;
      };


      // Stage netting: compute the encumbrance delta and the on-chain mutation **without writing**.
      // The actual `apply_netting` write is deferred until after the MM `fill_quote` deposit is
      // confirmed below. This guarantees that a failed / mismatched fill cannot leave the netting
      // line shifted by a phantom bet (which would let later fills compute an under-collateralised
      // encumbrance delta against the polluted state).
      let netting_calc: Option<NettingCalc> =
         if !quote.netting_pda.is_data_empty() && market_id.is_pregame() {
            calculate_netting(
               quote.netting_pda,
               &market_id,
               side,
               amount_to_fill,
               quote.odds_scaled,
            )
         } else {
            None
         };
      let is_potentially_netted = netting_calc.is_some();
      let netting_delta_i64: i64 = netting_calc.map(|c| c.delta).unwrap_or(0);

      let Ok(gross_margin_u64) = calc_potential_profit(amount_to_fill, quote.odds_scaled) else {
         #[cfg(feature = "log")]
         log!("fill_bet: failed to calc potential profit");
         continue;
      };
      let gross_margin_i64: i64 = match gross_margin_u64.try_into() {
         Ok(v) => v,
         Err(_) => continue,
      };

      let encumbrance_delta_i64: i64 = if is_potentially_netted {
         netting_delta_i64
      } else {
         gross_margin_i64
      };

      let encumbered_i64: i64 = if outstanding_liability < 0 {
         0
      } else {
         outstanding_liability
      };
      let free_i64: i64 = mm_liability_account_balance_i64.saturating_sub(encumbered_i64);

      let shortfall_i64: i64 = encumbrance_delta_i64.saturating_sub(free_i64);
      let amount_to_send: u64 = if shortfall_i64 <= 0 {
         0u64
      } else {
         match shortfall_i64.try_into() {
            Ok(v) => v,
            Err(_) => continue,
         }
      };

      let new_outstanding_liability: i64 = match outstanding_liability.checked_add(encumbrance_delta_i64) {
         Some(v) => v,
         None => continue,
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
         quote.mm_config_pda.as_ref(),
         quote.mm_quote_buffer.as_ref(),
         quote.mm_token_account.as_ref(),
         quote.mm_liability_token_account.as_ref(),
         mint.as_ref(),
         token_program.as_ref(),
         instructions_sysvar.as_ref(),
      ];

      let fill_quote_ix = InstructionView {
         program_id: &quote.mm_address,
         accounts: &fill_quote_ix_account_metas,
         data: &fill_quote_ix_buf,
      };
      let Ok(()) = invoke(
         &fill_quote_ix,
         &fill_quote_invoke_accounts,
      ) else {
         continue;
      };

      //verify that they send the amount needed to cover the liability
      let Ok(mm_liability_account_balance_after) =
         get_token_account_balance(quote.mm_liability_token_account)
      else {
         continue;
      };

      let Some(mm_liability_token_account_increase) = mm_liability_account_balance_after
         .checked_sub(mm_liability_account_balance_before)
      else {
         continue;
      };

      if unlikely(mm_liability_token_account_increase != amount_to_send) {
         refund_liability_deposit_mismatch(
            mm_encumbrance_pda,
            quote.encumbrance_pda_bump,
            quote.mm_address,
            quote.mm_liability_token_account,
            quote.mm_token_account,
            amount_to_send,
            mm_liability_token_account_increase,
         )?;

         continue;
      }
   
      
      filled_amount = match filled_amount.checked_add(amount_to_fill) {
         Some(v) => v,
         None => continue,
      };

      let Ok(addl_payout) = calc_potential_payout(amount_to_fill, quote.odds_scaled) else {
         continue;
      };
      
      filled_payout = match filled_payout.checked_add(addl_payout) {
         Some(v) => v,
         None => continue,
      };

      if let Some(NettingCalc { write: netting_write, .. }) = netting_calc {
         apply_netting(quote.netting_pda, &netting_write)?;
      }

      unsafe {
         write_i64_le_unchecked(
            mm_encumbrance_pda.data_mut_ptr(),
            MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
            new_outstanding_liability
         );
      }

      bet_fillers[filler_count].write(BetFiller {
         mm_address: quote.mm_address,
         amount: amount_to_fill,
         odds_scaled: quote.odds_scaled,
         is_potentially_netted,
         encumbrance_delta: encumbrance_delta_i64,
      });
      filler_count += 1;

   }

   if unlikely(filled_amount == 0) {
      log!("fill_bet: no quotes were filled");
      return Err(ProgramError::InvalidInstructionData);
   }

   let mut finalized_bet_fillers: [BetFiller; MAX_NUMBER_OF_MMS] = core::array::from_fn(|_| BetFiller {
      mm_address: Address::new_from_array([0; 32]),
      amount: 0,
      odds_scaled: 0,
      is_potentially_netted: false,
      encumbrance_delta: 0,
   });
   for (index, filler) in finalized_bet_fillers.iter_mut().enumerate().take(filler_count) {
      // SAFETY: exactly the first `filler_count` entries were initialized in the loop above.
      *filler = unsafe { bet_fillers[index].assume_init_read() };
   }


   // create the bet PDA
   let (expected_bet_pda, bet_bump) = Address::find_program_address(&bet_pda_seed, &ID);
   if !address_eq(bet_pda.address(), &expected_bet_pda) {
      log!("fill_bet: bet pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }

   let bet_bump_bytes = [bet_bump];
   let bet_pda_signer_seed = [
      Seed::from(BET_ACCOUNT_SEED),
      Seed::from(user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];
   let bet_pda_signers = [Signer::from(&bet_pda_signer_seed)];

   let clock = Clock::from_account_view(clock_program)?;
   let timestamp_i64 = clock.unix_timestamp;
   let timestamp: u32 = timestamp_i64.try_into().map_err(|_| {
      log!("fill_bet: failed to convert timestamp to u32");
      ProgramError::InvalidAccountData
   })?;

   let bet_account_data = BetAccountData {
      discriminator: BET_ACCOUNT_DISCRIMINATOR,
      bump: bet_bump,
      event_state_sequence,
      side,
      owner: *user.address(),
      feepayer: *feepayer.address(),
      bet_id,
      amount: filled_amount,
      payout: filled_payout,
      market_id,
      event_game_state,
      timestamp,
      result: BetResult::Pending,
      filler_0: finalized_bet_fillers[0],
      filler_1: finalized_bet_fillers[1],
      filler_2: finalized_bet_fillers[2],
      filler_3: finalized_bet_fillers[3],
      filler_4: finalized_bet_fillers[4],
   };

   let lamports = get_rent_local(BET_ACCOUNT_LEN);
   CreateAccount {
      from: feepayer,
      to: bet_pda,
      lamports,
      space: BET_ACCOUNT_LEN,
      owner: &ID,
   }.invoke_signed(&bet_pda_signers)?;

   // write data to the bet account
   {
      let mut bet_pda_data = bet_pda.try_borrow_mut()?;
      bet_account_data.write_to_account(&mut bet_pda_data)?;
   }

   // create the bet ata
   Create {
      funding_account: feepayer,
      account: bet_ata,
      wallet: bet_pda,
      mint,
      system_program,
      token_program,
   }
   .invoke()?;
   
   verify_token_account(
      true, 
      bet_ata, 
      bet_pda, 
      mint, 
      token_program
   )?;

   // transfer the funds from the user to the bet ata
   Transfer::new(user_ata, bet_ata, user, filled_amount).invoke()?;

   Ok(())
}

//-----------------

use zeropod::{ZeroPod, ZeroPodFixed};

/// Fill-bet instruction payload (bytes after the router `Instruction` discriminator in `lib.rs`).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillBetIxData {
   pub bet_id: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
}

pub const FILL_BET_IX_DATA_LEN: usize = <FillBetIxData as ZeroPodFixed>::SIZE;

impl FillBetIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_BET_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         bet_id: zc.bet_id.get(),
         amount: zc.amount.get(),
         min_odds_scaled: zc.min_odds_scaled.get(),
         event_state_sequence: zc.event_state_sequence.get(),
         side: zc.side,
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
      })
   }

   /// Serialize for tests / off-chain tx builders (mirrors [`GetQuoteIxData::write_wire`]).
   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != FILL_BET_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillBetIxDataZc {
         bet_id: self.bet_id.into(),
         market_id: self.market_id.to_zc(),
         side: self.side,
         amount: self.amount.into(),
         min_odds_scaled: self.min_odds_scaled.into(),
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}
