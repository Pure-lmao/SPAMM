import { useEffect, useRef, useState, type ReactElement } from "react";
import {
   useAccount,
   useConnectWallet,
   useDisconnectWallet,
   useWallet,
   useWalletConnectors,
} from "@solana/connector/react";

export function WalletBar(): ReactElement {
   const { isConnected, isConnecting } = useWallet();
   const { formatted, address } = useAccount();
   const { connect, isConnecting: connectBusy, error: connectError, resetError } = useConnectWallet();
   const { disconnect, isDisconnecting } = useDisconnectWallet();
   const connectors = useWalletConnectors();

   const [menuOpen, setMenuOpen] = useState(false);
   const wrapRef = useRef<HTMLDivElement>(null);

   const busy = isConnecting || connectBusy || isDisconnecting;

   useEffect(() => {
      if (!menuOpen) {
         return;
      }
      const close = (e: MouseEvent) => {
         if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
            setMenuOpen(false);
         }
      };
      document.addEventListener("mousedown", close);
      return () => document.removeEventListener("mousedown", close);
   }, [menuOpen]);

   return (
      <div className="wallet-bar" ref={wrapRef}>
         {!isConnected || !address ? (
            <div className="wallet-bar__cluster">
               <button
                  type="button"
                  className="wallet-bar__btn"
                  disabled={busy}
                  onClick={() => {
                     resetError();
                     setMenuOpen((o) => !o);
                  }}
               >
                  {busy ? "Connecting…" : "Connect wallet"}
               </button>
               {connectError != null && (
                  <span className="wallet-bar__err" title={connectError.message}>
                     {connectError.message}
                  </span>
               )}
               {menuOpen && (
                  <ul className="wallet-bar__menu" role="listbox">
                     {connectors.length === 0 && (
                        <li className="wallet-bar__menu-empty">No wallets detected (install a Wallet Standard wallet).</li>
                     )}
                     {connectors.map((c) => (
                        <li key={c.id}>
                           <button
                              type="button"
                              className="wallet-bar__menu-item"
                              disabled={busy || !c.ready}
                              onClick={async () => {
                                 await connect(c.id);
                                 setMenuOpen(false);
                              }}
                           >
                              {c.name}
                           </button>
                        </li>
                     ))}
                  </ul>
               )}
            </div>
         ) : (
            <div className="wallet-bar__connected">
               <span className="wallet-bar__addr" title={address}>
                  {formatted}
               </span>
               <button type="button" className="wallet-bar__btn wallet-bar__btn--ghost" disabled={busy} onClick={() => disconnect()}>
                  Disconnect
               </button>
            </div>
         )}
      </div>
   );
}
