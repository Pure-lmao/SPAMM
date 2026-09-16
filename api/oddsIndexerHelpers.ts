import {
   address,
   appendTransactionMessageInstructions,
   createTransactionMessage,
   generateKeyPairSigner,
   getAddressDecoder,
   lamports,
   pipe,
   setTransactionMessageFeePayerSigner,
   signTransactionMessageWithSigners,
   type Address,
   type Base64EncodedDataResponse,
   type EncodedAccount,
   type KeyPairSigner,
   type Lamports,
   type Rpc,
   type SolanaRpcApi,
} from "@solana/kit";
import {
   ComputeBudget,
   FailedTransactionMetadata,
   LiteSVM,
   type SimulatedTransactionInfo,
} from "litesvm";
import {
   AGGREGATOR_PROGRAM_ID,
   decodeMarketQuotesProxyReturnData,
   EVENT_STATE_DISCRIMINATOR,
   getEventGameState,
   getGetMarketQuotesProxyIx,
   getMmConfigPda,
   getMmQuoteBufferPda,
   maxProxyMmsForMarketQuotes,
   MAX_NUMBER_OF_MMS_PROXY,
   memcmp,
   MIN_BET_AMOUNT,
   MM_MARKET_DATA_PDA_DISCRIMINATOR,
   MM_QUOTE_BUFFER_DISCRIMINATOR,
   MM_QUOTE_BUFFER_LEN,
   numSidesForMkt,
   ODDS_SCALE,
   type MarketId,
   type ProxyMarketMmQuotes,
   Sport,
   u8WireByte,
} from "spamm-aggregator-sdk";
import { withRpcRetry } from "../aggregator/client/txSendV1.ts";
import { PROMO_MKT_ID } from "./localDb.ts";
import type { DbMarket } from "./types.ts";

const QUOTE_PROBE_BET_ID = 1n;
const QUOTE_PROBE_MIN_ODDS = ODDS_SCALE + 1n;
const GMA_CHUNK = 100;
const PROGRAMDATA_METADATA_LEN = 45;
const BPF_LOADER_UPGRADEABLE = address("BPFLoaderUpgradeab1e11111111111111111111111");
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000n;

export type OddsSvmContext = Readonly<{
   svm: LiteSVM;
   payer: KeyPairSigner;
}>;

function base64ToBytes(b64: string): Uint8Array {
   return new Uint8Array(Buffer.from(b64, "base64"));
}

function rpcAccountToEncoded(
   accountAddress: Address,
   account: {
      data: Base64EncodedDataResponse;
      executable: boolean;
      lamports: Lamports;
      owner: Address;
      space: bigint;
   },
): EncodedAccount {
   const data = base64ToBytes(account.data[0]);
   return {
      address: accountAddress,
      data,
      executable: account.executable,
      lamports: account.lamports,
      programAddress: account.owner,
      space: account.space,
   };
}

export function bestOddsPerSideFromMarketQuotes(
   quotes: readonly ProxyMarketMmQuotes[],
   numSides: number,
): number[] {
   const best = Array.from({ length: numSides }, () => 0);
   for (const mm of quotes) {
      for (let side = 0; side < numSides; side++) {
         const odds = Number(mm.oddsScaled[side] ?? 0n);
         if (odds > best[side]!) {
            best[side] = odds;
         }
      }
   }
   return best;
}

async function fetchProgramAccountsByDisc(
   rpc: Rpc<SolanaRpcApi>,
   program: Address,
   discriminator: number,
): Promise<EncodedAccount[]> {
   const rows = await withRpcRetry(() =>
      rpc.getProgramAccounts(program, {
         encoding: "base64",
         filters: [memcmp(0n, u8WireByte(discriminator))],
      }).send(),
   );
   return rows.map((row) => rpcAccountToEncoded(row.pubkey, row.account));
}

async function fetchAccountsByAddress(
   rpc: Rpc<SolanaRpcApi>,
   addresses: readonly Address[],
): Promise<EncodedAccount[]> {
   const out: EncodedAccount[] = [];
   for (let i = 0; i < addresses.length; i += GMA_CHUNK) {
      const chunk = addresses.slice(i, i + GMA_CHUNK);
      const { value } = await withRpcRetry(() =>
         rpc.getMultipleAccounts(chunk, { encoding: "base64" }).send(),
      );
      for (let j = 0; j < chunk.length; j++) {
         const account = value[j];
         if (account == null) {
            continue;
         }
         out.push(rpcAccountToEncoded(chunk[j]!, account));
      }
   }
   return out;
}

function programDataAddressFromUpgradeableProgram(data: Uint8Array): Address | null {
   if (data.length < 36) {
      return null;
   }
   const variant = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
   if (variant !== 2) {
      return null;
   }
   return getAddressDecoder().decode(data.subarray(4, 36));
}

