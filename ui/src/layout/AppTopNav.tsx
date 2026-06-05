import { type ReactElement } from "react";
import { NavLink } from "react-router-dom";

export function AppTopNav(): ReactElement {
   return (
      <nav className="app-top-nav" aria-label="Primary">
         {/* <div className="app-top-nav__live" title="Live markets — not available yet">
            <span className="app-top-nav__live-caption">Live</span>
            <span className="app-top-nav__live-soon">Coming soon</span>
         </div> */}
         <NavLink to="/my-bets" className={({ isActive }) => `app-top-nav__link${isActive ? " app-top-nav__link--active" : ""}`}>
            My Bets
         </NavLink>
         <NavLink to="/score-predict" className={({ isActive }) => `app-top-nav__link${isActive ? " app-top-nav__link--active" : ""}`}>
            World Cup Predict
         </NavLink>
      </nav>
   );
}
