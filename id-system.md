

## Sport (u8 - max 255)

0 - Invalid
1 - Soccer
3 - American Football
4 - Baseball
5 - Basketball
6 - Ice Hockey
... More to be added

## League (u32 - max 4,294,967,295)

... To be defined by the source API used

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

## Market (u32 - max 4,294,967,295)

0 - Moneyline (used in 2-way markets)
1 - Full Time Result (used in 3-way markets)
4 - Both Teams To Score
5 - Double Chance (used in 3-way markets)
10,000 - Base for total markets, take line and multiply by 100 then add to this base
20,000 - Base for home team total markets, take line and multiply by 100 then add to this base
30,000 - Base for away team total markets, take line and multiply by 100 then add to this base
200,000 - Base for handicap markets, take line from home team perspective and multiply by 100 then add to this base
... More to be added such as FT+BTTS, HT/FT, CS, Player Props, etc.

## Player (u64 - max 18,446,744,073,709,551,615)

... To be defined by the source API used or determined by encoding the player name

## Side (u8 - max 255)

0 - Home (Over in totals) 
1 - Away (Under in totals) 
2 - Draw (used in 3-way markets)

In Double Chance markets, the side is the team NOT to win (so side 0 means the user is betting away OR draw)

## Event Sequence (u16 - max 65535)

0 - Uninitiated
1 - Pre-game
2 - Game started
3+ - Points/goals have been scores
