use pinocchio::{
   account::AccountView, address::{address_eq}, cpi::{Seed, Signer}, error::ProgramError, hint::unlikely,
   ProgramResult, Address
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use zeropod::ZeroPodFixed;

use crate::checks::admin_is;
use spamm_aggregator::{
   helpers::{get_rent, verify_rent_sysvar, verify_signer, verify_system_program},
   state::{
      market_id_pda_seed_parts, other::{
         MM_MARKET_DATA_PDA_MIN_LEN, MM_MARKET_DATA_PDA_SEED, MmMarketDataPdaData,
      }, MarketId, MM_MARKET_DATA_PDA_DISCRIMINATOR,
   },
};

pub const INIT_MARKET_IX_DISCRIMINATOR: u8 = 111;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let market_id = MarketId::decode(data).ok_or(ProgramError::InvalidInstructionData)?;
   let [
      feepayer,       // `verify_signer`; `admin_is`
      config,         // `admin_is`
      market,         // `Address::find_program_address`; empty
      rent_sysvar,    // `verify_rent_sysvar`
      system_program, // `verify_system_program`
   ] = accounts else {
      log!("init_market: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(feepayer)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   if unlikely(!admin_is(feepayer, config, program_id)) {
      log!("init_market: admin");
      return Err(ProgramError::IncorrectAuthority);
   }
   if unlikely(market.lamports() > 0 || market.data_len() > 0) {
      log!("init_market: account must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let wire = market_id.as_bytes();
   let (body, operator) = market_id_pda_seed_parts(&wire);
   let (pda, bump) = Address::find_program_address(
      &[MM_MARKET_DATA_PDA_SEED, body, operator],
      program_id,
   );
   if unlikely(!address_eq(market.address(), &pda)) {
      return Err(ProgramError::InvalidSeeds);
   }

   let space = MM_MARKET_DATA_PDA_MIN_LEN as u64;
   let bump_seed = [bump];
   let signer_seeds = [
      Seed::from(MM_MARKET_DATA_PDA_SEED),
      Seed::from(body),
      Seed::from(operator),
      Seed::from(&bump_seed as &[u8]),
   ];
   let signers = [Signer::from(&signer_seeds)];
   CreateAccount {
      from: feepayer,
      to: market,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: program_id,
   }
   .invoke_signed(&signers)?;
   let mut body = market.try_borrow_mut()?;
   let header = <MmMarketDataPdaData as ZeroPodFixed>::from_bytes_mut(&mut body)
      .map_err(|_| ProgramError::InvalidAccountData)?;
   header.discriminator = MM_MARKET_DATA_PDA_DISCRIMINATOR;
   header.bump = bump;
   Ok(())
}
