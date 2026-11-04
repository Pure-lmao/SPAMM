

export type DbSport = {
   id: number;
   name: string;
   api_id: string;
};

export type DbLeague = {
   id: number;
   sport_id: number;
   name: string;
   abbr: string;
   country_code: string;
   country_name: string;
   country_rank: number;
   variation: number;
   api_id: string;
};

export type DbEvent = {
   id: number;
   league_id: number;
   sport_id: number;
   home_name: string;
   away_name: string;
   event_name: string;
   start_time: number;
   api_id: string;
   home_score: number | null;
   away_score: number | null;
};

/** Per-period result (e.g. esports map N = period 10 + N). `is_void` = 1 voids markets on that period. */
export type DbEventPeriodResult = {
   event_id: number;
   league_id: number;
   sport_id: number;
   period_id: number;
   home_score: number | null;
   away_score: number | null;
   is_void: number;
};

export type DbMarket = {
   id: number;
   event_id: number;
   league_id: number;
   sport_id: number;
   period_id: number;
   player_id: number;
   player_name: string;
   line_value: number | null;
   last_odds: string;
   last_update: number;
   mkt_string: string;
   operator: string;
   mint: string;
};

/** Event names for a bet card. Market id, period, and side come from the bet. */
export type BetCardEvent = {
   id: number;
   league_id: number;
   sport_id: number;
   home_name: string;
   away_name: string;
   event_name: string;
};

export type PromotionalMarketStatus = 'open' | 'settled';

export type PromoRelatedEvent = {
   sport_id: number;
   league_id: number;
   event_id: number;
   event_name?: string;
};

/** Promo market: on-chain `mkt` 9 (`PROMO`). Graded manually after Discord settle. */
export type PromotionalMarket = {
   id: number;
   title: string;
   description: string;
   sport_id: number;
   league_id: number;
   event_id: number;
   period_id: number;
   operator: string;
   mint: string;
   yes_label: string;
   last_odds: string;
   last_update: number;
   status: PromotionalMarketStatus;
   winning_side: number | null;
   related_events: PromoRelatedEvent[];
   closes_at: number | null;
   created_at: number;
   settled_at: number | null;
   settled_notes: string | null;
};

/** One event inside `GroupedLeague.events`; `markets` set when fetched with `withMarkets`. */
export type GroupedEvent = DbEvent & { markets?: DbMarket[] };

export type GroupedLeague = {
   id: number;
   sport_id: number;
   name: string;
   abbr: string;
   country_name: string;
   country_code: string;
   country_rank: number;
   api_id: string;
   events: GroupedEvent[];
};

/** One sport branch for UI: sport → leagues → events → optional markets. */
export type GroupedSport = {
   id: number;
   /** Display label; same as `name` from DB. */
   sport: string;
   name: string;
   api_id: string;
   leagues: GroupedLeague[];
};

export type PredictionContestStatus = 'open' | 'locked' | 'graded';

export type PredictionContestKind = 'match_score' | 'daily_total';

export type PredictionContest = {
   id: number;
   contest_date: string;
   deadline: number;
   kind: PredictionContestKind;
   title: string;
   description: string;
   tweet_template: string;
   /** X/Twitter status id; appended as `in_reply_to` on the post intent URL when set. */
   reply_to_tweet_id: string | null;
   event_sport_id: number | null;
   event_league_id: number | null;
   event_id: number | null;
   home_flag_url: string | null;
   away_flag_url: string | null;
   image_url: string | null;
   status: PredictionContestStatus;
   result_prediction: Uint8Array | null;
   result_notes: string | null;
   created_at: number;
   graded_at: number | null;
};

/** API response for today's contest. */
export type PredictionContestToday = PredictionContest & {
   entry_open: boolean;
};

export type ESPNEvent = {
   id: string;
   uid: string;
   date: string;
   name: string;
   shortName: string;
   season: any;
   competitions: ESPNCompetition[];
   links: any;
   status: {
      displayClock: string;
      period: number;
      clock: number;
      type: {
         id: string;
         name: string;
         completed: boolean;
         description: string;
         detail: string;
         shortDetail: string;
      };
   }
};

export type ESPNCompetition = {
   id: string;
   uid: string;
   date: string; //ISO String
   attendance: number;
   type: {id: string; abbreviation: string};
   timeValid: boolean;
   neutralSite: boolean;
   conferenceCompetition: boolean;
   playByPlayAvailable: boolean;
   recent: boolean;
   wasSuspended: boolean;
   venue: {id: string; fullName: string; address: {city: string; state: string; country: string}, indoor: boolean};
   competitors: ESPNCompetitor[];
   notes: any;
   status: {
      displayClock: string;
      period: number;
      clock: number;
      type: any;
   };
   startDate: string;   
};

export type ESPNCompetitor = {
   id: string;
   uid: string;
   type: string;
   order: number;
   homeAway: string;
   winner: boolean;
   team: ESPNTeam;
   score: string;
};

export type ESPNTeam = {
   id: string;
   uid: string;
   location: string;
   name: string;
   abbreviation: string;
   displayName: string;
   shortDisplayName: string;
   color: string;
   alternateColor: string;
   isActive: boolean;
   links: any;
   logo: string;
};

