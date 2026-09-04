//! Custom program errors (`ProgramError::Custom`).
//!
//! Only failures a client would branch on in production get a code here. Structural faults
//! (bad account count, malformed ix data, seed mismatch, overflow) keep their built-in
//! [`ProgramError`] variant, since the only sane client response is "fix the transaction".
//!
//! The TS SDK mirrors this list in `sdk/ts/src/errors.ts`.

use pinocchio::error::ProgramError;

#[repr(u32)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpammError {
   /// Aggregator config status is PAUSED; retry later.
   ProgramPaused = 1,
   /// The supplied MM config PDA is not a valid PDA of the supplied MM program.
   MmNotRegistered = 2,
   /// Bet / cashout PDA for this seed already exists; pick a new id.
   AccountAlreadyExists = 3,
   /// Settle attempted before the bet (or parlay ticket) was graded.
   BetNotGraded = 4,
   /// No MM returned a usable quote, or nothing could be filled; requote and retry.
   NoQuotesAvailable = 5,
   /// Quoted odds came back below `min_odds_scaled`; requote and retry.
   SlippageExceeded = 6,
   /// MM could not cover the potential payout, or its liability ATA moved by an unexpected amount.
   InsufficientMmLiquidity = 7,
   /// `amount` exceeds the `max_stake` the MM signed for.
   StakeExceedsMaxStake = 8,
   /// RFQ `offer_expiry` is in the past; request a fresh quote.
   QuoteExpired = 9,
   /// RFQ ed25519 signature did not verify against the MM's registered RFQ signer.
   InvalidRfqSignature = 10,
   /// `num_legs` outside the allowed range for this instruction.
   InvalidParlayLegCount = 11,
   /// Product of per-leg odds does not equal the signed ticket odds.
   ParlayOddsMismatch = 12,
   /// Every event group in a parlay needs at least one positive-odds leg.
   ParlayEventRuleViolation = 13,
   /// Live cashout escrow claim before `LIVE_CASHOUT_DELAY` has elapsed.
   CashoutDelayNotElapsed = 14,
   /// Cashout amount, payout floor, ticket state, or escrow is invalid.
   InvalidCashout = 15,
   /// Escrow is RolledBack (or original ticket is); use `revert_cashout`.
   CashoutMustRevert = 16,
   /// Freebet `expiry` is in the past.
   FreebetExpired = 17,
   /// Freebet is `Used` (or not `Available`) for this action.
   FreebetNotAvailable = 18,
   /// Fill `amount` does not equal the freebet PDA amount, or the auction did not fill it all.
   FreebetAmountMismatch = 19,
   /// Quoted / filled odds are outside the freebet `[min_odds, max_odds]` range.
   FreebetOddsOutOfRange = 20,
   /// Ticket leg count is below the freebet `min_legs`.
   FreebetLegCount = 21,
   /// Filling MM is not on the freebet `allowed_mms` list.
   FreebetMmNotAllowed = 22,
   /// Wrong settle/cashout path, or freebet PDA / issuer accounts do not match the ticket.
   InvalidFreebet = 23,
   /// Market `operator` is not on the freebet `allowed_operators` list.
   FreebetOperatorNotAllowed = 24,
}

impl From<SpammError> for ProgramError {
   #[inline]
   fn from(e: SpammError) -> Self {
      ProgramError::Custom(e as u32)
   }
}
