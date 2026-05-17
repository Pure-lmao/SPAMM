import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { BetModal } from "./BetModal";
import type { BetModalOpenContext } from "./types";

type BetModalCtx = {
   openBet: (ctx: BetModalOpenContext) => void;
   closeBet: () => void;
};

const BetModalContext = createContext<BetModalCtx | null>(null);

export function BetModalProvider({ children }: { children: ReactNode }): ReactElement {
   const [open, setOpen] = useState<BetModalOpenContext | null>(null);
   const openBet = useCallback((ctx: BetModalOpenContext) => {
      setOpen(ctx);
   }, []);
   const closeBet = useCallback(() => {
      setOpen(null);
   }, []);
   const value = useMemo(() => ({ openBet, closeBet }), [openBet, closeBet]);
   return (
      <BetModalContext.Provider value={value}>
         {children}
         <BetModal open={open} onClose={closeBet} />
      </BetModalContext.Provider>
   );
}

export function useBetModal(): BetModalCtx {
   const v = useContext(BetModalContext);
   if (!v) {
      throw new Error("useBetModal must be used within BetModalProvider");
   }
   return v;
}
