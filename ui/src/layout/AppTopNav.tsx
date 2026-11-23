import { type ReactElement } from "react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../i18n/useI18n";
import { IS_DEVNET } from "../network";

export function AppTopNav(): ReactElement {
   const { t } = useI18n();
   return (
      <nav className="app-top-nav" aria-label={t("nav.primary")}>
         <NavLink to="/my-bets" className={({ isActive }) => `app-top-nav__link${isActive ? " app-top-nav__link--active" : ""}`}>
            {t("nav.myBets")}
         </NavLink>
         {IS_DEVNET ? (
            <NavLink to="/demo" className={({ isActive }) => `app-top-nav__link${isActive ? " app-top-nav__link--active" : ""}`}>
               {t("nav.demo")}
            </NavLink>
         ) : null}
      </nav>
   );
}
