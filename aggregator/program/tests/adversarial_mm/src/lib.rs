#![no_std]

use core::{mem::MaybeUninit, slice::from_raw_parts_mut};

use pinocchio::{
   MAX_TX_ACCOUNTS, ProgramResult, account::AccountView, address::address_eq, cpi::{Seed, Signer},
   entrypoint::deserialize, error::ProgramError, Address,
};
use pinocchio_token::instructions::Transfer;
use zeropod::ZeroPodFixed;
use spamm_aggregator::{
   constants::ODDS_SCALE,
   readers::read_u8_unchecked,
   state::{
      mm_account_config::{MM_ACCOUNT_CONFIG_SEED, MM_CONFIG_PDA_BUMP_OFFSET},
      mm_parlay_quote::{
         GetQuoteParlayIxHeader, MMParlayQuoteBuffer, ParlayLegQuoted, GET_QUOTE_PARLAY_IX_HEADER_LEN,
         PARLAY_LEG_SEL_LEN,
      },
      mm_quote::{
         GetParlayQuoteReturnWire, MMQuoteBuffer, QUOTE_DATA_LEN, MM_QUOTE_BUFFER_DISCRIMINATOR,
         MM_QUOTE_BUFFER_LEN,
      },
      GetQuoteIxData, ParlayLegSel, FILL_BET_QUOTE_IX_DISCRIMINATOR, FILL_BET_RFQ_IX_DISCRIMINATOR,
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR, FILL_QUOTE_PARLAY_IX_DISCRIMINATOR, GET_QUOTE_IX_DISCRIMINATOR,
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR, parlay_quote_return_wire_len,
   },
};

pinocchio::no_allocator!();

#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
   match deserialize_and_route(input) {
      Ok(()) => 0,
      Err(e) => e.into(),
   }
}

unsafe fn deserialize_and_route(input: *mut u8) -> ProgramResult {
   const UNINIT: MaybeUninit<AccountView> = MaybeUninit::<AccountView>::uninit();
   let mut account_storage = [UNINIT; MAX_TX_ACCOUNTS];
   let (program_id, count, instruction_data) =
      unsafe { deserialize::<MAX_TX_ACCOUNTS>(input, &mut account_storage) };
   let accounts = unsafe { from_raw_parts_mut(account_storage.as_mut_ptr() as *mut AccountView, count) };
   dispatch(program_id, accounts, instruction_data)
}

fn dispatch(
   _program_id: &Address,
   accounts: &mut [AccountView],
   instruction_data: &[u8],
) -> ProgramResult {
   let Some((disc, data)) = instruction_data.split_first() else {
      return Err(ProgramError::InvalidInstructionData);
   };
   match *disc {
      GET_QUOTE_IX_DISCRIMINATOR => get_quote(accounts, data),
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR => get_quote_parlay(accounts, data),
      FILL_BET_QUOTE_IX_DISCRIMINATOR => fill_short(accounts, data, 4, 6, 7),
      FILL_QUOTE_PARLAY_IX_DISCRIMINATOR => fill_short(accounts, data, 2, 4, 5),
      FILL_BET_RFQ_IX_DISCRIMINATOR => fill_short(accounts, data, 4, 5, 6),
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR => fill_short(accounts, data, 2, 3, 4),
      _ => Ok(()),
   }
}

fn lie_odds(min_odds: u32) -> u32 {
   if min_odds >= 16_000 {
      min_odds.saturating_sub(1)
   } else {
      20_000
   }
}

fn get_quote(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let mut full = [0u8; GetQuoteIxData::WIRE_LEN];
   if data.len() + 1 != GetQuoteIxData::WIRE_LEN {
      return set_quote_return(0, 0);
   }
   full[0] = GET_QUOTE_IX_DISCRIMINATOR;
   full[1..].copy_from_slice(data);
   let parsed = GetQuoteIxData::decode(&full)?;
   let odds = lie_odds(parsed.odds_scaled);
   let user = accounts[0].address();
   let quote = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user,
      market_id: parsed.market_id,
      side: parsed.side,
      max_amount: parsed.amount,
      odds_scaled: odds,
      event_game_state: parsed.event_game_state,
      event_state_sequence: parsed.event_state_sequence,
   };
   {
      let mut w = accounts[5].try_borrow_mut()?;
      if w.len() != MM_QUOTE_BUFFER_LEN {
         return Err(ProgramError::InvalidAccountData);
      }
      quote.write_wire(&mut w)?;
   }
   set_quote_return(parsed.amount, odds)
}

