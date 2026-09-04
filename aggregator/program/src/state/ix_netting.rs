use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use super::ids::EventId;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct AddLineToLiabilityNettingIxData {
   pub event_id: EventId,
   pub period: u8,
   pub mkt: u16,
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

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct RemoveLineFromLiabilityNettingIxData {
   pub event_id: EventId,
   pub period: u8,
   pub mkt: u16,
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
         period: zc.period,
         mkt: zc.mkt.get(),
      })
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = RemoveLineFromLiabilityNettingIxDataZc {
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
