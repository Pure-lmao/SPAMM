use pinocchio::{
   AccountView, Address, ProgramResult, cpi::Signer, error::ProgramError, hint::unlikely,
   address::address_eq,
};
use pinocchio_log::log;
use pinocchio_token::{ID as TOKEN_PROGRAM_ID, instructions::{CloseAccount, Transfer as TokenTransfer}};
use pinocchio_associated_token_account::ID as ASSOCIATED_TOKEN_PROGRAM_ID;
use pinocchio_system::ID as SYSTEM_ID;

use zeropod::ZeroPodFixed;

use crate::{
   ID,
   constants::{ADDRESS_LOOKUP_TABLE_PROGRAM, CONFIG_PDA, LOOKUP_TABLE, MINT, MM_LIST_PDA, ODDS_SCALE},
   parsers::get_token_account_balance,
   readers::{read_address_unchecked, read_u8_unchecked},
   state::{
      EVENT_STATE_DISCRIMINATOR, EVENT_STATE_LEN, EVENT_STATE_SEED, EventGameState, EventId, EventStateData, MM_ACCOUNT_CONFIG_MIN_LEN, MM_ACCOUNT_CONFIG_SEED, MM_PARLAY_QUOTE_BUFFER_LEN, MM_QUOTE_BUFFER_LEN, MarketId, NETTING_PDA_DISCRIMINATOR, NETTING_PDA_MIN_LEN, NETTING_PDA_SEED, mm_account_config::{MM_CONFIG_PDA_ADMIN_OFFSET, MM_CONFIG_PDA_BUMP_OFFSET}, other::{
         CONFIG_PDA_AUTHORITY_OFFSET, CONFIG_PDA_STATUS_OFFSET, MM_ENCUMBRANCE_PDA_BUMP_OFFSET, MM_ENCUMBRANCE_PDA_LEN, MM_ENCUMBRANCE_PDA_SEED, MM_MARKET_DATA_PDA_BUMP_OFFSET, MM_MARKET_DATA_PDA_MIN_LEN, MM_MARKET_DATA_PDA_SEED
      }
   },
};

pub const TOKEN_ACCOUNT_LEN: usize = 165;
const MINT_LEN: usize = 82;
const ADDRESS_LEN: usize = 32;

const TOKEN_ACCOUNT_MINT_OFFSET: usize = 0;
const TOKEN_ACCOUNT_OWNER_OFFSET: usize = TOKEN_ACCOUNT_MINT_OFFSET + ADDRESS_LEN;

#[inline(always)]
pub fn verify_signer(signer: &AccountView) -> ProgramResult {
   if unlikely(!signer.is_signer()) {
      log!("verify_signer: signer must be a signer");
      return Err(ProgramError::MissingRequiredSignature);
   }
   Ok(())
}

