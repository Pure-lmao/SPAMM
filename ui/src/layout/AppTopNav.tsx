import { type ReactElement } from "react";
import { NavLink } from "react-router-dom";

export function AppTopNav(): ReactElement {
   return (
      <nav className="app-top-nav" aria-label="Primary">
         <NavLink to="/my-bets" className={({ isActive }) => `app-top-nav__link${isActive ? " app-top-nav__link--active" : ""}`}>
            My Bets
         </NavLink>
      </nav>
   );
}
