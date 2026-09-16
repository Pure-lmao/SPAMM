/**
 * Re-export SPAMM aggregator SDK (Kit) helpers used by the promo MM client.
 */
export {
   getEventGameState,
   getEventGameStateEncoder,
   getEventIdEncoder,
   getMarketIdEncoder,
   getAta,
   getEventStatePda,
   getMmConfigPda,
   getMmMarketDataPda,
   getMmParlayQuoteBufferPda,
   getMmQuoteBufferPda,
   getRegisterMmIx,
   MARKET_ID_WIRE_SIZE,
   MINT_ID,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
   SYSVAR_RENT_ID,
   SYSTEM_PROGRAM_ID,
   AGGREGATOR_PROGRAM_ID,
   readAccountDataRaw,
} from 'spamm-aggregator-sdk';
export type { EventId, EventGameState, MarketId } from 'spamm-aggregator-sdk';
