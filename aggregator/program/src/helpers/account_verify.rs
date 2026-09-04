use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely, sysvars::{
      clock::CLOCK_ID, instructions::INSTRUCTIONS_ID, rent::RENT_ID,
   },
};
use pinocchio_associated_token_account::ID as ASSOCIATED_TOKEN_PROGRAM_ID;
use pinocchio_log::log;
use pinocchio_system::ID as SYSTEM_ID;
use pinocchio_token::ID as TOKEN_PROGRAM_ID;

use super::derive_pdas::{
   derive_bet_pda, derive_cashout_pda, derive_cashout_parlay_pda, derive_encumbrance_pda,
   derive_event_state_pda, derive_mm_config_pda, derive_mm_market_data_pda, derive_netting_pda,
   derive_parlay_pda,
};
use crate::{
   ID, constants::{
      ADDRESS_LEN, CONFIG_PDA, MAX_NUMBER_OF_MMS_PROXY, MINT, MM_LIST_PDA,
   }, errors::SpammError, readers::{read_address_ref_unchecked, read_u8_unchecked, read_u16_le_unchecked, read_u64_le_unchecked}, 
   state::{
      EVENT_STATE_BUMP_OFFSET, EVENT_STATE_DISCRIMINATOR, EVENT_STATE_GAME_STATE_OFFSET, EVENT_STATE_HEADER_LEN, 
      EVENT_STATE_SEQUENCE_OFFSET, EventGameState, EventId, MARKET_ID_LEN, MM_CONFIG_PDA_HEADER_LEN, 
      MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR, MM_PARLAY_QUOTE_BUFFER_LEN, MM_QUOTE_BUFFER_DISCRIMINATOR, 
      MM_QUOTE_BUFFER_LEN, NETTING_PDA_DISCRIMINATOR, NETTING_PDA_MIN_LEN, 
      mm_account_config::{MM_CONFIG_PDA_ADMIN_OFFSET, MM_CONFIG_PDA_BUMP_OFFSET}, other::{
         CONFIG_PDA_AUTHORITY_OFFSET, CONFIG_PDA_STATUS_OFFSET, MM_ENCUMBRANCE_PDA_BUMP_OFFSET,
         MM_ENCUMBRANCE_PDA_LEN, MM_MARKET_DATA_PDA_BUMP_OFFSET,
         MM_MARKET_DATA_PDA_MIN_LEN,
      },
   },
};

#[inline(always)]
pub fn verify_signer(signer: &AccountView) -> ProgramResult {
   if unlikely(!signer.is_signer()) {
      log!("verify_signer: signer must be a signer");
      return Err(ProgramError::MissingRequiredSignature);
   }
   Ok(())
}

/// Unused means empty data and not owned by this program.
#[inline(always)]
pub fn ensure_pda_unused(pda: &AccountView, label: &str) -> ProgramResult {
   if unlikely(pda.data_len() > 0 || address_eq(pda.owner(), &ID)) {
      log!("{}: pda already initialized", label);
      return Err(SpammError::AccountAlreadyExists.into());
   }
   Ok(())
}

