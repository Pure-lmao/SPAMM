//! Extra copies of the example MM binary, each loaded under a distinct program id.

use solana_instruction::AccountMeta;
use solana_pubkey::Pubkey;

use spamm_aggregator::state::{EventId, MarketId};

use super::fixtures::*;

/// Solana transaction account cap. Mollusk does not enforce this.
pub const MAX_TX_ACCOUNTS: usize = 64;

/// Extra slots `1..=12` plus the default program (`0`) = 13 executables (proxy N=12).
pub const EXTRA_MM_SLOTS: u8 = 12;

/// Adversarial MM program id (lying quotes / short transfers).
pub fn adversarial_mm_program_id() -> Pubkey {
   Pubkey::new_from_array([0xAD; 32])
}

pub fn adversarial_mm_admin() -> Pubkey {
   Pubkey::new_from_array([0xAE; 32])
}

pub fn mm_alt_program_id(slot: u8) -> Pubkey {
   assert!((1..=EXTRA_MM_SLOTS).contains(&slot));
   Pubkey::new_from_array([0xB0 + slot; 32])
}

pub fn mm_alt_admin(slot: u8) -> Pubkey {
   assert!((1..=EXTRA_MM_SLOTS).contains(&slot));
   Pubkey::new_from_array([0xC0 + slot; 32])
}

/// Second user for interleaved lifecycle tests.
pub fn user_b() -> Pubkey {
   Pubkey::new_from_array([0xA6; 32])
}

pub fn user_b_collateral_ata() -> Pubkey {
   spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
      &user_b(),
      &mint_pubkey(),
      &mollusk_svm_programs_token::token::ID,
   )
}

#[derive(Clone, Copy)]
pub struct MmKeys {
   pub slot: u8,
   pub program_id: Pubkey,
   pub admin: Pubkey,
   pub config: Pubkey,
   pub quote_buf: Pubkey,
   pub parlay_buf: Pubkey,
}

impl MmKeys {
   pub fn default_mm() -> Self {
      Self {
         slot: 0,
         program_id: mm_program_id(),
         admin: mm_admin(),
         config: mm_config_pda(),
         quote_buf: mm_quote_buffer_pda(),
         parlay_buf: mm_parlay_quote_buffer_pda(),
      }
   }

   pub fn extra(slot: u8) -> Self {
      let program_id = mm_alt_program_id(slot);
      Self {
         slot,
         program_id,
         admin: mm_alt_admin(slot),
         config: Pubkey::find_program_address(&[b"config"], &program_id).0,
         quote_buf: Pubkey::find_program_address(&[b"mm_quote_buffer"], &program_id).0,
         parlay_buf: Pubkey::find_program_address(&[b"mm_parlay_quote_buffer"], &program_id).0,
      }
   }

   pub fn adversarial() -> Self {
      let program_id = adversarial_mm_program_id();
      Self {
         slot: 99,
         program_id,
         admin: adversarial_mm_admin(),
         config: Pubkey::find_program_address(&[b"config"], &program_id).0,
         quote_buf: Pubkey::find_program_address(&[b"mm_quote_buffer"], &program_id).0,
         parlay_buf: Pubkey::find_program_address(&[b"mm_parlay_quote_buffer"], &program_id).0,
      }
   }

   pub fn encumbrance(&self) -> Pubkey {
      Pubkey::find_program_address(
         &[b"encumbrance", self.program_id.as_ref(), mint_pubkey().as_ref()],
         &agg_program_id(),
      ).0
   }

   pub fn liability_ata(&self) -> Pubkey {
      spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
         &self.encumbrance(),
         &mint_pubkey(),
         &mollusk_svm_programs_token::token::ID,
      )
   }

   pub fn collateral_ata(&self) -> Pubkey {
      spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
         &self.config,
         &mint_pubkey(),
         &mollusk_svm_programs_token::token::ID,
      )
   }

   pub fn event_state(&self, eid: &EventId) -> Pubkey {
      let e = eid.as_wire_bytes();
      Pubkey::find_program_address(&[b"event_state", e.as_slice()], &self.program_id).0
   }

   pub fn market_data(&self, mid: &MarketId) -> Pubkey {
      let w = market_id_wire_bytes(mid);
      let (body, operator, mint) = spamm_aggregator::state::market_id_pda_seed_parts(&w);
      Pubkey::find_program_address(&[b"market_data", body, operator, mint], &self.program_id).0
   }

   pub fn netting(&self, eid: &EventId) -> Pubkey {
      let e = eid.as_wire_bytes();
      Pubkey::find_program_address(
         &[
            b"netting",
            self.program_id.as_ref(),
            e.as_slice(),
            market_operator().as_ref(),
            mint_pubkey().as_ref(),
         ],
         &agg_program_id(),
      )
      .0
   }

   pub fn fill_bet_group(&self, market: &MarketId, mm_netting: Pubkey) -> Vec<AccountMeta> {
      vec![
         AccountMeta::new_readonly(self.program_id, false),
         AccountMeta::new(self.config, false),
         AccountMeta::new(self.event_state(&market.event_id), false),
         AccountMeta::new(self.market_data(market), false),
         AccountMeta::new(self.quote_buf, false),
         AccountMeta::new(self.encumbrance(), false),
         AccountMeta::new(self.liability_ata(), false),
         AccountMeta::new(self.collateral_ata(), false),
         AccountMeta::new(mm_netting, false),
      ]
   }

   pub fn fill_parlay_group(&self) -> Vec<AccountMeta> {
      vec![
         AccountMeta::new_readonly(self.program_id, false),
         AccountMeta::new(self.config, false),
         AccountMeta::new(self.parlay_buf, false),
         AccountMeta::new(self.encumbrance(), false),
         AccountMeta::new(self.liability_ata(), false),
         AccountMeta::new(self.collateral_ata(), false),
      ]
   }

   pub fn fill_rfq_bet_group(&self, market: &MarketId, mm_netting: Pubkey) -> Vec<AccountMeta> {
      vec![
         AccountMeta::new_readonly(self.program_id, false),
         AccountMeta::new(self.config, false),
         AccountMeta::new(self.event_state(&market.event_id), false),
         AccountMeta::new(self.market_data(market), false),
         AccountMeta::new(self.encumbrance(), false),
         AccountMeta::new(self.liability_ata(), false),
         AccountMeta::new(self.collateral_ata(), false),
         AccountMeta::new(mm_netting, false),
      ]
   }

   pub fn quote_proxy_group(&self, market: &MarketId) -> Vec<AccountMeta> {
      vec![
         AccountMeta::new_readonly(self.program_id, false),
         AccountMeta::new_readonly(self.config, false),
         AccountMeta::new_readonly(self.event_state(&market.event_id), false),
         AccountMeta::new_readonly(self.market_data(market), false),
         AccountMeta::new(self.quote_buf, false),
      ]
   }

   pub fn parlay_proxy_prefix(&self) -> Vec<AccountMeta> {
      vec![
         AccountMeta::new_readonly(self.program_id, false),
         AccountMeta::new_readonly(self.config, false),
         AccountMeta::new(self.parlay_buf, false),
      ]
   }
}
