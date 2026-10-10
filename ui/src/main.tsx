import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { BetSlipProvider } from "./betting/BetSlipContext";
import { SolanaProviders } from "./providers/SolanaProviders";
import { SettingsProvider } from "./settings/SettingsContext";
import { AppRoutes } from "./routes";
import "./index.css";

const el = document.getElementById("root");
if (el) {
   createRoot(el).render(
      <StrictMode>
         <BrowserRouter>
            <SolanaProviders>
               <SettingsProvider>
                  <BetSlipProvider>
                     <AppRoutes />
                  </BetSlipProvider>
               </SettingsProvider>
            </SolanaProviders>
         </BrowserRouter>
      </StrictMode>,
   );
}
