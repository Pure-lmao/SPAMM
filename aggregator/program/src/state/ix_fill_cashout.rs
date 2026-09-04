use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use super::other::EventGameState;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillCashoutIxData {
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub min_payout: u64,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
}

pub const FILL_CASHOUT_IX_DATA_LEN: usize = <FillCashoutIxData as ZeroPodFixed>::SIZE;

impl FillCashoutIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_CASHOUT_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         orig_bet_id: zc.orig_bet_id.get(),
         cashout_id: zc.cashout_id.get(),
         amount: zc.amount.get(),
         min_payout: zc.min_payout.get(),
         event_state_sequence: zc.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
      })
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != FILL_CASHOUT_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillCashoutIxDataZc {
         orig_bet_id: self.orig_bet_id.into(),
         cashout_id: self.cashout_id.into(),
         amount: self.amount.into(),
         min_payout: self.min_payout.into(),
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}
