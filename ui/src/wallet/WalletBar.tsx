import { useEffect, useRef, useState, type ReactElement } from "react";
import {
   useAccount,
   useConnectWallet,
   useDisconnectWallet,
   useWallet,
   useWalletConnectors,
} from "@solana/connector/react";
import { EPHEMERAL_DEVNET_WALLET_NAME } from "./ephemeralDevnetWallet";

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
                     {connectors.map((c) => {
                        const isEphemeral = c.name === EPHEMERAL_DEVNET_WALLET_NAME;
                        const disabled = busy || !c.ready;
                        return (
                           <li key={c.id}>
                              {isEphemeral ? (
                                 <button
                                    type="button"
                                    className="wallet-bar__menu-item wallet-bar__menu-item--ephemeral"
                                    disabled={disabled}
                                    onClick={async () => {
                                       await connect(c.id);
                                       setMenuOpen(false);
                                    }}
                                 >
                                    <span className="wallet-bar__menu-item__title">{c.name}</span>
                                    <span className="wallet-bar__menu-subtitle">Stored in this browser only.</span>
                                 </button>
                              ) : (
                                 <button
                                    type="button"
                                    className="wallet-bar__menu-item"
                                    disabled={disabled}
                                    onClick={async () => {
                                       await connect(c.id);
                                       setMenuOpen(false);
                                    }}
                                 >
                                    {c.name}
                                 </button>
                              )}
                           </li>
                        );
                     })}
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
