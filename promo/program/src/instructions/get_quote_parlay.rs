//! Promo MM does not offer parlays — always return `(0, 0)`.

use pinocchio::{AccountView, Address, ProgramResult};
use zeropod::ZeroPodFixed;

use crate::state::GetQuoteReturnWire;

pub use spamm_aggregator::state::GET_QUOTE_PARLAY_IX_DISCRIMINATOR;

pub fn process(_program_id: &Address, _accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
   zero_quote_return()
}

#[inline(always)]
fn zero_quote_return() -> ProgramResult {
   let ret = GetQuoteReturnWire {
      max_amount: 0,
      odds_scaled: 0,
   };
   let zc = ret.to_zc();
   let mut out = [0u8; <GetQuoteReturnWire as ZeroPodFixed>::SIZE];
   unsafe {
      core::ptr::write(out.as_mut_ptr().cast(), zc);
   }
   #[cfg(any(target_os = "solana", target_arch = "bpf"))]
   unsafe {
      pinocchio::syscalls::sol_set_return_data(out.as_ptr(), out.len() as u64);
   }
   Ok(())
}
