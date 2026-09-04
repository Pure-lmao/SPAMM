use pinocchio::{Address, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::{ADDRESS_LEN, MAX_FREEBET_ALLOWED_MMS, MAX_FREEBET_ALLOWED_OPERATORS, MIN_BET_AMOUNT},
   readers::read_address_ref_unchecked,
};

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct IssueFreebetIxHeader {
   pub freebet_id: u32,
   pub expiry: u32,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub max_odds_scaled: u32,
   pub min_legs: u8,
   pub num_mms: u8,
   pub num_operators: u8,
}

pub const ISSUE_FREEBET_IX_HEADER_LEN: usize = <IssueFreebetIxHeader as ZeroPodFixed>::SIZE;

#[derive(Copy, Clone)]
pub struct IssueFreebetIxData {
   pub freebet_id: u32,
   pub expiry: u32,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub max_odds_scaled: u32,
   pub min_legs: u8,
   pub num_mms: u8,
   pub num_operators: u8,
   pub allowed_mms: [Address; MAX_FREEBET_ALLOWED_MMS],
   pub allowed_operators: [Address; MAX_FREEBET_ALLOWED_OPERATORS],
}

impl IssueFreebetIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if unlikely(data.len() < ISSUE_FREEBET_IX_HEADER_LEN) {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <IssueFreebetIxHeader as ZeroPodFixed>::from_bytes(&data[..ISSUE_FREEBET_IX_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let num_mms = zc.num_mms as usize;
      let num_operators = zc.num_operators as usize;
      if unlikely(num_mms > MAX_FREEBET_ALLOWED_MMS || num_operators > MAX_FREEBET_ALLOWED_OPERATORS)
      {
         return Err(ProgramError::InvalidInstructionData);
      }
      let expected_len = ISSUE_FREEBET_IX_HEADER_LEN + num_mms * ADDRESS_LEN + num_operators * ADDRESS_LEN;
      if unlikely(data.len() != expected_len) {
         return Err(ProgramError::InvalidInstructionData);
      }
      let amount = zc.amount.get();
      let min_odds_scaled = zc.min_odds_scaled.get();
      let max_odds_scaled = zc.max_odds_scaled.get();
      let freebet_id = zc.freebet_id.get();
      if unlikely(amount == 0 || amount < MIN_BET_AMOUNT || max_odds_scaled < min_odds_scaled || min_odds_scaled == 0) {
         return Err(ProgramError::InvalidInstructionData);
      }
      if unlikely(freebet_id == 0) {
         log!("issue_freebet: freebet_id 0 reserved");
         return Err(ProgramError::InvalidInstructionData);
      }
      let mut allowed_mms = [Address::default(); MAX_FREEBET_ALLOWED_MMS];
      for i in 0..num_mms {
         allowed_mms[i] = *unsafe {
            read_address_ref_unchecked(data.as_ptr(), ISSUE_FREEBET_IX_HEADER_LEN + i * ADDRESS_LEN)
         };
      }
      let ops_off = ISSUE_FREEBET_IX_HEADER_LEN + num_mms * ADDRESS_LEN;
      let mut allowed_operators = [Address::default(); MAX_FREEBET_ALLOWED_OPERATORS];
      for i in 0..num_operators {
         allowed_operators[i] = *unsafe {
            read_address_ref_unchecked(data.as_ptr(), ops_off + i * ADDRESS_LEN)
         };
      }
      Ok(Self {
         freebet_id,
         expiry: zc.expiry.get(),
         amount,
         min_odds_scaled,
         max_odds_scaled,
         min_legs: zc.min_legs,
         num_mms: zc.num_mms,
         num_operators: zc.num_operators,
         allowed_mms,
         allowed_operators,
      })
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      let n_mms = self.num_mms as usize;
      let n_ops = self.num_operators as usize;
      let expected = ISSUE_FREEBET_IX_HEADER_LEN + n_mms * ADDRESS_LEN + n_ops * ADDRESS_LEN;
      if unlikely(out.len() != expected) {
         return Err(ProgramError::InvalidInstructionData);
      }
      let hzc = IssueFreebetIxHeaderZc {
         freebet_id: self.freebet_id.into(),
         expiry: self.expiry.into(),
         amount: self.amount.into(),
         min_odds_scaled: self.min_odds_scaled.into(),
         max_odds_scaled: self.max_odds_scaled.into(),
         min_legs: self.min_legs,
         num_mms: self.num_mms,
         num_operators: self.num_operators,
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      for i in 0..n_mms {
         let off = ISSUE_FREEBET_IX_HEADER_LEN + i * ADDRESS_LEN;
         out[off..off + ADDRESS_LEN].copy_from_slice(self.allowed_mms[i].as_ref());
      }
      let ops_off = ISSUE_FREEBET_IX_HEADER_LEN + n_mms * ADDRESS_LEN;
      for i in 0..n_ops {
         let off = ops_off + i * ADDRESS_LEN;
         out[off..off + ADDRESS_LEN].copy_from_slice(self.allowed_operators[i].as_ref());
      }
      Ok(())
   }
}
