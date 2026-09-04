*TL;DR — SPAMMs are programmatic, on-chain market makers for sports betting, modelled on the prop AMMs that already out-quote Binance for SOL/USDC. An aggregator routes user bets to the best of multiple competing SPAMMs at execution time, with liability netting and live-event state-tracking baked in.*

Sports Programmatic Automated Market Makers (SPAMMs) are a proposed system for pricing and fulfilling sports and esports bets. They are based on "proprietary automated market makers” (prop AMMs) that were developed on Solana. SPAMMs allow operators to focus on fewer moving parts than quoting on an orderbook, and more on optimising the pricing algorithm. If you are familiar with AMMs and prop AMMs, you can skip the next section

# Background

## The Original AMMs


The original automated market makers began with Uniswap with the constant-product function. These were essentially a pool of two different tokens and the relative price was derived from the ratio of the amount of each token in the pool. The amount of the receiving token the user got was based on the pool balances and the amount swapped. They were governed by the formula `x * y = k` where x and y are the amount of each token and k is a constant that never changes for the life of the pool (assuming no fees). 

For example, if a pool had 10 ETH and 20,000 USDC, the shown price of ETH would be `20,000 / 10 = 2000 USDC per ETH` and `k = 200,000`. If a swap of 1 ETH for USDC was made, the amount of ETH in the pool goes up and the amount of USDC in the pool goes down to keep the constant the same: there is now 11 ETH and 18,181 USDC meaning the new spot price is now `(18,181 / 11)` 1653 USDC per ETH and the user got `(20,000 - 18,181)` 1818 USDC for their ETH. (This is an extreme example of a relatively large swap into an illiquid pool). 

These pools would run on the Ethereum blockchain and allow anyone to make a swap at any time, always offering a price based on the pool balances (hence the “automated” in AMM.) Generally, anyone could deposit their tokens into these pools and earn the trading fees applied on each swap, but they risked losing funds to the price and balance difference of the tokens between depositing and withdrawing. For example, if you deposit some USDC and POOP in the pool when the price is 1 USDC per POOP, then the price moves to 0.0001 USDC per POOP, you now hold a lot of worthless POOP.

There were further developments in the pricing systems such as concentrated liquidity, stablecoin-focused curves, etc, but they don’t change the basics of a pool offering a price at any time to any person using only the information contained within the pool balances and a mathematical function. 

The major downside of these “dumb” AMMs was that an arbitrageur bot could notice an arbitrage between two different pools, or between an AMM pool and an offchain exchange like Binance or Coinbase. The bot would execute a trade against the AMM which was purely +EV for itself and -EV for the value of the AMM pool. The AMM “paid” to have its price moved in line with the wider market.

## Prop AMMs

Due to the low fees and fast blocktimes of Solana, a new type of AMM was born. These are known as “proprietary AMMs” because they are not publicly accessible pools, but privately owned pricing algorithms that actively trade the owner’s funds. Prop AMMs are Solana programs which ingest price data from the offchain world through custom oracles, and calculate the pricing of swaps using complex functions, not a simple invariant. Prop AMM operators update the oracle data every few seconds (or more frequently), then the quote calculation uses this data, as well as other information like time since last update, swaps that have happened since the last update, if the swap is part of an arbitrage trade, the swap size, where in the block the swap is taking place, and probably much more (they are proprietary after all).

There are multiple prop AMMs running at any time, each aggregated by trade routers like Jupiter or Titan. This means each prop AMM should try to offer the best price they can to get the flow and earn their spread, but also must avoid adverse selection on trades. The main benefit these AMMs have over passive AMMs is that they don’t need to “pay” traders to update their prices - the oracle data does that. These features have led to prop AMM pricing becoming very competitive for traders, and often offer a better deal than swapping on Binance for major pairs like SOL/USDC.

