import { getAddressEncoder, type Address } from '@solana/kit';
import type { Rpc } from '@solana/rpc-spec';
import type { SolanaRpcApi } from '@solana/rpc-api';
import type { Base64EncodedBytes, GetProgramAccountsMemcmpFilter } from '@solana/rpc-types';

import { decodePredictionAccountData, PREDICTION_ACCOUNT_WIRE_OFFSETS } from './codex.js';
import {
   PREDICTION_ACCOUNT_DISCRIMINATOR,
   PREDICTION_ACCOUNT_LEN,
   SCORE_PREDICT_PROGRAM_ID,
} from './constants.js';
import { getPredictionPda } from './helpers.js';
import type { PredictionAccountData } from './types.js';

const addressEncoder = getAddressEncoder();

function base64DataToUint8Array(data: readonly [string, string]): Uint8Array {
   const [b64] = data;
   const bin = atob(b64);
   const out = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
   }
   return out;
}

function bytesToBase64EncodedBytes(bytes: Uint8Array): Base64EncodedBytes {
   let binary = '';
   for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
   }
   return btoa(binary) as Base64EncodedBytes;
}

function memcmp(offset: bigint, bytes: Uint8Array): GetProgramAccountsMemcmpFilter {
   return { memcmp: { offset, bytes: bytesToBase64EncodedBytes(bytes), encoding: 'base64' } };
}

function u8WireByte(value: number): Uint8Array {
   return new Uint8Array([value & 0xff]);
}

function u32Le(value: number): Uint8Array {
   const out = new Uint8Array(4);
   new DataView(out.buffer).setUint32(0, value >>> 0, true);
   return out;
}

export async function readProgramAccountsRaw(
   rpc: Rpc<SolanaRpcApi>,
   programId: Address,
   filters: readonly (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[],
): Promise<ReadonlyArray<Readonly<{ address: Address; data: Uint8Array }>>> {
   const accounts = await rpc
      .getProgramAccounts(programId, {
         encoding: 'base64',
         filters: [...filters],
      })
      .send();
   return accounts.map((row) => ({
      address: row.pubkey,
      data: base64DataToUint8Array(row.account.data),
   }));
}

/** Direct fetch for the `(owner, contest_id)` prediction PDA (preferred over GPA). */
export async function readPredictionAccountDataRaw(
   rpc: Rpc<SolanaRpcApi>,
   owner: Address,
   contestId: number,
): Promise<Readonly<{ address: Address; data: Uint8Array }> | null> {
   const [pda] = await getPredictionPda(owner, contestId);
   const res = await rpc.getAccountInfo(pda, { encoding: 'base64' }).send();
   if (res.value === null) {
      return null;
   }
   return {
      address: pda,
      data: base64DataToUint8Array(res.value.data),
   };
}

function ownerMatches(a: Address, b: Address): boolean {
   return String(a) === String(b);
}

export async function getPredictionData(
   rpc: Rpc<SolanaRpcApi>,
   owner: Address,
   contestId: number,
): Promise<PredictionAccountData | null> {
   const row = await readPredictionAccountDataRaw(rpc, owner, contestId);
   if (!row) {
      return null;
   }
   const data = decodePredictionAccountData(row.data);
   if (data.discriminator !== PREDICTION_ACCOUNT_DISCRIMINATOR || !ownerMatches(data.owner, owner)) {
      return null;
   }
   return data;
}

export async function getPredictionsByUser(
   rpc: Rpc<SolanaRpcApi>,
   owner: Address,
): Promise<ReadonlyArray<Readonly<{ address: Address; data: PredictionAccountData }>>> {
   const filters: (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[] = [
      { dataSize: BigInt(PREDICTION_ACCOUNT_LEN) },
      memcmp(BigInt(PREDICTION_ACCOUNT_WIRE_OFFSETS.discriminator), u8WireByte(PREDICTION_ACCOUNT_DISCRIMINATOR)),
   ];
   const rows = await readProgramAccountsRaw(rpc, SCORE_PREDICT_PROGRAM_ID, filters);
   return rows
      .map((row) => ({
         address: row.address,
         data: decodePredictionAccountData(row.data),
      }))
      .filter((row) => ownerMatches(row.data.owner, owner));
}

export async function getPredictionsByContest(
   rpc: Rpc<SolanaRpcApi>,
   contestId: number,
): Promise<ReadonlyArray<Readonly<{ address: Address; data: PredictionAccountData }>>> {
   const filters: (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[] = [
      { dataSize: BigInt(PREDICTION_ACCOUNT_LEN) },
      memcmp(BigInt(PREDICTION_ACCOUNT_WIRE_OFFSETS.discriminator), u8WireByte(PREDICTION_ACCOUNT_DISCRIMINATOR)),
      memcmp(BigInt(PREDICTION_ACCOUNT_WIRE_OFFSETS.contestId), u32Le(contestId)),
   ];
   const rows = await readProgramAccountsRaw(rpc, SCORE_PREDICT_PROGRAM_ID, filters);
   return rows.map((row) => ({
      address: row.address,
      data: decodePredictionAccountData(row.data),
   }));
}
