import {
   createContext,
   useCallback,
   useContext,
   useEffect,
   useMemo,
   useState,
   type ReactElement,
   type ReactNode,
} from "react";
import { MAX_PARLAY_LEGS } from "spamm-aggregator-sdk";
import { marketKey, selectionId, selectionMatches } from "./betSlipUtils";
import { BetSlipTray } from "./BetSlipTray";
import type { BetSlipSelection, BetSlipSelectionInput } from "./types";

type BetSlipCtx = {
   selections: readonly BetSlipSelection[];
   expanded: boolean;
   /** True after Place bet until Reuse selection(s); blocks edits to the slip. */
   slipLocked: boolean;
   setSlipLocked: (locked: boolean) => void;
   toggleSelection: (input: BetSlipSelectionInput) => void;
   removeSelection: (id: string) => void;
   clearSlip: () => void;
   setExpanded: (expanded: boolean) => void;
   isSelected: (input: Pick<BetSlipSelectionInput, "eventId" | "marketWireId" | "periodId" | "column" | "outcomeIndex">) => boolean;
   slipActive: boolean;
};

const BetSlipContext = createContext<BetSlipCtx | null>(null);

export function BetSlipProvider({ children }: { children: ReactNode }): ReactElement {
   const [selections, setSelections] = useState<BetSlipSelection[]>([]);
   const [expanded, setExpanded] = useState(true);
   const [slipLocked, setSlipLocked] = useState(false);

   const clearSlip = useCallback(() => {
      if (slipLocked) {
         return;
      }
      setSelections([]);
      setExpanded(true);
   }, [slipLocked]);

   const toggleSelection = useCallback((input: BetSlipSelectionInput) => {
      if (slipLocked) {
         return;
      }
      const id = selectionId(input);
      setSelections((prev) => {
         const exactIdx = prev.findIndex((s) => s.id === id);
         if (exactIdx >= 0) {
            const next = prev.filter((_, i) => i !== exactIdx);
            if (next.length <= 1) {
               setExpanded(true);
            }
            return next;
         }

         const mk = marketKey(input);
         const withoutMarket = prev.filter((s) => marketKey(s) !== mk);
         if (withoutMarket.length >= MAX_PARLAY_LEGS) {
            return prev;
         }

         const next: BetSlipSelection[] = [...withoutMarket, { ...input, id }];
         if (prev.length === 1 && next.length === 2) {
            setExpanded(false);
         }
         return next;
      });
   }, [slipLocked]);

   const removeSelection = useCallback((id: string) => {
      if (slipLocked) {
         return;
      }
      setSelections((prev) => {
         const next = prev.filter((s) => s.id !== id);
         if (next.length <= 1) {
            setExpanded(true);
         }
         return next;
      });
   }, [slipLocked]);

   const isSelected = useCallback(
      (input: Pick<BetSlipSelectionInput, "eventId" | "marketWireId" | "periodId" | "column" | "outcomeIndex">) => {
         return selections.some((s) => selectionMatches(s, input));
      },
      [selections],
   );

   const slipActive = selections.length > 0;

   useEffect(() => {
      document.body.classList.toggle("has-bet-slip", slipActive);
      document.body.classList.toggle("bet-slip-expanded", slipActive && expanded);
      return () => {
         document.body.classList.remove("has-bet-slip");
         document.body.classList.remove("bet-slip-expanded");
      };
   }, [slipActive, expanded]);

   const value = useMemo(
      () => ({
         selections,
         expanded,
         slipLocked,
         setSlipLocked,
         toggleSelection,
         removeSelection,
         clearSlip,
         setExpanded,
         isSelected,
         slipActive,
      }),
      [selections, expanded, slipLocked, toggleSelection, removeSelection, clearSlip, isSelected, slipActive],
   );

   return (
      <BetSlipContext.Provider value={value}>
         {children}
         <BetSlipTray />
      </BetSlipContext.Provider>
   );
}

/** @deprecated Use {@link BetSlipProvider}. */
export const BetModalProvider = BetSlipProvider;

export function useBetSlip(): BetSlipCtx {
   const v = useContext(BetSlipContext);
   if (!v) {
      throw new Error("useBetSlip must be used within BetSlipProvider");
   }
   return v;
}

/** @deprecated Use {@link useBetSlip}. */
export function useBetModal(): BetSlipCtx & { openBet: BetSlipCtx["toggleSelection"]; closeBet: BetSlipCtx["clearSlip"] } {
   const slip = useBetSlip();
   return { ...slip, openBet: slip.toggleSelection, closeBet: slip.clearSlip };
}
