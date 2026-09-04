use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::MAX_PARLAY_LEGS,
   errors::SpammError,
};

use super::other::EventGameState;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct CashoutSnapshot {
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
}

pub const CASHOUT_SNAPSHOT_LEN: usize = <CashoutSnapshot as ZeroPodFixed>::SIZE;

impl CashoutSnapshot {
   #[inline(always)]
   pub fn zeroed() -> Self {
      Self {
         event_state_sequence: 0,
         event_game_state: EventGameState::zeroed(),
      }
   }

   #[inline(always)]
   pub fn decode_at(data: &[u8], off: usize) -> Result<Self, ProgramError> {
      let end = off.checked_add(CASHOUT_SNAPSHOT_LEN).ok_or(ProgramError::InvalidInstructionData)?;
      if data.len() < end {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(&data[off..end])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         event_state_sequence: zc.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
      })
   }

   #[inline(always)]
   pub fn write_at(&self, out: &mut [u8], off: usize) -> Result<(), ProgramError> {
      let end = off.checked_add(CASHOUT_SNAPSHOT_LEN).ok_or(ProgramError::InvalidInstructionData)?;
      if out.len() < end {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = CashoutSnapshotZc {
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().add(off).cast(), zc);
      }
      Ok(())
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillParlayCashoutIxHeader {
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub min_payout: u64,
   pub num_legs: u8,
}

pub const FILL_PARLAY_CASHOUT_IX_HEADER_LEN: usize = <FillParlayCashoutIxHeader as ZeroPodFixed>::SIZE;

pub struct FillParlayCashoutIxData {
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub min_payout: u64,
   pub num_legs: u8,
   pub snapshots: [CashoutSnapshot; MAX_PARLAY_LEGS],
}

impl FillParlayCashoutIxData {
   /// Never inlined: owns `[CashoutSnapshot; MAX_PARLAY_LEGS]` on this frame only.
   #[inline(never)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() < FILL_PARLAY_CASHOUT_IX_HEADER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <FillParlayCashoutIxHeader as ZeroPodFixed>::from_bytes(
         &data[..FILL_PARLAY_CASHOUT_IX_HEADER_LEN],
      )
      .map_err(|_| ProgramError::InvalidInstructionData)?;
      let n = zc.num_legs as usize;
      if unlikely(n < 2 || n > MAX_PARLAY_LEGS) {
         log!("fill_parlay_cashout: num_legs must be in 2..={}", MAX_PARLAY_LEGS);
         return Err(SpammError::InvalidParlayLegCount.into());
      }
      let expected = FILL_PARLAY_CASHOUT_IX_HEADER_LEN + n * CASHOUT_SNAPSHOT_LEN;
      if data.len() != expected {
         return Err(ProgramError::InvalidInstructionData);
      }
      let mut parsed = Self {
         orig_bet_id: zc.orig_bet_id.get(),
         cashout_id: zc.cashout_id.get(),
         amount: zc.amount.get(),
         min_payout: zc.min_payout.get(),
         num_legs: zc.num_legs,
         snapshots: [CashoutSnapshot::zeroed(); MAX_PARLAY_LEGS],
      };
      for i in 0..n {
         let off = FILL_PARLAY_CASHOUT_IX_HEADER_LEN + i * CASHOUT_SNAPSHOT_LEN;
         parsed.snapshots[i] = CashoutSnapshot::decode_at(data, off)?;
      }
      Ok(parsed)
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let expected = FILL_PARLAY_CASHOUT_IX_HEADER_LEN + n * CASHOUT_SNAPSHOT_LEN;
      if out.len() != expected {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillParlayCashoutIxHeaderZc {
         orig_bet_id: self.orig_bet_id.into(),
         cashout_id: self.cashout_id.into(),
         amount: self.amount.into(),
         min_payout: self.min_payout.into(),
         num_legs: self.num_legs,
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      for i in 0..n {
         let off = FILL_PARLAY_CASHOUT_IX_HEADER_LEN + i * CASHOUT_SNAPSHOT_LEN;
         self.snapshots[i].write_at(out, off)?;
      }
      Ok(())
   }
}
