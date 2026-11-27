import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";

type SideRails = {
   /** User asked for the panel on widths where it is not always shown. */
   betsRequested: boolean;
   /** Hide the panel even on the always-on wide layout. */
   betsDismissed: boolean;
   openBets: () => void;
   closeBets: () => void;
   /** Panel is actually on screen. */
   betsVisible: boolean;
   setBetsVisible: (visible: boolean) => void;
};

const SideRailsContext = createContext<SideRails | null>(null);

export function SideRailsProvider({ children }: { children: ReactNode }): ReactElement {
   const [betsRequested, setBetsRequested] = useState(false);
   const [betsDismissed, setBetsDismissed] = useState(false);
   const [betsVisible, setBetsVisible] = useState(false);
   const value = useMemo(
      () => ({
         betsRequested,
         betsDismissed,
         openBets: () => {
            setBetsDismissed(false);
            setBetsRequested(true);
         },
         closeBets: () => {
            setBetsDismissed(true);
            setBetsRequested(false);
         },
         betsVisible,
         setBetsVisible,
      }),
      [betsRequested, betsDismissed, betsVisible],
   );
   return <SideRailsContext.Provider value={value}>{children}</SideRailsContext.Provider>;
}

export function useSideRails(): SideRails {
   const value = useContext(SideRailsContext);
   if (value == null) {
      return {
         betsRequested: false,
         betsDismissed: false,
         openBets: () => {},
         closeBets: () => {},
         betsVisible: false,
         setBetsVisible: () => {},
      };
   }
   return value;
}
