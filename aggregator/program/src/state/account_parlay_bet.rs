//! On-chain parlay bet PDA layout (distinct discriminator from single [`super::account_bet::BetAccountData`]).
//!
//! PDA seeds: **`["parlay", user_address, bet_id_le]`** (see [`PARLAY_BET_ACCOUNT_SEED`]).

use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use super::{
   account_bet::{BetResult},
   mm_parlay_quote::ParlayLegTable,
};

pub const PARLAY_BET_ACCOUNT_SEED: &[u8] = b"parlay";

pub const PARLAY_BET_ACCOUNT_DISCRIMINATOR: u8 = 2;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ParlayBetAccountData {
   pub discriminator: u8,
   pub bump: u8,
   pub owner: Address,
   pub feepayer: Address,
   pub bet_id: u64,
   pub amount: u64,
   pub payout: u64,
   pub filler_address: Address,
   pub result: BetResult,
   pub num_legs: u8,
   pub legs: ParlayLegTable,
}
pub const PARLAY_BET_RESULT_OFFSET: usize = 122;

pub const PARLAY_BET_ACCOUNT_LEN: u64 = <ParlayBetAccountData as ZeroPodFixed>::SIZE as u64;

impl ParlayBetAccountData {
   #[inline(always)]
   fn to_zc(self) -> ParlayBetAccountDataZc {
      ParlayBetAccountDataZc {
         discriminator: self.discriminator,
         bump: self.bump,
         owner: self.owner,
         feepayer: self.feepayer,
         bet_id: self.bet_id.into(),
         amount: self.amount.into(),
         payout: self.payout.into(),
         filler_address: self.filler_address,
         result: self.result.into(),
         num_legs: self.num_legs,
         legs: self.legs.to_zc(),
      }
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != PARLAY_BET_ACCOUNT_LEN as usize {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;      
      Ok(Self {
         discriminator: zc.discriminator,
         bump: zc.bump,
         owner: zc.owner,
         feepayer: zc.feepayer,
         bet_id: zc.bet_id.get(),
         amount: zc.amount.get(),
         payout: zc.payout.get(),
         filler_address: zc.filler_address,
         result: BetResult::from_u8(zc.result.get()),
         num_legs: zc.num_legs,
         legs: ParlayLegTable::from_zc(&zc.legs).ok_or(ProgramError::InvalidAccountData)?,
      })
   }

   #[inline(always)]
   pub fn write_to_account(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      let len = <Self as ZeroPodFixed>::SIZE;
      if out.len() != len {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}
