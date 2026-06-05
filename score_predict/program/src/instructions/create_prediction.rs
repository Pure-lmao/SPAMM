//! Create a prediction PDA for `(owner, contest_id)`.
//!
//! Accounts:
//! 0. `owner` (writable signer) — pays rent; stored as account owner
//! 1. `prediction_pda` (writable, uninitialized)
//! 2. `system_program` (readonly)
//!
//! Instruction data (after router disc): see `parsers::CREATE_PREDICTION_IX_DATA_LEN`.

use pinocchio::{
   AccountView, Address, ProgramResult,
   address::address_eq,
   cpi::{Seed, Signer},
   error::ProgramError,
   hint::unlikely,
   sysvars::{Sysvar, clock::Clock},
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
   ID,
   constants::PREDICTION_ACCOUNT_SEED,
   helpers::{get_rent_local, verify_signer, verify_system_program},
   parsers::parse_create_prediction_data,
   state::{PREDICTION_ACCOUNT_DISCRIMINATOR, PREDICTION_ACCOUNT_LEN, PredictionAccountData, PredictionAccountDataZc},
};

pub const CREATE_PREDICTION_IX_DISCRIMINATOR: u8 = 0;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [owner, prediction_pda, system_program] = accounts else {
      log!("create_prediction: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(owner)?;
   verify_system_program(system_program)?;

   if unlikely(prediction_pda.lamports() > 0 || prediction_pda.data_len() != 0) {
      log!("create_prediction: pda already exists");
      return Err(ProgramError::AccountAlreadyInitialized);
   }

   let parsed = parse_create_prediction_data(data)?;
   let clock = Clock::get()?;
   let timestamp = u32::try_from(clock.unix_timestamp).map_err(|_| {
      log!("create_prediction: clock unix_timestamp out of u32 range");
      ProgramError::InvalidAccountData
   })?;
   let contest_id_bytes = parsed.contest_id.to_le_bytes();
   let seeds = [
      PREDICTION_ACCOUNT_SEED,
      owner.address().as_ref(),
      contest_id_bytes.as_ref(),
   ];

   let (expected_pda, bump) = Address::find_program_address(&seeds, &ID);
   if unlikely(!address_eq(prediction_pda.address(), &expected_pda)) {
      log!("create_prediction: invalid pda");
      return Err(ProgramError::InvalidSeeds);
   }

   let bump_seed = [bump];
   let signer_seeds = [
      Seed::from(PREDICTION_ACCOUNT_SEED),
      Seed::from(owner.address().as_ref()),
      Seed::from(contest_id_bytes.as_ref()),
      Seed::from(&bump_seed),
   ];
   let signers = [Signer::from(&signer_seeds)];

   let space = PREDICTION_ACCOUNT_LEN as u64;
   CreateAccount {
      from: owner,
      to: prediction_pda,
      lamports: get_rent_local(space),
      space,
      owner: &ID,
   }
   .invoke_signed(&signers)?;

   let body = PredictionAccountData {
      discriminator: PREDICTION_ACCOUNT_DISCRIMINATOR,
      bump,
      prediction_id: parsed.prediction_id,
      contest_id: parsed.contest_id,
      owner: *owner.address(),
      timestamp,
      prediction: parsed.prediction,
      open_bet: parsed.open_bet,
      tweet_link: parsed.tweet_link,
   }.to_zc();

   {
      let mut acc_data = prediction_pda.try_borrow_mut()?;
      unsafe {
         core::ptr::write(
            acc_data.as_mut_ptr().cast::<PredictionAccountDataZc>(),
            body,
         );
      }
   }

   Ok(())
}
