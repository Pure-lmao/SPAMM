import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   address,
   getSignatureFromTransaction,
   sendAndConfirmTransactionFactory,
   type Rpc,
   type SolanaRpcApi,
} from '@solana/kit';
import { useCluster, useKitTransactionSigner, useWallet } from '@solana/connector/react';
import {
   formatPredictionForTweet,
   getClosePredictionIx,
   getPredictionsByUser,
   type PredictionKind,
} from 'spamm-score-predict-sdk';
import { resolveHttpRpcUrl, buildSignV0Transaction, httpToWsRpcUrl } from '../betting/txPipeline';
import { fetchContestById, fetchContestHistory } from '../scorePredict/fetchContest';
import type { ApiPredictionContest } from '../scorePredict/types';

type EntryRow = {
   pda: string;
   contestId: number;
   predictionId: bigint;
   prediction: readonly [number, number];
   tweetLink: string;
   openBet: string;
   contest?: ApiPredictionContest;
};

export function ScorePredictHistoryPage(): ReactElement {
   const { isConnected, account } = useWallet();
   const { cluster } = useCluster();
   const { signer, ready: signerReady } = useKitTransactionSigner();
   const [rows, setRows] = useState<EntryRow[]>([]);
   const [err, setErr] = useState<string | null>(null);
   const [selectedContestIds, setSelectedContestIds] = useState<ReadonlySet<number>>(() => new Set());
   const [closing, setClosing] = useState(false);
   const [loading, setLoading] = useState(false);

   const rpc = useMemo((): Rpc<SolanaRpcApi> => {
      const url = resolveHttpRpcUrl(import.meta.env.VITE_SOLANA_RPC_URL ?? cluster?.url);
      return createSolanaRpc(url);
   }, [cluster?.url]);

   const load = useCallback(async () => {
      if (!isConnected || !account) {
         setRows([]);
         setSelectedContestIds(new Set());
         return;
      }
      setLoading(true);
      setErr(null);
      try {
         const onChain = await getPredictionsByUser(rpc, address(account));
         const history = await fetchContestHistory(50);
         const byId = new Map(history.map((c) => [c.id, c]));
         const merged: EntryRow[] = [];
         for (const row of onChain) {
            const c =
               byId.get(row.data.contestId) ??
               (await fetchContestById(row.data.contestId)) ??
               undefined;
            merged.push({
               pda: String(row.address),
               contestId: row.data.contestId,
               predictionId: row.data.predictionId,
               prediction: row.data.prediction,
               tweetLink: row.data.tweetLink,
               openBet: String(row.data.openBet),
               contest: c ?? undefined,
            });
         }
         merged.sort((a, b) => b.contestId - a.contestId);
         setRows(merged);
         setSelectedContestIds((prev) => {
            const next = new Set<number>();
            for (const id of prev) {
               if (merged.some((r) => r.contestId === id)) {
                  next.add(id);
               }
            }
            return next;
         });
      } catch (e) {
         setErr(e instanceof Error ? e.message : String(e));
      } finally {
         setLoading(false);
      }
   }, [isConnected, account, rpc]);

   useEffect(() => {
      void load();
   }, [load]);

   const toggleSelected = useCallback((contestId: number, checked: boolean) => {
      setSelectedContestIds((prev) => {
         const next = new Set(prev);
         if (checked) {
            next.add(contestId);
         } else {
            next.delete(contestId);
         }
         return next;
      });
   }, []);

   const closeSelected = useCallback(async () => {
      if (!account || !signer || !signerReady || selectedContestIds.size === 0) {
         return;
      }
      setClosing(true);
      setErr(null);
      try {
         const owner = address(account);
         const contestIds = [...selectedContestIds];
         const instructions = await Promise.all(
            contestIds.map((contestId) => getClosePredictionIx(owner, owner, contestId)),
         );
         const signed = await buildSignV0Transaction(rpc, {
            feePayer: signer,
            instructions,
            signers: [signer],
         });
         const httpUrl = resolveHttpRpcUrl(import.meta.env.VITE_SOLANA_RPC_URL);
         const subs = createSolanaRpcSubscriptions(httpToWsRpcUrl(httpUrl));
         const sendAndConfirm = sendAndConfirmTransactionFactory({
            rpc,
            rpcSubscriptions: subs,
         } as never);
         await sendAndConfirm(signed as never, { commitment: 'confirmed' });
         getSignatureFromTransaction(signed);
         setSelectedContestIds(new Set());
         await load();
      } catch (e) {
         setErr(e instanceof Error ? e.message : String(e));
      } finally {
         setClosing(false);
      }
   }, [account, signer, signerReady, rpc, load, selectedContestIds]);

   const canClose = isConnected && signerReady && selectedContestIds.size > 0 && !closing;

   return (
      <section className="score-predict-page">
         <div className="score-predict-page__toolbar">
            <h1 className="score-predict-history-title">Past entries</h1>
            <Link className="score-predict-link" to="/score-predict">
               Today&apos;s contest
            </Link>
         </div>

         {!isConnected && (
            <div className="score-predict-banner score-predict-banner--info">
               Connect your wallet to see your on-chain entries.
            </div>
         )}

         {isConnected && rows.length > 0 && (
            <>
               <p className="score-predict-history-notice">
                  Closed prediction accounts are not eligible to win. Only close entries for contests you
                  lost — keep open any entry that could still win.
               </p>
               <div className="score-predict-history-bulk">
                  <button
                     type="button"
                     className="bet-modal-btn bet-modal-btn--primary"
                     disabled={!canClose}
                     onClick={() => void closeSelected()}
                  >
                     {closing
                        ? 'Closing…'
                        : `Close selected predictions${selectedContestIds.size > 0 ? ` (${selectedContestIds.size})` : ''}`}
                  </button>
               </div>
            </>
         )}

         {err && <div className="score-predict-banner score-predict-banner--error">{err}</div>}

         {loading && <div className="score-predict-page__loading">Loading entries…</div>}

         {!loading && isConnected && rows.length === 0 && (
            <div className="score-predict-empty">
               <p>No on-chain prediction entries yet.</p>
            </div>
         )}

         <ul className="score-predict-history-list">
            {rows.map((row) => {
               const kind = (row.contest?.kind ?? 'match_score') as PredictionKind;
               const pick = formatPredictionForTweet(kind, row.prediction);
               const resultBytes = row.contest?.result_prediction;
               let resultLabel = 'Pending';
               let resultMod = 'pending';
               if (resultBytes && resultBytes.length >= 2) {
                  resultLabel = formatPredictionForTweet(kind, [resultBytes[0]!, resultBytes[1]!]);
                  resultMod = 'graded';
               }
               const checked = selectedContestIds.has(row.contestId);
               return (
                  <li key={`${row.contestId}-${row.predictionId}`} className="score-predict-history-card">
                     <div className="score-predict-history-card__head">
                        <label className="score-predict-history-card__select">
                           <input
                              type="checkbox"
                              checked={checked}
                              disabled={closing}
                              onChange={(e) => toggleSelected(row.contestId, e.target.checked)}
                           />
                           <span className="score-predict-history-card__select-label">Select to close</span>
                        </label>
                        <h2 className="score-predict-history-card__title">
                           {row.contest?.title ?? `Contest #${row.contestId}`}
                        </h2>
                        <span className={`score-predict-result-pill score-predict-result-pill--${resultMod}`}>
                           {resultMod === 'graded' ? `Result ${resultLabel}` : resultLabel}
                        </span>
                     </div>
                     <dl className="score-predict-history-card__meta">
                        <div>
                           <dt>Your pick</dt>
                           <dd>{pick}</dd>
                        </div>
                        <div>
                           <dt>Entry id</dt>
                           <dd>{row.predictionId.toString()}</dd>
                        </div>
                        <div>
                           <dt>Contest date</dt>
                           <dd>{row.contest?.contest_date ?? '—'}</dd>
                        </div>
                        <div className="score-predict-history-card__full">
                           <dt>Entry post</dt>
                           <dd>
                              <a href={row.tweetLink} target="_blank" rel="noreferrer">
                                 {row.tweetLink}
                              </a>
                           </dd>
                        </div>
                        {row.contest?.result_notes && (
                           <div className="score-predict-history-card__full">
                              <dt>Notes</dt>
                              <dd>{row.contest.result_notes}</dd>
                           </div>
                        )}
                     </dl>
                  </li>
               );
            })}
         </ul>
      </section>
   );
}
