/**
 * Mirror of `aggregator/program/src/errors.rs` (`ProgramError::Custom` codes).
 *
 * Codes are stable and append-only. Structural faults stay built-in `ProgramError` variants.
 *
 * Shapes that actually carry the code:
 * - Kit `sendTransaction` / confirm: `SolanaError` with
 *   `SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM` and `context.code` (decimal u32).
 * - RPC `simulateTransaction` / `getTransaction` `meta.err`:
 *   `{ InstructionError: [ixIndex, { Custom: n }] }` — `Custom` is decimal, not hex.
 * Program logs print hex (`custom program error: 0xa`); that is display-only.
 */
import {
   isSolanaError,
   SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from '@solana/kit';

export enum SpammErrorCode {
   /** Aggregator config status is PAUSED; retry later. */
   ProgramPaused = 1,
   /** The supplied MM config PDA is not a valid PDA of the supplied MM program. */
   MmNotRegistered = 2,
   /** Bet / cashout PDA for this seed already exists; pick a new id. */
   AccountAlreadyExists = 3,
   /** Settle attempted before the bet (or parlay ticket) was graded. */
   BetNotGraded = 4,
   /** No MM returned a usable quote, or nothing could be filled; requote and retry. */
   NoQuotesAvailable = 5,
   /** Quoted odds came back below `minOddsScaled`; requote and retry. */
   SlippageExceeded = 6,
   /** MM could not cover the potential payout, or its liability ATA moved unexpectedly. */
   InsufficientMmLiquidity = 7,
   /** `amount` exceeds the `maxStake` the MM signed for. */
   StakeExceedsMaxStake = 8,
   /** RFQ `offerExpiry` is in the past; request a fresh quote. */
   QuoteExpired = 9,
   /** RFQ ed25519 signature did not verify against the MM's registered RFQ signer. */
   InvalidRfqSignature = 10,
   /** `numLegs` outside the allowed range for this instruction. */
   InvalidParlayLegCount = 11,
   /** Product of per-leg odds does not equal the signed ticket odds. */
   ParlayOddsMismatch = 12,
   /** Every event group in a parlay needs at least one positive-odds leg. */
   ParlayEventRuleViolation = 13,
   /** Live cashout escrow claim before `LIVE_CASHOUT_DELAY` has elapsed. */
   CashoutDelayNotElapsed = 14,
   /** Cashout amount, payout floor, ticket state, or escrow is invalid. */
   InvalidCashout = 15,
   /** Escrow is RolledBack (or original ticket is); use `revert_cashout`. */
   CashoutMustRevert = 16,
   /** Freebet `expiry` is in the past. */
   FreebetExpired = 17,
   /** Freebet is `Used` (or not `Available`) for this action. */
   FreebetNotAvailable = 18,
   /** Fill `amount` does not equal the freebet PDA amount, or the auction did not fill it all. */
   FreebetAmountMismatch = 19,
   /** Quoted / filled odds are outside the freebet `[min_odds, max_odds]` range. */
   FreebetOddsOutOfRange = 20,
   /** Ticket leg count is below the freebet `min_legs`. */
   FreebetLegCount = 21,
   /** Filling MM is not on the freebet `allowed_mms` list. */
   FreebetMmNotAllowed = 22,
   /** Wrong settle/cashout path, or freebet PDA / issuer accounts do not match the ticket. */
   InvalidFreebet = 23,
   /** Market `operator` is not on the freebet `allowed_operators` list. */
   FreebetOperatorNotAllowed = 24,
}

const MESSAGES: Record<SpammErrorCode, string> = {
   [SpammErrorCode.ProgramPaused]: 'aggregator is paused',
   [SpammErrorCode.MmNotRegistered]: 'mm config pda does not belong to the given mm program',
   [SpammErrorCode.AccountAlreadyExists]: 'account for this seed already exists',
   [SpammErrorCode.BetNotGraded]: 'bet is not graded yet',
   [SpammErrorCode.NoQuotesAvailable]: 'no market maker quote could be filled',
   [SpammErrorCode.SlippageExceeded]: 'quoted odds fell below minOddsScaled',
   [SpammErrorCode.InsufficientMmLiquidity]: 'market maker could not cover the potential payout',
   [SpammErrorCode.StakeExceedsMaxStake]: 'amount exceeds the signed maxStake',
   [SpammErrorCode.QuoteExpired]: 'rfq quote has expired',
   [SpammErrorCode.InvalidRfqSignature]: 'rfq signature did not verify',
   [SpammErrorCode.InvalidParlayLegCount]: 'numLegs out of range',
   [SpammErrorCode.ParlayOddsMismatch]: 'leg odds product does not match ticket odds',
   [SpammErrorCode.ParlayEventRuleViolation]:
      'each event group needs at least one positive-odds leg',
   [SpammErrorCode.CashoutDelayNotElapsed]: 'live cashout escrow claim delay has not elapsed',
   [SpammErrorCode.InvalidCashout]: 'cashout amount, payout floor, or ticket state is invalid',
   [SpammErrorCode.CashoutMustRevert]: 'cashout escrow must be reverted (rolled back)',
   [SpammErrorCode.FreebetExpired]: 'freebet expiry is in the past',
   [SpammErrorCode.FreebetNotAvailable]: 'freebet is not available',
   [SpammErrorCode.FreebetAmountMismatch]: 'fill amount does not match the freebet',
   [SpammErrorCode.FreebetOddsOutOfRange]: 'quoted odds are outside the freebet range',
   [SpammErrorCode.FreebetLegCount]: 'ticket has fewer legs than the freebet requires',
   [SpammErrorCode.FreebetMmNotAllowed]: 'market maker is not on the freebet allow list',
   [SpammErrorCode.InvalidFreebet]: 'wrong freebet settle or cashout path',
   [SpammErrorCode.FreebetOperatorNotAllowed]: 'market operator is not on the freebet allow list',
};

export function isSpammErrorCode(code: number): code is SpammErrorCode {
   return code in MESSAGES;
}

export function spammErrorMessage(code: number): string | undefined {
   return isSpammErrorCode(code) ? MESSAGES[code] : undefined;
}

/** SPAMM custom code from a Kit `SolanaError` or RPC `TransactionError`. */
export function parseSpammErrorCode(err: unknown): SpammErrorCode | undefined {
   const code = customCode(err);
   return code !== undefined && isSpammErrorCode(code) ? code : undefined;
}

function customCode(err: unknown): number | undefined {
   if (isSolanaError(err, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
      return err.context.code;
   }
   if (
      typeof err === 'object' &&
      err !== null &&
      'InstructionError' in err &&
      Array.isArray(err.InstructionError)
   ) {
      const inner = err.InstructionError[1];
      if (typeof inner === 'object' && inner !== null && 'Custom' in inner) {
         const n = (inner as { Custom: unknown }).Custom;
         if (typeof n === 'number') {
            return n;
         }
      }
   }
   return undefined;
}
