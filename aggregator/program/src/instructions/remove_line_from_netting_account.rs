//! Accounts (4):
//! 0. `admin` (signer)
//! 1. `mm_program` (readonly)
//! 2. `mm_config_pda` (readonly)
//! 3. `netting_pda` (writable)
//!
//! Data: (event_id: EventId, mkt: u32)

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   helpers::{verify_mm_admin, verify_mm_program_executable, verify_netting_pda_exists, verify_signer},
   state::{EventId, remove_netting_line},
};



pub const REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR: u8 = 8;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      admin,
      mm_program, 
      mm_config_pda,
      netting_pda
   ] = accounts else {
      log!("remove_line_from_liability_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&admin)?;
   verify_mm_program_executable(&mm_program)?;
   verify_mm_admin(&admin, &mm_program, &mm_config_pda)?;

   let parsed_data = RemoveLineFromLiabilityNettingIxData::decode(data)?;
   let event_id = parsed_data.event_id;
   let mkt = parsed_data.mkt;

   verify_netting_pda_exists(netting_pda, mm_program, &event_id)?;

   let mut acc_data = netting_pda.try_borrow_mut()?;
   remove_netting_line(&mut acc_data, mkt)?;

   Ok(())
}

//--------------------------

use zeropod::{ZeroPod, ZeroPodFixed};

#[derive(Copy, Clone, ZeroPod)]
pub struct RemoveLineFromLiabilityNettingIxData {
   pub event_id: EventId,
   pub mkt: u32,
}

pub const REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN: usize =
   <RemoveLineFromLiabilityNettingIxData as ZeroPodFixed>::SIZE;

impl RemoveLineFromLiabilityNettingIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         event_id: EventId::from_zc(&zc.event_id).ok_or(ProgramError::InvalidInstructionData)?,
         mkt: zc.mkt.get(),
      })
   }
}

const _: () = assert!(REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN == EventId::WIRE_SIZE + 4);
