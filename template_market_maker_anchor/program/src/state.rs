//! Anchor accounts whose Borsh layout is the SPAMM packed header.
//!
//! Byte 0 is the framework discriminator (`#[account(discriminator = …)]`).
//! The Borsh body is the header after that byte. Quote buffers stay exact-length.
//! Parlay buffers stay a raw leg table.

use anchor_lang::prelude::*;
use spamm_aggregator::state::{
   EventGameState, EventId, MarketId, EVENT_STATE_DISCRIMINATOR, MM_ACCOUNT_CONFIG_DISCRIMINATOR,
   MM_MARKET_DATA_PDA_DISCRIMINATOR, MM_QUOTE_BUFFER_DISCRIMINATOR, MM_QUOTE_BUFFER_LEN,
};

/// `u64` max amount, then `u32` odds. Borsh is 12 bytes, which is the quote return.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct SingleQuote {
   pub max_amount: u64,
   pub odds_scaled: u32,
}

impl SingleQuote {
   pub const ZERO: Self = Self {
      max_amount: 0,
      odds_scaled: 0,
   };
}

/// Packed `MarketId` (event id fields, then the rest). In-memory alignment is not the wire.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub struct MarketIdWire {
   pub event: u64,
   pub league: u16,
   pub sport: u8,
   pub player: u64,
   pub mkt: u16,
   pub period: u8,
   pub is_pregame: bool,
   pub operator: Pubkey,
   pub mint: Pubkey,
}

impl MarketIdWire {
   pub fn from_market(id: &MarketId) -> Self {
      let mut operator = [0u8; 32];
      operator.copy_from_slice(id.operator.as_ref());
      let mut mint = [0u8; 32];
      mint.copy_from_slice(id.mint.as_ref());
      Self {
         event: id.event_id.event,
         league: id.event_id.league,
         sport: id.event_id.sport,
         player: id.player,
         mkt: id.mkt,
         period: id.period,
         is_pregame: id.is_pregame,
         operator: Pubkey::new_from_array(operator),
         mint: Pubkey::new_from_array(mint),
      }
   }

   pub fn same(&self, id: &MarketId) -> bool {
      self == &Self::from_market(id)
   }
}

/// Packed `EventGameState`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub struct GameStateWire {
   pub game_phase: [u8; 4],
   pub home_primary: u8,
   pub away_primary: u8,
   pub home_secondary: u8,
   pub away_secondary: u8,
}

impl GameStateWire {
   pub fn from_state(state: &EventGameState) -> Self {
      Self {
         game_phase: state.game_phase,
         home_primary: state.home_primary,
         away_primary: state.away_primary,
         home_secondary: state.home_secondary,
         away_secondary: state.away_secondary,
      }
   }

   pub fn same(&self, state: &EventGameState) -> bool {
      self == &Self::from_state(state)
   }
}

/// Config PDA. Aggregator reads bump at offset 1 and admin after that.
#[account(discriminator = [MM_ACCOUNT_CONFIG_DISCRIMINATOR])]
#[derive(Default)]
pub struct Config {
   pub bump: u8,
   pub admin: Pubkey,
   pub rfq_signer: Pubkey,
}

/// Event-state header. Bytes after this header are unused by the template.
#[account(discriminator = [EVENT_STATE_DISCRIMINATOR])]
#[derive(Default)]
pub struct EventState {
   pub bump: u8,
   pub event: u64,
   pub league: u16,
   pub sport: u8,
   pub sequence: u16,
   pub game_state: GameStateWire,
}

impl EventState {
   pub fn matches_id(&self, id: &EventId) -> bool {
      self.event == id.event && self.league == id.league && self.sport == id.sport
   }
}

/// Market PDA header. The aggregator allows a longer account; this template keeps the minimum.
#[account(discriminator = [MM_MARKET_DATA_PDA_DISCRIMINATOR])]
#[derive(Default)]
pub struct Market {
   pub bump: u8,
}

/// Single-market quote buffer. Length is fixed by the aggregator.
#[account(discriminator = [MM_QUOTE_BUFFER_DISCRIMINATOR])]
#[derive(Default)]
pub struct QuoteBuffer {
   pub is_used: u8,
   pub user: Pubkey,
   pub market_id: MarketIdWire,
   pub side: u8,
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub game_state: GameStateWire,
   pub sequence: u16,
}

/// Write `value` over `info` only when the Anchor encoding is the whole account.
pub fn store_quote(info: &AccountInfo, value: &QuoteBuffer) -> bool {
   let Ok(mut data) = info.try_borrow_mut_data() else {
      return false;
   };
   if data.len() != MM_QUOTE_BUFFER_LEN {
      return false;
   }
   let mut buf = [0u8; MM_QUOTE_BUFFER_LEN];
   let mut cursor = std::io::Cursor::new(&mut buf[..]);
   if value.try_serialize(&mut cursor).is_err() || cursor.position() as usize != MM_QUOTE_BUFFER_LEN {
      return false;
   }
   data.copy_from_slice(&buf);
   true
}

