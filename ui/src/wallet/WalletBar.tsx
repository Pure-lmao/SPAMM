import { useEffect, useRef, useState, type ReactElement } from "react";
import { useDepositFunds } from "@privy-io/react-auth";
import { IS_DEVNET } from "../network";
import { EPHEMERAL_DEVNET_WALLET_NAME } from "./ephemeralDevnetWallet";
import { useAppWallet } from "./useAppWallet";
import { useI18n } from "../i18n/useI18n";

/** Stripe delivers USDC on mainnet only, including sandbox. */
const STRIPE_SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export function WalletBar(): ReactElement {
   const {
      isConnected,
      formatted,
      account,
      connectors,
      connectBusy,
      connectError,
      loginError,
      connectWallet,
      loginSocial,
      logout,
      walletName,
   } = useAppWallet();
   const { depositFunds } = useDepositFunds();
   const { t } = useI18n();
   const [open, setOpen] = useState(false);
   const [step, setStep] = useState<"choose" | "wallets">("choose");
   const [copied, setCopied] = useState(false);
   const [accountMenu, setAccountMenu] = useState(false);
   const [depositing, setDepositing] = useState(false);
   const accountMenuRef = useRef<HTMLDivElement>(null);
   const [depositError, setDepositError] = useState<string | null>(null);
   const busy = connectBusy;
   const error = connectError ?? loginError ?? depositError;
   const isPrivy = walletName?.toLowerCase() === "privy";

   useEffect(() => {
      if (!open) {
         return;
      }
      const onKey = (event: KeyboardEvent) => {
         if (event.key === "Escape") {
            setOpen(false);
         }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [open]);

   useEffect(() => {
      if (!accountMenu) {
         return;
      }
      const closeMenu = (event: MouseEvent) => {
         if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
            setAccountMenu(false);
         }
      };
      document.addEventListener("mousedown", closeMenu);
      return () => document.removeEventListener("mousedown", closeMenu);
   }, [accountMenu]);

   useEffect(() => {
      if (!copied) {
         return;
      }
      const timer = window.setTimeout(() => setCopied(false), 2000);
      return () => window.clearTimeout(timer);
   }, [copied]);

   const close = () => {
      setOpen(false);
      setStep("choose");
   };

   const copyAddress = async () => {
      if (account == null) {
         return;
      }
      try {
         await navigator.clipboard.writeText(account);
         setCopied(true);
      } catch {
         setCopied(false);
      }
   };

   const deposit = () => {
      if (account == null) {
         return;
      }
      setAccountMenu(false);
      setDepositError(null);
      setDepositing(true);
      void depositFunds({
         destination: {
            wallet: account,
            asset: "usdc",
            chain: STRIPE_SOLANA_CHAIN,
         },
         fiat: {
            source: {
               assets: ["usd", "eur"],
               defaultAsset: "usd",
            },
            environment: IS_DEVNET ? "sandbox" : "production",
            preferredProvider: "stripe",
         },
      })
         .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            if (/exit/i.test(message)) {
               return;
            }
            setDepositError(message);
         })
         .finally(() => setDepositing(false));
   };

   return (
      <div className="wallet-bar">
         {!isConnected || account == null || formatted == null ? (
            <button
               type="button"
               className="wallet-bar__btn"
               disabled={connectBusy}
               onClick={() => {
                  setStep("choose");
                  setOpen(true);
               }}
            >
               {connectBusy ? t("buttons.connecting") : t("buttons.signIn")}
            </button>
         ) : (
            <div className="wallet-bar__connected">
               {isPrivy ? (
                  <div className="wallet-bar__account" ref={accountMenuRef}>
                     <button
                        type="button"
                        className="wallet-bar__btn wallet-bar__addr-btn"
                        disabled={busy}
                        aria-expanded={accountMenu}
                        onClick={() => setAccountMenu((openMenu) => !openMenu)}
                     >
                        {depositing ? t("buttons.depositing") : copied ? t("buttons.copied") : formatted}
                     </button>
                     {accountMenu && (
                        <ul className="wallet-bar__menu" role="menu">
                           <li>
                              <button
                                 type="button"
                                 className="wallet-bar__menu-item"
                                 role="menuitem"
                                 disabled={depositing}
                                 onClick={deposit}
                              >
                                 {t("buttons.deposit")}
                              </button>
                           </li>
                           <li>
                              <button
                                 type="button"
                                 className="wallet-bar__menu-item"
                                 role="menuitem"
                                 onClick={() => {
                                    void copyAddress().then(() => setAccountMenu(false));
                                 }}
                              >
                                 {t("buttons.copyAddress")}
                              </button>
                           </li>
                        </ul>
                     )}
                  </div>
               ) : (
                  <button
                     type="button"
                     className="wallet-bar__addr"
                     title={copied ? t("buttons.copied") : account}
                     onClick={() => void copyAddress()}
                  >
                     {copied ? t("buttons.copied") : formatted}
                  </button>
               )}
               <button type="button" className="wallet-bar__btn wallet-bar__btn--ghost" disabled={busy} onClick={() => void logout()}>
                  {t("buttons.disconnect")}
               </button>
               {error != null && (
                  <span className="wallet-bar__err" title={error}>
                     {error}
                  </span>
               )}
            </div>
         )}
         {open && (
            <div
               className="bet-modal-overlay"
               role="presentation"
               onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                     close();
                  }
               }}
            >
               <div
                  className="bet-modal-dialog bet-modal-dialog--compact"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="auth-entry-title"
                  onMouseDown={(event) => event.stopPropagation()}
               >
                  <header className="bet-modal-header">
                     <h2 id="auth-entry-title" className="bet-modal-title">
                        {t("buttons.signIn")}
                     </h2>
                     <button type="button" className="bet-modal-close" onClick={close} aria-label={t("buttons.close")}>
                        ×
                     </button>
                  </header>
                  <div className="bet-modal-body">
                     {step === "choose" ? (
                        <div className="auth-entry__choices">
                           <button type="button" className="auth-entry__choice" onClick={() => setStep("wallets")}>
                              <span className="auth-entry__choice-title">{t("auth.wallet")}</span>
                              <span className="auth-entry__choice-hint">{t("auth.walletHint")}</span>
                           </button>
                           <button
                              type="button"
                              className="auth-entry__choice"
                              onClick={() => {
                                 close();
                                 loginSocial();
                              }}
                           >
                              <span className="auth-entry__choice-title">{t("auth.social")}</span>
                              <span className="auth-entry__choice-hint">{t("auth.socialHint")}</span>
                           </button>
                        </div>
                     ) : (
                        <div className="auth-entry__wallets">
                           <button type="button" className="auth-entry__back" onClick={() => setStep("choose")}>
                              {t("auth.back")}
                           </button>
                           {connectors.length === 0 && <p className="bet-modal-muted">{t("auth.noWallets")}</p>}
                           <ul className="auth-entry__wallet-list">
                              {connectors.map((connector) => {
                                 const isEphemeral = connector.name === EPHEMERAL_DEVNET_WALLET_NAME;
                                 return (
                                    <li key={connector.id}>
                                       <button
                                          type="button"
                                          className="auth-entry__wallet"
                                          disabled={busy || !connector.ready}
                                          onClick={() => {
                                             void connectWallet(connector.id).then(() => close());
                                          }}
                                       >
                                          <span className="auth-entry__choice-title">{connector.name}</span>
                                          {isEphemeral && (
                                             <span className="auth-entry__choice-hint">{t("auth.ephemeralHint")}</span>
                                          )}
                                       </button>
                                    </li>
                                 );
                              })}
                           </ul>
                        </div>
                     )}
                     {error != null && <p className="bet-modal-err">{error}</p>}
                  </div>
               </div>
            </div>
         )}
      </div>
   );
}
