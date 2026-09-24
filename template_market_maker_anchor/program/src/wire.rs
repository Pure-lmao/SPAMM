//! Packed (zeropod) instruction args. Anchor still Borsh-decodes handler
//! arguments; these impls read raw remaining bytes instead of length prefixes.

use std::io::{Error, ErrorKind, Read, Write};

use anchor_lang::{AnchorDeserialize, AnchorSerialize};
use spamm_aggregator::state::{
   ids::MARKET_ID_BODY_WIRE_LEN, EventGameState, EventId, MarketId, MARKET_ID_LEN,
};
use zeropod::ZeroPodFixed;

#[derive(Clone, Copy)]
pub struct EventIdArg {
   pub id: EventId,
   pub wire: [u8; EventId::WIRE_SIZE],
}

impl AnchorDeserialize for EventIdArg {
   fn deserialize_reader<R: Read>(reader: &mut R) -> std::io::Result<Self> {
      let mut wire = [0u8; EventId::WIRE_SIZE];
      reader.read_exact(&mut wire)?;
      let id = EventId::decode(&wire).ok_or_else(|| Error::new(ErrorKind::InvalidData, "event_id"))?;
      Ok(Self { id, wire })
   }
}

impl AnchorSerialize for EventIdArg {
   fn serialize<W: Write>(&self, writer: &mut W) -> std::io::Result<()> {
      writer.write_all(&self.wire)
   }
}

#[derive(Clone, Copy)]
pub struct MarketIdArg {
   pub id: MarketId,
   pub wire: [u8; MARKET_ID_LEN],
}

impl MarketIdArg {
   pub fn body(&self) -> &[u8] {
      &self.wire[..MARKET_ID_BODY_WIRE_LEN]
   }

   pub fn operator(&self) -> &[u8] {
      &self.wire[MARKET_ID_BODY_WIRE_LEN..]
   }
}

impl AnchorDeserialize for MarketIdArg {
   fn deserialize_reader<R: Read>(reader: &mut R) -> std::io::Result<Self> {
      let mut wire = [0u8; MARKET_ID_LEN];
      reader.read_exact(&mut wire)?;
      let id = MarketId::decode(&wire).ok_or_else(|| Error::new(ErrorKind::InvalidData, "market_id"))?;
      Ok(Self { id, wire })
   }
}

impl AnchorSerialize for MarketIdArg {
   fn serialize<W: Write>(&self, writer: &mut W) -> std::io::Result<()> {
      writer.write_all(&self.wire)
   }
}

#[derive(Clone, Copy)]
pub struct EventGameStateArg(pub EventGameState);

impl AnchorDeserialize for EventGameStateArg {
   fn deserialize_reader<R: Read>(reader: &mut R) -> std::io::Result<Self> {
      let mut buf = [0u8; <EventGameState as ZeroPodFixed>::SIZE];
      reader.read_exact(&mut buf)?;
      let zc = <EventGameState as ZeroPodFixed>::from_bytes(&buf)
         .map_err(|_| Error::new(ErrorKind::InvalidData, "event_game_state"))?;
      Ok(Self(EventGameState::from_zc(zc)))
   }
}

impl AnchorSerialize for EventGameStateArg {
   fn serialize<W: Write>(&self, writer: &mut W) -> std::io::Result<()> {
      let zc = self.0.to_zc();
      let mut out = [0u8; <EventGameState as ZeroPodFixed>::SIZE];
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      writer.write_all(&out)
   }
}

/// All bytes after the 1-byte instruction discriminator (variable-length ixs).
pub struct WireRest(pub Vec<u8>);

impl WireRest {
   pub fn with_disc(&self, disc: u8) -> Vec<u8> {
      let mut out = Vec::with_capacity(1 + self.0.len());
      out.push(disc);
      out.extend_from_slice(&self.0);
      out
   }
}

impl AnchorDeserialize for WireRest {
   fn deserialize_reader<R: Read>(reader: &mut R) -> std::io::Result<Self> {
      let mut rest = Vec::new();
      reader.read_to_end(&mut rest)?;
      Ok(Self(rest))
   }
}

impl AnchorSerialize for WireRest {
   fn serialize<W: Write>(&self, writer: &mut W) -> std::io::Result<()> {
      writer.write_all(&self.0)
   }
}