/// Existing single-bet ticket PDA: one `derive_bet_pda` with the stored bump.
#[inline(always)]
pub fn verify_bet_pda(
   pda: &AccountView,
   owner: &Address,
   bet_id: u64,
   bump: u8,
) -> ProgramResult {
   if unlikely(!address_eq(pda.address(), &derive_bet_pda(owner, bet_id, bump))) {
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

/// Existing parlay ticket PDA: one `derive_parlay_pda` with the stored bump.
#[inline(always)]
pub fn verify_parlay_pda(
   pda: &AccountView,
   owner: &Address,
   bet_id: u64,
   bump: u8,
) -> ProgramResult {
   if unlikely(!address_eq(pda.address(), &derive_parlay_pda(owner, bet_id, bump))) {
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

/// Existing cashout ticket PDA: one `derive_cashout_pda` with the stored bump.
#[inline(always)]
pub fn verify_cashout_pda(
   pda: &AccountView,
   mm: &Address,
   cashout_id: u64,
   bump: u8,
) -> ProgramResult {
   if unlikely(!address_eq(pda.address(), &derive_cashout_pda(mm, cashout_id, bump))) {
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

/// Existing cashout-parlay ticket PDA: one `derive_cashout_parlay_pda` with the stored bump.
#[inline(always)]
pub fn verify_cashout_parlay_pda(
   pda: &AccountView,
   mm: &Address,
   cashout_id: u64,
   bump: u8,
) -> ProgramResult {
   if unlikely(!address_eq(pda.address(), &derive_cashout_parlay_pda(mm, cashout_id, bump))) {
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

pub fn verify_token_program(token_program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(token_program.address(), &TOKEN_PROGRAM_ID)) {
      log!("verify_token_program: token program must be the token program");
      return Err(ProgramError::IncorrectProgramId);
   }
   Ok(())
}

#[inline(always)]
pub fn verify_mint(mint: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(mint.address(), &MINT)) {
      log!("verify_mint: mint must be defined mint");
      return Err(ProgramError::InvalidAccountData);
   }
   Ok(())
}

pub fn verify_associated_token_program(associated_token_program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(associated_token_program.address(), &ASSOCIATED_TOKEN_PROGRAM_ID)) {
      log!("verify_associated_token_program: associated token program must be the associated token program");
      return Err(ProgramError::IncorrectProgramId);
   }
   Ok(())
}

#[inline(always)]
pub fn verify_system_program(system_program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(system_program.address(), &SYSTEM_ID)) {
      log!("verify_system_program: system program must be the system program");
      return Err(ProgramError::IncorrectProgramId);
   }
   Ok(())
}

#[inline(always)]
pub fn verify_rent_sysvar(rent_acc: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(rent_acc.address(), &RENT_ID)) {
      log!("verify_rent: rent account must be the rent account");
      return Err(ProgramError::UnsupportedSysvar);
   }
   Ok(())
}

#[inline(always)]
pub fn verify_instructions_sysvar(instructions_sysvar: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(instructions_sysvar.address(), &INSTRUCTIONS_ID)) {
      log!("verify_instructions_sysvar: must be instructions sysvar");
      return Err(ProgramError::UnsupportedSysvar);
   }
   Ok(())
}

#[inline(always)]
pub fn verify_clock_sysvar(clock_sysvar: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(clock_sysvar.address(), &CLOCK_ID)) {
      log!("verify_clock_sysvar: clock sysvar must be the clock sysvar");
      return Err(ProgramError::UnsupportedSysvar);
   }
   Ok(())
}

/// Executable MM program account owned by the upgradeable BPF loader. Add other loaders if you need them.
#[inline(always)]
pub fn verify_mm_program_executable(mm_program: &AccountView) -> ProgramResult {
   if unlikely(!mm_program.executable()) {
      log!("verify_mm_program_executable: mm_program must be executable");
      return Err(ProgramError::IncorrectProgramId);
   }
   Ok(())
}

pub fn verify_mm_market_data_pda(
   mm_market_data_pda: &AccountView,
   mm_program_account: &AccountView,
   market_wire: &[u8; MARKET_ID_LEN],
) -> bool {
   if unlikely(!address_eq(mm_market_data_pda.owner(), mm_program_account.address())) {
      return false;
   }

   if unlikely(mm_market_data_pda.data_len() < MM_MARKET_DATA_PDA_MIN_LEN) {
      return false;
   }

   let bump = unsafe {
      read_u8_unchecked(mm_market_data_pda.data_ptr(), MM_MARKET_DATA_PDA_BUMP_OFFSET)
   };
   let expected_pda = derive_mm_market_data_pda(
      mm_program_account.address(),
      market_wire,
      bump,
   );

   address_eq(mm_market_data_pda.address(), &expected_pda)
}



pub fn verify_token_account(
   throw_error: bool,
   token_account: &AccountView, 
   owner: &AccountView, 
   mint: &AccountView, 
   token_program: &AccountView, 
) -> Result<bool, ProgramError> {
   const TOKEN_ACCOUNT_LEN: usize = 165;
   const TOKEN_ACCOUNT_MINT_OFFSET: usize = 0;
   const TOKEN_ACCOUNT_OWNER_OFFSET: usize = ADDRESS_LEN;

   if unlikely(!address_eq(token_account.owner(), token_program.address())) {
      if throw_error {
         log!("verify_token_account: token account must be owned by the token program");
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

   let token_account_mint = unsafe {
      read_address_ref_unchecked(token_account.data_ptr(), TOKEN_ACCOUNT_MINT_OFFSET)
   };
   let token_account_owner = unsafe {
      read_address_ref_unchecked(token_account.data_ptr(), TOKEN_ACCOUNT_OWNER_OFFSET)
   };

   if unlikely(!address_eq(token_account_mint, mint.address())) {
      if throw_error {
         log!("verify_token_account: token account mint must match mint account");
         return Err(ProgramError::InvalidAccountData);
      }
      return Ok(false);
   }
   if unlikely(!address_eq(token_account_owner, owner.address())) {
      if throw_error {
         log!("verify_token_account: token account owner must match owner account");
         return Err(ProgramError::IncorrectAuthority);
      }
      return Ok(false);
   }
   Ok(true)
}

pub fn verify_netting_pda(
   netting_pda: &AccountView,
   mm_program_account: &AccountView,
   event_id_wire: &[u8; EventId::WIRE_SIZE],
) -> bool {
   if unlikely(!address_eq(netting_pda.owner(), &ID)) {
      return false;
   }
   if unlikely(netting_pda.data_len() < NETTING_PDA_MIN_LEN) {
      return false;
   }
   let disc = unsafe { read_u8_unchecked(netting_pda.data_ptr(), 0) };
   if unlikely(disc != NETTING_PDA_DISCRIMINATOR) {
      return false;
   }
   let bump = unsafe { read_u8_unchecked(netting_pda.data_ptr(), 1) };
   let expected_pda = derive_netting_pda(mm_program_account.address(), event_id_wire, bump);
   address_eq(netting_pda.address(), &expected_pda)
}

/// `fill_bet` netting slot: either the real netting PDA for this MM + event, or the system program
/// id as a placeholder when no netting account exists yet (same as devnet clients).
#[inline]
pub fn verify_netting_pda_or_placeholder(
   netting_pda: &AccountView,
   mm_program_account: &AccountView,
   event_id_wire: &[u8; EventId::WIRE_SIZE],
) -> bool {
   if address_eq(netting_pda.address(), &SYSTEM_ID) {
      return true;
   }
   verify_netting_pda(netting_pda, mm_program_account, event_id_wire)
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
         return Err(SpammError::ProgramPaused.into());
      }
   }

   Ok(())
}

/// `mm_list_pda` address must equal the baked [`MM_LIST_PDA`].
#[inline(always)]
pub fn verify_mm_list_pda(mm_list_pda: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(mm_list_pda.address(), &MM_LIST_PDA)) {
      log!("verify_mm_list_pda: mm list pda must be as defined in the program");
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

pub fn verify_authority(authority: &AccountView, config_pda: &AccountView) -> ProgramResult {
   // config pda data must already be verified as the real config pda
   let config_auth = unsafe {
      read_address_ref_unchecked(config_pda.data_ptr(), CONFIG_PDA_AUTHORITY_OFFSET)
   };

   if unlikely(!address_eq(authority.address(), config_auth)) {
      log!("verify_authority: authority must be the config pda authority");
      return Err(ProgramError::IncorrectAuthority);
   }
   Ok(())
}

/// Market operator or aggregator config authority (grading).
#[inline(always)]
pub fn verify_market_operator_or_authority(
   authority: &AccountView,
   config_pda: &AccountView,
   operator: &Address,
) -> ProgramResult {
   if address_eq(authority.address(), operator) {
      return Ok(());
   }
   verify_authority(authority, config_pda)
}

/// MM-owned quote buffer PDA: exact length and [`MM_QUOTE_BUFFER_DISCRIMINATOR`] (stamped at MM `init_program`).
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

   let disc = unsafe { read_u8_unchecked(quote_buffer.data_ptr(), 0) };
   if unlikely(disc != MM_QUOTE_BUFFER_DISCRIMINATOR) {
      return false;
   }

   true
}

/// Parlay quote buffer: MM-owned PDA, exact length, [`MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR`].
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

   let disc = unsafe { read_u8_unchecked(quote_buffer.data_ptr(), 0) };
   if unlikely(disc != MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR) {
      return false;
   }

   true
}

