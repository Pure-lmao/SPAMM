//! RFQ quote signing helpers for Mollusk tests (ed25519, matches brine-ed25519 verify on-chain).

use ed25519_dalek::{Signer, SigningKey};
use pinocchio::Address;
use solana_pubkey::Pubkey;

use spamm_aggregator::state::{
   build_rfq_bet_message, build_rfq_parlay_message, EventGameState, MarketId, ParlayLegTable,
   RFQ_BET_MESSAGE_LEN, RFQ_PARLAY_MESSAGE_LEN,
};

use super::fixtures::mm_program_id;

/// Far-future expiry so `Clock::unix_timestamp > offer_expiry` does not trigger in Mollusk.
pub const RFQ_OFFER_EXPIRY: u32 = u32::MAX;

fn rfq_signing_key() -> SigningKey {
   SigningKey::from_bytes(&[0x52u8; 32])
}

pub fn rfq_signer_pubkey() -> Pubkey {
   Pubkey::from(rfq_signing_key().verifying_key().to_bytes())
}

pub fn sign_rfq_message(message: &[u8]) -> [u8; 64] {
   rfq_signing_key().sign(message).to_bytes()
}

pub fn sign_rfq_bet_quote(
   user: &Pubkey,
   bet_id: u64,
   market_id: &MarketId,
   event_game_state: &EventGameState,
   event_state_sequence: u16,
   side: u8,
   max_stake: u64,
   odds_scaled: u32,
   offer_expiry: u32,
) -> [u8; 64] {
   let mut message = [0u8; RFQ_BET_MESSAGE_LEN];
   let user_addr = Address::new_from_array(user.to_bytes());
   let mm_program = Address::new_from_array(mm_program_id().to_bytes());
   build_rfq_bet_message(
      &mut message,
      &user_addr,
      bet_id,
      market_id,
      event_game_state,
      event_state_sequence,
      side,
      max_stake,
      odds_scaled,
      offer_expiry,
      &mm_program,
   )
   .expect("build rfq bet message");
   sign_rfq_message(&message)
}

pub fn sign_rfq_parlay_quote(
   user: &Pubkey,
   bet_id: u64,
   num_legs: u8,
   legs: &ParlayLegTable,
   max_stake: u64,
   odds_scaled: u32,
   offer_expiry: u32,
) -> [u8; 64] {
   let mut message = [0u8; RFQ_PARLAY_MESSAGE_LEN];
   let user_addr = Address::new_from_array(user.to_bytes());
   let mm_program = Address::new_from_array(mm_program_id().to_bytes());
   build_rfq_parlay_message(
      &mut message,
      &user_addr,
      bet_id,
      num_legs,
      legs,
      max_stake,
      odds_scaled,
      offer_expiry,
      &mm_program,
   )
   .expect("build rfq parlay message");
   sign_rfq_message(&message)
}
