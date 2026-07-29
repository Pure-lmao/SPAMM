import { getAddressEncoder, getProgramDerivedAddress, type ProgramDerivedAddressBump, type Address } from '@solana/kit';

import {
   AGGREGATOR_PROGRAM_ID,
   EVENT_STATE_SEED,
   MINT_ID,
   MM_ACCOUNT_CONFIG_SEED,
   MM_ENCUMBRANCE_PDA_SEED,
   MM_MARKET_DATA_PDA_SEED,
   MM_PARLAY_QUOTE_BUFFER_SEED,
   MM_QUOTE_BUFFER_SEED,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
} from './constants.js';
import { encodeEventIdWire, getMarketIdEncoder } from './wire_codecs.js';
import { MARKET_ID_BODY_WIRE_SIZE, type EventGameState, type EventId, type MarketId } from './types.js';

const addressEncoder = getAddressEncoder();
const marketIdEncoder = getMarketIdEncoder();

/** PDA seeds for MM market data: legacy `MarketId` body wire + `operator` address bytes. */
export function marketIdPdaSeeds(marketId: MarketId): readonly [Uint8Array, Uint8Array] {
   const wire = marketIdEncoder.encode(marketId);
   return [wire.subarray(0, MARKET_ID_BODY_WIRE_SIZE), wire.subarray(MARKET_ID_BODY_WIRE_SIZE)] as const;
}

export async function getMmConfigPda(mmProgramId: Address): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_ACCOUNT_CONFIG_SEED],
   });
}

export async function getMmQuoteBufferPda(mmProgramId: Address): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_QUOTE_BUFFER_SEED],
   });
}

export async function getMmParlayQuoteBufferPda(
   mmProgramId: Address,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_PARLAY_QUOTE_BUFFER_SEED],
   });
}

export async function getEventStatePda(
   mmProgramId: Address,
   eventId: EventId,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [EVENT_STATE_SEED, encodeEventIdWire(eventId)],
   });
}

/**
 * MM market-data PDA: `["market_data", market_id_body_wire, operator]` (`find_market_data_pda`).
 */
export async function getMmMarketDataPda(
   mmProgramId: Address,
   marketId: MarketId,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   const [body, operator] = marketIdPdaSeeds(marketId);
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_MARKET_DATA_PDA_SEED, body, operator],
   });
}

export async function getMmEncumbrancePda(
   mmProgramId: Address,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [MM_ENCUMBRANCE_PDA_SEED, addressEncoder.encode(mmProgramId)],
   });
}

export async function getAta(
   owner: Address,
   mint: Address = MINT_ID,
   tokenProgram: Address = SPL_TOKEN_PROGRAM_ID,
   associatedTokenProgram: Address = SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<Address> {
   const [ata] = await getProgramDerivedAddress({
      programAddress: associatedTokenProgram,
      seeds: [
         addressEncoder.encode(owner),
         addressEncoder.encode(tokenProgram),
         addressEncoder.encode(mint),
      ],
   });
   return ata;
}

export function getEventGameState(
   gamePhase: string,
   homePrimary: number,
   awayPrimary: number,
   homeSecondary: number,
   awaySecondary: number,
): EventGameState {
   return {
      gamePhase,
      homePrimary,
      awayPrimary,
      homeSecondary,
      awaySecondary,
   };
}
