

## Sport (u8 - max 255)

These ids are suggested but ultimately controlled by the market operator. Only 0 and 1 are enforced by the aggregator program. 0 is used as a null placeholder, and 1 is used for soccer, creating a 3-way event netting header (home, away, draw).

0 - Invalid
1 - Soccer
2 - American Football
3 - Baseball
4 - Basketball
5 - Ice Hockey
6 - Tennis
7 - Golf
8 - Motorsports
9 - Cricket
101 - Counter-Strike 2
102 - Dota 2
103 - League of Legends
104 - Valorant

... More to be added

## League (u16 - max 65535)

For most sports, the league id will be as follows:
Digit 1 is the tier of the competition within it's `type` (e.g. Premier League = 1, Championship = 2)
Digit 2 is the type of competition:

| Digit 2 | Type |
|---------|------|
| 1       | Men's league|
| 2       | Men's cup |
| 3       | Youth league |
| 4       | Youth cup |
| 5       | Women's league |
| 6       | Women's cup |

Digits 3-6 are the country code from ISO 3166-1 numeric with additions for non-ISO countries and non-countries (e.g. UEFA) as follows:

| County/Continent | Custom Code |
|-------------|---------|
| England | 827 (UK 826 + 1) |
| Scotland | 828 (UK 826 + 2) |
| Wales | 829 (UK 826 + 3) |
| Northern Ireland | 830 (UK 826 + 4) |
| Global Organiser (e.g. FIFA) | 900 |
| European Organiser (e.g. UEFA) | 901 |
| South American Organiser (e.g. CONMEBOL) | 902 |
| North American Organiser (e.g. CONCACAF) | 903 |
| African Organiser (e.g. CAF) | 904 |
| Asian Organiser (e.g. AFC) | 905 |
| Oceania Organiser (e.g. OFC) | 906 |
| Olympic Games | 930 |
| International Friendly | 950 |
| Club Friendly | 951 |

For tennis, the league id will be as follows:
[from the api provider?]

For esports, the league id will be as follows:
[from the api provider?]

## Event (u64 - max 18,446,744,073,709,551,615)

... To be defined by the source API used

## Period (u8 - max 255)

0 - Full Match incl. Overtime (used for American sports)
1 - Full Time Result (regular time only - used for Soccer)
2 - First Half
3 - Second Half (only points in this period)
11 - First Quarter/Period (ice hockey)/Set (tennis)/Inning (baseball)/Map (esports)
12 - Second Quarter/Period/Set/Inning/Map
13 - Third Quarter/Period/Set/Inning/Map
... Continues as needed
21 - Overtime/Extra Time (only points in this period)
22 - First Half of ET (soccer)
23 - Second Half of ET (soccer)
24 - Penalty Shootout (soccer)
25 - First 10 Penalties (soccer)
30 - Tennis Games Betting (only handicap and total)
31 - Tennis Games Betting Set 1
32 - Tennis Games Betting Set 2
... More to be added such as corners, cards, etc.

## Market (u16 - max 65535)

mkt start | mkt end | market | sides count | logic | sides meaning (in index order)
|-------|-------|-------|-------|-------|-------|
| 0 |-| ml | 2 | fixed | home, away
| 1 |-| 1X2 | 3 | fixed | home, away, draw
| 4 |-| btts | 2 | fixed | yes, no
| 5 |-| dc | 3 | fixed | not home, not away, not draw
| 6 |-| ft+btts | 6 | fixed | h-y, a-y, d-y, h-n, a-n, d-n
| 7 |-| ht/ft | 9 | fixed | h/h, h/a, h/d, a/h, a/a, a/d, d/h, d/a, d/d
| 9 |-| promo | 1 | fixed | yes
| 10 | 50 | mo | 2 | fixed | win, not win
| 51 | 99 | ou (x.25) | 2 | 50+4*L | over, under
| 100 | 299 | ah (x.5) | 2 | 200+2*L | home, away
| 300 | 499 | ah (x.25) | 2 | 400+4*L | home, away
| 1000 | 1999 | ou (x.5) | 2 | 1000+2*L | over, under
| 2000 | 2999 | hou | 2 | 2000+2*L | over, under
| 3000 | 3999 | aou | 2 | 3000+2*L | over, under
| 4000 | 4999 | btts+ou | 4 | 4000+2*L | y-o, y-u, n-o, n-u
| 5000 | 5999 | ft+ou | 6 | 5000+2*L | h-o, a-o, d-o, h-u, a-u, d-u
| 10000 | 10909 | cs | 1 | [10][home score][0][away score] - scores max at 9	|
| 11000 | 65535 | player props | 2 | player_prop_id+2*L | over, under |

