//! Signed-quote RFQ fill for a single bet (one MM, no quote buffer).
//!
//! Accounts: **12** fixed + **8** MM (same fixed prefix as [`super::fill_parlay`]).
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
//! **MM (8)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_event_state_pda` (readonly)
//! 3. `mm_market_data_pda` (writable) — passed through to MM `fill_bet_rfq` for future market updates
//! 4. `mm_encumbrance_pda` (writable)
//! 5. `mm_liability_token_account` (writable)
//! 6. `mm_token_account` (writable)
//! 7. `mm_netting_pda` (writable) — real netting PDA, or system program if none

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
      verify_mm_program_executable, verify_netting_pda_or_placeholder, verify_signer,
      verify_system_program, verify_token_account, verify_token_program,
   },
   instructions::fill_helpers::{compute_liability_shortfall, ensure_bet_pda_unused},
   parsers::{get_encumbrance, get_token_account_balance, parse_fill_rfq_bet_data},
   rfq_verify::verify_rfq_ed25519_signature,
   state::{
      BET_ACCOUNT_DISCRIMINATOR, BET_ACCOUNT_LEN, BET_ACCOUNT_SEED, BetAccountData, BetFiller,
      EventGameState, FILL_BET_RFQ_IX_DISCRIMINATOR, FillRfqIxData, MarketId, MM_CONFIG_PDA_RFQ_SIGNER_OFFSET,
      account_bet::BetResult,
      account_netting::{NettingCalc, apply_netting, calculate_netting},
      build_rfq_bet_message,
      other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
      rfq_message::RFQ_BET_MESSAGE_LEN,
   },
   writers::write_i64_le_unchecked,
};

pub const FILL_RFQ_BET_IX_DISCRIMINATOR: u8 = 12;

const SIGNATURE_LEN: usize = 64;

/// Router payload for `fill_rfq_bet` (quote fields + ed25519 signature).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillRfqBetIxData {
   pub bet_id: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub amount: u64,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
   pub max_stake: u64,
   pub odds_scaled: u32,
   pub offer_expiry: u32,
}

pub const FILL_RFQ_BET_IX_BODY_LEN: usize = <FillRfqBetIxData as ZeroPodFixed>::SIZE;
pub const FILL_RFQ_BET_IX_DATA_LEN: usize = FILL_RFQ_BET_IX_BODY_LEN + SIGNATURE_LEN;

