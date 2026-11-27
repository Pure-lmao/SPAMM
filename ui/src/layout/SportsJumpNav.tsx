import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useI18n } from "../i18n/useI18n";
import { useSideRails } from "./sideRails";

/** Full labelled rail. Keep in sync with `--sports-jump-width`. */
const NAV_FULL_REM = 9.5;
/** My Bets column widths and gaps. Keep in sync with the pending-bets layout rules. */
const BETS_FORCED_REM = 17;
const BETS_FORCED_GAP_REM = 2;
const BETS_WIDE_REM = 20;
const BETS_WIDE_GAP_REM = 1.25;
const WIDE_BETS_MQ = "(min-width: 1620px)";
/** Odds table stays usable beside a full rail and the bets column. */
const MIN_MAIN_PX = 1000;
const ROOT_CHROME_PX = 32;

/** Matches the header's mobile breakpoint in `index.css`. */
const RAIL_MQ = "(min-width: 721px)";
const VIEWPORT_GUTTER_PX = 8;

export function sportJumpId(sportId: number): string {
   return `home-sport-${sportId}`;
}

export function leagueJumpId(sportId: number, leagueId: number): string {
   return `home-league-${sportId}-${leagueId}`;
}

export type SportsJumpLeague = {
   id: number;
   label: string;
};

export type SportsJumpSport = {
   id: number;
   label: string;
   leagues: SportsJumpLeague[];
};

type Props = {
   sports: readonly SportsJumpSport[];
   onSport: (sportId: number) => void;
   onLeague: (sportId: number, leagueId: number) => void;
};

function lengthPx(raw: string, rootFontPx: number): number {
   const value = raw.trim();
   const n = parseFloat(value);
   if (!Number.isFinite(n)) {
      return 0;
   }
   if (value.endsWith("rem")) {
      return n * rootFontPx;
   }
   return n;
}

function elementTop(el: HTMLElement): number {
   return el.getBoundingClientRect().top + window.scrollY;
}

function roomForFullNavAndBets(): boolean {
   const rootFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
   const wide = window.matchMedia(WIDE_BETS_MQ).matches;
   const nav = NAV_FULL_REM * rootFontPx;
   const navGap = 0.6 * rootFontPx;
   const bets = (wide ? BETS_WIDE_REM : BETS_FORCED_REM) * rootFontPx;
   const betsGap = (wide ? BETS_WIDE_GAP_REM : BETS_FORCED_GAP_REM) * rootFontPx;
   return window.innerWidth >= nav + navGap + MIN_MAIN_PX + bets + betsGap + ROOT_CHROME_PX;
}

