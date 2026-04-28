//! Loop over the MMs and get their quotes for the bet then fill the bet from best to worst
//! CPI into the fill_bet function and update the outstanding liability amount for each MM and create the bet PDA
//!
//! Accounts: **10** then **7 × N** per MM (`N` = number of market makers).
//!
//! **(10)**
//! 0. `feepayer` (writable signer)
//! 1. `user` (signer)
//! 2. `user_ata` (writable)
//! 3. `bet_pda` (writable)
//! 4. `bet_ata` (writable)
//! 5. `config_pda` (readonly)
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)
//! 8. `associated_token_program` (readonly)
//! 9. `system_program` (readonly)
//!
//! **Per MM (7 each)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (readonly)
//! 2. `mm_event_state_pda` (readonly)
//! 3. `mm_market_data_pda` (readonly)
//! 4. `mm_quote_buffer` (writable)
//! 5. `mm_liability_pda` (writable)
//! 6. `mm_token_account` (writable)
//! 7. `mm_netting_pda` (writable);
//!
//! Data (after router discriminator in `lib.rs`): `[
//!   bet_id (u64),
//!   market_id (MarketId),
//!   side (u8),
//!   amount (u64),
//!   min_odds_scaled (u32),
//!   event_state_sequence (u16),
//!   event_state_hash ([u8; 32]),
//! ]`

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer, get_return_data, invoke}, error::ProgramError, hint::{likely, unlikely}, instruction::{InstructionAccount, InstructionView}
};

use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;
use crate::{ID, 
   constants::{MAX_NUMBER_OF_MMS}, 
   helpers::{calc_potential_profit, get_rent_local, verify_config_pda, verify_event_state, verify_mint, verify_mm_config_pda, verify_mm_market_data_pda, verify_netting_pda, verify_quote_buffer, verify_signer, verify_system_program, verify_token_account, verify_token_program}, 
   parsers::{get_token_account_balance, parse_fill_bet_data, parse_quote_data}, 
   state::{
      BET_ACCOUNT_DISCRIMINATOR, BET_ACCOUNT_LEN, BET_ACCOUNT_SEED, BetAccountData, BetFiller, FILL_QUOTE_IX_DISCRIMINATOR, FillQuoteIxData, GET_QUOTE_IX_DISCRIMINATOR, GetQuoteIxData, MMQuote, MarketId, account_bet::BetResult, account_netting::apply_netting
   },
};


