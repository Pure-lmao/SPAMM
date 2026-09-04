use pinocchio::{
   AccountView, Address, ProgramResult,
   address::address_eq,
   error::ProgramError,
   hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::ID as SYSTEM_ID;
use pinocchio::sysvars::rent::RENT_ID;

use crate::{constants::{ADDRESS_LEN, ADMIN}, ID};

#[inline(always)]
pub fn verify_signer(signer: &AccountView) -> ProgramResult {
   if unlikely(!signer.is_signer()) {
      log!("verify_signer: missing signature");
      return Err(ProgramError::MissingRequiredSignature);
   }
   Ok(())
}

pub fn verify_system_program(system_program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(system_program.address(), &SYSTEM_ID)) {
      log!("verify_system_program: invalid system program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

pub fn verify_rent_sysvar(rent_acc: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(rent_acc.address(), &RENT_ID)) {
      log!("verify_rent_sysvar: rent account must be the rent account");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

pub fn verify_program_owner(account: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(account.owner(), &ID)) {
      log!("verify_program_owner: account not owned by program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}

pub fn get_rent(rent_sysvar: &AccountView, space: u64) -> Result<u64, ProgramError> {
   if unlikely(space == 0) {
      return Ok(0);
   }
   if unlikely(rent_sysvar.data_len() < 8) {
      return Err(ProgramError::InvalidAccountData);
   }
   let lamports_per_byte = unsafe {
      u64::from_le_bytes(*(rent_sysvar.data_ptr() as *const [u8; 8]))
   };
   Ok((128 + space) * lamports_per_byte)
}

/// Move lamports from PDA to recipient and close the account.
#[inline(never)]
pub fn close_pda_return_rent(
   pda: &mut AccountView,
   recipient: &mut AccountView,
) -> ProgramResult {
   let dest_lamports = recipient.lamports();
   let pda_lamports = pda.lamports();

   pda.set_lamports(0);
   recipient.set_lamports(dest_lamports + pda_lamports);
   pda.close()?;
   Ok(())
}

pub fn verify_owner_or_admin(authority: &AccountView, owner: &Address) -> ProgramResult {
   if address_eq(authority.address(), owner) {
      return Ok(());
   }
   if address_eq(authority.address(), &ADMIN) {
      return Ok(());
   }
   log!("verify_owner_or_admin: signer is not owner or admin");
   Err(ProgramError::InvalidAccountData)
}

pub fn verify_admin(authority: &AccountView) -> ProgramResult {
   if address_eq(authority.address(), &ADMIN) {
      return Ok(());
   }
   log!("verify_admin: signer is not admin");
   Err(ProgramError::InvalidAccountData)
}


pub fn read_address_unchecked(ptr: *const u8) -> Address {
   Address::new_from_array(unsafe { core::ptr::read_unaligned(ptr as *const [u8; ADDRESS_LEN]) })
}