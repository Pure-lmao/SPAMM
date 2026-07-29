//! Signed-quote RFQ fill for a parlay (one MM, no quote buffer).
//!
//! Accounts: **12** fixed + **5** MM + **2 × L** leg PDAs (same fixed prefix as [`super::fill_parlay`]).
//! **Fixed (12)**
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
//! **MM (5) + legs**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_encumbrance_pda` (writable)
//! 3. `mm_liability_token_account` (writable)
//! 4. `mm_token_account` (writable)
//! 5+2*i. `mm_market_data_pda` (writable), `mm_event_state_pda` (readonly) per leg

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer, invoke},
   error::ProgramError, hint::unlikely,
   instruction::{InstructionAccount, InstructionView},
   sysvars::clock::Clock,
};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   ID,
   helpers::{
      calc_potential_payout, calc_potential_profit, get_rent_local, verify_associated_token_program,
      verify_config_pda, verify_event_state, verify_instructions_sysvar, verify_mint,
      verify_mm_config_pda, verify_mm_encumbrance_pda, verify_mm_market_data_pda,
      verify_mm_program_executable, verify_signer, verify_system_program, verify_token_account,
      verify_token_program,
   },
   instructions::fill_helpers::{compute_liability_shortfall, ensure_bet_pda_unused},
   parsers::{get_encumbrance, get_token_account_balance, validate_fill_rfq_parlay_ix},
   parlay_helpers::force_placeholder_legs_after,
   rfq_verify::verify_rfq_ed25519_signature,
   state::{
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR, FillRfqIxData, MM_CONFIG_PDA_RFQ_SIGNER_OFFSET, ParlayLegTable,
      ParlayLegWire, PARLAY_BET_ACCOUNT_DISCRIMINATOR, PARLAY_BET_ACCOUNT_LEN, PARLAY_BET_ACCOUNT_SEED,
      ParlayBetAccountData, build_rfq_parlay_message, account_bet::BetResult,
      other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, rfq_message::RFQ_PARLAY_MESSAGE_LEN,
   },
   writers::write_i64_le_unchecked,
};

pub const FILL_RFQ_PARLAY_IX_DISCRIMINATOR: u8 = 13;

const SIGNATURE_LEN: usize = 64;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillRfqParlayIxData {
   pub bet_id: u64,
   pub amount: u64,
   pub num_legs: u8,
   pub legs: ParlayLegTable,
   pub max_stake: u64,
   pub odds_scaled: u32,
   pub offer_expiry: u32,
}

pub const FILL_RFQ_PARLAY_IX_BODY_LEN: usize = <FillRfqParlayIxData as ZeroPodFixed>::SIZE;
pub const FILL_RFQ_PARLAY_IX_DATA_LEN: usize = FILL_RFQ_PARLAY_IX_BODY_LEN + SIGNATURE_LEN;