impl FillRfqBetIxData {
   #[inline(always)]
   pub fn decode_with_signature(data: &[u8]) -> Result<(Self, [u8; 64]), ProgramError> {
      if data.len() != FILL_RFQ_BET_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(&data[..FILL_RFQ_BET_IX_BODY_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let parsed = Self {
         bet_id: zc.bet_id.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         side: zc.side,
         amount: zc.amount.get(),
         event_state_sequence: zc.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
         max_stake: zc.max_stake.get(),
         odds_scaled: zc.odds_scaled.get(),
         offer_expiry: zc.offer_expiry.get(),
      };
      let mut sig = [0u8; 64];
      sig.copy_from_slice(&data[FILL_RFQ_BET_IX_BODY_LEN..]);
      Ok((parsed, sig))
   }

   #[inline(always)]
   pub fn write_wire_with_signature(&self, signature: &[u8; 64], out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != FILL_RFQ_BET_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillRfqBetIxDataZc {
         bet_id: self.bet_id.into(),
         market_id: self.market_id.to_zc(),
         side: self.side,
         amount: self.amount.into(),
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
         max_stake: self.max_stake.into(),
         odds_scaled: self.odds_scaled.into(),
         offer_expiry: self.offer_expiry.into(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      out[FILL_RFQ_BET_IX_BODY_LEN..].copy_from_slice(signature);
      Ok(())
   }
}

#[inline(never)]
fn verify_rfq_bet_ed25519(
   user: &Address,
   mm_program: &Address,
   mm_config_pda: &AccountView,
   parsed: &FillRfqBetIxData,
   signature: &[u8; 64],
) -> Result<(), ProgramError> {
   let rfq_signer = unsafe {
      *(mm_config_pda.data_ptr().add(MM_CONFIG_PDA_RFQ_SIGNER_OFFSET) as *const Address)
   };
   let mut message = [0u8; RFQ_BET_MESSAGE_LEN];
   build_rfq_bet_message(
      &mut message,
      user,
      parsed.bet_id,
      &parsed.market_id,
      &parsed.event_game_state,
      parsed.event_state_sequence,
      parsed.side,
      parsed.max_stake,
      parsed.odds_scaled,
      parsed.offer_expiry,
      mm_program,
   )?;
   verify_rfq_ed25519_signature(&rfq_signer, signature, &message)
}

#[inline(never)]
pub fn fill_rfq_bet(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
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
      mm_event_state_pda, //verified by verify_event_state
      mm_market_data_pda, //verified by verify_mm_market_data_pda
      mm_encumbrance_pda, //verified by verify_mm_encumbrance_pda
      mm_liability_token_account, //verified by verify_token_account
      mm_token_account, //verified by verify_token_account
      mm_netting_pda, //verified by verify_netting_pda_or_placeholder
   ] = accounts else {
      log!("fill_rfq_bet: accounts mismatch");
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
   ensure_bet_pda_unused(bet_pda, "fill_rfq_bet")?;

   let (parsed, signature) = FillRfqBetIxData::decode_with_signature(data)?;
   parse_fill_rfq_bet_data(&parsed)?;

   let bet_id = parsed.bet_id;
   let amount = parsed.amount;
   let market_id = parsed.market_id;
   let side = parsed.side;
   let event_game_state = parsed.event_game_state;
   let event_state_sequence = parsed.event_state_sequence;
   let odds_scaled = parsed.odds_scaled;

   let clock = Clock::from_account_view(clock_program)?;
   if unlikely(clock.unix_timestamp > i64::from(parsed.offer_expiry)) {
      log!("fill_rfq_bet: quote expired");
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_mm_program_executable(mm_program_account)?;
   let mm_address = *mm_program_account.address();

   if unlikely(!verify_mm_config_pda(mm_config_pda, mm_program_account)) {
      log!("fill_rfq_bet: invalid mm config pda");
      return Err(ProgramError::InvalidAccountData);
   }

   verify_rfq_bet_ed25519(
      user.address(),
      mm_program_account.address(),
      mm_config_pda,
      &parsed,
      &signature,
   )?;

   if unlikely(!verify_mm_market_data_pda(mm_market_data_pda, mm_program_account, &market_id)) {
      log!("fill_rfq_bet: invalid market data pda");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!verify_event_state(
      mm_event_state_pda,
      mm_program_account,
      &market_id.event_id,
      &event_game_state,
      &event_state_sequence,
   )) {
      log!("fill_rfq_bet: invalid event state");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!verify_token_account(false, mm_token_account, mm_config_pda, mint, token_program)?) {
      log!("fill_rfq_bet: invalid mm token account");
      return Err(ProgramError::InvalidAccountData);
   }

   if verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program_account).is_none() {
      log!("fill_rfq_bet: invalid encumbrance pda");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!verify_token_account(
      false,
      mm_liability_token_account,
      mm_encumbrance_pda,
      mint,
      token_program,
   )?) {
      log!("fill_rfq_bet: invalid mm liability token account");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!verify_netting_pda_or_placeholder(mm_netting_pda, mm_program_account, &market_id.event_id)) {
      log!("fill_rfq_bet: invalid netting pda");
      return Err(ProgramError::InvalidAccountData);
   }

   let Ok(mm_liability_account_balance_before) = get_token_account_balance(mm_liability_token_account) else {
      log!("fill_rfq_bet: failed to read liability balance");
      return Err(ProgramError::InvalidAccountData);
   };

   let Ok(outstanding_liability) = get_encumbrance(mm_encumbrance_pda) else {
      log!("fill_rfq_bet: failed to read encumbrance");
      return Err(ProgramError::InvalidAccountData);
   };

   let netting_calc: Option<NettingCalc> =
      if !mm_netting_pda.is_data_empty() && market_id.is_pregame() {
         calculate_netting(
            mm_netting_pda,
            &market_id,
            side,
            amount,
            odds_scaled,
         )
      } else {
         None
      };
   let is_potentially_netted = netting_calc.is_some();
   let netting_delta_i64: i64 = netting_calc.map(|c| c.delta).unwrap_or(0);

   let Ok(gross_margin_u64) = calc_potential_profit(amount, odds_scaled) else {
      log!("fill_rfq_bet: failed to calc potential profit");
      return Err(ProgramError::InvalidInstructionData);
   };
   let gross_margin_i64: i64 = gross_margin_u64.try_into().map_err(|_| {
      log!("fill_rfq_bet: gross margin does not fit i64");
      ProgramError::InvalidInstructionData
   })?;

   let encumbrance_delta_i64: i64 = if is_potentially_netted {
      netting_delta_i64
   } else {
      gross_margin_i64
   };

   let (amount_to_send, new_outstanding_liability) = compute_liability_shortfall(
      mm_liability_account_balance_before,
      outstanding_liability,
      encumbrance_delta_i64,
   )?;

   let fill_ix_data = FillRfqIxData {
      instruction_discriminator: FILL_BET_RFQ_IX_DISCRIMINATOR,
      amount_to_send,
   };
   let mut fill_ix_buf = [0u8; FillRfqIxData::WIRE_LEN];
   fill_ix_data.write_wire(&mut fill_ix_buf)?;

   let fill_rfq_ix_account_metas = [
      InstructionAccount::new(user.address(), false, false),
      InstructionAccount::new(mm_market_data_pda.address(), true, false),
      InstructionAccount::new(mm_config_pda.address(), true, false),
      InstructionAccount::new(mm_token_account.address(), true, false),
      InstructionAccount::new(mm_liability_token_account.address(), true, false),
      InstructionAccount::new(mint.address(), false, false),
      InstructionAccount::new(token_program.address(), false, false),
      InstructionAccount::new(instructions_sysvar.address(), false, false),
   ];
   let fill_rfq_invoke_accounts = [
      user.as_ref(),
      mm_market_data_pda.as_ref(),
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
      log!("fill_rfq_bet: failed to read liability balance after CPI");
      return Err(ProgramError::InvalidAccountData);
   };
   let Some(mm_liability_token_account_increase) =
      mm_liability_account_balance_after.checked_sub(mm_liability_account_balance_before)
   else {
      log!("fill_rfq_bet: liability balance decreased");
      return Err(ProgramError::InvalidInstructionData);
   };

   if unlikely(mm_liability_token_account_increase != amount_to_send) {
      log!("fill_rfq_bet: liability deposit mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   if let Some(NettingCalc { write: netting_write, .. }) = netting_calc {
      apply_netting(mm_netting_pda, &netting_write)?;
   }

   unsafe {
      write_i64_le_unchecked(
         mm_encumbrance_pda.data_mut_ptr(),
         MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
         new_outstanding_liability,
      );
   }

   let filled_payout = calc_potential_payout(amount, odds_scaled)?;

   let bet_id_bytes = bet_id.to_le_bytes();
   let bet_pda_seed = [BET_ACCOUNT_SEED, user.address().as_ref(), &bet_id_bytes];
   let (expected_bet_pda, bet_bump) = Address::find_program_address(&bet_pda_seed, &ID);
   if !address_eq(bet_pda.address(), &expected_bet_pda) {
      log!("fill_rfq_bet: bet pda mismatch");
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

   let timestamp: u32 = clock.unix_timestamp.try_into().map_err(|_| {
      log!("fill_rfq_bet: failed to convert timestamp to u32");
      ProgramError::InvalidAccountData
   })?;

   let filler = BetFiller {
      mm_address,
      amount,
      odds_scaled,
      is_potentially_netted,
      encumbrance_delta: encumbrance_delta_i64,
   };
   let mut empty_fillers = [BetFiller {
      mm_address: Address::default(),
      amount: 0,
      odds_scaled: 0,
      is_potentially_netted: false,
      encumbrance_delta: 0,
   }; 5];
   empty_fillers[0] = filler;

   let bet_account_data = BetAccountData {
      discriminator: BET_ACCOUNT_DISCRIMINATOR,
      bump: bet_bump,
      event_state_sequence,
      side,
      owner: *user.address(),
      feepayer: *feepayer.address(),
      bet_id,
      amount,
      payout: filled_payout,
      market_id,
      event_game_state,
      timestamp,
      result: BetResult::Pending,
      filler_0: empty_fillers[0],
      filler_1: empty_fillers[1],
      filler_2: empty_fillers[2],
      filler_3: empty_fillers[3],
      filler_4: empty_fillers[4],
   };

   CreateAccount {
      from: feepayer,
      to: bet_pda,
      lamports: get_rent_local(BET_ACCOUNT_LEN),
      space: BET_ACCOUNT_LEN,
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