pub const FILL_BET_IX_DISCRIMINATOR: u8 = 3;

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
      system_program, //verified by equ const
      mm_accounts @ ..,
   ] = accounts else {
      log!("fill_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if mm_accounts.len() < 7 || mm_accounts.len() % 7 != 0 {
      log!("fill_bet: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   // -----ACCOUNT VERIFICATION-----
   verify_signer(&feepayer)?;
   verify_signer(&user)?;
   verify_token_program(&token_program)?;
   verify_system_program(&system_program)?;
   verify_mint(&mint)?;
   verify_token_account(true, user_ata, user, mint, token_program)?;
   verify_config_pda(&config_pda, true)?;

   // Values are validated by the parser.
   let parsed_data = parse_fill_bet_data(data)?;
   let bet_id = parsed_data.bet_id;
   let amount = parsed_data.amount;
   let min_odds_scaled = parsed_data.min_odds_scaled;
   let market_id = parsed_data.market_id;
   let side = parsed_data.side;
   let event_state_hash = parsed_data.event_state_hash;
   let event_state_sequence = parsed_data.event_state_sequence;

   let bet_id_bytes = bet_id.to_le_bytes();
   let bet_pda_seed = [
      BET_ACCOUNT_SEED, 
      user.address().as_ref(), 
      &bet_id_bytes
   ];

   let number_of_mms = mm_accounts.len() / 7;
   if number_of_mms > MAX_NUMBER_OF_MMS {
      log!("fill_bet: too many mm accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   }


   let mut mm_quotes = [const { MaybeUninit::<MMQuote>::uninit() }; MAX_NUMBER_OF_MMS];
   let mut valid_quote_count = 0usize;

   for i in 0..number_of_mms {
      // 0. program_id (readonly) - verified as executable
      // 1. mm_config_pda (readonly) - verified as owned by the mm program
      // 1. mm_event_state_pda (readonly) - validated by verify_event_state
      // 2. mm_market_data_pda (readonly) - validated by checking exists and owned by the mm program
      // 3. mm_quote_buffer (writable) - validated by verify_quote_buffer
      // 4. mm_liability_token_account (writable) - validated by verify_liability_token_account
      // 5. mm_token_account (writable) - validated by verify_token_account
      // 6. mm_netting_pda (writable), - validated by verify_netting_pda
      
      let this_mm_accounts = &mm_accounts[i * 7..(i + 1) * 7];

      let [
         mm_program_account,
         mm_config_pda,
         mm_event_state_pda,
         mm_market_data_pda,
         mm_quote_buffer,
         mm_liability_token_account,
         mm_token_account,
         mm_netting_pda,
      ] = this_mm_accounts else {
         log!("fill_bet: mm accounts mismatch");
         return Err(ProgramError::NotEnoughAccountKeys);
      };

      let is_valid_mm_config_pda = verify_mm_config_pda(
         mm_config_pda,
         &mm_program_account,
      );
      if !is_valid_mm_config_pda {
         continue;
      }

      let is_valid_quote_buffer = verify_quote_buffer(
         mm_quote_buffer,
         mm_program_account,
      );
      if !is_valid_quote_buffer {
         continue;
      }

      let is_valid_market_data_pda = verify_mm_market_data_pda(
         mm_market_data_pda,
         &mm_program_account,
         &market_id,
      );
      if !is_valid_market_data_pda {
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
         continue;
      }

      let is_valid_mm_liability_token_account = verify_token_account(
         false,
         &mm_liability_token_account, 
         &config_pda, 
         mint, 
         token_program, 
      )?;
      if !is_valid_mm_liability_token_account {
         continue;
      }

      let is_valid_event_state = verify_event_state(
         mm_event_state_pda,
         &mm_program_account,
         &market_id.event_id,
         &event_state_hash,
         &event_state_sequence,
      );
      if !is_valid_event_state {
         continue;
      }

      let is_valid_mm_netting_pda = verify_netting_pda(
         mm_netting_pda,
         &mm_program_account,
         &market_id.event_id,
      );
      if !is_valid_mm_netting_pda {
         continue;
      }

      // Get the quote via a CPI to the MM program and they will return the quote data from the ix
      let get_quote_ix_data = GetQuoteIxData {
         instruction_discriminator: GET_QUOTE_IX_DISCRIMINATOR,
         amount,
         odds_scaled: min_odds_scaled,
         market_id,
         side,
         event_state_hash,
         event_state_sequence,
      };
      let mut get_quote_ix_buf = [0u8; GetQuoteIxData::WIRE_LEN];
      let result = get_quote_ix_data.write_wire(&mut get_quote_ix_buf);
      if result.is_err() {
         continue;
      }
      let get_quote_ix_accounts = [
         InstructionAccount::new(user.address(), false, false),
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
      let result = invoke(
         &get_quote_ix,
         &[
            user.as_ref(), 
            mm_market_data_pda.as_ref(),
            mm_event_state_pda.as_ref(),
            mm_config_pda.as_ref(),
            mm_quote_buffer.as_ref(),
         ],
      );
      if result.is_err() {
         continue;
      }

      let mut max_amount = 0;
      let mut odds_scaled = 0;
      let maybe_retun_data = get_return_data();
      if maybe_retun_data.is_none() {
         continue;
      }

      let return_data = maybe_retun_data.unwrap();
      if likely(address_eq(return_data.program_id(), &mm_program_account.address())) {
         let result = parse_quote_data(return_data.as_slice());
         if result.is_err() {
            continue;
         }
         (max_amount, odds_scaled) = result.unwrap();
      }

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
      if remaining_amount == 0 {
         break;
      }
      let amount_to_fill = if quote.max_amount > remaining_amount {
         remaining_amount
      } else {
         quote.max_amount
      };

      // we know the amount to fill is > 0 because the quote amount of 0 is filtered out
      // and if the remaining amount is = 0 then we already broke out of the loop

      // get the mm token balance so we can tell they will be able to pay the liability
      let maybe_mm_token_account_balance = get_token_account_balance(quote.mm_token_account);
      let mm_token_account_balance = if maybe_mm_token_account_balance.is_err() {
         continue;
      } else {
         maybe_mm_token_account_balance.unwrap()
      };

      let maybe_mm_liability_token_account_balance_before = get_token_account_balance(quote.mm_liability_token_account);
      let mm_liability_token_account_balance_before: i64 = if maybe_mm_liability_token_account_balance_before.is_err() {
         continue;
      } else {
         let bal = maybe_mm_liability_token_account_balance_before.unwrap().try_into();
         if bal.is_err() {
            continue;
         }
         bal.unwrap()
      };

      let bet_liability = calc_potential_profit(amount_to_fill, quote.odds_scaled)?;

      // apply netting adjustments when a netting PDA is present
      let excess_liability = if !quote.netting_pda.is_data_empty() {
         // quote referenced a valid netting PDA; reduce reserved exposure when netting allows
         if market_id.is_pregame() {
            apply_netting(
               quote.netting_pda, 
               &market_id, side, 
               amount_to_fill, 
               quote.odds_scaled
            )
         } else {
            0u64
         }
      } else {
         0u64
      };

      let bet_liability_i64: i64 = bet_liability.try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;
      let excess_liability_i64: i64 = excess_liability.try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;
      let liability_increase: i64 = bet_liability_i64.checked_sub(excess_liability_i64).ok_or_else(|| ProgramError::ArithmeticOverflow)?;


      let (amount_to_send, amount_back_to_mm) = if liability_increase > 0 {
         let liability_increase_u64 = liability_increase as u64;
         if liability_increase_u64 > mm_token_account_balance {
            continue;
         }
         (liability_increase_u64, 0u64)
      } else {
         (0u64, (-liability_increase) as u64)
      };
  
      let fill_quote_ix_data = FillQuoteIxData {
         instruction_discriminator: FILL_QUOTE_IX_DISCRIMINATOR,
         side,
         event_state_sequence,
         amount_to_fill,
         odds_scaled: quote.odds_scaled,
         market_id,
         event_state_hash,
         amount_to_send,
      };
      let mut fill_quote_ix_buf = [0u8; FillQuoteIxData::WIRE_LEN];
      let result = fill_quote_ix_data.write_wire(&mut fill_quote_ix_buf);
      if result.is_err() {
         continue;
      }

      let fill_quote_ix_account_metas = [
         InstructionAccount::new(user.address(), false, false),
         InstructionAccount::new(quote.mm_market_data_pda.address(), true, false),
         InstructionAccount::new(quote.mm_config_pda.address(), true, false),
         InstructionAccount::new(quote.mm_quote_buffer.address(), true, false),
         InstructionAccount::new(quote.mm_token_account.address(), true, false),
         InstructionAccount::new(quote.mm_liability_token_account.address(), true, false),
      ];

      let fill_quote_invoke_accounts = [
         user.as_ref(),
         quote.mm_market_data_pda.as_ref(),
         quote.mm_config_pda.as_ref(),
         quote.mm_quote_buffer.as_ref(),
         quote.mm_token_account.as_ref(),
         quote.mm_liability_token_account.as_ref(),
      ];

      let fill_quote_ix = InstructionView {
         program_id: &quote.mm_address,
         accounts: &fill_quote_ix_account_metas,
         data: &fill_quote_ix_buf,
      };
      let result = invoke(
         &fill_quote_ix,
         &fill_quote_invoke_accounts,
      );
      if result.is_err() {
         continue;
      }

      // transfer back any netting exposure to the mm token account
      if amount_back_to_mm > 0 {
         Transfer::new(
            quote.mm_liability_token_account,
            quote.mm_token_account,
            &config_pda,
            amount_back_to_mm,
         ).invoke()?;
      }

      //verify that they send the amount needed to cover the liability
      let maybe_mm_liability_token_account_balance_after = get_token_account_balance(quote.mm_liability_token_account);
      let mm_liability_token_account_balance_after: i64 = if maybe_mm_liability_token_account_balance_after.is_err() {
         continue;
      } else {
         let bal = maybe_mm_liability_token_account_balance_after.unwrap().try_into();
         if bal.is_err() {
            continue;
         }
         bal.unwrap()
      };

      let expected_liability_token_account_balance = mm_liability_token_account_balance_before.checked_add(liability_increase);
      if expected_liability_token_account_balance.is_none() {
         continue;
      }

      if mm_liability_token_account_balance_after < expected_liability_token_account_balance.unwrap() {
         continue;
      }
      
      filled_amount += amount_to_fill;

      let new_payout = calc_potential_profit(amount_to_fill, quote.odds_scaled);
      if new_payout.is_err() {
         continue;
      }
      filled_payout += new_payout.unwrap();

      bet_fillers[filler_count].write(BetFiller {
         mm_address: quote.mm_address,
         amount: amount_to_fill,
         odds_scaled: quote.odds_scaled,
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
      event_state_hash,
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
   }
   .invoke_signed(&bet_pda_signers)
   .map_err(|e| {
      log!("create_user_vault: create account failed");
      e
   })?;

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
pub struct FillBetIxData {
   pub bet_id: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub event_state_sequence: u16,
   pub event_state_hash: [u8; 32],
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
         event_state_hash: zc.event_state_hash,
      })
   }
}

const _: () = assert!(FILL_BET_IX_DATA_LEN == 82);