export type ESPNOdds = {
   error?: {message: string, code: number};
   count: number;
   pageIndex: number;
   pageSize: number;
   pageCount: number;
   items: {
      provider: any;
      details: string;
      overUnder: number;
      spread: number;
      initialSpread: number;
      initialOverUnder: number;
      price: number;
      overOdds: number;
      underOdds: number;
      awayTeamOdds: ESPNTeamOdds;
      homeTeamOdds: ESPNTeamOdds;
      links: any;
      moneylineWinner: false | string;
      spreadWinner: false | string;
      open: ESPNOddsSet;
      close: ESPNOddsSet;
      current: ESPNOddsSet;
   }[]
}

export type ESPNPropsResponse = {
   error?: {message: string, code: number};
   count: number;
   pageIndex: number;
   pageSize: number;
   pageCount: number;
   items: ESPNProps[];
}

export type ESPNProps = ESPNPropsWithOdds | ESPNPropsWithCurrentWithOdds | ESPNPropsWithCurrentLine;

export type ESPNPropsBase = {
   competition: {
      "$ref": string;
   };
   athlete: {
      "$ref": string;
   };
   provider: {
      "$ref": string;
   };
   type: {
      id: string;
      name: string;
   };
   lastUpdated: string;
}
export type ESPNPropsWithOdds = ESPNPropsBase & {
   odds: {
      american: {
         value: string;
         open: string;
      },
      decimal: {
         value: string;
         open: string;
      },
      fraction: {
         value: string;
         open: string;
      },
      total: {
         value: string;
         open: string;
      }
   },
   current: {
      target: {
         value: number;
         displayValue: string;
      }
   },
   open: {
      target: {
         value: number;
         displayValue: string;
      }
   }
}

export type ESPNPropsWithCurrentWithOdds = ESPNPropsBase & {
   current: {
      over: {
         value: number;
         displayValue: string;
         alternateDisplayValue: string;
         decimal: string;
         fraction: string;
         american: string;
      }
   },
   target: {
      value: number;
      displayValue: string;
   },
   open: {
      over: {
         value: number;
         displayValue: string;
         alternateDisplayValue: string;
         decimal: number;
         fraction: string;
         american: string;
      }
   }
}

export type ESPNPropsWithCurrentLine = ESPNPropsBase & {
   current: {
      target: {
         value: number;
         displayValue: string;
      }
   },
   open: {
      target: {
         value: number;
         displayValue: string;
      }
   }
}

export type PandaScoreTier = "s" | "a" | "b" | "c" | "d" | "unranked";

export type PandaScoreMatchStatus = "canceled" | "finished" | "not_started" | "postponed" | "running";

export type PandaScoreMatchType = "all_games_played" | "best_of" | "custom" | "first_to" | "ow_best_of" | "red_bull_home_ground";

export type PandaScoreOpponent = {
   id: number;
   name: string;
   acronym: string | null;
   slug: string;
   image_url: string | null;
};

export type PandaScoreGame = {
   id: number;
   position: number;
   status: "finished" | "not_played" | "not_started" | "running";
   finished: boolean;
   forfeit: boolean;
   winner: { id: number | null; type: string };
};

export type PandaScoreMatch = {
   id: number;
   name: string;
   status: PandaScoreMatchStatus;
   match_type: PandaScoreMatchType;
   number_of_games: number;
   scheduled_at: string | null;
   begin_at: string | null;
   draw: boolean;
   forfeit: boolean;
   /** Opponent id that starts with a one-map lead. Not listed in `games`, but counted in `results`. */
   game_advantage: number | null;
   games: PandaScoreGame[];
   opponents: { type: "Team" | "Player"; opponent: PandaScoreOpponent }[];
   results: { team_id?: number; player_id?: number; score: number }[];
   winner_id: number | null;
   league_id: number;
   league: { id: number; name: string; slug: string; image_url: string | null };
   serie: { id: number; full_name: string; name: string | null };
   tournament: { id: number; name: string; tier: PandaScoreTier | null };
};

type ESPNTeamOdds = {
   favorite: boolean;
   underdog: boolean;
   moneyline: number;
   open: ESPNTeamOddsSet;
   close: ESPNTeamOddsSet;
   current: ESPNTeamOddsSet;
   team: any;
}

type ESPNTeamOddsSet = {
   favorite: boolean;
   pointSpread: {
      alternateDisplayValue: string;
      american: string;
   };
   spread: {
      value: number;
      displayValue: string;
      alternateDisplayValue: string;
      decimal: number;
      fraction: string;
      american: string;
   };
   moneyLine: {
      value: number;
      displayValue: string;
      alternateDisplayValue: string;
      decimal: number;
      fraction: string;
      american: string;
   };
};

type ESPNOddsSet = {
   over: {
      value: number;
      displayValue: string;
      alternateDisplayValue: string;
      decimal: number;
      fraction: string;
      american: string;
   };
   under: {
      value: number;
      displayValue: string;
      alternateDisplayValue: string;
      decimal: number;
      fraction: string;
      american: string;
   };
   total: {
      alternateDisplayValue: string;
      american: string;
   };
   draw?: {
      value: number;
      displayValue: string;
      alternateDisplayValue: string;
      decimal: number;
      fraction: string;
      american: string;
   };
}