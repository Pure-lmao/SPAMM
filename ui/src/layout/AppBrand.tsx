import { Link } from "react-router-dom";
import type { ReactElement } from "react";

export type AppBrandProps = {
   /** When false, renders static branding (e.g. bet-slip share card). */
   asLink?: boolean;
   className?: string;
};

export function AppBrand({ asLink = true, className }: AppBrandProps): ReactElement {
   const title = asLink ? (
      <h1 className="app-title">Automatic Sports Markets</h1>
   ) : (
      <span className="app-title">Automatic Sports Markets</span>
   );
   const mark = <img src="/brand.png" alt="" className="app-header__brand-mark" />;
   const rootClass = className != null && className !== "" ? `app-header__brand ${className}` : "app-header__brand";

   if (asLink) {
      return (
         <div className={rootClass}>
            <Link to="/" className="app-header__brand-link inline-nav-link">
               {mark}
               {title}
            </Link>
         </div>
      );
   }

   return (
      <div className={rootClass}>
         <div className="app-header__brand-link">{mark}{title}</div>
      </div>
   );
}
