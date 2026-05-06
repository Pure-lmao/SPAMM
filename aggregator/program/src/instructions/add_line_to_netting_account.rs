use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   helpers::{verify_mm_admin, verify_mm_program_executable, verify_netting_pda_exists, verify_signer},
   state::add_netting_line,
};

/// Accounts (4):
/// 0. `admin` (signer)
/// 1. `mm_program` (readonly)
/// 2. `mm_config_pda` (readonly)
/// 3. `netting_pda` (writable)
/// 
/// Data: (event_id: EventId, period: u8, mkt: u32)


pub const ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR: u8 = 51;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      admin, 
      mm_program, 
      mm_config_pda,
      netting_pda
   ] = accounts else {
      log!("add_line_to_netting_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&admin)?;
   verify_mm_program_executable(&mm_program)?;
   verify_mm_admin(&admin, &mm_program, mm_config_pda)?;

   let parsed_data = AddLineToLiabilityNettingIxData::decode(data)?;
   let event_id = parsed_data.event_id;
   let period = parsed_data.period;
   let mkt = parsed_data.mkt;

   verify_netting_pda_exists(netting_pda, mm_program, &event_id)?;

   let mut acc_data = netting_pda.try_borrow_mut()?;
   add_netting_line(&mut acc_data, event_id.sport, period, mkt)?;

   Ok(())
}

//--------------------------

use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::EventId;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct AddLineToLiabilityNettingIxData {
   pub event_id: EventId,
   pub period: u8,
   pub mkt: u32,
}

pub const ADD_LINE_TO_LIABILITY_NETTING_IX_LEN: usize =
   <AddLineToLiabilityNettingIxData as ZeroPodFixed>::SIZE;

impl AddLineToLiabilityNettingIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != ADD_LINE_TO_LIABILITY_NETTING_IX_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         event_id: EventId::from_zc(&zc.event_id).ok_or(ProgramError::InvalidInstructionData)?,
         period: zc.period,
         mkt: zc.mkt.get(),
      })
   }

   /// Serialize for tests / off-chain builders.
   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != ADD_LINE_TO_LIABILITY_NETTING_IX_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = AddLineToLiabilityNettingIxDataZc {
         event_id: self.event_id.to_zc(),
         period: self.period,
         mkt: self.mkt.into(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}
