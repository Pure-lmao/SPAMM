export type PredictionContestKind = 'match_score' | 'daily_total';

export type ApiPredictionContest = {
   id: number;
   contest_date: string;
   deadline: number;
   kind: PredictionContestKind;
   title: string;
   description: string;
   tweet_template: string;
   reply_to_tweet_id: string | null;
   event_sport_id: number | null;
   event_league_id: number | null;
   event_id: number | null;
   home_flag_url: string | null;
   away_flag_url: string | null;
   image_url: string | null;
   status: string;
   result_prediction: number[] | null;
   result_notes: string | null;
   created_at: number;
   graded_at: number | null;
   entry_open?: boolean;
};
