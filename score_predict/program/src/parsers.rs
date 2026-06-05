use pinocchio::{Address, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::constants::TWEET_LINK_LEN;

pub struct CreatePredictionIxData {
   pub prediction_id: u64,
   pub contest_id: u32,
   pub prediction: [u8; 2],
   pub open_bet: Address,
   pub tweet_link: [u8; TWEET_LINK_LEN],
}

/// Wire layout after router discriminator: prediction_id u64, contest_id u32,
/// prediction [u8;2], open_bet [32], tweet_link [70]. Timestamp comes from Clock sysvar.
pub const CREATE_PREDICTION_IX_DATA_LEN: usize = 8 + 4 + 2 + 32 + TWEET_LINK_LEN;

pub fn parse_create_prediction_data(data: &[u8]) -> Result<CreatePredictionIxData, ProgramError> {
   if unlikely(data.len() != CREATE_PREDICTION_IX_DATA_LEN) {
      log!("create_prediction: invalid ix data len");
      return Err(ProgramError::InvalidInstructionData);
   }

   let mut off = 0;
   let prediction_id = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
   off += 8;
   let contest_id = u32::from_le_bytes(data[off..off + 4].try_into().unwrap());
   off += 4;
   let prediction = [data[off], data[off + 1]];
   off += 2;
   let mut open_bet_bytes = [0u8; 32];
   open_bet_bytes.copy_from_slice(&data[off..off + 32]);
   let open_bet = Address::new_from_array(open_bet_bytes);
   off += 32;
   let mut tweet_link = [0u8; TWEET_LINK_LEN];
   tweet_link.copy_from_slice(&data[off..off + TWEET_LINK_LEN]);

   if unlikely(!tweet_link.iter().any(|&b| b != 0)) {
      log!("create_prediction: tweet_link empty");
      return Err(ProgramError::InvalidInstructionData);
   }

   Ok(CreatePredictionIxData {
      prediction_id,
      contest_id,
      prediction,
      open_bet,
      tweet_link,
   })
}