fn get_quote_parlay(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   const MAX_ADV_LEGS: usize = 4;
   if data.len() + 1 < GET_QUOTE_PARLAY_IX_HEADER_LEN {
      return Err(ProgramError::InvalidInstructionData);
   }
   let mut hdr = [0u8; GET_QUOTE_PARLAY_IX_HEADER_LEN];
   hdr[0] = GET_QUOTE_PARLAY_IX_DISCRIMINATOR;
   hdr[1..].copy_from_slice(&data[..GET_QUOTE_PARLAY_IX_HEADER_LEN - 1]);
   let h = <GetQuoteParlayIxHeader as ZeroPodFixed>::from_bytes(&hdr)
      .map_err(|_| ProgramError::InvalidInstructionData)?;
   let n = h.num_legs as usize;
   if n < 2 || n > MAX_ADV_LEGS {
      return Err(ProgramError::InvalidInstructionData);
   }
   let legs_off = GET_QUOTE_PARLAY_IX_HEADER_LEN - 1;
   if data.len() < legs_off + n * PARLAY_LEG_SEL_LEN {
      return Err(ProgramError::InvalidInstructionData);
   }
   let amount = h.amount.get();
   let combined = lie_odds(h.odds_scaled.get());
   let mut legs = [ParlayLegQuoted::placeholder(); MAX_ADV_LEGS];
   let mut leg_odds = [0u32; MAX_ADV_LEGS];
   for i in 0..n {
      let start = legs_off + i * PARLAY_LEG_SEL_LEN;
      let sel_z = <ParlayLegSel as ZeroPodFixed>::from_bytes(&data[start..start + PARLAY_LEG_SEL_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let sel = ParlayLegSel::from_zc(&sel_z).ok_or(ProgramError::InvalidInstructionData)?;
      let o = if i == 0 { combined } else { ODDS_SCALE as u32 };
      legs[i] = ParlayLegQuoted {
         market_id: sel.market_id,
         side: sel.side,
         event_state_sequence: sel.event_state_sequence,
         event_game_state: sel.event_game_state,
         odds_scaled: o,
      };
      leg_odds[i] = o;
   }
   let user = *accounts[0].address();
   {
      let mut w = accounts[3].try_borrow_mut()?;
      MMParlayQuoteBuffer::write_fresh_quote(&mut w, user, h.num_legs, amount, combined, &legs[..n])?;
   }
   let mut packed_odds = [0u32; spamm_aggregator::constants::MAX_PARLAY_LEGS];
   packed_odds[..n].copy_from_slice(&leg_odds[..n]);
   let ret = GetParlayQuoteReturnWire {
      max_amount: amount,
      odds_scaled: combined,
      num_legs: h.num_legs,
      leg_odds: packed_odds,
   };
   let len = parlay_quote_return_wire_len(n);
   let mut out = [0u8; 64];
   if len > out.len() {
      return Err(ProgramError::InvalidInstructionData);
   }
   ret.write_wire(&mut out[..len])?;
   pinocchio::cpi::set_return_data(&out[..len]);
   Ok(())
}

fn set_quote_return(max_amount: u64, odds: u32) -> ProgramResult {
   let mut out = [0u8; QUOTE_DATA_LEN];
   out[..8].copy_from_slice(&max_amount.to_le_bytes());
   out[8..12].copy_from_slice(&odds.to_le_bytes());
   pinocchio::cpi::set_return_data(&out);
   Ok(())
}

fn fill_short(
   accounts: &mut [AccountView],
   data: &[u8],
   config_i: usize,
   from_i: usize,
   to_i: usize,
) -> ProgramResult {
   if data.len() < 8 {
      return Err(ProgramError::InvalidInstructionData);
   }
   let mut amt_bytes = [0u8; 8];
   amt_bytes.copy_from_slice(&data[data.len() - 8..]);
   let send = u64::from_le_bytes(amt_bytes).saturating_sub(1);
   if send == 0 {
      return Ok(());
   }
   let config = &accounts[config_i];
   let from = &accounts[from_i];
   let to = &accounts[to_i];
   let bump = unsafe { read_u8_unchecked(config.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) };
   let expected = Address::derive_address(&[MM_ACCOUNT_CONFIG_SEED], Some(bump), config.owner());
   if !address_eq(config.address(), &expected) {
      return Err(ProgramError::InvalidSeeds);
   }
   let bump_ref = [bump];
   let seeds = [Seed::from(MM_ACCOUNT_CONFIG_SEED), Seed::from(&bump_ref as &[u8])];
   let signers = [Signer::from(&seeds)];
   Transfer::new(from, to, config, send).invoke_signed(&signers)?;
   Ok(())
}