impl FillRfqParlayIxData {
   #[inline(always)]
   pub fn decode_with_signature(data: &[u8]) -> Result<(Self, [u8; 64]), ProgramError> {
      if data.len() != FILL_RFQ_PARLAY_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(&data[..FILL_RFQ_PARLAY_IX_BODY_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok((
         Self {
            bet_id: zc.bet_id.get(),
            amount: zc.amount.get(),
            num_legs: zc.num_legs,
            legs: ParlayLegTable {
               leg_0: ParlayLegWire::from_zc(&zc.legs.leg_0).ok_or(ProgramError::InvalidInstructionData)?,
               leg_1: ParlayLegWire::from_zc(&zc.legs.leg_1).ok_or(ProgramError::InvalidInstructionData)?,
               leg_2: ParlayLegWire::from_zc(&zc.legs.leg_2).ok_or(ProgramError::InvalidInstructionData)?,
               leg_3: ParlayLegWire::from_zc(&zc.legs.leg_3).ok_or(ProgramError::InvalidInstructionData)?,
               leg_4: ParlayLegWire::from_zc(&zc.legs.leg_4).ok_or(ProgramError::InvalidInstructionData)?,
            },
            max_stake: zc.max_stake.get(),
            odds_scaled: zc.odds_scaled.get(),
            offer_expiry: zc.offer_expiry.get(),
         },
         {
            let mut sig = [0u8; 64];
            sig.copy_from_slice(&data[FILL_RFQ_PARLAY_IX_BODY_LEN..]);
            sig
         },
      ))
   }

   #[inline(always)]
   pub fn write_wire_with_signature(&self, signature: &[u8; 64], out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != FILL_RFQ_PARLAY_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillRfqParlayIxDataZc {
         bet_id: self.bet_id.into(),
         amount: self.amount.into(),
         num_legs: self.num_legs,
         legs: self.legs.to_zc(),
         max_stake: self.max_stake.into(),
         odds_scaled: self.odds_scaled.into(),
         offer_expiry: self.offer_expiry.into(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      out[FILL_RFQ_PARLAY_IX_BODY_LEN..].copy_from_slice(signature);
      Ok(())
   }
}

#[inline(never)]
fn verify_rfq_parlay_ed25519(
   user: &Address,
   mm_program: &Address,
   mm_config_pda: &AccountView,
   parsed_ix: &FillRfqParlayIxData,
   signature: &[u8; 64],
) -> Result<(), ProgramError> {
   let rfq_signer = unsafe {
      *(mm_config_pda.data_ptr().add(MM_CONFIG_PDA_RFQ_SIGNER_OFFSET) as *const Address)
   };
   let mut message = [0u8; RFQ_PARLAY_MESSAGE_LEN];
   build_rfq_parlay_message(
      &mut message,
      user,
      parsed_ix.bet_id,
      parsed_ix.num_legs,
      &parsed_ix.legs,
      parsed_ix.max_stake,
      parsed_ix.odds_scaled,
      parsed_ix.offer_expiry,
      mm_program,
   )?;
   verify_rfq_ed25519_signature(&rfq_signer, signature, &message)
}

#[inline(never)]
fn create_parlay_bet_after_rfq_fill(
   feepayer: &AccountView,
   user: &AccountView,
   user_ata: &AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   system_program: &AccountView,
   mm_program_account: &AccountView,
   clock_unix_timestamp: i64,
   bet_id: u64,
   amount: u64,
   odds_scaled: u32,
   num_legs_u8: u8,
   mut legs: ParlayLegTable,
) -> ProgramResult {
   force_placeholder_legs_after(num_legs_u8 as usize, &mut legs);

   let filled_payout = calc_potential_payout(amount, odds_scaled)?;
   let bet_id_bytes = bet_id.to_le_bytes();
   let bet_pda_seed = [PARLAY_BET_ACCOUNT_SEED, user.address().as_ref(), bet_id_bytes.as_slice()];
   let (expected_bet_pda, bet_bump) = Address::find_program_address(&bet_pda_seed, &ID);
   if !address_eq(bet_pda.address(), &expected_bet_pda) {
      log!("fill_rfq_parlay: bet pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }

   let bet_bump_bytes = [bet_bump];
   let bet_pda_seed_refs = [
      Seed::from(PARLAY_BET_ACCOUNT_SEED),
      Seed::from(user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];
   let bet_pda_signers = [Signer::from(&bet_pda_seed_refs)];

   let timestamp: u32 = clock_unix_timestamp.try_into().map_err(|_| {
      log!("fill_rfq_parlay: failed to convert timestamp to u32");
      ProgramError::InvalidAccountData
   })?;
   let bet_account_data = ParlayBetAccountData {
      discriminator: PARLAY_BET_ACCOUNT_DISCRIMINATOR,
      bump: bet_bump,
      owner: *user.address(),
      feepayer: *feepayer.address(),
      bet_id,
      amount,
      payout: filled_payout,
      timestamp,
      filler_address: *mm_program_account.address(),
      result: BetResult::Pending,
      num_legs: num_legs_u8,
      legs,
   };

   CreateAccount {
      from: feepayer,
      to: bet_pda,
      lamports: get_rent_local(PARLAY_BET_ACCOUNT_LEN),
      space: PARLAY_BET_ACCOUNT_LEN,
      owner: &ID,
   }
   .invoke_signed(&bet_pda_signers)?;

   {
      let mut bet_pda_data = bet_pda.try_borrow_mut()?;
      bet_account_data.write_to_account(&mut bet_pda_data)?;
   }

   Create {
      funding_account: feepayer,
      account: bet_ata,
      wallet: bet_pda,
      mint,
      system_program,
      token_program,
   }
   .invoke()?;

   verify_token_account(true, bet_ata, bet_pda, mint, token_program)?;
   Transfer::new(user_ata, bet_ata, user, amount).invoke()?;
   Ok(())
}

#[inline(never)]
pub fn fill_rfq_parlay(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
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
      mm_program_account, //verified by verify_mm_program_executable
      mm_config_pda, //verified by verify_mm_config_pda
      mm_encumbrance_pda, //verified by verify_mm_encumbrance_pda
      mm_liability_token_account, //verified by verify_token_account
      mm_token_account, //verified by verify_token_account
      leg_accounts @ .., //verified per-leg below
   ] = accounts else {
      log!("fill_rfq_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&feepayer)?;
   verify_signer(&user)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_system_program(system_program)?;
   verify_instructions_sysvar(instructions_sysvar)?;
   verify_mint(mint)?;
   verify_token_account(true, user_ata, user, mint, token_program)?;
   verify_config_pda(config_pda, true)?;
   ensure_bet_pda_unused(bet_pda, "fill_rfq_parlay")?;

   let (parsed_ix, signature) = FillRfqParlayIxData::decode_with_signature(data)?;
   let (bet_id, amount, odds_scaled, num_legs_u8) = validate_fill_rfq_parlay_ix(&parsed_ix)?;
   let num_legs = num_legs_u8 as usize;

   let expected_leg_accounts = num_legs.saturating_mul(2);
   if leg_accounts.len() != expected_leg_accounts {
      log!("fill_rfq_parlay: leg accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }

   let clock = Clock::from_account_view(clock_program)?;
   if unlikely(clock.unix_timestamp > i64::from(parsed_ix.offer_expiry)) {
      log!("fill_rfq_parlay: quote expired");
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_mm_program_executable(mm_program_account)?;
   if unlikely(!verify_mm_config_pda(mm_config_pda, mm_program_account)) {
      log!("fill_rfq_parlay: invalid mm config pda");
      return Err(ProgramError::InvalidAccountData);
   }

   verify_rfq_parlay_ed25519(
      user.address(),
      mm_program_account.address(),
      mm_config_pda,
      &parsed_ix,
      &signature,
   )?;

   if unlikely(!verify_token_account(false, mm_token_account, mm_config_pda, mint, token_program)?) {
      log!("fill_rfq_parlay: invalid mm token account");
      return Err(ProgramError::InvalidAccountData);
   }
   if verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program_account).is_none() {
      log!("fill_rfq_parlay: invalid encumbrance pda");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!verify_token_account(
      false,
      mm_liability_token_account,
      mm_encumbrance_pda,
      mint,
      token_program,
   )?) {
      log!("fill_rfq_parlay: invalid mm liability token account");
      return Err(ProgramError::InvalidAccountData);
   }

   for (leg_i, leg_pair) in leg_accounts.chunks_exact(2).enumerate().take(num_legs) {
      let market_data_pda = &leg_pair[0];
      let event_state_pda = &leg_pair[1];
      let Some(leg) = parsed_ix.legs.get(leg_i) else {
         log!("fill_rfq_parlay: missing leg {}", leg_i);
         return Err(ProgramError::InvalidInstructionData);
      };
      if unlikely(!verify_mm_market_data_pda(market_data_pda, mm_program_account, &leg.market_id)) {
         log!("fill_rfq_parlay: invalid market data pda");
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(!verify_event_state(
         event_state_pda,
         mm_program_account,
         &leg.market_id.event_id,
         &leg.event_game_state,
         &leg.event_state_sequence,
      )) {
         log!("fill_rfq_parlay: invalid event state");
         return Err(ProgramError::InvalidAccountData);
      }
   }

   let Ok(mm_liability_account_balance_before) = get_token_account_balance(mm_liability_token_account) else {
      log!("fill_rfq_parlay: failed to read liability balance");
      return Err(ProgramError::InvalidAccountData);
   };
   let Ok(outstanding_liability) = get_encumbrance(mm_encumbrance_pda) else {
      log!("fill_rfq_parlay: failed to read encumbrance");
      return Err(ProgramError::InvalidAccountData);
   };

   let Ok(gross_margin_u64) = calc_potential_profit(amount, odds_scaled) else {
      log!("fill_rfq_parlay: failed to calc potential profit");
      return Err(ProgramError::InvalidInstructionData);
   };
   let gross_margin_i64: i64 = gross_margin_u64.try_into().map_err(|_| {
      log!("fill_rfq_parlay: gross margin does not fit i64");
      ProgramError::InvalidInstructionData
   })?;

   let (amount_to_send, new_outstanding_liability) = compute_liability_shortfall(
      mm_liability_account_balance_before,
      outstanding_liability,
      gross_margin_i64,
   )?;

   let fill_ix_data = FillRfqIxData {
      instruction_discriminator: FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
      amount_to_send,
   };
   let mut fill_ix_buf = [0u8; FillRfqIxData::WIRE_LEN];
   fill_ix_data.write_wire(&mut fill_ix_buf)?;

   let fill_rfq_ix_account_metas = [
      InstructionAccount::new(user.address(), false, false),
      InstructionAccount::new(mm_config_pda.address(), true, false),
      InstructionAccount::new(mm_token_account.address(), true, false),
      InstructionAccount::new(mm_liability_token_account.address(), true, false),
      InstructionAccount::new(mint.address(), false, false),
      InstructionAccount::new(token_program.address(), false, false),
      InstructionAccount::new(instructions_sysvar.address(), false, false),
   ];
   let fill_rfq_invoke_accounts = [
      user.as_ref(),
      mm_config_pda.as_ref(),
      mm_token_account.as_ref(),
      mm_liability_token_account.as_ref(),
      mint.as_ref(),
      token_program.as_ref(),
      instructions_sysvar.as_ref(),
   ];
   invoke(
      &InstructionView {
         program_id: mm_program_account.address(),
         accounts: &fill_rfq_ix_account_metas,
         data: &fill_ix_buf,
      },
      &fill_rfq_invoke_accounts,
   )?;

   let Ok(mm_liability_account_balance_after) = get_token_account_balance(mm_liability_token_account) else {
      log!("fill_rfq_parlay: failed to read liability balance after CPI");
      return Err(ProgramError::InvalidAccountData);
   };
   let Some(mm_liability_token_account_increase) =
      mm_liability_account_balance_after.checked_sub(mm_liability_account_balance_before)
   else {
      log!("fill_rfq_parlay: liability balance decreased");
      return Err(ProgramError::InvalidInstructionData);
   };
   if unlikely(mm_liability_token_account_increase != amount_to_send) {
      log!("fill_rfq_parlay: liability deposit mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   unsafe {
      write_i64_le_unchecked(
         mm_encumbrance_pda.data_mut_ptr(),
         MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
         new_outstanding_liability,
      );
   }

   create_parlay_bet_after_rfq_fill(
      feepayer,
      user,
      user_ata,
      bet_pda,
      bet_ata,
      mint,
      token_program,
      system_program,
      mm_program_account,
      clock.unix_timestamp,
      bet_id,
      amount,
      odds_scaled,
      num_legs_u8,
      parsed_ix.legs,
   )
}
