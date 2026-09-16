import { useAccount } from "@solana/connector/react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { fetchDemoEvents, postDemoFreebet, postDemoPromo, type DemoEvent } from "../demo/demoApi";

function formatEventStart(ms: number): string {
   const d = new Date(ms);
   if (Number.isNaN(d.getTime())) {
      return "";
   }
   return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
   });
}

export function DemoPage(): ReactElement {
   const { address: connectedAddress } = useAccount();

   const [wallet, setWallet] = useState("");
   const [fbBusy, setFbBusy] = useState(false);
   const [fbErr, setFbErr] = useState<string | null>(null);
   const [fbOk, setFbOk] = useState<string | null>(null);

   const [events, setEvents] = useState<DemoEvent[]>([]);
   const [eventsErr, setEventsErr] = useState<string | null>(null);
   const [eventId, setEventId] = useState("");
   const [title, setTitle] = useState("");
   const [yesLabel, setYesLabel] = useState("Yes");
   const [odds, setOdds] = useState("");
   const [description, setDescription] = useState("");
   const [useAllow, setUseAllow] = useState(false);
   const [allow, setAllow] = useState("");
   const [promoBusy, setPromoBusy] = useState(false);
   const [promoErr, setPromoErr] = useState<string | null>(null);
   const [promoOk, setPromoOk] = useState<string | null>(null);

   useEffect(() => {
      document.title = "Demo — Automatic Sports Markets";
      return () => {
         document.title = "Automatic Sports Markets";
      };
   }, []);

   useEffect(() => {
      if (connectedAddress) {
         setWallet((prev) => (prev === "" ? connectedAddress : prev));
      }
   }, [connectedAddress]);

   const loadEvents = useCallback(async () => {
      setEventsErr(null);
      try {
         const rows = await fetchDemoEvents();
         setEvents(rows);
      } catch (e) {
         setEventsErr(e instanceof Error ? e.message : String(e));
      }
   }, []);

   useEffect(() => {
      void loadEvents();
   }, [loadEvents]);

   const onSendFreebet = useCallback(async () => {
      setFbErr(null);
      setFbOk(null);
      setFbBusy(true);
      try {
         const result = await postDemoFreebet(wallet.trim());
         setFbOk(`Freebet ${result.freebetId}`);
      } catch (e) {
         setFbErr(e instanceof Error ? e.message : String(e));
      } finally {
         setFbBusy(false);
      }
   }, [wallet]);

   const onCreatePromo = useCallback(async () => {
      setPromoErr(null);
      setPromoOk(null);
      const oddsNum = Number(odds);
      if (!Number.isFinite(oddsNum) || oddsNum <= 1 || oddsNum > 10) {
         setPromoErr("Odds must be > 1 and ≤ 10");
         return;
      }
      setPromoBusy(true);
      try {
         const result = await postDemoPromo({
            title: title.trim(),
            eventId: Number(eventId),
            odds: oddsNum,
            yesLabel: yesLabel.trim(),
            description: description.trim() || undefined,
            allow: useAllow ? allow : undefined,
         });
         setPromoOk(`Promo ${result.id}`);
         setTitle("");
         setOdds("");
         setDescription("");
         setAllow("");
         setUseAllow(false);
         await loadEvents();
         setEventId("");
      } catch (e) {
         setPromoErr(e instanceof Error ? e.message : String(e));
      } finally {
         setPromoBusy(false);
      }
   }, [allow, description, eventId, loadEvents, odds, title, useAllow, yesLabel]);

   return (
      <main className="demo-page">
         <h2 className="demo-page__title">Demo</h2>

         <section className="demo-page__card" aria-labelledby="demo-freebet-heading">
            <h3 id="demo-freebet-heading" className="demo-page__card-title">
               Give a user a $2 freebet.
            </h3>
            <label className="bet-modal-field">
               <span className="bet-modal-field-label">Wallet</span>
               <input
                  className="bet-modal-input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
               />
            </label>
            {fbErr != null && <p className="demo-page__err">{fbErr}</p>}
            {fbOk != null && <p className="demo-page__ok">{fbOk}</p>}
            <button
               type="button"
               className="bet-modal-btn bet-modal-btn--primary"
               disabled={fbBusy || wallet.trim() === ""}
               onClick={() => void onSendFreebet()}
            >
               {fbBusy ? "Sending…" : "Send"}
            </button>
         </section>

         <section className="demo-page__card" aria-labelledby="demo-promo-heading">
            <h3 id="demo-promo-heading" className="demo-page__card-title">
               Create a promo market.
            </h3>
            <p className="demo-page__meta">It will have a $1 max stake per bet.</p>
            {eventsErr != null && <p className="demo-page__err">{eventsErr}</p>}
            <label className="bet-modal-field">
               <span className="bet-modal-field-label">Event</span>
               <select
                  className="bet-modal-input"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
               >
                  <option value="">Select…</option>
                  {events.map((ev) => (
                     <option key={`${ev.sport_id}:${ev.league_id}:${ev.id}`} value={ev.id}>
                        {ev.event_name} · {formatEventStart(ev.start_time)}
                     </option>
                  ))}
               </select>
            </label>
            <label className="bet-modal-field">
               <span className="bet-modal-field-label">Title</span>
               <input
                  className="bet-modal-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
               />
            </label>
            <label className="bet-modal-field">
               <span className="bet-modal-field-label">Odds</span>
               <input
                  className="bet-modal-input"
                  type="number"
                  min={1.01}
                  max={10}
                  step={0.01}
                  value={odds}
                  onChange={(e) => setOdds(e.target.value)}
               />
            </label>
            <label className="bet-modal-field">
               <span className="bet-modal-field-label">Outcome title</span>
               <input
                  className="bet-modal-input"
                  type="text"
                  value={yesLabel}
                  onChange={(e) => setYesLabel(e.target.value)}
               />
            </label>
            <label className="bet-modal-field">
               <span className="bet-modal-field-label">Description (optional)</span>
               <textarea
                  className="bet-modal-input demo-page__textarea"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
               />
            </label>
            <label className="demo-page__check">
               <input
                  type="checkbox"
                  checked={useAllow}
                  onChange={(e) => setUseAllow(e.target.checked)}
               />
               Allow-list
            </label>
            {useAllow && (
               <label className="bet-modal-field">
                  <span className="bet-modal-field-label">Wallets (comma-separated list)</span>
                  <textarea
                     className="bet-modal-input demo-page__textarea"
                     rows={3}
                     value={allow}
                     onChange={(e) => setAllow(e.target.value)}
                  />
               </label>
            )}
            {promoErr != null && <p className="demo-page__err">{promoErr}</p>}
            {promoOk != null && <p className="demo-page__ok">{promoOk}</p>}
            <button
               type="button"
               className="bet-modal-btn bet-modal-btn--primary"
               disabled={
                  promoBusy ||
                  eventId === "" ||
                  title.trim() === "" ||
                  yesLabel.trim() === "" ||
                  odds.trim() === ""
               }
               onClick={() => void onCreatePromo()}
            >
               {promoBusy ? "Creating…" : "Create"}
            </button>
         </section>
      </main>
   );
}
