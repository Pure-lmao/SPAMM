import { type ReactElement } from "react";

const FOOTER_LINKS: readonly { label: string; href: string }[] = [
   { label: "X (Twitter)", href: "https://x.com/AutmtcSprtsMkts" },
   { label: "Discord", href: "https://discord.gg/AG7J2kzkpV" },
   { label: "GitHub", href: "https://github.com/Pure-lmao/SPAMM" },
];

export function AppFooter(): ReactElement {
   return (
      <footer className="app-footer" aria-label="Site links">
         <nav className="app-footer__nav">
            {FOOTER_LINKS.map((link) => (
               <a
                  key={link.href}
                  className="app-footer__link"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
               >
                  {link.label}
               </a>
            ))}
         </nav>
      </footer>
   );
}
