//! RFQ quote signing helpers for Mollusk tests (ed25519, matches brine-ed25519 verify on-chain).

use ed25519_dalek::{Signer, SigningKey};
use pinocchio::Address;
use solana_pubkey::Pubkey;

use spamm_aggregator::constants::RFQ_NETWORK_MAINNET;
use spamm_aggregator::state::{
   build_rfq_bet_message, build_rfq_cashout_message, build_rfq_cashout_parlay_message,
   build_rfq_parlay_message, rfq_cashout_parlay_message_len, rfq_parlay_message_len, EventGameState,
   CashoutSnapshot, MarketId, ParlayLegQuoted, RFQ_BET_MESSAGE_LEN, RFQ_CASHOUT_MESSAGE_LEN,
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

/// Sign with the on-chain layout but domain byte flipped to mainnet (program verifies devnet).
pub fn sign_rfq_bet_quote_wrong_domain(
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
   message[0] = RFQ_NETWORK_MAINNET;
   sign_rfq_message(&message)
}

/// Sign covering a different MM program id than the fill accounts.
pub fn sign_rfq_bet_quote_other_mm(
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
   let other_mm = Address::new_from_array([0x11u8; 32]);
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
      &other_mm,
   )
   .expect("build rfq bet message");
   sign_rfq_message(&message)
}

pub fn sign_rfq_parlay_quote(
   user: &Pubkey,
   bet_id: u64,
   num_legs: u8,
   legs: &[ParlayLegQuoted],
   max_stake: u64,
   odds_scaled: u32,
   offer_expiry: u32,
) -> [u8; 64] {
   let n = num_legs as usize;
   let msg_len = rfq_parlay_message_len(n);
   let mut message = vec![0u8; msg_len];
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

pub fn sign_rfq_cashout_quote(
   user: &Pubkey,
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,
   max_payment: u64,
   offer_expiry: u32,
   event_state_sequence: u16,
   event_game_state: &EventGameState,
) -> [u8; 64] {
   let mut message = [0u8; RFQ_CASHOUT_MESSAGE_LEN];
   let user_addr = Address::new_from_array(user.to_bytes());
   let mm_program = Address::new_from_array(mm_program_id().to_bytes());
   build_rfq_cashout_message(
      &mut message,
      &user_addr,
      orig_bet_id,
      cashout_id,
      amount,
      max_payment,
      offer_expiry,
      event_state_sequence,
      event_game_state,
      &mm_program,
   )
   .expect("build rfq cashout message");
   sign_rfq_message(&message)
}

pub fn sign_rfq_cashout_parlay_quote(
   user: &Pubkey,
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,
   max_payment: u64,
   offer_expiry: u32,
   num_legs: u8,
   snapshots: &[CashoutSnapshot],
) -> [u8; 64] {
   let n = num_legs as usize;
   let msg_len = rfq_cashout_parlay_message_len(n);
   let mut message = vec![0u8; msg_len];
   let user_addr = Address::new_from_array(user.to_bytes());
   let mm_program = Address::new_from_array(mm_program_id().to_bytes());
   build_rfq_cashout_parlay_message(
      &mut message,
      &user_addr,
      orig_bet_id,
      cashout_id,
      amount,
      max_payment,
      offer_expiry,
      &mm_program,
      num_legs,
      snapshots,
   )
   .expect("build rfq cashout parlay message");
   sign_rfq_message(&message)
}