pub fn verify_token_program(token_program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(token_program.address(), &TOKEN_PROGRAM_ID)) {
      log!("verify_token_program: token program must be the token program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

#[inline(always)]
pub fn verify_mint(mint: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(mint.address(), &MINT)) {
      log!("verify_mint: mint must be defined mint");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

pub fn verify_associated_token_program(associated_token_program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(associated_token_program.address(), &ASSOCIATED_TOKEN_PROGRAM_ID)) {
      log!("verify_associated_token_program: associated token program must be the associated token program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

pub fn verify_system_program(system_program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(system_program.address(), &SYSTEM_ID)) {
      log!("verify_system_program: system program must be the system program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

/// Executable MM program account owned by the upgradeable BPF loader. Add other loaders if you need them.
#[inline(always)]
pub fn verify_mm_program_executable(mm_program: &AccountView) -> ProgramResult {
   if unlikely(!mm_program.executable()) {
      log!("verify_mm_program_loaded: mm_program must be executable");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

pub fn verify_mm_market_data_pda(mm_market_data_pda: &AccountView, mm_program_account: &AccountView, market_id: &MarketId) -> bool {
   if unlikely(!address_eq(mm_market_data_pda.owner(), &mm_program_account.address())) {
      return false;
   }
   

   if unlikely(mm_market_data_pda.data_len() < MM_MARKET_DATA_PDA_MIN_LEN) {
      return false;
   };

   let bump = unsafe { 
      read_u8_unchecked(mm_market_data_pda.data_ptr(), MM_MARKET_DATA_PDA_BUMP_OFFSET) };
   let mut market_wire = [0u8; MarketId::WIRE_SIZE];
   let zc = market_id.to_zc();
   unsafe {
      core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
   }
   let seeds = [
      MM_MARKET_DATA_PDA_SEED,
      market_wire.as_slice(),
   ];

   let expected_pda = Address::derive_address(
      &seeds,
      Some(bump),
      &mm_program_account.address()
   );

   if unlikely(!address_eq(mm_market_data_pda.address(), &expected_pda)) {
      return false;
   }

   return true
}





pub fn verify_token_account(
   throw_error: bool,
   token_account: &AccountView, 
   owner: &AccountView, 
   mint: &AccountView, 
   token_program: &AccountView, 
) -> Result<bool, ProgramError> {
   if unlikely(!address_eq(token_account.owner(), token_program.address())) {
      if throw_error {
         log!("verify_token_account: token account must be owned by the token program");
         return Err(ProgramError::InvalidAccountOwner);
      } 
      return Ok(false);
   }
   if unlikely(!address_eq(mint.owner(), token_program.address())) {
      if throw_error {
         log!("verify_token_account: mint must be owned by the token program");
         return Err(ProgramError::InvalidAccountOwner);
      }
      return Ok(false);
   }

   if unlikely(token_account.data_len() != TOKEN_ACCOUNT_LEN) {
      if throw_error {
         log!("verify_token_account: token account data length is invalid");
         return Err(ProgramError::InvalidAccountData);
      }
      return Ok(false);
   }
   if unlikely(mint.data_len() != MINT_LEN) {
      if throw_error {
         log!("verify_token_account: mint data length is invalid");
         return Err(ProgramError::InvalidAccountData);
      }
      return Ok(false);
   }

   let token_account_mint = unsafe { 
      read_address_unchecked(token_account.data_ptr(), TOKEN_ACCOUNT_MINT_OFFSET) };
   let token_account_owner = unsafe { 
      read_address_unchecked(token_account.data_ptr(), TOKEN_ACCOUNT_OWNER_OFFSET) };

   if unlikely(!address_eq(&token_account_mint, mint.address())) {
      if throw_error {
         log!("verify_token_account: token account mint must match mint account");
         return Err(ProgramError::InvalidAccountData);
      }
      return Ok(false);
   }
   if unlikely(!address_eq(&token_account_owner, owner.address())) {
      if throw_error {
         log!("verify_token_account: token account owner must match owner account");
         return Err(ProgramError::IncorrectAuthority);
      }
      return Ok(false);
   }
   Ok(true)
}

pub fn verify_netting_pda(netting_pda: &AccountView, mm_program_account: &AccountView, event_id: &EventId) -> bool {
   let event_id_wire = event_id.as_wire_bytes();
   let seeds = [
      NETTING_PDA_SEED,
      mm_program_account.address().as_ref(),
      event_id_wire.as_slice(),
   ];

   let (expected_pda, _bump) = Address::find_program_address(
      &seeds, 
      &ID
   );
   if unlikely(!address_eq(netting_pda.address(), &expected_pda)) {
      return false;
   }

   return true;
}

/// `fill_bet` netting slot: either the real netting PDA for this MM + event, or the system program
/// id as a placeholder when no netting account exists yet (same as devnet clients).
#[inline]
pub fn verify_netting_pda_or_placeholder(
   netting_pda: &AccountView,
   mm_program_account: &AccountView,
   event_id: &EventId,
) -> bool {
   if address_eq(netting_pda.address(), &SYSTEM_ID) {
      return true;
   }
   verify_netting_pda(netting_pda, mm_program_account, event_id)
}


pub fn verify_netting_pda_exists(netting_pda: &AccountView, mm_program_account: &AccountView, event_id: &EventId) -> ProgramResult {
   if unlikely(!address_eq(netting_pda.owner(), &ID)) {
      log!("verify_netting_pda: netting pda must be owned by the program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   if unlikely(netting_pda.data_len() < NETTING_PDA_MIN_LEN) {
      log!("verify_netting_pda: netting pda data length is invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   let netting_pda_discriminator = unsafe { 
      read_u8_unchecked(netting_pda.data_ptr(), 0) };
   if unlikely(netting_pda_discriminator != NETTING_PDA_DISCRIMINATOR) {
      log!("verify_netting_pda: netting pda discriminator must be the netting pda discriminator");
      return Err(ProgramError::InvalidAccountData);
   }

   let netting_pda_bump = unsafe { 
      read_u8_unchecked(netting_pda.data_ptr(), 1) };

   let event_id_wire = event_id.as_wire_bytes();
   let seeds = [
      NETTING_PDA_SEED,
      mm_program_account.address().as_ref(),
      event_id_wire.as_slice(),
   ];

   let expected_pda = Address::derive_address(
      &seeds, 
      Some(netting_pda_bump), 
      &ID
   );
   if unlikely(!address_eq(netting_pda.address(), &expected_pda)) {
      log!("verify_netting_pda: netting pda must match expected pda");
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

pub fn verify_config_pda(config_pda: &AccountView, check_status: bool) -> ProgramResult {
   if unlikely(!address_eq(config_pda.address(), &CONFIG_PDA)) {
      log!("verify_config_pda: config pda must be as defined in the program");
      return Err(ProgramError::InvalidSeeds);
   }

   if check_status {
      let config_status = unsafe { read_u8_unchecked(config_pda.data_ptr(), CONFIG_PDA_STATUS_OFFSET) };
      if unlikely(config_status == 0) {
         log!("verify_config_pda: config pda status must not be PAUSED");
         return Err(ProgramError::InvalidAccountData);
      }
   }

   Ok(())
}

/// `mm_list_pda` must be the program-derived address for seed [`MM_LIST_PDA_SEED`], owned by this
/// program, with header discriminator and minimum size.
#[inline(always)]
pub fn verify_mm_list_pda(mm_list_pda: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(mm_list_pda.address(), &MM_LIST_PDA)) {
      log!("verify_mm_list_pda: mm list pda must be as defined in the program");
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

pub fn verify_authority(authority: &AccountView, config_pda: &AccountView) -> ProgramResult {
   //config pda data should already be verified as the real config pda
   let config_auth = unsafe { read_address_unchecked(config_pda.data_ptr(), CONFIG_PDA_AUTHORITY_OFFSET) };

   if unlikely(!address_eq(authority.address(), &config_auth)) {
      log!("verify_authority: authority must be the config pda authority");
      return Err(ProgramError::IncorrectAuthority);
   }
   Ok(())
}

pub fn verify_quote_buffer(
   quote_buffer: &AccountView,
   mm_program_account: &AccountView
) -> bool {
   if unlikely(!address_eq(quote_buffer.owner(), mm_program_account.address())) {
      return false;
   }

   if unlikely(quote_buffer.data_len() != MM_QUOTE_BUFFER_LEN) {
      return false;
   }

   return true;
}

/// Parlay quote buffer: MM-owned PDA with [`MM_PARLAY_QUOTE_BUFFER_LEN`] bytes (see `mm_parlay_quote`).
#[inline(always)]
pub fn verify_parlay_quote_buffer(
   quote_buffer: &AccountView,
   mm_program_account: &AccountView
) -> bool {
   if unlikely(!address_eq(quote_buffer.owner(), mm_program_account.address())) {
      return false;
   }

   if unlikely(quote_buffer.data_len() != MM_PARLAY_QUOTE_BUFFER_LEN) {
      return false;
   }

   true
}

#[inline(always)]
pub fn verify_lookup_table(lookup_table: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(lookup_table.address(), &LOOKUP_TABLE)) {
      log!("verify_lookup_table: lookup table must be as defined in the program");
      return Err(ProgramError::InvalidSeeds);
   }

   Ok(())
}

#[inline(always)]
pub fn verify_address_lookup_table_program(lookup_table_program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(lookup_table_program.address(), &ADDRESS_LOOKUP_TABLE_PROGRAM)) {
      log!("verify_address_lookup_table_program: lookup table program must be the address lookup table program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

#[inline(always)]
pub fn verify_event_state(
   event_state_pda: &AccountView,
   mm_program_account: &AccountView,
   event_id: &EventId,
   event_game_state: &EventGameState,
   event_state_sequence: &u16,
) -> bool {
   if unlikely(!address_eq(event_state_pda.owner(), mm_program_account.address())) {
      #[cfg(feature = "log")]
      log!("verify_event_state: fail owner (event_state owner != mm program id)");
      return false;
   }

   let event_state_data = match event_state_pda.try_borrow() {
      Ok(data) => data,
      Err(_) => {
         #[cfg(feature = "log")]
         log!("verify_event_state: fail borrow (account data borrow)");
         return false;
      }
   };

   if unlikely(event_state_data.len() != EVENT_STATE_LEN) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail data_len got={} want={}",
         event_state_data.len() as u64,
         EVENT_STATE_LEN as u64
      );
      return false;
   }

   let state = match EventStateData::from_bytes(&event_state_data) {
      Ok(s) => s,
      Err(_) => {
         #[cfg(feature = "log")]
         log!("verify_event_state: fail from_bytes (wire invalid for EventStateData)");
         return false;
      }
   };
   if unlikely(state.discriminator != EVENT_STATE_DISCRIMINATOR) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail discriminator got={} want={}",
         state.discriminator as u64,
         EVENT_STATE_DISCRIMINATOR as u64
      );
      return false;
   }

   let event_id_wire = event_id.as_wire_bytes();
   let seeds = [
      EVENT_STATE_SEED,
      event_id_wire.as_slice(),
   ];
   let expected_pda = Address::derive_address(
      &seeds,
      Some(state.bump),
      &mm_program_account.address()
   );
   if unlikely(!address_eq(event_state_pda.address(), &expected_pda)) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail pda bump={} (derive_address != account key)",
         state.bump as u64
      );
      return false;
   }

   if unlikely(state.sequence.get() != *event_state_sequence) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail sequence acct={} ix={}",
         state.sequence.get() as u64,
         *event_state_sequence as u64
      );
      return false;
   }

   if unlikely(EventGameState::from_zc(&state.game_state) != *event_game_state) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail game_state acct_u64={} ix_u64={}",
         EventGameState::from_zc(&state.game_state).as_u64(),
         event_game_state.as_u64()
      );
      return false;
   }

   return true
}

pub fn verify_mm_config_pda(mm_config_pda: &AccountView, mm_program_account: &AccountView) -> bool {
   if unlikely(!address_eq(mm_config_pda.owner(), &mm_program_account.address())) {
      return false;
   }

   if unlikely(mm_config_pda.data_len() < MM_ACCOUNT_CONFIG_MIN_LEN) {
      return false;
   }

   let stored_bump = unsafe { 
      read_u8_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) 
   };

   let expected_address = Address::derive_address(
      &[MM_ACCOUNT_CONFIG_SEED],
      Some(stored_bump),
      mm_program_account.address(),
   );

   if unlikely(!address_eq(mm_config_pda.address(), &expected_address)) {
      return false;
   }
   
   return true;
}

#[inline(always)]
pub fn verify_mm_admin(admin: &AccountView, mm_program_account: &AccountView, config_pda: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(config_pda.owner(), &mm_program_account.address())) {
      log!("verify_mm_admin: config pda must be owned by the mm program");
      return Err(ProgramError::InvalidAccountOwner);
   }

   if unlikely(config_pda.data_len() < MM_ACCOUNT_CONFIG_MIN_LEN) {
      log!("verify_mm_admin: config pda data length is invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   let stored_bump = unsafe { 
      read_u8_unchecked(config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) 
   };
   let stored_admin = unsafe { 
      read_address_unchecked(config_pda.data_ptr(), MM_CONFIG_PDA_ADMIN_OFFSET) 
   };

   let expected_address = Address::derive_address(
      &[MM_ACCOUNT_CONFIG_SEED],
      Some(stored_bump),
      mm_program_account.address(),
   );

   if unlikely(!address_eq(config_pda.address(), &expected_address)) {
      log!("verify_mm_admin: config pda address does not match seeds");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(!address_eq(admin.address(), &stored_admin)) {
      log!("verify_mm_admin: signer does not match config admin");
      return Err(ProgramError::IncorrectAuthority);
   }

   Ok(())
}

pub fn verify_mm_encumbrance_pda(mm_encumbrance_pda: &AccountView, mm_program_account: &AccountView) -> Option<u8> {
   if unlikely(!address_eq(mm_encumbrance_pda.owner(), &ID)) {
      #[cfg(feature = "log")]
      log!("verify_mm_encumbrance_pda: encumbrance pda must be owned by the program");
      return None;
   }

   if unlikely(mm_encumbrance_pda.data_len() != MM_ENCUMBRANCE_PDA_LEN) {
      #[cfg(feature = "log")]
      log!("verify_mm_encumbrance_pda: encumbrance pda data length is invalid");
      return None;
   }

   let stored_bump = unsafe { 
      read_u8_unchecked(mm_encumbrance_pda.data_ptr(), MM_ENCUMBRANCE_PDA_BUMP_OFFSET) 
   };
   let expected_address = Address::derive_address(
      &[
         MM_ENCUMBRANCE_PDA_SEED,
         mm_program_account.address().as_ref(),
      ],
      Some(stored_bump),
      &ID,
   );

   if unlikely(!address_eq(mm_encumbrance_pda.address(), &expected_address)) {
      #[cfg(feature = "log")]
      log!("verify_mm_encumbrance_pda: encumbrance pda address does not match seeds");
      return None;
   }

   Some(stored_bump)
}

/// Move all lamports from `pda` to `recipient` (PDA signs with `signers`), then [`AccountView::close`].
#[inline(never)]
pub fn close_pda_return_rent(
   pda: &mut AccountView,
   recipient: &mut AccountView,
) -> ProgramResult {
   let dest_lamports = recipient.lamports();
   let pda_lamports = pda.lamports();

   pda.set_lamports(0);
   recipient.set_lamports(dest_lamports + pda_lamports);
   pda.close()
}

#[inline(always)]
pub fn safe_close_ata(
   ata: &mut AccountView,
   lamport_dest: &mut AccountView,
   token_dest: &mut AccountView,
   authority: &mut AccountView,
   signers: &[Signer],
) -> ProgramResult {
   let token_balance = get_token_account_balance(ata)?;
   if token_balance > 0 {
      TokenTransfer::new(
         ata,
         token_dest,
         authority,
         token_balance,
      ).invoke_signed(signers)?;
   }

   CloseAccount::new(
      ata, lamport_dest, authority
   ).invoke_signed(signers)?;

   Ok(())
}

#[inline(always)]
pub fn get_rent_local(space: u64) -> u64 {
   if unlikely(space == 0) {
      return 0;
   }
   // (overhead + space) * lamports_per_byte
   let rent = (128 + space) * 6960;
   return rent;
}

pub fn calc_potential_profit(amount: u64, odds_scaled: u32) -> Result<u64, ProgramError> {
   let profit = (odds_scaled as u128)
   .checked_sub(ODDS_SCALE).ok_or_else(|| ProgramError::ArithmeticOverflow)?
   .checked_mul(amount as u128).ok_or_else(|| ProgramError::ArithmeticOverflow)?
   .checked_div(ODDS_SCALE).ok_or_else(|| ProgramError::ArithmeticOverflow)?
   .try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;

   Ok(profit)
}

pub fn calc_potential_payout(amount: u64, odds_scaled: u32) -> Result<u64, ProgramError> {
   let payout = (odds_scaled as u128)
   .checked_mul(amount as u128).ok_or_else(|| ProgramError::ArithmeticOverflow)?
   .checked_div(ODDS_SCALE).ok_or_else(|| ProgramError::ArithmeticOverflow)?
   .try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;

   Ok(payout)
}