This podcast is a great overview of prop AMMs from the basics to the complexity of the pricing functions: [https://www.youtube.com/watch?v=kNb9kwW3ec0](https://www.youtube.com/watch?v=kNb9kwW3ec0)

# Why SPAMMs?

SPAMMs aim to bring the benefits for traders of prop AMMs to sports and esports betting. Multiple SPAMMs would compete for the bettor flow: trying to offer the best odds possible, without catching -EV flow. SPAMMs can ingest custom offchain data (such as bookie prices or an operator’s model’s prices), and can perform complex quoting functions such as factoring in the time since last price update, number of bets taken since last update, the liability on each side of the market, the profile of the bettor, the prestige of the event, and anything else you can think of.

SPAMMs replace the constant updating of orderbook offers, monitoring fills and cancels, and managing liability, with the development (and continuous improvement) of a quoting algorithm, and updating market oracle data. 

Onchain sports betting deserves an onchain-native solution. There is no other environment that can offer SPAMMs: they are permissionlessly deployed code that executes perfectly and trustlessly 100% of the time. There have been attempts to create onchain sports betting venues but they either badly approximate sportsbooks with wide spreads and limited markets, or they have poorly implemented orderbooks. Solana has also lagged behind in this space. The only notable attempt was Betdex/Monaco V1. This was a KYCed frontend over an onchain orderbook. They struggled to attract liquidity to the orderbook because they tried to onboard traditional sports betting exchange market makers to quote. This was at a time when Solana transaction landing rates were unreliable and this would mean that order additions or cancels disappeared into the aether and onchain orderbook state did not match the expected state. Live betting was impossible to quote because of dropped transactions and delays. 

With massive improvements in Solana transaction landing rates and more sophisticated block building, very small transactions like updating oracle data using low-CU code land reliably near the top of the block, meaning odds updates or quoting pauses land before user bets even if they are in the same 400 ms block. Since updates are only to the oracle odds, in the extremely rare case of a dropped transaction, the odds will be stale for a few seconds, rather than the whole orderbook state being out of sync. 

At maturity, SPAMMs, and the aggregation thereof, will offer very competitive odds and generally be a no-frills experience with no bonuses, or rewards - this will be up to the frontends via freebets and boosted odds. This puts it in competition with Asian brokers (e.g. Mollybet) and traditional sports betting exchanges. However, it also gives a good liquidity platform for frontends to build upon and offer their own sports betting experience. 

SPAMM operators make money by taking +EV positions across many markets like traditional bookmakers. This can either be via trying to balance their book on each market and earning the spread between each side or between the bets offered and positions hedged elsewhere; or by having an internal pricing model and skewing their book to the side they believe is value.

As more stablecoins move onchain, people are going to want to use them to do things. If onchain-native solutions don't exist for sports betting, those stablecoins will just end up deposited to offchain casinos and be removed from the ecosystem.

# The aggregator

The design for the SPAMM aggregator allows for peak-reserve position netting on major markets (FT, ML, total, spread) both pregame and live, which reduces the total collateral a SPAMM needs to hold if they can successfully quote opposing outcomes on a market. This gives a major advantage to the SPAMM operator, compared to just facing users natively. Of course the advantage for the user is that they get the best odds **at execution time** as the best pre-execution offers are all loaded on the transaction and checked again during placement.

Parlays are also handled by the aggregator. Auction / quote-buffer parlays are capped at **20** legs because each leg still needs its own PDAs and the transaction has a size limit. RFQ parlays can go up to **40** legs: the legs live in a signed message, so there are no per-leg PDAs. Both are open to traditional parlays, same game parlays (SGPs) or a mix of both. It is up to the SPAMM to manage the more complex pricing of these markets: they can opt out to focus on competitive pricing of single bet prematch major markets, or build a system to take on higher edge player prop parlays.

Live betting is a major focus of the aggregator and framework. Each SPAMM holds their view of the current event state onchain. This is updated when, for example, a team scores a goal, or a period ends. The aggregator checks that each bet is only routed to SPAMMs which hold the same event state as the user bet. This means that a SPAMM which has not updated for a recent goal will not be used and be picked off for stale odds. It also allows rolling back bets which were placed with an event state that got reverted. For example, a bet that was placed after a goal had been scored, but then the goal got cancelled – this bet would be rolled back, the same as it would be on a traditional sportsbook.

# Why sports?

Given the “hype” (read: billions of venture capital dollars) around “prediction markets”, you might ask why everything written about SPAMMs is focused on sports, and not prediction markets. There are two main reasons. 

Firstly, I believe that sports will make up a significant portion of prediction market volume (as you can already see with Kalshi - like 85%+). So prediction markets are basically just going to be sports betting exchanges with a few side markets. Their net pricing will be worse than most low margin bookmakers (e.g. Pinnacle) because they will focus on recreational users and take large fees.

Secondly, orderbooks are actually good for true prediction markets. A market like “Will Trump say ‘bet more’ in his speech?” or “Will MrBeast get over 500 million subscribers by 30 July?” do not have any concrete probability, and truly are opinions of a bunch of different people. The best way to offer a market on these is an orderbook and let people post their best guess at the prices and get matched if they agree.

However, in sports betting, there generally is a “correct price” since there are multiple venues with similar prices, and multiple sophisticated firms modeling the matches and correcting any misprices by betting on them. This means that an orderbook is not strictly needed, since taking an average view of wider market prices gets you very close to the correct price. At that point, it comes down to small differences of opinion on which way to skew odds to attract flow and manage exposure. 

# Why not SPAMMs?

I keep getting told to stop being so negative but I think it is important to be open about the issues and show that I am honest.

The biggest issue with SPAMMs is the chicken-and-egg problem: users need market makers; market makers need users, and specifically losing users. The first market makers to join are never going to have a sophisticated system as they are learning a brand new system. This means that any blips or issues will first be seized upon by smart bettors who are on the cutting edge to try to find exploits. This is why I believe it is best that the SPAMM framework is developed alongside market makers who already have experience with building prop AMMs, and who have experience quoting on sports betting exchanges. That allows them to ensure the framework has everything they need to quote competitively, and they are ready to go from Day 1. I also believe that it is best to launch the user-facing aggregator under an existing successful onchain Solana brand (e.g. Jupiter). This brings in a favourable flow of users from the start. The alternative is a sophisticated and expensive GTM strategy and I cannot do that alone. 

Another issue is the longer term place for SPAMMs in the wider betting market. They cannot offer the perks traditional sportsbooks do. They cannot offer credit to large bettors or market makers like traditional low-margin venues and exchanges do. This means the users need to be sharp enough that they are not driven by perks, but square enough to not have access to credit betting – I am told by someone offering this to the European market that they think this is worth on the order of $1 billion per year. The market makers are unlikely to be traditional sports market makers until much later in the product lifecycle because the difference between quoting on Betfair etc and a SPAMM is very large. It is probably much easier to convince those already familiar with prop AMMs to try their hand at a SPAMM. Traditional sports market makers would join if the user volume and lack of competition on offer justified the effort of learning the new technology.

In the current framework, the **market operator** baked into each `MarketId.operator` grades bets via `grade_bets` / `grade_parlay`. The aggregator admin is only a fallback if that operator is delinquent. There is already a large degree of trust placed in the aggregator by the SPAMMs since it holds their funds for liability netting. Allowing each SPAMM to grade the bets they fill would mean that users would need to understand which SPAMMs they trust and which have a bad reputation, and they would use this opinion to select which SPAMMs get aggregated on each bet. It also creates a barrier to entry for a new SPAMM as it must earn the trust of the community before it sees flow. There is no independent sports onchain data feed to use and building some sort of result voting system is too much work at this time. 

# What is next?

A working version of the framework and aggregator is deployed on Solana devnet, with an example SPAMM market maker program to copy from. The events/market API (`api/`) already exists — catalog, snapshots, and RFQ hub.

The next stage is to gather feedback from teams involved in prop AMMs and sports exchange market making, have one or two of them spin up a real SPAMM, quote a handful of leagues, and stress-test the netting and live-betting paths against actual flow.

If you build prop AMMs, run a sportsbook trading desk, or operate a Solana frontend that could route bets, I'd like to hear from you — particularly if you think something in the framework would stop you using it. Contact me on [X](https://x.com/pure_lmao) / [Discord](https://discord.com/users/223573305410584577) / [Telegram](https://t.me/pure_lmao)  - pure_lmao on all platforms.
