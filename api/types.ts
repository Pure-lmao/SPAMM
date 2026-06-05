

export type Sport = {
   id: number;
   name: string;
   api_id: string;
};

export type League = {
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

export type Event = {
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

export type Market = {
   id: number;
   event_id: number;
   league_id: number;
   sport_id: number;
   period_id: number;
   line_value: number | null;
   last_odds: string;
   last_update: number;
   mkt_string: string;
};

/** One event inside `GroupedLeague.events`; `markets` set when fetched with `withMarkets`. */
export type GroupedEvent = Event & { markets?: Market[] };

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