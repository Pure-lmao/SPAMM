import { useId, useState, type ReactElement, type ReactNode } from "react";

/** Event-page market group. Open by default; the header toggles the body. */
export function MarketSection({
   title,
   tooltip,
   children,
}: {
   title: string;
   tooltip?: string;
   children: ReactNode;
}): ReactElement {
   const [open, setOpen] = useState(true);
   const panelId = useId();

   return (
      <section className="event-market-section">
         <button
            type="button"
            className="event-market-section-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            title={tooltip}
            onClick={() => setOpen((v) => !v)}
         >
            <span>{title}</span>
            <span className={`event-market-section-toggle__chevron${open ? " is-open" : ""}`} aria-hidden="true" />
         </button>
         {open ? (
            <div id={panelId} className="event-market-section-body">
               {children}
            </div>
         ) : null}
      </section>
   );
}
