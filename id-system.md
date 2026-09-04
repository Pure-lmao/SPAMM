

## Sport (u8 - max 255)

0 - Invalid
1 - Soccer
2 - American Football
3 - Baseball
4 - Basketball
5 - Ice Hockey
6 - Tennis
101 - Counter-Strike 2
102 - Dota 2
103 - League of Legends
104 - Valorant

... More to be added

## League (u16 - max 65535)

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
| 11000 | 65535 | player props | 2 | 10000+player_prop_id+2*L | over, under |

player prop id | line type | notes
|-------|-------|---------|

## Player (u64 - max 18,446,744,073,709,551,615)

... To be defined by the source API used or determined by encoding the player name (TBD)

## Side (u8 - max 255)

Per the sides meaning in the markets table. For example, in a 1X2 market, the sides are: 0 - Home, 1 - Away, and 2 - Draw; in a Both Teams To Score + Over/Under market, the sides: 0 - Yes+Over, 1 - Yes+Under, 2 - No+Over, 3 - No+Under.

## Event Sequence (u16 - max 65535)

0 - Uninitiated
1 - Pre-game
2 - Game started
3+ - Points/goals have been scores
