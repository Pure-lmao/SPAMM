import type { Address } from '@solana/kit';
import type { Rpc } from '@solana/rpc-spec';
import type { SolanaRpcApi } from '@solana/rpc-api';

import {
   decodeEventStateData,
   decodeMmAccountConfig,
   decodeMmEncumbranceAccountData,
   decodeMmMarketDataAccountData,
   decodeMmParlayQuoteBuffer,
   decodeMmQuoteBuffer,
   decodeNettingAccountData,
   getEventStatePda,
   getMmEncumbrancePda,
   getMmMarketDataPda,
   getNettingPda,
   readAccountDataRaw,
} from 'spamm-aggregator-sdk';

import {
   ANCHOR_TEMPLATE_MM_CONFIG_PDA,
   ANCHOR_TEMPLATE_MM_ENCUMBRANCE_PDA,
   ANCHOR_TEMPLATE_MM_PARLAY_QUOTE_BUFFER_PDA,
   ANCHOR_TEMPLATE_MM_PROGRAM_ID,
   ANCHOR_TEMPLATE_MM_QUOTE_BUFFER_PDA,
} from './constants.js';
import { collateralAta, liabilityAta } from './instructions.js';
import type {
   EventId,
   EventStateData,
   MarketId,
   MMConfigAccountData,
   MmEncumbranceAccountData,
   MmMarketDataAccountData,
   MmParlayQuoteBuffer,
   MmQuoteBuffer,
   NettingAccountData,
} from './types.js';

const PROGRAM = ANCHOR_TEMPLATE_MM_PROGRAM_ID;

async function read(rpc: Rpc<SolanaRpcApi>, address: Address, label: string): Promise<Uint8Array> {
   const raw = await readAccountDataRaw(rpc, address);
   if (raw === null) {
      throw new Error(`${label} not found: ${address}`);
   }
   return raw;
}

export async function readConfig(rpc: Rpc<SolanaRpcApi>): Promise<MMConfigAccountData> {
   return decodeMmAccountConfig(await read(rpc, ANCHOR_TEMPLATE_MM_CONFIG_PDA, 'config'));
}

export async function readEventState(rpc: Rpc<SolanaRpcApi>, eventId: EventId): Promise<EventStateData> {
   const [pda] = await getEventStatePda(PROGRAM, eventId);
   return decodeEventStateData(await read(rpc, pda, 'event state'));
}

export async function readMarket(rpc: Rpc<SolanaRpcApi>, marketId: MarketId): Promise<MmMarketDataAccountData> {
   const [pda] = await getMmMarketDataPda(PROGRAM, marketId);
   return decodeMmMarketDataAccountData(await read(rpc, pda, 'market'));
}

export async function readQuoteBuffer(rpc: Rpc<SolanaRpcApi>): Promise<MmQuoteBuffer> {
   return decodeMmQuoteBuffer(await read(rpc, ANCHOR_TEMPLATE_MM_QUOTE_BUFFER_PDA, 'quote buffer'));
}

export async function readParlayQuoteBuffer(rpc: Rpc<SolanaRpcApi>): Promise<MmParlayQuoteBuffer> {
   return decodeMmParlayQuoteBuffer(
      await read(rpc, ANCHOR_TEMPLATE_MM_PARLAY_QUOTE_BUFFER_PDA, 'parlay quote buffer'),
   );
}

export async function readEncumbrance(rpc: Rpc<SolanaRpcApi>): Promise<MmEncumbranceAccountData> {
   return decodeMmEncumbranceAccountData(
      await read(rpc, ANCHOR_TEMPLATE_MM_ENCUMBRANCE_PDA, 'encumbrance'),
   );
}

export async function readNetting(rpc: Rpc<SolanaRpcApi>, eventId: EventId): Promise<NettingAccountData> {
   const [pda] = await getNettingPda(PROGRAM, eventId);
   return decodeNettingAccountData(await read(rpc, pda, 'netting'));
}

export async function readTokenBalance(rpc: Rpc<SolanaRpcApi>, ata: Address): Promise<bigint> {
   const balance = await rpc.getTokenAccountBalance(ata).send();
   return BigInt(balance.value.amount);
}

export async function readCollateralBalance(rpc: Rpc<SolanaRpcApi>): Promise<bigint> {
   return readTokenBalance(rpc, await collateralAta());
}

export async function readLiabilityBalance(rpc: Rpc<SolanaRpcApi>): Promise<bigint> {
   return readTokenBalance(rpc, await liabilityAta());
}

export async function encumbranceAddress(): Promise<Address> {
   const [pda] = await getMmEncumbrancePda(PROGRAM);
   return pda;
}
