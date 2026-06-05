import { useEffect, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): ReactElement {
   useEffect(() => {
      document.title = 'Page not found — Automatic Sports Markets';
      return () => {
         document.title = 'Automatic Sports Markets';
      };
   }, []);

   return (
      <section className="not-found-page" aria-labelledby="not-found-heading">
         <div className="not-found-page__stage">
            <div className="not-found-page__ball-wrap" aria-hidden>
               <img
                  className="not-found-page__ball"
                  src="/not-found-football.png"
                  alt=""
                  width={520}
                  height={520}
               />
            </div>
            <p id="not-found-heading" className="not-found-page__message">
               Oh no, page not found.{' '}
               <span className="not-found-page__aside">
                  <Link className="not-found-page__home-link" to="/">
                  Back to the betting
                  </Link>
               </span>
            </p>
         </div>
      </section>
   );
}
