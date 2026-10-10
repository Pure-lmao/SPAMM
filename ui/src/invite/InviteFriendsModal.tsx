import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { isValidRefCode, loadOrCreateRefCode, persistRefCode, sanitizeRefCodeInput } from "./refCodeStorage";
import { useI18n } from "../i18n/useI18n";

type InviteFriendsModalProps = Readonly<{
   open: boolean;
   onClose: () => void;
}>;

function buildInviteUrl(refCode: string): string {
   const url = new URL("https://automaticsportsmarkets.com");
   url.searchParams.set("ref", refCode);
   return url.toString();
}

export function InviteFriendsModal({ open, onClose }: InviteFriendsModalProps): ReactElement | null {
   const [code, setCode] = useState(() => loadOrCreateRefCode());
   const [copyState, setCopyState] = useState<"copy" | "copied">("copy");
   const { t } = useI18n();

   useEffect(() => {
      if (!open) {
         return;
      }
      const onKey = (e: KeyboardEvent) => {
         if (e.key === "Escape") {
            onClose();
         }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [open, onClose]);

   useEffect(() => {
      if (open) {
         setCode(loadOrCreateRefCode());
         setCopyState("copy");
      }
   }, [open]);

   const inviteUrl = useMemo(() => (isValidRefCode(code) ? buildInviteUrl(code) : ""), [code]);

   const onCodeChange = useCallback((raw: string) => {
      const next = sanitizeRefCodeInput(raw);
      setCode(next);
      if (isValidRefCode(next)) {
         persistRefCode(next);
      }
   }, []);

   const onCopy = useCallback(async () => {
      if (inviteUrl === "") {
         return;
      }
      try {
         await navigator.clipboard.writeText(inviteUrl);
         setCopyState("copied");
         window.setTimeout(() => setCopyState("copy"), 2000);
      } catch {
         setCopyState("copy");
      }
   }, [inviteUrl]);

   if (!open) {
      return null;
   }

   return (
      <div
         className="bet-modal-overlay"
         role="presentation"
         onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
               onClose();
            }
         }}
      >
         <div
            className="bet-modal-dialog bet-modal-dialog--compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-friends-title"
            onMouseDown={(e) => e.stopPropagation()}
         >
            <header className="bet-modal-header">
               <h2 id="invite-friends-title" className="bet-modal-title">
                  {t("buttons.inviteFriends")}
               </h2>
               <button type="button" className="bet-modal-close" onClick={onClose} aria-label={t("buttons.close")}>
                  ×
               </button>
            </header>
            <div className="bet-modal-body">
               <p className="bet-modal-muted invite-friends-modal__lead">
                  Invite your fields by sharing this link. Edit the code below to personalise your link.
               </p>
               <label className="bet-modal-field invite-friends-modal__field">
                  <span className="bet-modal-field-label">Your code:</span>
                  <input
                     className="bet-modal-input invite-friends-modal__code-input"
                     type="text"
                     inputMode="text"
                     autoComplete="off"
                     spellCheck={false}
                     maxLength={6}
                     value={code}
                     onChange={(e) => onCodeChange(e.target.value)}
                     aria-invalid={!isValidRefCode(code)}
                  />
               </label>
               {inviteUrl !== "" ? (
                  <p className="bet-modal-muted invite-friends-modal__url-preview" title={inviteUrl}>
                     <span className="bet-modal-mono">{inviteUrl}</span>
                  </p>
               ) : (
                  <p className="bet-modal-err invite-friends-modal__hint">Enter at least 3 uppercase letters or numbers.</p>
               )}
            </div>
            <footer className="bet-modal-footer">
               <button type="button" className="bet-modal-btn bet-modal-btn--ghost" onClick={onClose}>
                  {t("buttons.close")}
               </button>
               <button
                  type="button"
                  className="bet-modal-btn bet-modal-btn--primary"
                  disabled={inviteUrl === ""}
                  onClick={() => void onCopy()}
               >
                  {copyState === "copied" ? t("buttons.copied") : t("buttons.copyLink")}
               </button>
            </footer>
         </div>
      </div>
   );
}

export function InviteFriendsControls(): ReactElement {
   const [open, setOpen] = useState(false);
   const { t } = useI18n();
   return (
      <>
         <button type="button" className="invite-friends-btn" onClick={() => setOpen(true)}>
            {t("buttons.inviteFriends")}
         </button>
         <InviteFriendsModal open={open} onClose={() => setOpen(false)} />
      </>
   );
}
