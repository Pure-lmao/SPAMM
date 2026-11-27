export type Act =
   | { t: "menu" }
   | { t: "sports"; page: number }
   | { t: "leagues"; sportId: number; page: number }
   | { t: "games"; sportId: number; leagueId: number; page: number }
   | { t: "game"; sportId: number; leagueId: number; eventId: number }
   | { t: "sections"; sportId: number; leagueId: number; eventId: number; page: number }
   | { t: "section"; sportId: number; leagueId: number; eventId: number; section: number; page: number }
   | { t: "focus"; index: number }
   | { t: "place" }
   | { t: "add" }
   | { t: "addbet" }
   | { t: "unfocus" }
   | { t: "combo" }
   | { t: "drop"; index: number }
   | { t: "clearCombo" }
   | { t: "addMore" }
   | { t: "betCombo" }
   | { t: "stake"; amount: string }
   | { t: "stakeType" }
   | { t: "min" }
   | { t: "confirm" }
   | { t: "rfq" }
   | { t: "rfqPick"; index: number }
   | { t: "freebet" }
   | { t: "boost" }
   | { t: "noVoucher" }
   | { t: "bets"; tab: "pending" | "graded"; page: number }
   | { t: "cash"; index: number }
   | { t: "escrow"; index: number }
   | { t: "cashOk" }
   | { t: "cashEdit" }
   | { t: "claim" }
   | { t: "history" }
   | { t: "older" }
   | { t: "balance" }
   | { t: "deposit" }
   | { t: "airdrop" }
   | { t: "withdraw" }
   | { t: "withdrawOk" }
   | { t: "search" }
   | { t: "searchPage"; page: number }
   | { t: "settings" }
   | { t: "oddsFormat"; format: "decimal" | "american" | "percent" }
   | { t: "explorer"; explorer: "solscan" | "solana" | "orb" }
   | { t: "help" }
   | { t: "alt"; index: number }
   | { t: "eventMarkets"; index: number }
   | { t: "back" };
