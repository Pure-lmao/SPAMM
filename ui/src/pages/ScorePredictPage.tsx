import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { address, createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';
import {
   useCluster,
   useConnectWallet,
   useKitTransactionSigner,
   useWallet,
   useWalletConnectors,
} from '@solana/connector/react';
import {
   encodePrediction,
   getPredictionData,
   isScorePredictProgramDeployed,
   type PredictionKind,
} from 'spamm-score-predict-sdk';
import { resolveHttpRpcUrl } from '../betting/txPipeline';
import { formatFilledBetOdds } from '../betting/filledOdds';
import { formatUsdcBaseUnitsForUi } from '../betting/usdc';
import { fetchTodayContest } from '../scorePredict/fetchContest';
import {
   resolveQualifyingOpenBet,
   fetchEventsTree,
   type QualifyingOpenBet,
} from '../scorePredict/eligibleOpenBet';
import { clearEntryDraft, loadEntryDraft, saveEntryDraft } from '../scorePredict/draftStorage';
import { deterministicPredictionId } from '../scorePredict/deterministicPredictionId';
import {
   buildExpectedTweetText,
   buildTwitterIntentUrl,
   replyToTweetUrl,
} from '../scorePredict/tweetIntent';
import { verifyTweetMatchesExpected } from '../scorePredict/verifyTweet';
import { submitCreatePrediction } from '../scorePredict/createPredictionTx';
import type { ApiPredictionContest } from '../scorePredict/types';

function msUntil(deadline: number): string {
   const d = deadline - Date.now();
   if (d <= 0) {
      return 'Closed';
   }
   const h = Math.floor(d / 3_600_000);
   const m = Math.floor((d % 3_600_000) / 60_000);
   const s = Math.floor((d % 60_000) / 1000);
   return `${h}h ${m}m ${s}s`;
}

function scoreLabel(kind: PredictionKind, home: number, away: number, total: number): string {
   if (kind === 'match_score') {
      return `${home}-${away}`;
   }
   return String(total);
}

export function ScorePredictPage(): ReactElement {
   const { isConnected, account } = useWallet();
   const { cluster } = useCluster();
   const { signer, ready: signerReady } = useKitTransactionSigner();
   const { connect, isConnecting: connectBusy, resetError } = useConnectWallet();
   const connectors = useWalletConnectors();

   const [contest, setContest] = useState<ApiPredictionContest | null | undefined>(undefined);
   const [err, setErr] = useState<string | null>(null);
   const [openBet, setOpenBet] = useState<QualifyingOpenBet | null>(null);
   const [homeScore, setHomeScore] = useState(0);
   const [awayScore, setAwayScore] = useState(0);
   const [dailyTotal, setDailyTotal] = useState(0);
   const [tweetUrl, setTweetUrl] = useState('');
   const [tweetVerified, setTweetVerified] = useState(false);
   const [verifyErr, setVerifyErr] = useState<string | null>(null);
   const [alreadyEntered, setAlreadyEntered] = useState(false);
   const [submitting, setSubmitting] = useState(false);
   const [submitErr, setSubmitErr] = useState<string | null>(null);
   const [countdown, setCountdown] = useState('');
   const [copyTweetLabel, setCopyTweetLabel] = useState<'Copy' | 'Copied'>('Copy');

   const rpc = useMemo((): Rpc<SolanaRpcApi> => {
      const url = resolveHttpRpcUrl(import.meta.env.VITE_SOLANA_RPC_URL ?? cluster?.url);
      return createSolanaRpc(url);
   }, [cluster?.url]);

   const kind = (contest?.kind ?? 'match_score') as PredictionKind;
   const entryOpen = contest?.entry_open === true;

   const predictionBytes = useMemo((): readonly [number, number] => {
      if (!contest) {
         return [0, 0];
      }
      if (kind === 'match_score') {
         return encodePrediction(kind, { homeGoals: homeScore, awayGoals: awayScore });
      }
      return encodePrediction(kind, { total: dailyTotal });
   }, [contest, kind, homeScore, awayScore, dailyTotal]);

   const predictionId = useMemo((): bigint | null => {
      if (!contest || !account) {
         return null;
      }
      return deterministicPredictionId(contest.id, predictionBytes, account);
   }, [contest, account, predictionBytes]);

   const expectedTweet = useMemo(() => {
      if (!contest || predictionId == null) {
         return '';
      }
      return buildExpectedTweetText(contest.tweet_template, kind, predictionBytes, predictionId, {
         title: contest.title,
         description: contest.description,
      });
   }, [contest, predictionId, predictionBytes, kind]);

   const displayScore = useMemo(
      () => scoreLabel(kind, homeScore, awayScore, dailyTotal),
      [kind, homeScore, awayScore, dailyTotal],
   );

   useEffect(() => {
      let cancelled = false;
      void (async () => {
         try {
            const c = await fetchTodayContest();
            if (!cancelled) {
               setContest(c);
               if (!c) {
                  return;
               }
               const draft = loadEntryDraft(c.id, c.contest_date);
               if (draft && draft.kind === c.kind) {
                  setHomeScore(draft.homeScore);
                  setAwayScore(draft.awayScore);
                  setDailyTotal(draft.dailyTotal);
                  setTweetUrl(draft.tweetUrl);
               } else {
                  setHomeScore(0);
                  setAwayScore(0);
                  setDailyTotal(0);
                  setTweetUrl('');
               }
            }
         } catch (e) {
            if (!cancelled) {
               setErr(e instanceof Error ? e.message : String(e));
            }
         }
      })();
      return () => {
         cancelled = true;
      };
   }, []);

   useEffect(() => {
      if (!contest) {
         return;
      }
      saveEntryDraft({
         contestId: contest.id,
         contestDate: contest.contest_date,
         wallet: account ?? null,
         kind,
         homeScore,
         awayScore,
         dailyTotal,
         tweetUrl,
      });
   }, [contest, kind, homeScore, awayScore, dailyTotal, tweetUrl, account]);

   useEffect(() => {
      if (!contest) {
         return;
      }
      const t = setInterval(() => setCountdown(msUntil(contest.deadline)), 1000);
      return () => clearInterval(t);
   }, [contest]);

   useEffect(() => {
      if (!isConnected || !account || !contest) {
         setOpenBet(null);
         setAlreadyEntered(false);
         return;
      }
      let cancelled = false;
      void (async () => {
         try {
            // 1) Linked open bet — aggregator program (same as My Bets).
            const tree = await fetchEventsTree();
            const bet = await resolveQualifyingOpenBet({
               rpc,
               userAddress: account,
               contest,
               eventTree: tree,
            });
            if (cancelled) {
               return;
            }
            setOpenBet(bet);

            // 2) Already entered — score-predict program (prediction PDAs only).
            if (!isScorePredictProgramDeployed()) {
               setAlreadyEntered(false);
               return;
            }
            const existing = await getPredictionData(rpc, address(account), contest.id);
            if (cancelled) {
               return;
            }
            if (existing) {
               clearEntryDraft();
               setAlreadyEntered(true);
               setOpenBet(null);
               return;
            }
            setAlreadyEntered(false);
         } catch (e) {
            if (!cancelled) {
               setErr(e instanceof Error ? e.message : String(e));
            }
         }
      })();
      return () => {
         cancelled = true;
      };
   }, [isConnected, account, contest, rpc]);

   const runVerifyTweet = useCallback(async () => {
      setVerifyErr(null);
      setTweetVerified(false);
      const r = await verifyTweetMatchesExpected(tweetUrl, expectedTweet);
      if (!r.ok) {
         setVerifyErr(r.error ?? `Tweet text mismatch. Got: ${r.actual ?? '?'}`);
         return;
      }
      setTweetVerified(true);
   }, [tweetUrl, expectedTweet]);

   const runEnter = useCallback(async () => {
      if (!contest || !account || !signer || !signerReady || !openBet || predictionId == null || !tweetVerified) {
         return;
      }
      setSubmitting(true);
      setSubmitErr(null);
      try {
         await submitCreatePrediction({
            rpc,
            walletSigner: signer,
            ownerAddress: account,
            predictionId,
            contestId: contest.id,
            prediction: predictionBytes,
            openBetAddress: openBet.address,
            tweetLink: tweetUrl.trim(),
         });
         clearEntryDraft();
         setAlreadyEntered(true);
      } catch (e) {
         setSubmitErr(e instanceof Error ? e.message : String(e));
      } finally {
         setSubmitting(false);
      }
   }, [
      contest,
      account,
      signer,
      signerReady,
      openBet,
      predictionId,
      tweetVerified,
      rpc,
      predictionBytes,
      tweetUrl,
   ]);

   const onCopyTweet = useCallback(async () => {
      if (!expectedTweet) {
         return;
      }
      try {
         await navigator.clipboard.writeText(expectedTweet);
         setCopyTweetLabel('Copied');
         window.setTimeout(() => setCopyTweetLabel('Copy'), 2000);
      } catch {
         setCopyTweetLabel('Copy');
      }
   }, [expectedTweet]);

   const onConnectClick = useCallback(() => {
      resetError();
      const ready = connectors.find((c) => c.ready);
      const c = ready ?? connectors[0];
      if (c == null) {
         return;
      }
      void connect(c.id);
   }, [connect, connectors, resetError]);

   const canConnect = !connectBusy && connectors.length > 0;

   if (contest === undefined) {
      return (
         <section className="score-predict-page">
            <div className="score-predict-page__loading">Loading today&apos;s contest…</div>
         </section>
      );
   }

   if (err) {
      return (
         <section className="score-predict-page">
            <div className="score-predict-banner score-predict-banner--error">{err}</div>
         </section>
      );
   }

   if (!contest) {
      return (
         <section className="score-predict-page">
            <div className="score-predict-empty">
               <h1 className="score-predict-empty__title">Score Predict</h1>
               <p>No contest is scheduled for the current day.</p>
               <Link className="score-predict-link" to="/score-predict/history">
                  View past entries
               </Link>
            </div>
         </section>
      );
   }

   const intentUrl = expectedTweet
      ? buildTwitterIntentUrl(expectedTweet, contest.reply_to_tweet_id)
      : '#';
   const canEnter =
      isConnected && signerReady && openBet != null && tweetVerified && !submitting;

   return (
      <section className="score-predict-page">
         <div className="score-predict-page__toolbar">
            <span className="score-predict-page__eyebrow">Daily contest</span>
            <Link className="score-predict-link" to="/score-predict/history">
               Past entries
            </Link>
         </div>

         <header className="score-predict-hero">
            {(contest.home_flag_url || contest.away_flag_url || contest.image_url) && (
               <div className="score-predict-hero__art">
                  {contest.image_url && (
                     <img className="score-predict-hero__image" src={contest.image_url} alt="" />
                  )}
                  {(contest.home_flag_url || contest.away_flag_url) && (
                     <div className="score-predict-hero__flags">
                        {contest.home_flag_url && (
                           <img className="score-predict-hero__flag" src={contest.home_flag_url} alt="" />
                        )}
                        {contest.away_flag_url && (
                           <img className="score-predict-hero__flag" src={contest.away_flag_url} alt="" />
                        )}
                     </div>
                  )}
               </div>
            )}
            <h1 className="score-predict-hero__title">{contest.title}</h1>
            <p className="score-predict-hero__desc">{contest.description}</p>
            <div className="score-predict-hero__meta">
               <span
                  className={`score-predict-pill${entryOpen ? ' score-predict-pill--open' : ' score-predict-pill--closed'}`}
               >
                  {entryOpen ? 'Entries open' : 'Entries closed'}
               </span>
               <span className="score-predict-hero__deadline">
                  <span className="score-predict-hero__deadline-label">Deadline</span>
                  <time dateTime={new Date(contest.deadline).toISOString()}>
                     {new Date(contest.deadline).toLocaleString()}
                  </time>
                  <span className="score-predict-hero__countdown">{countdown}</span>
               </span>
            </div>
         </header>

         {alreadyEntered ? (
            <div className="score-predict-banner score-predict-banner--success">
               <p>You&apos;re in for this contest.</p>
               <Link className="score-predict-link" to="/score-predict/history">
                  View your entry
               </Link>
            </div>
         ) : !entryOpen ? (
            <div className="score-predict-banner score-predict-banner--warn">
               Entries are closed for this contest. Check back for the next one.
            </div>
         ) : (
            <div className="score-predict-flow">
               <section className="score-predict-card">
                  <div className="score-predict-card__head">
                     <span className="score-predict-step">1</span>
                     <h2 className="score-predict-card__title">Your prediction</h2>
                  </div>
                  {kind === 'match_score' ? (
                     <div className="score-predict-scoreboard">
                        <div className="score-predict-score-field">
                           <label className="bet-modal-field-label" htmlFor="sp-home">
                              Home
                           </label>
                           <input
                              id="sp-home"
                              className="bet-modal-input score-predict-score-input"
                              type="number"
                              min={0}
                              max={20}
                              value={homeScore}
                              onChange={(e) => setHomeScore(Number(e.target.value))}
                           />
                        </div>
                        <span className="score-predict-scoreboard__sep" aria-hidden>
                           –
                        </span>
                        <div className="score-predict-score-field">
                           <label className="bet-modal-field-label" htmlFor="sp-away">
                              Away
                           </label>
                           <input
                              id="sp-away"
                              className="bet-modal-input score-predict-score-input"
                              type="number"
                              min={0}
                              max={20}
                              value={awayScore}
                              onChange={(e) => setAwayScore(Number(e.target.value))}
                           />
                        </div>
                     </div>
                  ) : (
                     <div className="bet-modal-field">
                        <label className="bet-modal-field-label" htmlFor="sp-total">
                           Your total
                        </label>
                        <input
                           id="sp-total"
                           className="bet-modal-input"
                           type="number"
                           min={0}
                           max={65535}
                           value={dailyTotal}
                           onChange={(e) => setDailyTotal(Number(e.target.value))}
                        />
                     </div>
                  )}
                  <p className="score-predict-pick-preview">
                     Pick: <strong>{displayScore}</strong>
                  </p>
               </section>

               <section className="score-predict-card">
                  <div className="score-predict-card__head">
                     <span className="score-predict-step">2</span>
                     <h2 className="score-predict-card__title">Post on X</h2>
                  </div>
                  <p className="score-predict-card__hint">
                     Post the following text to X via the button below, or copy and post it if there is an issue.
                  </p>
                  {expectedTweet && (
                     <>
                        <div className="score-predict-tweet-row">
                           <blockquote className="score-predict-tweet-preview">{expectedTweet}</blockquote>
                           <button
                              type="button"
                              className="score-predict-copy-btn"
                              onClick={() => void onCopyTweet()}
                              aria-label="Copy tweet text to clipboard"
                           >
                              {copyTweetLabel}
                           </button>
                        </div>
                        {contest.reply_to_tweet_id != null &&
                           /^\d+$/.test(contest.reply_to_tweet_id.trim()) && (
                              <p className="score-predict-reply-hint">
                                 Post as a reply to{' '}
                                 <a
                                    className="score-predict-link"
                                    href={replyToTweetUrl(contest.reply_to_tweet_id)}
                                    target="_blank"
                                    rel="noreferrer"
                                 >
                                    this post
                                 </a>{' '}
                                 if you post manually (the button below does this this automatically).
                              </p>
                           )}
                     </>
                  )}
                  <a
                     className="bet-modal-btn bet-modal-btn--primary score-predict-post-btn"
                     href={intentUrl}
                     target="_blank"
                     rel="noreferrer"
                  >
                     Post on X
                  </a>
               </section>

               <section className="score-predict-card">
                  <div className="score-predict-card__head">
                     <span className="score-predict-step">3</span>
                     <h2 className="score-predict-card__title">Verify &amp; enter</h2>
                  </div>
                  <div className="bet-modal-field">
                     <label className="bet-modal-field-label" htmlFor="sp-tweet-url">
                        Paste your post link
                     </label>
                     <input
                        id="sp-tweet-url"
                        className="bet-modal-input"
                        type="url"
                        value={tweetUrl}
                        onChange={(e) => {
                           setTweetUrl(e.target.value);
                           setTweetVerified(false);
                        }}
                        placeholder="https://x.com/username/status/…"
                     />
                  </div>
                  <div className="score-predict-actions">
                     <button
                        type="button"
                        className="bet-modal-btn bet-modal-btn--ghost"
                        disabled={!tweetUrl.trim()}
                        onClick={() => void runVerifyTweet()}
                     >
                        Verify post
                     </button>
                     <button
                        type="button"
                        className="bet-modal-btn bet-modal-btn--primary"
                        disabled={
                           !isConnected
                              ? !canConnect
                              : !canEnter
                        }
                        onClick={() => {
                           if (!isConnected) {
                              onConnectClick();
                              return;
                           }
                           void runEnter();
                        }}
                     >
                        {!isConnected
                           ? connectBusy
                              ? 'Connecting…'
                              : 'Connect wallet'
                           : submitting
                              ? 'Submitting…'
                              : 'Enter on-chain'}
                     </button>
                  </div>
                  {openBet && (
                     <div className="score-predict-bet-chip">
                        <span className="score-predict-bet-chip__label">Linked bet</span>
                        <span className="score-predict-bet-chip__value">
                           {openBet.eventLabel} · {formatUsdcBaseUnitsForUi(openBet.amount)} USDC @{' '}
                           {formatFilledBetOdds(openBet.row.data.amount, openBet.row.data.payout)}
                        </span>
                     </div>
                  )}
                  {isConnected && !openBet && (
                     <p className="score-predict-msg score-predict-msg--error">
                        No qualifying open bet — you need to have an open bet of at least $1 USDC on an event taking place today to enter.
                     </p>
                  )}
                  {verifyErr && <p className="score-predict-msg score-predict-msg--error">{verifyErr}</p>}
                  {tweetVerified && (
                     <p className="score-predict-msg score-predict-msg--ok">Post verified — you can enter.</p>
                  )}
                  {submitErr && <p className="score-predict-msg score-predict-msg--error">{submitErr}</p>}
               </section>
            </div>
         )}

         <div className="score-predict-terms">
            <p>
               Terms and conditions: Entry requires an open single bet of at least $1 USDC on an event taking place the same day as the contest event(s). You must post the entry text on X via the button or copy and past it manually. It must be in reply to the post specified if required. If there are multiple correct predictions in a contest, the tie breakers are: 1) highest amount in the linked bet, 2) highest odds in the linked bet, 3) earliest placed linked bet. Your linked bet cannot be changed after entry and is automatically picked at entry time based on your open bets. You will be contacted via X to recieve your prize. The prize is a $10 USDC risk free single bet. You will specify the bet you wish to be risk free after placing it, before the event start, to the organiser. If your risk free bet loses, you will be refunded up to $10 USDC.
            </p>
         </div>
      </section>
   );
}
