import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { BetModalProvider } from "./betting/BetModalContext";
import { SolanaProviders } from "./providers/SolanaProviders";
import { AppRoutes } from "./routes";
import "./index.css";

const el = document.getElementById("root");
if (el) {
   createRoot(el).render(
      <StrictMode>
         <BrowserRouter>
            <SolanaProviders>
               <BetModalProvider>
                  <AppRoutes />
               </BetModalProvider>
            </SolanaProviders>
         </BrowserRouter>
      </StrictMode>,
   );
}
