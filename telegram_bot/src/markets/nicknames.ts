/**
 * Alias → name fragments. Append rows when a common nickname misses search.
 * One alias may point at several teams (`spurs`).
 */
export const NICKNAMES: Record<string, readonly string[]> = {
   "man u": ["Manchester United"],
   "man utd": ["Manchester United"],
   "manchester utd": ["Manchester United"],
   spurs: ["Tottenham Hotspur", "San Antonio Spurs"],
   gunners: ["Arsenal"],
   barca: ["Barcelona"],
   wolves: ["Wolverhampton"],
   sixers: ["76ers"],
};
