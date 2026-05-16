import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SolanaProviders } from "./providers/SolanaProviders";
import "./index.css";

const el = document.getElementById("root");
if (el) {
   createRoot(el).render(
      <StrictMode>
         <SolanaProviders>
            <App />
         </SolanaProviders>
      </StrictMode>,
   );
}
