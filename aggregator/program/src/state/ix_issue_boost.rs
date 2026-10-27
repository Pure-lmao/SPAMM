use pinocchio::{Address, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::{ADDRESS_LEN, MAX_PROMO_ALLOWED_MMS, MAX_PROMO_ALLOWED_OPERATORS},
   readers::read_address_ref_unchecked,
};

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct IssueBoostIxHeader {
   pub boost_id: u32,
   pub expiry: u32,
   pub max_stake: u64,
   pub min_odds_scaled: u32,
   pub max_odds_scaled: u32,
   pub boost_bps: u32,
   pub min_legs: u8,
   pub num_mms: u8,
   pub num_operators: u8,
}

pub const ISSUE_BOOST_IX_HEADER_LEN: usize = <IssueBoostIxHeader as ZeroPodFixed>::SIZE;

#[derive(Copy, Clone)]
pub struct IssueBoostIxData {
   pub boost_id: u32,
   pub expiry: u32,
   pub max_stake: u64,
   pub min_odds_scaled: u32,
   pub max_odds_scaled: u32,
   pub boost_bps: u32,
   pub min_legs: u8,
   pub num_mms: u8,
   pub num_operators: u8,
   pub allowed_mms: [Address; MAX_PROMO_ALLOWED_MMS],
   pub allowed_operators: [Address; MAX_PROMO_ALLOWED_OPERATORS],
}

impl IssueBoostIxData {
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if unlikely(data.len() < ISSUE_BOOST_IX_HEADER_LEN) {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <IssueBoostIxHeader as ZeroPodFixed>::from_bytes(&data[..ISSUE_BOOST_IX_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let num_mms = zc.num_mms as usize;
      let num_operators = zc.num_operators as usize;
      if unlikely(num_mms > MAX_PROMO_ALLOWED_MMS || num_operators > MAX_PROMO_ALLOWED_OPERATORS) {
         return Err(ProgramError::InvalidInstructionData);
      }
      let expected_len = ISSUE_BOOST_IX_HEADER_LEN + num_mms * ADDRESS_LEN + num_operators * ADDRESS_LEN;
      if unlikely(data.len() != expected_len) {
         return Err(ProgramError::InvalidInstructionData);
      }
      let max_stake = zc.max_stake.get();
      let min_odds_scaled = zc.min_odds_scaled.get();
      let max_odds_scaled = zc.max_odds_scaled.get();
      let boost_bps = zc.boost_bps.get();
      let boost_id = zc.boost_id.get();
      if unlikely(
         max_stake == 0
            || boost_id == 0
            || boost_bps == 0
            || max_odds_scaled < min_odds_scaled
            || min_odds_scaled == 0
      ) {
         log!("issue_boost: bad header");
         return Err(ProgramError::InvalidInstructionData);
      }
      let mut allowed_mms = [Address::default(); MAX_PROMO_ALLOWED_MMS];
      for i in 0..num_mms {
         allowed_mms[i] = *unsafe {
            read_address_ref_unchecked(data.as_ptr(), ISSUE_BOOST_IX_HEADER_LEN + i * ADDRESS_LEN)
         };
      }
      let ops_off = ISSUE_BOOST_IX_HEADER_LEN + num_mms * ADDRESS_LEN;
      let mut allowed_operators = [Address::default(); MAX_PROMO_ALLOWED_OPERATORS];
      for i in 0..num_operators {
         allowed_operators[i] = *unsafe { read_address_ref_unchecked(data.as_ptr(), ops_off + i * ADDRESS_LEN) };
      }
      Ok(Self {
         boost_id,
         expiry: zc.expiry.get(),
         max_stake,
         min_odds_scaled,
         max_odds_scaled,
         boost_bps,
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
      let expected = ISSUE_BOOST_IX_HEADER_LEN + n_mms * ADDRESS_LEN + n_ops * ADDRESS_LEN;
      if unlikely(out.len() != expected) {
         return Err(ProgramError::InvalidInstructionData);
      }
      let hzc = IssueBoostIxHeaderZc {
         boost_id: self.boost_id.into(),
         expiry: self.expiry.into(),
         max_stake: self.max_stake.into(),
         min_odds_scaled: self.min_odds_scaled.into(),
         max_odds_scaled: self.max_odds_scaled.into(),
         boost_bps: self.boost_bps.into(),
         min_legs: self.min_legs,
         num_mms: self.num_mms,
         num_operators: self.num_operators,
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      for i in 0..n_mms {
         let off = ISSUE_BOOST_IX_HEADER_LEN + i * ADDRESS_LEN;
         out[off..off + ADDRESS_LEN].copy_from_slice(self.allowed_mms[i].as_ref());
      }
      let ops_off = ISSUE_BOOST_IX_HEADER_LEN + n_mms * ADDRESS_LEN;
      for i in 0..n_ops {
         let off = ops_off + i * ADDRESS_LEN;
         out[off..off + ADDRESS_LEN].copy_from_slice(self.allowed_operators[i].as_ref());
      }
      Ok(())
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use super::super::promo::BOOST_BPS_SCALE;

   fn sample(boost_bps: u32) -> IssueBoostIxData {
      IssueBoostIxData {
         boost_id: 1,
         expiry: 1,
         max_stake: 1,
         min_odds_scaled: 10_000,
         max_odds_scaled: 10_000,
         boost_bps,
         min_legs: 1,
         num_mms: 0,
         num_operators: 0,
         allowed_mms: [Address::default(); MAX_PROMO_ALLOWED_MMS],
         allowed_operators: [Address::default(); MAX_PROMO_ALLOWED_OPERATORS],
      }
   }

   #[test]
   fn boost_bps_has_no_upper_bound() {
      let mut over_hundred = [0u8; ISSUE_BOOST_IX_HEADER_LEN];
      sample(BOOST_BPS_SCALE + 1).write_wire(&mut over_hundred).unwrap();
      assert_eq!(IssueBoostIxData::decode(&over_hundred).unwrap().boost_bps, BOOST_BPS_SCALE + 1);

      let mut max = [0u8; ISSUE_BOOST_IX_HEADER_LEN];
      sample(u32::MAX).write_wire(&mut max).unwrap();
      assert_eq!(IssueBoostIxData::decode(&max).unwrap().boost_bps, u32::MAX);

      let mut zero = [0u8; ISSUE_BOOST_IX_HEADER_LEN];
      sample(0).write_wire(&mut zero).unwrap();
      assert!(IssueBoostIxData::decode(&zero).is_err());
   }
}
