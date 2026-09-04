use core::mem::MaybeUninit;

use crate::{
   constants::MAX_NUMBER_OF_MMS_PROXY,
   state::{
      mm_quote::{ProxyParlayQuoteData, ProxyQuoteData},
      ProxyCashoutQuoteData,
   },
};

#[cfg(target_os = "solana")]
use crate::state::{
   mm_quote::{proxy_parlay_quote_data_len, PROXY_PARLAY_QUOTE_DATA_LEN, PROXY_QUOTE_DATA_LEN},
   PROXY_CASHOUT_QUOTE_DATA_LEN,
};

/// On-chain: write instruction return data for the first `valid_quote_count` quotes.
/// Host (`cargo check`, Mollusk): no-op.
///
/// # Safety
/// Callers must have initialized exactly `data[0..valid_quote_count]` via `MaybeUninit::write`.
#[inline(never)]
pub fn set_proxy_return_data(
   data: &[MaybeUninit<ProxyQuoteData>; MAX_NUMBER_OF_MMS_PROXY],
   valid_quote_count: usize,
) {
   #[cfg(target_os = "solana")]
   unsafe {
      let out_len = valid_quote_count
         .checked_mul(PROXY_QUOTE_DATA_LEN).unwrap_or(0);
      let mut out = [0u8; MAX_NUMBER_OF_MMS_PROXY * PROXY_QUOTE_DATA_LEN];
      for i in 0..valid_quote_count {
         let q = data[i].assume_init_ref();
         core::ptr::copy_nonoverlapping(
            q as *const ProxyQuoteData as *const u8,
            out.as_mut_ptr().add(i * PROXY_QUOTE_DATA_LEN),
            PROXY_QUOTE_DATA_LEN,
         );
      }
      pinocchio::cpi::set_return_data(&out[..out_len]);
   }
   #[cfg(not(target_os = "solana"))]
   {
      let _ = (data, valid_quote_count);
   }
}

/// On-chain: write parlay proxy return data for the first `valid_quote_count` quotes.
#[inline(never)]
pub fn set_proxy_parlay_return_data(
   data: &[MaybeUninit<ProxyParlayQuoteData>; MAX_NUMBER_OF_MMS_PROXY],
   valid_quote_count: usize,
) {
   #[cfg(target_os = "solana")]
   unsafe {
      let mut out = [0u8; MAX_NUMBER_OF_MMS_PROXY * PROXY_PARLAY_QUOTE_DATA_LEN];
      let mut off = 0usize;
      for i in 0..valid_quote_count {
         let q = data[i].assume_init_ref();
         let n = q.num_legs as usize;
         let entry_len = proxy_parlay_quote_data_len(n);
         let _ = q.write_wire(&mut out[off..off + entry_len]);
         off += entry_len;
      }
      pinocchio::cpi::set_return_data(&out[..off]);
   }
   #[cfg(not(target_os = "solana"))]
   {
      let _ = (data, valid_quote_count);
   }
}

/// On-chain: write `get_market_quotes_proxy` return bytes. Host: no-op.
#[inline(always)]
pub fn set_market_quotes_proxy_return_data(data: &[u8]) {
   #[cfg(target_os = "solana")]
   pinocchio::cpi::set_return_data(data);
   #[cfg(not(target_os = "solana"))]
   let _ = data;
}

/// On-chain: write cashout quote proxy return data for the first `valid_quote_count` quotes.
#[inline(never)]
pub fn set_proxy_cashout_return_data(
   data: &[MaybeUninit<ProxyCashoutQuoteData>; MAX_NUMBER_OF_MMS_PROXY],
   valid_quote_count: usize,
) {
   #[cfg(target_os = "solana")]
   unsafe {
      let out_len = valid_quote_count
         .checked_mul(PROXY_CASHOUT_QUOTE_DATA_LEN).unwrap_or(0);
      let mut out = [0u8; MAX_NUMBER_OF_MMS_PROXY * PROXY_CASHOUT_QUOTE_DATA_LEN];
      for i in 0..valid_quote_count {
         let q = data[i].assume_init_ref();
         core::ptr::copy_nonoverlapping(
            q as *const ProxyCashoutQuoteData as *const u8,
            out.as_mut_ptr().add(i * PROXY_CASHOUT_QUOTE_DATA_LEN),
            PROXY_CASHOUT_QUOTE_DATA_LEN,
         );
      }
      pinocchio::cpi::set_return_data(&out[..out_len]);
   }
   #[cfg(not(target_os = "solana"))]
   {
      let _ = (data, valid_quote_count);
   }
}