export function SportsJumpNav({ sports, onSport, onLeague }: Props): ReactElement {
   const { t } = useI18n();
   const { betsVisible, closeBets } = useSideRails();
   const slotRef = useRef<HTMLDivElement>(null);
   const navRef = useRef<HTMLElement>(null);
   const measureRef = useRef<() => void>(() => {});
   const [navExpanded, setNavExpanded] = useState(true);
   const dots = betsVisible && !navExpanded;
   const scrollLock = useRef(0);
   const scrollGen = useRef(0);
   const [openSportId, setOpenSportId] = useState<number | null>(sports[0]?.id ?? null);
   const [activeLeagueId, setActiveLeagueId] = useState<number | null>(null);
   const openIndex = sports.findIndex((sport) => sport.id === openSportId);
   const openSport = openIndex < 0 ? null : sports[openIndex];

   function sportRow(index: number): number {
      if (dots || openIndex < 0 || index <= openIndex) {
         return index + 1;
      }
      return index + 2;
   }

   useEffect(() => {
      if (betsVisible) {
         setNavExpanded(false);
      }
   }, [betsVisible]);

   useEffect(() => {
      const onResize = () => {
         if (betsVisible && !roomForFullNavAndBets()) {
            setNavExpanded(false);
         }
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
   }, [betsVisible]);

   useLayoutEffect(() => {
      const slot = slotRef.current;
      const page = slot?.parentElement;
      const nav = navRef.current;
      if (slot == null || page == null || nav == null) {
         return;
      }

      const mq = window.matchMedia(RAIL_MQ);

      const applyOffset = () => {
         if (mq.matches) {
            page.style.setProperty("--sports-jump-offset", "0.75rem");
            return;
         }
         page.style.setProperty("--sports-jump-offset", `${Math.ceil(nav.offsetHeight + 10)}px`);
      };

      const measure = () => {
         applyOffset();
         if (!mq.matches) {
            if (page.style.paddingLeft !== "") {
               page.style.paddingLeft = "";
            }
            page.style.removeProperty("--sports-jump-pad");
            slot.dataset.ready = "true";
            return;
         }

         const rootFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
         const gap = lengthPx(getComputedStyle(page).getPropertyValue("--sports-jump-gap"), rootFontPx);
         const width = slot.getBoundingClientRect().width || lengthPx(getComputedStyle(page).getPropertyValue("--sports-jump-width"), rootFontPx);
         const left = page.getBoundingClientRect().left;
         const pad = Math.max(0, Math.ceil(width + gap + VIEWPORT_GUTTER_PX - left));
         const nextPad = `${pad}px`;
         if (page.style.getPropertyValue("--sports-jump-pad") !== nextPad) {
            page.style.setProperty("--sports-jump-pad", nextPad);
         }
         const nextPadding = pad > 0 ? nextPad : "";
         if (page.style.paddingLeft !== nextPadding) {
            page.style.paddingLeft = nextPadding;
         }
         slot.dataset.ready = "true";
      };

      measureRef.current = measure;
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(page);
      ro.observe(nav);
      ro.observe(document.documentElement);
      const root = document.getElementById("root");
      if (root != null) {
         ro.observe(root);
      }
      mq.addEventListener("change", measure);
      window.addEventListener("resize", measure);
      return () => {
         ro.disconnect();
         mq.removeEventListener("change", measure);
         window.removeEventListener("resize", measure);
         page.style.paddingLeft = "";
         page.style.removeProperty("--sports-jump-pad");
         page.style.removeProperty("--sports-jump-offset");
         delete slot.dataset.ready;
      };
   }, []);

   useLayoutEffect(() => {
      const page = slotRef.current?.parentElement;
      if (page == null) {
         return;
      }
      page.classList.toggle("home-page--nav-dots", dots);
      measureRef.current();
      return () => {
         page.classList.remove("home-page--nav-dots");
      };
   }, [dots]);

   useLayoutEffect(() => {
      const page = slotRef.current?.parentElement;
      const nav = navRef.current;
      if (page == null || nav == null) {
         return;
      }
      if (window.matchMedia(RAIL_MQ).matches) {
         page.style.setProperty("--sports-jump-offset", "0.75rem");
         return;
      }
      page.style.setProperty("--sports-jump-offset", `${Math.ceil(nav.offsetHeight + 10)}px`);
   }, [openSportId, sports]);

   useEffect(() => {
      if (sports.length === 0) {
         return;
      }

      const sync = () => {
         if (performance.now() < scrollLock.current) {
            return;
         }
         const page = slotRef.current?.parentElement;
         const offsetRaw = page == null ? "" : getComputedStyle(page).getPropertyValue("--sports-jump-offset");
         const rootFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
         const offset = lengthPx(offsetRaw, rootFontPx) || 12;
         const marker = window.scrollY + offset + 4;
         let sportId = sports[0]!.id;
         let leagueId: number | null = null;
         for (const sport of sports) {
            const sportEl = document.getElementById(sportJumpId(sport.id));
            if (sportEl == null || elementTop(sportEl) > marker) {
               continue;
            }
            sportId = sport.id;
            leagueId = null;
            for (const league of sport.leagues) {
               const leagueEl = document.getElementById(leagueJumpId(sport.id, league.id));
               if (leagueEl != null && elementTop(leagueEl) <= marker) {
                  leagueId = league.id;
               }
            }
         }
         setOpenSportId((prev) => (prev === sportId ? prev : sportId));
         setActiveLeagueId((prev) => (prev === leagueId ? prev : leagueId));
      };

      let frame = 0;
      const onScroll = () => {
         if (frame !== 0) {
            return;
         }
         frame = requestAnimationFrame(() => {
            frame = 0;
            sync();
         });
      };

      sync();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      return () => {
         cancelAnimationFrame(frame);
         window.removeEventListener("scroll", onScroll);
         window.removeEventListener("resize", onScroll);
      };
   }, [sports]);

   function armScrollLock(): void {
      const gen = ++scrollGen.current;
      scrollLock.current = Number.POSITIVE_INFINITY;
      const release = () => {
         if (scrollGen.current !== gen) {
            return;
         }
         scrollGen.current += 1;
         scrollLock.current = 0;
         window.dispatchEvent(new Event("scroll"));
      };
      window.addEventListener("scrollend", release, { once: true });
      window.setTimeout(release, 1600);
   }

   function expandNav(): void {
      setNavExpanded(true);
      if (!roomForFullNavAndBets()) {
         closeBets();
      }
   }

   function selectSport(sportId: number): void {
      armScrollLock();
      setOpenSportId(sportId);
      setActiveLeagueId(null);
      onSport(sportId);
   }

   function selectLeague(sportId: number, leagueId: number): void {
      armScrollLock();
      setOpenSportId(sportId);
      setActiveLeagueId(leagueId);
      onLeague(sportId, leagueId);
   }

   return (
      <div className="sports-jump-slot" ref={slotRef}>
         <nav className={`sports-jump${dots ? " sports-jump--dots" : ""}`} ref={navRef} aria-label={t("nav.sports")}>
            <div className="sports-jump__list">
               <div className="sports-jump__sports">
                  {sports.map((sport, index) => {
                     const isOpen = sport.id === openSportId;
                     return (
                        <button
                           key={sport.id}
                           type="button"
                           className={`sports-jump__sport${isOpen ? " is-open" : ""}`}
                           data-sport={sport.id}
                           style={{ gridRow: sportRow(index) }}
                           aria-current={isOpen ? "true" : undefined}
                           onClick={() => selectSport(sport.id)}
                        >
                           <span className="sports-jump__mark" aria-hidden />
                           <span className="sports-jump__sport-label">{sport.label}</span>
                        </button>
                     );
                  })}
               </div>
               {!dots && openSport != null && openSport.leagues.length > 0 && (
                  <ul className="sports-jump__leagues" style={{ gridRow: openIndex + 2 }}>
                     {openSport.leagues.map((league) => {
                        const isActive = league.id === activeLeagueId;
                        return (
                           <li key={league.id}>
                              <button
                                 type="button"
                                 className={`sports-jump__league${isActive ? " is-active" : ""}`}
                                 aria-current={isActive ? "true" : undefined}
                                 onClick={() => selectLeague(openSport.id, league.id)}
                              >
                                 {league.label}
                              </button>
                           </li>
                        );
                     })}
                  </ul>
               )}
            </div>
            {dots && (
               <button type="button" className="sports-jump__expand" aria-label={t("nav.showSports")} onClick={expandNav}>
                  <span aria-hidden>▸</span>
               </button>
            )}
         </nav>
      </div>
   );
}