#[cfg(test)]
mod layout {
   use super::*;
   use anchor_lang::AnchorSerialize;
   use pinocchio::Address;
   use spamm_aggregator::state::{
      mm_quote::QUOTE_DATA_LEN,
      other::{MmMarketDataPdaData, MM_MARKET_DATA_PDA_MIN_LEN},
      EventStateData, EventStateDataZc, MmAccountConfigZc, MMQuoteBuffer, CASHOUT_QUOTE_RETURN_LEN,
      EVENT_STATE_HEADER_LEN, MM_CONFIG_PDA_HEADER_LEN,
   };
   use zeropod::ZeroPodFixed;

   fn write_zc<T: Copy>(value: &T, len: usize) -> Vec<u8> {
      let mut out = vec![0u8; len];
      assert_eq!(std::mem::size_of::<T>(), len);
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), *value);
      }
      out
   }

   fn anchor_bytes<T: AccountSerialize>(value: &T) -> Vec<u8> {
      let mut out = Vec::new();
      value.try_serialize(&mut out).unwrap();
      out
   }

   fn sample_market() -> MarketId {
      MarketId {
         event_id: EventId {
            event: 9,
            league: 3,
            sport: 1,
         },
         player: 42,
         mkt: 7,
         period: 2,
         is_pregame: true,
         operator: Address::new_from_array([0x11; 32]),
         mint: Address::new_from_array([0x22; 32]),
      }
   }

   fn sample_game() -> EventGameState {
      EventGameState {
         game_phase: *b"T1\0\0",
         home_primary: 1,
         away_primary: 2,
         home_secondary: 3,
         away_secondary: 4,
      }
   }

   #[test]
   fn config_matches_packed_header() {
      let admin = Pubkey::new_from_array([0x22; 32]);
      let rfq = Pubkey::new_from_array([0x33; 32]);
      let zc = MmAccountConfigZc {
         discriminator: MM_ACCOUNT_CONFIG_DISCRIMINATOR,
         bump: 7,
         admin: Address::new_from_array(admin.to_bytes()),
         rfq_signer: Address::new_from_array(rfq.to_bytes()),
      };
      let raw = write_zc(&zc, MM_CONFIG_PDA_HEADER_LEN);
      let anchor = anchor_bytes(&Config {
         bump: 7,
         admin,
         rfq_signer: rfq,
      });
      assert_eq!(anchor, raw);
   }

   #[test]
   fn event_and_market_match_packed_headers() {
      let id = sample_market().event_id;
      let game = sample_game();
      let mut event_raw = vec![0u8; EVENT_STATE_HEADER_LEN];
      {
         let header = <EventStateData as ZeroPodFixed>::from_bytes_mut(&mut event_raw).unwrap();
         *header = EventStateDataZc {
            discriminator: EVENT_STATE_DISCRIMINATOR,
            bump: 4,
            event_id: id.to_zc(),
            sequence: 8u16.into(),
            game_state: game.to_zc(),
         };
      }
      let anchor_event = anchor_bytes(&EventState {
         bump: 4,
         event: id.event,
         league: id.league,
         sport: id.sport,
         sequence: 8,
         game_state: GameStateWire::from_state(&game),
      });
      assert_eq!(anchor_event, event_raw);

      let mut market_raw = vec![0u8; MM_MARKET_DATA_PDA_MIN_LEN];
      {
         let header = <MmMarketDataPdaData as ZeroPodFixed>::from_bytes_mut(&mut market_raw).unwrap();
         header.discriminator = MM_MARKET_DATA_PDA_DISCRIMINATOR;
         header.bump = 3;
      }
      assert_eq!(anchor_bytes(&Market { bump: 3 }), market_raw);
   }

   #[test]
   fn quote_buffer_and_returns_match_packed_wire() {
      let market = sample_market();
      let game = sample_game();
      let user = [0xABu8; 32];
      let packed = MMQuoteBuffer {
         discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
         is_used: 1,
         user_address: Address::new_from_array(user),
         market_id: market,
         side: 1,
         max_amount: 1000,
         odds_scaled: 15,
         event_game_state: game,
         event_state_sequence: 8,
      };
      let mut raw = vec![0u8; MM_QUOTE_BUFFER_LEN];
      packed.write_wire(&mut raw).unwrap();
      let anchor = anchor_bytes(&QuoteBuffer {
         is_used: 1,
         user: Pubkey::new_from_array(user),
         market_id: MarketIdWire::from_market(&market),
         side: 1,
         max_amount: 1000,
         odds_scaled: 15,
         game_state: GameStateWire::from_state(&game),
         sequence: 8,
      });
      assert_eq!(anchor, raw);

      let mut quote = Vec::new();
      SingleQuote {
         max_amount: 5,
         odds_scaled: 6,
      }
      .serialize(&mut quote)
      .unwrap();
      assert_eq!(quote.len(), QUOTE_DATA_LEN);
      assert_eq!(&quote[..8], &5u64.to_le_bytes());
      assert_eq!(&quote[8..], &6u32.to_le_bytes());

      let mut cashout = Vec::new();
      7u64.serialize(&mut cashout).unwrap();
      assert_eq!(cashout, 7u64.to_le_bytes());
      assert_eq!(cashout.len(), CASHOUT_QUOTE_RETURN_LEN);
   }
}
