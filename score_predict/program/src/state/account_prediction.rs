use pinocchio::Address;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::constants::TWEET_LINK_LEN;

pub const PREDICTION_ACCOUNT_DISCRIMINATOR: u8 = 1;
pub const PREDICTION_ACCOUNT_SEED: &[u8] = b"prediction";

/// Memcmp offsets for getProgramAccounts filters (must match SDK readers).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct PredictionAccountData {
   pub discriminator: u8,
   pub bump: u8,
   pub prediction_id: u64,
   pub contest_id: u32,
   pub owner: Address,
   pub timestamp: u32,
   pub prediction: [u8; 2],
   pub open_bet: Address,
   pub tweet_link: [u8; TWEET_LINK_LEN],
}

pub const PREDICTION_ACCOUNT_LEN: usize= <PredictionAccountData as ZeroPodFixed>::SIZE;
pub const PREDICTION_CONTEST_ID_OFFSET: usize = 1 + 1 + 8;
pub const PREDICTION_OWNER_OFFSET: usize = PREDICTION_CONTEST_ID_OFFSET + 4;

impl PredictionAccountData {
   #[inline(always)]
   pub fn tweet_link_non_empty(&self) -> bool {
      self.tweet_link.iter().any(|&b| b != 0)
   }
   #[inline(always)]
   pub fn to_zc(self) -> PredictionAccountDataZc {
      PredictionAccountDataZc {
         discriminator: self.discriminator,
         bump: self.bump,
         prediction_id: self.prediction_id.into(),
         contest_id: self.contest_id.into(),
         owner: self.owner,
         timestamp: self.timestamp.into(),
         prediction: self.prediction,
         open_bet: self.open_bet,
         tweet_link: self.tweet_link,
      }
   }
   
}