async function loadProgramElf(rpc: Rpc<SolanaRpcApi>, programId: Address): Promise<Uint8Array> {
   const info = await withRpcRetry(() =>
      rpc.getAccountInfo(programId, { encoding: "base64" }).send(),
   );
   if (info.value === null) {
      throw new Error(`program account not found: ${programId}`);
   }
   const data = base64ToBytes(info.value.data[0]!);
   if (info.value.owner !== BPF_LOADER_UPGRADEABLE) {
      return data;
   }
   const programDataAddress = programDataAddressFromUpgradeableProgram(data);
   if (programDataAddress === null) {
      throw new Error(`upgradeable program ${programId} missing programdata address`);
   }
   const programData = await withRpcRetry(() =>
      rpc.getAccountInfo(programDataAddress, { encoding: "base64" }).send(),
   );
   if (programData.value === null) {
      throw new Error(`programdata account not found for ${programId}`);
   }
   const programDataBytes = base64ToBytes(programData.value.data[0]!);
   if (programDataBytes.length <= PROGRAMDATA_METADATA_LEN) {
      throw new Error(`programdata for ${programId} is too short to contain an ELF`);
   }
   return programDataBytes.subarray(PROGRAMDATA_METADATA_LEN);
}

function setDummyQuoteBuffer(svm: LiteSVM, mmProgram: Address, quoteBufferPda: Address): void {
   const data = new Uint8Array(MM_QUOTE_BUFFER_LEN);
   data[0] = MM_QUOTE_BUFFER_DISCRIMINATOR;
   const rent = svm.minimumBalanceForRentExemption(BigInt(MM_QUOTE_BUFFER_LEN));
   svm.setAccount({
      address: quoteBufferPda,
      data,
      executable: false,
      lamports: lamports(rent),
      programAddress: mmProgram,
      space: BigInt(MM_QUOTE_BUFFER_LEN),
   });
}

export async function createOddsSvm(
   rpc: Rpc<SolanaRpcApi>,
   mmPrograms: readonly Address[],
): Promise<OddsSvmContext> {
   const budget = new ComputeBudget();
   budget.computeUnitLimit = MAX_COMPUTE_UNIT_LIMIT;
   const svm = new LiteSVM().withComputeBudget(budget);

   const payer = await generateKeyPairSigner();
   svm.airdrop(payer.address, lamports(1_000_000_000n));

   const programIds = [AGGREGATOR_PROGRAM_ID, ...mmPrograms];
   for (const programId of programIds) {
      const elf = await loadProgramElf(rpc, programId);
      svm.addProgram(programId, elf);
   }

   const configAddresses: Address[] = [];
   for (const mmProgram of mmPrograms) {
      const markets = await fetchProgramAccountsByDisc(
         rpc,
         mmProgram,
         MM_MARKET_DATA_PDA_DISCRIMINATOR,
      );
      const events = await fetchProgramAccountsByDisc(
         rpc,
         mmProgram,
         EVENT_STATE_DISCRIMINATOR,
      );
      for (const account of markets) {
         svm.setAccount(account);
      }
      for (const account of events) {
         svm.setAccount(account);
      }
      const [configPda] = await getMmConfigPda(mmProgram);
      configAddresses.push(configPda);
      const [quoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      setDummyQuoteBuffer(svm, mmProgram, quoteBufferPda);
   }

   const configs = await fetchAccountsByAddress(rpc, configAddresses);
   for (const account of configs) {
      svm.setAccount(account);
   }

   return { svm, payer };
}

function dbMarketToWireId(market: DbMarket): MarketId {
   return {
      mkt: market.id,
      period: market.period_id,
      player: BigInt(market.player_id),
      eventId: {
         sport: market.sport_id as Sport,
         league: market.league_id,
         event: BigInt(market.event_id),
      },
      isPregame: true,
      operator: address(market.operator),
   };
}

export async function simulateMarketQuotesLocally(
   ctx: OddsSvmContext,
   market: DbMarket,
   mmPrograms: readonly Address[],
): Promise<number[] | null> {
   const numSides = numSidesForMkt(market.id);
   if (numSides === undefined) {
      console.warn(`Skipping odds cache for unsupported mkt ${market.id} (${market.mkt_string})`);
      return null;
   }
   if (market.id === PROMO_MKT_ID) {
      return null;
   }

   const mmProgramsForMarket = mmPrograms.slice(
      0,
      Math.min(MAX_NUMBER_OF_MMS_PROXY, maxProxyMmsForMarketQuotes(numSides)),
   );
   if (mmProgramsForMarket.length === 0) {
      return null;
   }

   const quoteIx = await getGetMarketQuotesProxyIx(
      {
         betId: QUOTE_PROBE_BET_ID,
         marketId: dbMarketToWireId(market),
         side: 0,
         amount: MIN_BET_AMOUNT,
         minOddsScaled: QUOTE_PROBE_MIN_ODDS,
         eventGameState: getEventGameState("PG", 0, 0, 0, 0),
         eventStateSequence: 1,
      },
      ctx.payer.address,
      mmProgramsForMarket,
   );

   const signedTx = await signTransactionMessageWithSigners(
      pipe(
         createTransactionMessage({ version: 0 }),
         (m) => setTransactionMessageFeePayerSigner(ctx.payer, m),
         (m) => ctx.svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
         (m) => appendTransactionMessageInstructions([quoteIx], m),
      ),
   );

   const result: FailedTransactionMetadata | SimulatedTransactionInfo =
      ctx.svm.simulateTransaction(signedTx);
   if (result instanceof FailedTransactionMetadata) {
      // console.error(
      //    `Local quote sim failed for market ${market.id} event ${market.event_id}: ${result.toString()}`,
      // );
      return null;
   }

   const returnData = result.meta().returnData().data();
   if (returnData.length === 0) {
      return null;
   }
   const quotes = decodeMarketQuotesProxyReturnData(returnData, numSides);
   return bestOddsPerSideFromMarketQuotes(quotes, numSides);
}
