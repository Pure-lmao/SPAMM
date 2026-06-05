//! Types for MM `get_quote` / `get_quote_parlay` handlers (SPAMM framework contract).

use core::convert::Infallible;

use pinocchio::ProgramResult;

/// Quote instructions must not fail the transaction (soft `(0, 0)` return data instead).
pub type QuoteResult = Result<(), Infallible>;

/// Bridge [`QuoteResult`] into [`ProgramResult`] for the instruction router.
#[inline(always)]
pub fn quote_ok(r: QuoteResult) -> ProgramResult {
   match r {
      Ok(()) => Ok(()),
      Err(i) => match i {},
   }
}
