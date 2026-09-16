import { getAddressDecoder, type Address } from '@solana/kit';
import { getPromoMarketDataPda } from './instructions';
import { readAccountDataRaw } from './spammSdk';
import type { MarketId } from './spammSdk';
import type { PromoAdminContext } from './adminRun';
import {
   BETTOR_PUBKEY_LEN,
   decodePromoOracleAccount,
   ORACLE_ACCOUNT_DISCRIMINATOR,
   PROMO_ORACLE_ACCOUNT_LEN,
   PROMO_ORACLE_OFFSETS,
   type PromoOracleAccount,
} from './codex';
import { ODDS_SCALE, PROMO_PROGRAM_ID } from './constants';

const addressDecoder = getAddressDecoder();
const USDC_DECIMALS = 6;
/** Above this scaled odds value, header bytes are likely misaligned / corrupt. */
const MAX_REASONABLE_ODDS_SCALED = 100_000_000;

export type PromoOracleChainState = Readonly<{
   pda: Address;
   bump: number;
   dataLen: number;
   oracle: PromoOracleAccount;
   raw: Readonly<Uint8Array>;
}>;

export type PromoOracleDisplay = Readonly<{
   pda: Address;
   bump: number;
   dataLen: number;
   discriminator: number;
   sequence: number;
   outcomeOdds0: number;
   outcomeOdds0Decimal: number;
   outcomeOdds1: number;
   outcomeOdds1Decimal: number;
   outcomeOdds2: number;
   outcomeOdds2Decimal: number;
   eventStartTime: number;
   eventStartIso: string | null;
   parlayFactor: number;
   marketOutcomes: number;
   maxAmountUsdc: number;
   maxTotalAmountUsdc: number;
   totalStakeUsdc: number;
   allowedCount: number;
   allowed: readonly Address[];
   bettorCount: number;
   bettors: readonly Address[];
   headerHex: string;
   getQuoteReady: boolean;
}>;

function scaledOddsToDecimal(scaled: number): number {
   return scaled / ODDS_SCALE;
}

function microUsdcToUsdc(micro: bigint): number {
   return Number(micro) / 10 ** USDC_DECIMALS;
}

function formatHeaderHex(raw: Readonly<Uint8Array>, len = 32): string {
   const slice = raw.subarray(0, Math.min(len, raw.length));
   return [...slice].map((b, i) => `${i}:${b.toString(16).padStart(2, '0')}`).join(' ');
}

function decodeBettorPubkeys(bettors: Readonly<Uint8Array>): Address[] {
   const out: Address[] = [];
   if (bettors.length % BETTOR_PUBKEY_LEN !== 0) {
      throw new RangeError(`bettor bytes len ${bettors.length} not a multiple of ${BETTOR_PUBKEY_LEN}`);
   }
   for (let i = 0; i < bettors.length; i += BETTOR_PUBKEY_LEN) {
      out.push(addressDecoder.decode(bettors.subarray(i, i + BETTOR_PUBKEY_LEN)));
   }
   return out;
}

/** Fetch and decode promo market-data (oracle) account from chain. */
export async function fetchPromoOracleAccount(
   ctx: Pick<PromoAdminContext, 'rpcs' | 'programId'>,
   marketId: MarketId,
): Promise<PromoOracleChainState | null> {
   const [pda, bump] = await getPromoMarketDataPda(ctx.programId, marketId);
   const raw = await readAccountDataRaw(ctx.rpcs.rpc, pda);
   if (raw === null || raw.length === 0) {
      return null;
   }
   const oracle = decodePromoOracleAccount(raw);
   return { pda, bump, dataLen: raw.length, oracle, raw };
}

/** Pretty fields for CLI / logging. */
export function formatPromoOracleChainState(state: PromoOracleChainState): PromoOracleDisplay {
   const { oracle, raw, pda, bump, dataLen } = state;
   const eventStartIso =
      oracle.eventStartTime > 0 ? new Date(oracle.eventStartTime * 1000).toISOString() : null;

   return {
      pda,
      bump,
      dataLen,
      discriminator: oracle.discriminator,
      sequence: oracle.sequence,
      outcomeOdds0: oracle.outcomeOdds0,
      outcomeOdds0Decimal: scaledOddsToDecimal(oracle.outcomeOdds0),
      outcomeOdds1: oracle.outcomeOdds1,
      outcomeOdds1Decimal: scaledOddsToDecimal(oracle.outcomeOdds1),
      outcomeOdds2: oracle.outcomeOdds2,
      outcomeOdds2Decimal: scaledOddsToDecimal(oracle.outcomeOdds2),
      eventStartTime: oracle.eventStartTime,
      eventStartIso,
      parlayFactor: oracle.parlayFactor,
      marketOutcomes: oracle.marketOutcomes,
      maxAmountUsdc: microUsdcToUsdc(oracle.maxAmount),
      maxTotalAmountUsdc: microUsdcToUsdc(oracle.maxTotalAmount),
      totalStakeUsdc: microUsdcToUsdc(oracle.totalStakeAmount),
      allowedCount: oracle.allowedCount,
      allowed: decodeBettorPubkeys(oracle.allowed),
      bettorCount: oracle.bettorCount,
      bettors: decodeBettorPubkeys(oracle.bettors),
      headerHex: formatHeaderHex(raw),
      getQuoteReady:
         oracle.discriminator === ORACLE_ACCOUNT_DISCRIMINATOR
         && oracle.bump === bump
         && oracle.outcomeOdds0 >= ODDS_SCALE
         && oracle.outcomeOdds0 <= MAX_REASONABLE_ODDS_SCALED,
   };
}

