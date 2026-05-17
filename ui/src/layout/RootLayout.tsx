import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { AppTopNav } from "./AppTopNav";
import { UsdcBalancePanel } from "../wallet/UsdcBalancePanel";
import { WalletBar } from "../wallet/WalletBar";

/** Keep in sync with `max-width` in `index.css` for `.app-header` wallet menu rules. */
const WALLET_MENU_MQ = "(max-width: 720px)";

export function RootLayout(): ReactElement {
   const [walletMenuOpen, setWalletMenuOpen] = useState(false);
   const walletShellRef = useRef<HTMLDivElement>(null);
   const location = useLocation();

   useEffect(() => {
      setWalletMenuOpen(false);
   }, [location.pathname]);

   useEffect(() => {
      const mq = window.matchMedia(WALLET_MENU_MQ);
      const onMq = () => {
         if (!mq.matches) {
            setWalletMenuOpen(false);
         }
      };
      mq.addEventListener("change", onMq);
      return () => mq.removeEventListener("change", onMq);
   }, []);

   useEffect(() => {
      if (!walletMenuOpen) {
         return;
      }
      const mq = window.matchMedia(WALLET_MENU_MQ);
      const onPointerDown = (e: PointerEvent) => {
         if (!mq.matches) {
            return;
         }
         if (walletShellRef.current != null && !walletShellRef.current.contains(e.target as Node)) {
            setWalletMenuOpen(false);
         }
      };
      const onKeyDown = (e: KeyboardEvent) => {
         if (e.key === "Escape") {
            setWalletMenuOpen(false);
         }
      };
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      return () => {
         document.removeEventListener("pointerdown", onPointerDown);
         document.removeEventListener("keydown", onKeyDown);
      };
   }, [walletMenuOpen]);

   return (
      <>
         <header className="app-header">
            <div className="app-header__brand">
               <h1 className="app-title">
                  <Link to="/" className="inline-nav-link">
                     Automatic Sports Markets
                  </Link>
               </h1>
            </div>
            <AppTopNav />
            <div className="app-header__wallet-shell" ref={walletShellRef}>
               <button
                  type="button"
                  className="app-header__wallet-menu-btn"
                  id="header-wallet-menu-trigger"
                  aria-expanded={walletMenuOpen}
                  aria-controls="header-wallet-menu-panel"
                  aria-haspopup="true"
                  onClick={() => setWalletMenuOpen((o) => !o)}
               >
                  Wallet
               </button>
               <div
                  id="header-wallet-menu-panel"
                  className={`app-header__wallet-panel${walletMenuOpen ? " is-open" : ""}`}
                  role="region"
                  aria-label="Wallet"
               >
                  <UsdcBalancePanel />
                  <WalletBar />
               </div>
            </div>
         </header>
         <Outlet />
      </>
   );
}
