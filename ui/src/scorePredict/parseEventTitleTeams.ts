const TEAM_TITLE_DELIMITERS = [' vs. ', ' vs ', ' - '] as const;

export function parseEventTitleTeams(title: string): { home: string; away: string } {
   for (const delim of TEAM_TITLE_DELIMITERS) {
      const idx = title.indexOf(delim);
      if (idx === -1) {
         continue;
      }
      const home = title.slice(0, idx).trim();
      const away = title.slice(idx + delim.length).trim();
      if (home && away) {
         return { home, away };
      }
   }
   return { home: 'Home', away: 'Away' };
}
