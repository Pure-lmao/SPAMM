//! Live cashout delay escrow PDA.
//!
//! Seeds: **`["cashout_escrow", user_address, orig_bet_id_le]`**.

use core::mem::offset_of;

use pinocchio::{Address, error::ProgramError, hint::unlikely};
use zeropod::{ZeroPod, ZeroPodFixed};

pub const CASHOUT_ESCROW_SEED: &[u8] = b"cashout_escrow";
pub const CASHOUT_ESCROW_DISCRIMINATOR: u8 = 7;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct CashoutEscrow {
   pub discriminator: u8,
   pub bump: u8,
   pub owner: Address,
   pub feepayer: Address,
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub timestamp: u32,
   pub amount: u64,
   pub payout_removed: u64,
   pub payment: u64,
   pub market_maker: Address,
   pub is_parlay: bool,
}

pub const CASHOUT_ESCROW_LEN: usize = <CashoutEscrow as ZeroPodFixed>::SIZE;
pub const CASHOUT_ESCROW_BUMP_OFFSET: usize = offset_of!(CashoutEscrowZc, bump);

impl CashoutEscrow {
   #[inline(always)]
   fn to_zc(&self) -> CashoutEscrowZc {
      CashoutEscrowZc {
         discriminator: self.discriminator,
         bump: self.bump,
         owner: self.owner,
         feepayer: self.feepayer,
         orig_bet_id: self.orig_bet_id.into(),
         cashout_id: self.cashout_id.into(),
         timestamp: self.timestamp.into(),
         amount: self.amount.into(),
         payout_removed: self.payout_removed.into(),
         payment: self.payment.into(),
         market_maker: self.market_maker,
         is_parlay: self.is_parlay.into(),
      }
   }

   #[inline(always)]
   fn from_zc(z: &CashoutEscrowZc) -> Self {
      Self {
         discriminator: z.discriminator,
         bump: z.bump,
         owner: z.owner,
         feepayer: z.feepayer,
         orig_bet_id: z.orig_bet_id.get(),
         cashout_id: z.cashout_id.get(),
         timestamp: z.timestamp.get(),
         amount: z.amount.get(),
         payout_removed: z.payout_removed.get(),
         payment: z.payment.get(),
         market_maker: z.market_maker,
         is_parlay: z.is_parlay.get(),
      }
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if unlikely(data.len() != CASHOUT_ESCROW_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data[0] != CASHOUT_ESCROW_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidAccountData)?;
      Ok(Self::from_zc(zc))
   }

   #[inline(always)]
   pub fn write_to_account(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if unlikely(out.len() != CASHOUT_ESCROW_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}