Over/Under markets multiply the line by 2 to avoid x0.5 lines.
player prop id | line type | notes
|-------|-------|---------|
| 11000+X (max X = 100) | Top X place | Player will finish in the top X places (golf, F1, etc.) (sides = yes/no) |
| 11100+N | Nth Scorer | Player will be the Nth scorer (soccer, NFL, etc.) (Last Scorer market is N=99) (sides = yes/no) |
| 11200 | Goals Scored | Player will score N goals. Anytime scorer is 11201, side 0 (over 0.5 goals) (soccer, ice hockey) |
| 11300 | Shots On Target | Player will have N shots on target (soccer, ice hockey) |
| 11400 | Shots | Player will have N shots (soccer, ice hockey) |
| 11500 | To Be Fouled | Player will be fouled N times (soccer) |
| 11600 | Fouls Committed | Player will commit N fouls (soccer) |
| 11700 | Tackles Made | Player will make N tackles (soccer, american football) |
| 11800 | Yellow Cards | Player will get N yellow cards (soccer) |
| 11900 | Red Cards | Player will get N red cards (soccer) |
| 12000 | Saves | Goalkeeper will make N saves (soccer, ice hockey) |
| 12100 | Assists | Player will make N assists (soccer, ice hockey, basketball, american football) |
| 13000 | Touchdowns | Player will score N touchdowns (american football) |
| 13100 | Passing Touchdowns | Player will score N passing touchdowns (american football) |
| 13200 | Interceptions Thrown | Player will throw N interceptions (american football) |
| 13300 | Rush Attempts | RB will have N rush attempts (american football) |
| 13400 | Receptions | RB will have N receptions (american football) |
| 13500 | Sacks | Defensive player will make N sacks (american football) |
| 13600 | Kicking Points | Kicker will score N kicking points (american football) |
| 13700 | Interceptions Made | Defensive player will make N interceptions (american football) |
| 13800 | Field Goals Made | Kicker will make N field goals (american football) |
| 13900 | Extra Points Made | Kicker will make N extra points (american football) |
| 14000 | Pitcher Strikeouts | Pitcher will make N strikeouts (baseball) |
| 14100 | Pitcher Earned Runs | Pitcher will get N earned runs against (baseball) |
| 14200 | Pitcher Outs | Pitcher will get N outs (baseball) |
| 14300 | Pitcher Hits Allowed | Pitcher will allow N hits (baseball) |
| 14400 | Pitcher Walks Issued | Pitcher will walk N batters (baseball) |
| 14500..14900 | placeholder | Pitcher placeholder (baseball) |
| 15000 | Home Runs | Batter will hit N home runs (baseball) |
| 15100 | Runs | Batter will get N runs (baseball) |
| 15200 | Hits | Batter will get N hits (baseball) |
| 15300 | Total Bases | Batter will get N total bases (baseball) |
| 15400 | Runs Batted In | Batter will get N runs batted in (baseball) |
| 15500 | Strikeouts | Batter will get N strikeouts (baseball) |
| 15600 | Stolen Bases | Batter will get N stolen bases (baseball) |
| 15700 | Strikeouts | Batter will get N strikeouts (baseball) |
| 15800 | Singles | Batter will get N singles (baseball) |
| 15900 | Doubles | Batter will get N doubles (baseball) |
| 16000 | Triples | Batter will get N triples (baseball) |
| 16100 | Total Hits + Runs + RBIs | Batter will get N total hits + runs + RBIs (baseball) |
| 16200..19900 | placeholder | placeholder, low scoring (basketball, ice hockey) |
| 20000 | Passing Yards | Player will get N passing yards (american football) |
| 21000 | Passing + Rushing Yards | Player will get N passing + rushing yards (american football) |
| 22000 | Pass Attempts | Player will have N pass attempts (american football) |
| 22500 | Pass Completions | Player will have N pass completions (american football) |
| 23000 | Longest Pass Completion | Player's longest pass completion distance will be over/under N yards (american football) |
| 23500 | Rushing Yards | Player will get N rushing yards (american football) |
| 24000 | Rushing + Receiving Yards | Player will get N rushing + receiving yards (american football) |
| 24500 | Longest Rush | Player's longest rush distance will be over/under N yards (american football) |
| 25000 | Receiving Yards | Player will get N receiving yards (american football) |
| 25500 | Longest Reception | Player's longest reception distance will be over/under N yards (american football) |
| 26000..28500 | placeholder | placeholder (american football) |
| 29000 | Fantasy Points | Player will get N fantasy points (american football) |



## Player (u64 - max 18,446,744,073,709,551,615)

... To be defined by the source API used or determined by encoding the player name (TBD)

## Side (u8 - max 255)

Per the sides meaning in the markets table. For example, in a 1X2 market, the sides are: 0 - Home, 1 - Away, and 2 - Draw; in a Both Teams To Score + Over/Under market, the sides: 0 - Yes+Over, 1 - Yes+Under, 2 - No+Over, 3 - No+Under.

## Event Sequence (u16 - max 65535)

0 - Uninitiated
1 - Pre-game
2 - Game started
3+ - Points/goals have been scores
