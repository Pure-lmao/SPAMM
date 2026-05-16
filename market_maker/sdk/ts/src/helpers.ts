import { getAddressEncoder, getProgramDerivedAddress, type ProgramDerivedAddressBump, type Address } from '@solana/kit';

import {
   EVENT_STATE_SEED,
   MINT_ID,
   MM_ACCOUNT_CONFIG_SEED,
   MM_MARKET_DATA_PDA_SEED,
   MM_PARLAY_QUOTE_BUFFER_SEED,
   MM_QUOTE_BUFFER_SEED,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
} from './constants.js';
import { encodeEventIdWire, getMarketIdEncoder } from './wire_codecs.js';
import type { EventGameState, EventId, MarketId } from './types.js';

const addressEncoder = getAddressEncoder();
const marketIdEncoder = getMarketIdEncoder();

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
 * MM market-data PDA: `["market_data", market_id_wire]` (`market_maker::mm_helpers::find_market_data_pda`).
 */
export async function getMmMarketDataPda(
   mmProgramId: Address,
   marketId: MarketId,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_MARKET_DATA_PDA_SEED, marketIdEncoder.encode(marketId)],
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