#[inline(always)]
pub fn verify_event_state(
   event_state_pda: &AccountView,
   mm_program_account: &AccountView,
   event_id_wire: &[u8; EventId::WIRE_SIZE],
   event_game_state: &EventGameState,
   event_state_sequence: u16,
) -> bool {
   if unlikely(!address_eq(event_state_pda.owner(), mm_program_account.address())) {
      #[cfg(feature = "log")]
      log!("verify_event_state: fail owner (event_state owner != mm program id)");
      return false;
   }

   if unlikely(event_state_pda.data_len() < EVENT_STATE_HEADER_LEN) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail data_len got={} want>={}",
         event_state_pda.data_len() as u64,
         EVENT_STATE_HEADER_LEN as u64
      );
      return false;
   }

   let ptr = event_state_pda.data_ptr();
   let disc = unsafe { read_u8_unchecked(ptr, 0) };
   if unlikely(disc != EVENT_STATE_DISCRIMINATOR) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail discriminator got={} want={}",
         disc as u64,
         EVENT_STATE_DISCRIMINATOR as u64
      );
      return false;
   }
   let bump = unsafe { read_u8_unchecked(ptr, EVENT_STATE_BUMP_OFFSET) };
   let stored_sequence = unsafe { read_u16_le_unchecked(ptr, EVENT_STATE_SEQUENCE_OFFSET) };
   let stored_game = unsafe { read_u64_le_unchecked(ptr, EVENT_STATE_GAME_STATE_OFFSET) };

   let expected_pda = derive_event_state_pda(
      mm_program_account.address(),
      event_id_wire,
      bump,
   );
   if unlikely(!address_eq(event_state_pda.address(), &expected_pda)) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail pda bump={} (derive_address != account key)",
         bump as u64
      );
      return false;
   }

   if unlikely(stored_sequence != event_state_sequence) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail sequence acct={} ix={}",
         stored_sequence as u64,
         event_state_sequence as u64
      );
      return false;
   }

   if unlikely(stored_game != event_game_state.as_u64()) {
      #[cfg(feature = "log")]
      log!(
         "verify_event_state: fail game_state acct_u64={} ix_u64={}",
         stored_game,
         event_game_state.as_u64()
      );
      return false;
   }

   true
}