/** JSON-serializable snapshot (bigint-safe). */
export function promoOracleChainStateToJson(state: PromoOracleChainState): Record<string, unknown> {
   const view = formatPromoOracleChainState(state);
   const o = PROMO_ORACLE_OFFSETS;
   const dv = new DataView(state.raw.buffer, state.raw.byteOffset, state.raw.byteLength);
   return {
      programId: PROMO_PROGRAM_ID,
      pda: view.pda,
      bump: view.bump,
      expectedBump: state.bump,
      bumpMatches: state.oracle.bump === state.bump,
      dataLen: view.dataLen,
      expectedDataLen: PROMO_ORACLE_ACCOUNT_LEN,
      discriminator: view.discriminator,
      sequence: view.sequence,
      outcomeOdds0: view.outcomeOdds0,
      outcomeOdds0Decimal: view.outcomeOdds0Decimal,
      outcomeOdds1: view.outcomeOdds1,
      outcomeOdds1Decimal: view.outcomeOdds1Decimal,
      outcomeOdds2: view.outcomeOdds2,
      outcomeOdds2Decimal: view.outcomeOdds2Decimal,
      u32AtOffset6: dv.getUint32(o.outcomeOdds0, true),
      u32AtOffset8: dv.getUint32(8, true),
      eventStartTime: view.eventStartTime,
      eventStartIso: view.eventStartIso,
      parlayFactor: view.parlayFactor,
      marketOutcomes: view.marketOutcomes,
      maxAmountUsdc: view.maxAmountUsdc,
      maxTotalAmountUsdc: view.maxTotalAmountUsdc,
      totalStakeUsdc: view.totalStakeUsdc,
      allowedCount: view.allowedCount,
      allowed: view.allowed,
      bettorCount: view.bettorCount,
      bettors: view.bettors,
      headerHex: view.headerHex,
      getQuoteReady: view.getQuoteReady,
   };
}

export function printPromoOracleChainState(state: PromoOracleChainState, marketKey?: string): void {
   const v = formatPromoOracleChainState(state);
   if (marketKey) {
      console.log(`market key:    ${marketKey}`);
   }
   console.log(`PDA:           ${v.pda}`);
   console.log(`data len:      ${v.dataLen} (expected ${PROMO_ORACLE_ACCOUNT_LEN})`);
   console.log(`disc / bump:   ${v.discriminator} / ${state.oracle.bump} (PDA bump ${v.bump})`);
   console.log(`sequence:      ${v.sequence}`);
   console.log(
      `odds @6/10/14: ${v.outcomeOdds0} (${v.outcomeOdds0Decimal.toFixed(4)}x) / `
         + `${v.outcomeOdds1} (${v.outcomeOdds1Decimal.toFixed(4)}x) / `
         + `${v.outcomeOdds2} (${v.outcomeOdds2Decimal.toFixed(4)}x)`,
   );
   console.log(`event start:   ${v.eventStartTime}${v.eventStartIso ? ` (${v.eventStartIso})` : ''}`);
   console.log(`market outs:   ${v.marketOutcomes}`);
   console.log(
      `caps / stake:  ${v.maxAmountUsdc} / ${v.maxTotalAmountUsdc} / ${v.totalStakeUsdc} USDC`,
   );
   console.log(`allowed:       ${v.allowedCount}`);
   for (const [i, addr] of v.allowed.entries()) {
      console.log(`  [${i}] ${addr}`);
   }
   console.log(`bettors:       ${v.bettorCount}`);
   for (const [i, addr] of v.bettors.entries()) {
      console.log(`  [${i}] ${addr}`);
   }
   console.log(`header bytes:  ${v.headerHex}`);
   console.log(`get_quote ok:  ${v.getQuoteReady ? 'yes' : 'no'}`);
}
