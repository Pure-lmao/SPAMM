import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { useI18n } from "../i18n/useI18n";
import { copyBetCardImage } from "./copyBetCardImage";

function ShareIcon(): ReactElement {
   return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
         <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
         />
      </svg>
   );
}

function CheckIcon(): ReactElement {
   return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
         <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M5 12.5 9.5 17 19 7" />
      </svg>
   );
}

export function BetCardMark({ cardRef }: { cardRef: RefObject<HTMLElement | null> }): ReactElement {
   const { t } = useI18n();
   const [phase, setPhase] = useState<"idle" | "busy" | "copied" | "err">("idle");
   const timer = useRef(0);

   useEffect(() => () => window.clearTimeout(timer.current), []);

   const label =
      phase === "copied" ? t("myBets.shareCopied") : phase === "err" ? t("myBets.shareFailed") : t("myBets.shareBet");

   const onShare = () => {
      const node = cardRef.current;
      if (node == null || phase === "busy") {
         return;
      }
      setPhase("busy");
      void copyBetCardImage(node).then(
         () => {
            setPhase("copied");
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setPhase("idle"), 1600);
         },
         () => {
            setPhase("err");
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setPhase("idle"), 2200);
         },
      );
   };

   return (
      <div className="my-bets-card__mark">
         <img src="/brand.png" alt="" className="my-bets-card__mark-logo" />
         <span className="my-bets-card__mark-word">Automatic Sports Markets</span>
         <button
            type="button"
            className={`my-bets-card__share${phase === "copied" ? " my-bets-card__share--copied" : ""}`}
            aria-label={label}
            title={label}
            disabled={phase === "busy"}
            onClick={onShare}
         >
            {phase === "copied" ? <CheckIcon /> : <ShareIcon />}
         </button>
      </div>
   );
}
