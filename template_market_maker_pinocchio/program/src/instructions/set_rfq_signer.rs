use pinocchio::{account::AccountView, error::ProgramError, hint::unlikely, Address, ProgramResult};
use pinocchio_log::log;

use crate::checks::admin_is;
use spamm_aggregator::{
   constants::ADDRESS_LEN,
   helpers::verify_signer,
   state::MM_CONFIG_PDA_RFQ_SIGNER_OFFSET,
};

pub const SET_RFQ_SIGNER_IX_DISCRIMINATOR: u8 = 101;

pub fn process(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
   let [
      admin,      // `verify_signer`; `admin_is`
      config,     // `admin_is`
      rfq_signer, // pubkey written onto the config; not a PDA
   ] = accounts else {
      log!("set_rfq_signer: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(admin)?;
   if unlikely(!admin_is(admin, config, program_id)) {
      log!("set_rfq_signer: admin");
      return Err(ProgramError::IncorrectAuthority);
   }
   if unlikely(config.data_len() < MM_CONFIG_PDA_RFQ_SIGNER_OFFSET + ADDRESS_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }
   let mut body = config.try_borrow_mut()?;
   let start = MM_CONFIG_PDA_RFQ_SIGNER_OFFSET;
   body[start..start + ADDRESS_LEN].copy_from_slice(rfq_signer.address().as_ref());
   Ok(())
}
