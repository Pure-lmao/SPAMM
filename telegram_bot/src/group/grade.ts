import type { Api } from "grammy";
import { BetResult } from "spamm-aggregator-sdk";
import { fetchHistory, fetchOpenBets, isCashedOut, isPending, rowResult } from "../betting/bets";
import { logError } from "../chain/rpc";
import { ensureWallet } from "../wallet/privy";
import { closeCard, legsOpen } from "./cards";
import { trackingSnaps } from "./store";

export async function sweepCards(api: Api): Promise<void> {
   for (const snap of trackingSnaps()) {
      try {
         if (snap.kind === "pick" || snap.betAddress == null) {
            if (!(await legsOpen(snap.legs))) {
               await closeCard(api, snap, "Closed");
            }
            continue;
         }
         const wallet = await ensureWallet(snap.ownerId);
         const open = await fetchOpenBets(wallet.address);
         const row = open.find((item) => item.address === snap.betAddress);
         if (row != null && isPending(row)) {
            continue;
         }
         if (row != null && isCashedOut(row)) {
            await closeCard(api, snap, "CashedOut");
            continue;
         }
         if (row != null) {
            await closeCard(api, snap, BetResult[rowResult(row)] ?? "Graded");
            continue;
         }
         const page = await fetchHistory(wallet.address);
         const hist = page.rows.find((item) => item.recordId != null && item.recordId === snap.betAddress)
            ?? page.rows.find((item) => item.stakeRaw === snap.stake && item.legs[0]?.id === snap.legs[0]?.id && item.result !== "Pending");
         if (hist != null && hist.result !== "Pending") {
            await closeCard(api, snap, hist.result);
         }
      } catch (error) {
         logError(error);
      }
   }
}