pub fn verify_mm_config_pda(mm_config_pda: &AccountView, mm_program_account: &AccountView) -> bool {
   if unlikely(!address_eq(mm_config_pda.owner(), &mm_program_account.address())) {
      return false;
   }

   if unlikely(mm_config_pda.data_len() < MM_CONFIG_PDA_HEADER_LEN) {
      return false;
   }

   let stored_bump = unsafe { 
      read_u8_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) 
   };

   let expected_address = derive_mm_config_pda(mm_program_account.address(), stored_bump);

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

   if unlikely(config_pda.data_len() < MM_CONFIG_PDA_HEADER_LEN) {
      log!("verify_mm_admin: config pda data length is invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   let stored_bump = unsafe {
      read_u8_unchecked(config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET)
   };
   let stored_admin = unsafe {
      read_address_ref_unchecked(config_pda.data_ptr(), MM_CONFIG_PDA_ADMIN_OFFSET)
   };

   let expected_address = derive_mm_config_pda(mm_program_account.address(), stored_bump);

   if unlikely(!address_eq(config_pda.address(), &expected_address)) {
      log!("verify_mm_admin: config pda address does not match seeds");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(!address_eq(admin.address(), stored_admin)) {
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
   let expected_address = derive_encumbrance_pda(mm_program_account.address(), stored_bump);

   if unlikely(!address_eq(mm_encumbrance_pda.address(), &expected_address)) {
      #[cfg(feature = "log")]
      log!("verify_mm_encumbrance_pda: encumbrance pda address does not match seeds");
      return None;
   }

   Some(stored_bump)
}

/// Reject the same MM program id appearing twice in a strided remaining-accounts tail.
pub fn reject_duplicate_mm_programs(mm_accounts: &[AccountView], stride: usize) -> ProgramResult {
   if stride == 0 || mm_accounts.len() < stride || mm_accounts.len() % stride != 0 {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   let n = mm_accounts.len() / stride;
   if unlikely(n > MAX_NUMBER_OF_MMS_PROXY) {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   let mut keys = [const { MaybeUninit::<&Address>::uninit() }; MAX_NUMBER_OF_MMS_PROXY];
   for i in 0..n {
      let cur = mm_accounts[i * stride].address();
      keys[i].write(cur);
      for j in 0..i {
         if unlikely(address_eq(cur, unsafe { keys[j].assume_init() })) {
            log!("reject_duplicate_mm_programs: duplicate mm program account");
            return Err(ProgramError::InvalidInstructionData);
         }
      }
   }
   Ok(())
}
