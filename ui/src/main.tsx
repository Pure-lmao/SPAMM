import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { BetSlipProvider } from "./betting/BetSlipContext";
import { SolanaProviders } from "./providers/SolanaProviders";
import { AppRoutes } from "./routes";
import "./index.css";

const el = document.getElementById("root");
if (el) {
   createRoot(el).render(
      <StrictMode>
         <BrowserRouter>
            <SolanaProviders>
               <BetSlipProvider>
                  <AppRoutes />
               </BetSlipProvider>
            </SolanaProviders>
         </BrowserRouter>
      </StrictMode>,
   );
}
