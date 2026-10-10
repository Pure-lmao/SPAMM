import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { isOddsFormat } from "./convertOdds";
import { LANGUAGE_OPTIONS, useSettings } from "./SettingsContext";
import { useI18n } from "../i18n/useI18n";

function CogIcon(): ReactElement {
   return (
      <svg className="settings-menu__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
         <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"
         />
         <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1v.1a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1.06-1.82 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.06-.33H2.9a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.82-1.06 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V2.9a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1.06 1.82 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.3.22.63.22 1v.07a1.65 1.65 0 0 0 1.06 1.5h.1a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.28.43z"
         />
      </svg>
   );
}

export function SettingsMenu(): ReactElement {
   const { language, oddsFormat, setLanguage, setOddsFormat } = useSettings();
   const { t } = useI18n();
   const [open, setOpen] = useState(false);
   const rootRef = useRef<HTMLDivElement>(null);
   const panelId = useId();

   useEffect(() => {
      if (!open) {
         return;
      }
      const onPointerDown = (e: PointerEvent) => {
         if (rootRef.current != null && !rootRef.current.contains(e.target as Node)) {
            setOpen(false);
         }
      };
      const onKeyDown = (e: KeyboardEvent) => {
         if (e.key === "Escape") {
            setOpen(false);
         }
      };
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      return () => {
         document.removeEventListener("pointerdown", onPointerDown);
         document.removeEventListener("keydown", onKeyDown);
      };
   }, [open]);

   return (
      <div className="settings-menu" ref={rootRef}>
         <button
            type="button"
            className="settings-menu__btn"
            aria-label={t("settings.settings")}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
         >
            <CogIcon />
         </button>
         {open && (
            <div id={panelId} className="settings-menu__panel" role="dialog" aria-label={t("settings.settings")}>
               <label className="settings-menu__field">
                  <span className="settings-menu__label">{t("settings.language")}</span>
                  <select
                     className="settings-menu__select"
                     value={language}
                     onChange={(e) => setLanguage(e.target.value)}
                  >
                     {LANGUAGE_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                           {opt.label}
                        </option>
                     ))}
                  </select>
               </label>
               <label className="settings-menu__field">
                  <span className="settings-menu__label">{t("settings.oddsFormat")}</span>
                  <select
                     className="settings-menu__select"
                     value={oddsFormat}
                     onChange={(e) => {
                        if (isOddsFormat(e.target.value)) {
                           setOddsFormat(e.target.value);
                        }
                     }}
                  >
                     {(
                        [
                           ["decimal", t("odds.decimal")],
                           ["american", t("odds.american")],
                           ["percent", t("odds.percent")],
                        ] as const
                     ).map(([id, label]) => (
                        <option key={id} value={id}>
                           {label}
                        </option>
                     ))}
                  </select>
               </label>
            </div>
         )}
      </div>
   );
}
