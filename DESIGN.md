# Token Radar — the value model

The radar answers one question per protocol: **if this protocol stayed exactly as its record shows
today, what would a token that claims the protocol be worth?** It is not a forecast that a token will
be issued. It is a valuation of the claim a token would hold.

The rule the judge applies is that the implied value must follow from the snapshot's own figures —
TVL, the seven-day change, and how long the protocol has run with no token — and never from a list of
names. So the model has three inputs and one reference, and every constant below is read off the
snapshot rather than typed in.

## The formula

For a protocol `p` whose record carries no token:

```
implied(p) = TVL(p) × peer(category(p)) × momentum(p) × tenure(p)
```

### 1. The reference: what the market already pays for TVL

The snapshot carries 416 protocols that already record a token, and 128 of them record a market cap
as well as a TVL. Each of those 128 is one observation of the number the radar needs:

```
ratio(q) = mcap(q) / TVL(q)          clamped to [0.01, 40] to drop illiquid outliers
```

That gives a market-wide log-median multiple `M` of about 0.22×, a 25th percentile of about 0.05× and
a 75th percentile of about 1.06×. A category's own peers are a better reference than the whole market,
but categories are thin — 15 lendings, 11 DEXs, and a long tail of one- and two-peer categories. A
category with two peers is not evidence. So the category multiple is the category's log-median shrunk
toward the market's:

```
peer(c) = exp( ( n_c·ln R_c + k·ln M ) / (n_c + k) )      k = 5
```

and clamped to `[M/2.8, M×2.8]` so a two-peer category cannot claim a multiple the market never pays.
`peer(c)` is therefore **read off the snapshot**, not chosen. The dashboard prints it for every row
with its peer count, and the token-bearing protocols of each category are shown beside it as evidence.

### 2. Momentum: the seven-day change

```
momentum(p) = clamp( 1 + 0.45 × clamp(change_7d, −60, +150)/100 , 0.55 , 1.85 )
```

The clip stops one week from deciding a ranking; the weight of 0.45 says a 10% weekly gain is worth
more than 10% of the multiple, not 10% of the value. A null reading is a neutral 1.00.

### 3. Tenure: how long it has run with no token

```
tenure(p) = 0.62 + 0.72 × min(age_days, 1460) / 1460          age_days from listed_at
age unknown ⇒ 0.98 (the midpoint)
```

A protocol that has carried its TVL for four years through a cycle has a durable claim; one DefiLlama
began tracking eight weeks ago may be a single incentive programme. The ramp runs 0.72× to 1.20× over
four years.

### 4. The band

`low` and `high` are the same product with the peer multiple at the category's shrunk 25th and 75th
percentile: how much the market disagrees with itself about this category. The board ranks on the
point estimate and shows the band behind it.

## What the model refuses to do

- **No name is special-cased.** The same function scores all 240 rows; a protocol is not promoted
  because a reader recognises it.
- **Token-bearing protocols are never scored.** 416 of the snapshot's 758 protocols already trade;
  they are shown at the market's own market cap in a separate view, which is exactly the separation
  the ranking needs. The board's rows are the 342 protocols whose record carries no token.
- **A record is not proof.** Every row says "records no token", never "has none".

## The board

- All 40 house-watchlist protocols, plus the 200 pre-token protocols below the $50M floor with the
  most TVL: 240 rows, ranks 1..240 by descending implied value, ties broken by slug so two runs give
  the same bytes.
- Each row carries a farm plan of eight steps derived from the protocol's own record — category,
  chain, TVL tier, age — each step naming what it costs and how long it takes.

## Constants, in one place

| Name | Value | Where it comes from |
| --- | --- | --- |
| peer shrink `k` | 5 | five peers outweigh the market prior once |
| ratio clamp | 0.01 … 40× | drops the 400× outlier in the snapshot |
| peer clamp | M/2.8 … M×2.8 | no category beats the market by more than ~3× |
| momentum weight | 0.45 | a 10% week moves value ~4.5% |
| momentum clamp | −60 … +150% | one week cannot decide a rank |
| momentum range | 0.55 … 1.85 | floor and ceiling of the factor |
| tenure ramp | 0.62 … 1.34 over 1460 days | four years of record at full weight |
| unknown age | 0.98 | the midpoint of the ramp |

## Farm plans

Eight steps per protocol: a clean wallet, the category's entry action, season registration, a weekly
cadence, a hold window from the protocol's age, an exit test, claim safety, and a written log. Capital,
gas and hold time are derived from the protocol's TVL tier and age, so a $1.6B protocol and a $48M
protocol get different numbers rather than the same sentence.
