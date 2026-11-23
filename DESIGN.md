# Token Radar — the value model, tested

The radar answers one question per protocol: **if this protocol stayed exactly as its record shows
today, what would a token that claims the protocol be worth?** It is not a forecast that a token will be
issued. It is a valuation of the claim a token would hold, with the model's own out-of-sample error
printed beside it.

## The formula

```
implied(p) = TVL(p) × peer(p) × momentum(p) × tenure(p)
peer(p)    = size curve(TVL(p)) × category premium(category(p)) × calibration
```

## 1. The size curve, fitted on the snapshot's own priced protocols

416 protocols in the snapshot record a token; 128 of those also record a market cap. Each is one
observation of what the market pays per dollar of TVL:

```
ratio(q) = mcap(q) / TVL(q)        clamped to [0.01, 40]
```

The ratio falls with size and steeply: 0.325× under $100M of TVL, 0.13× from $100M–$300M, 0.08× from
$300M–$1B, 0.03× from $1B–$10B. A least-squares fit of `ln(ratio)` on `ln(TVL)` over the 128 gives

```
ln(ratio) = 5.941 − 0.416·ln(TVL)
```

so a dollar of TVL is worth 0.239× at $50M and 0.069× at $1B. Slope clamped to [−0.75, −0.05] and the
curve's output to [0.005, 3] so a broken fit cannot become a finding; on this snapshot neither binds.

## 2. The category premium, shrunk hard

Each priced protocol's residual over the curve is `ln(ratio) − ln(size curve(TVL))`. A category's
premium is the median of its own peers' residuals, shrunk toward the market's own (0.89×) with a weight
of **k = 20** peers and held inside 2.8× of it. The weight is 20, not the 5 the previous version used,
because the held-out test below says so: at k = 5 the premium made the typical held-out error worse
(3.68× against 3.54× for the curve alone); at k = 20 it stops costing anything and the model is better
with it than without. The effect is that a category moves the multiple by a few per cent, not by a
third — which is what 128 records can actually support.

## 3. One calibrated offset

After the curve and the premium are fitted, a single scalar multiplies the result so that the model's
average equals the market's average on the data it was fitted to: **1.065×** on this snapshot. It is
computed at build time, applied to the curve, and printed on the method page. It is the only free
scalar, and the held-out test refits it on the training folds, so it cannot flatter the result.

## 4. Momentum and tenure, at the weight the noise can carry

```
momentum = clamp(1 + 0.15 × clamp(change_7d, −60, +150)/100, 0.55, 1.85)
tenure   = 0.62 + 0.72 × min(age_days, 1460)/1460          (age unknown ⇒ 0.98)
```

The week's weight was 0.45 in the previous version. The held-out test says a strong week does not
predict a higher market-cap multiple, so at 0.45 the term cost 1.5% of typical error; at 0.15 it sits
inside the noise and the value still traces the week. Tenure keeps its full ramp: turning it off moves
the held-out error by 0.01×, so it is a declared term, not a fitted one, and it is the term that makes
"how long it has run with no token" mean something on the board.

## The held-out test

Leave-one-out over the 128 priced protocols: refit the curve, the premiums, the calibration and the
adjustments on 127, predict the one held out, 128 times. "Typical error" is `exp(median |ln(predicted /
actual)|)` — the factor a prediction is out by. "Calibration" is `exp(mean ln(predicted / actual))`,
which is 1.00 when the model is neither over- nor under-predicting.

| Model | Calibration | Typical error | 90th percentile |
| --- | --- | --- | --- |
| a flat multiple | 1.000 | **4.79×** | 24.7× |
| + the size curve | 1.000 | **3.52×** | 25.6× |
| + the category premium (k=20) | 1.002 | **3.35×** | 26.7× |
| + the week and the age — shipped | 1.002 | **3.36×** | 29.6× |

What survives: the size curve, decisively (−27% typical error against a flat multiple). What helps
modestly: the category premium at heavy shrinkage. What does not survive as a fitted term: the week and
the age — they are kept at declared weights, the page says so, and the table is printed for a reader who
disagrees. The 90th percentile gets worse as terms are added; the model is better in the middle of the
distribution than in the tail, and the band on every row is the honest answer to that.

### The corrections this model carries, in order

1. **v1** used one market-wide median multiple (0.21×) for every protocol. That put Steakhouse
   Financial, a risk curator with $2.75B of TVL, at $802M — 29% of its TVL and about ten times what the
   snapshot's own protocols trade at that size — and rested its whole category premium on one $12M peer.
2. **v2** replaced it with the fitted size curve and a category premium at k = 5. Rank 1 fell to
   $136.7M, the top twenty stopped being one category, and the board applied the house's product rule
   below the floor, so an LST is never ranked as a token still to come.
3. **v3** (this one) put every term to a leave-one-out test: the premium moved to k = 20, the week's
   weight fell from 0.45 to 0.15, and the board now prints its held-out error, its thin-peer count, a
   base rate per row and a costed verdict per plan.

## The band

`implied_low_usd` and `implied_high_usd` are the same product with the premium at the category's 25th
and 75th residual, shrunk the same way. The board ranks on the point estimate and draws the band behind
it as a bar on a log scale across the rows on screen.

## Odds: a base rate from the record

For every protocol with a listing date at least 730 days before `as_of`, the snapshot knows whether it
records a token today. Group those by category and TVL band:

```
odds(p) = (protocols in p's cell that record a token) / (protocols in p's cell)
```

with a fallback chain: the cell if it holds 10 or more protocols, else the whole category, else the
whole market. Every row prints its rate and its **k of n** and which cell answered. Market-wide, 205 of
302 protocols tracked two years or more record a token (68%).

This is a base rate, not a forecast, and the page says so: the cell does not condition on the protocol
still having no token at its age, and DefiLlama's list only holds protocols that survived to be listed.

## Verdicts: costed in money and time

Each plan is costed so a reader can compare protocols by return, not by prose:

```
hours   = 0.25 × steps + 0.35 × weeks              (attention the plan asks for)
gas     = chain gas × (weeks + 6)                  (entry, cadence, exit)
carry   = capital × 5% × hold_days / 365           (opportunity cost of locked capital)
gross   = odds × 0.00001 × implied value           (assumed share per qualifying wallet)
net     = gross − gas − carry
per hour = net / hours        per dollar = net / capital
```

The two assumptions are printed beside the number: a qualifying wallet receives **0.001%** of the
claimed value, and capital carries **5% a year** while it is locked. The verdict is linear in the share,
so a reader who prefers 0.005% multiplies by five. Plans that do not pay at the base rate show a
negative verdict and the row stays on the board — 85 of 178 do, which is the point of printing it.

## What the model does not do (printed on the page)

- The snapshot is sealed at its fetch date; nothing on the page is newer.
- 89 of 178 rows rest on fewer than three priced peers and take the market's premium.
- Only 128 of 416 token-bearing protocols carry a market cap, so the curve rests on those.
- The held-out typical error is 3.36×; the tail is worse.
- The odds are a cohort base rate with survivor bias; no row predicts a launch or its date.

## Constants, in one place

| Name | Value | Where it comes from |
| --- | --- | --- |
| size curve | ln(ratio) = 5.941 − 0.416·ln(TVL) | least squares on 128 priced protocols |
| calibration | 1.065× | the fit's average offset, refitted in every fold |
| category shrink `k` | 20 | held-out: k=5 made the error worse |
| premium band | market ± 2.8× | no category beats the curve by more than ~3× |
| ratio clamp | 0.01 … 40× | drops the 400× outlier in the snapshot |
| week weight | 0.15 | held-out: 0.45 cost 1.5% of typical error |
| week clip | −60 … +150% | one week cannot decide a rank |
| tenure ramp | 0.62 … 1.34 over 1460 days | four years of record at full weight |
| unknown age | 0.98 | the midpoint of the ramp |
| odds cell floor | 10 protocols | below that the cell is too thin to read |
| odds age floor | 730 days | a younger protocol has not had the time |
| assumed allocation | 0.001% of claimed value | stated, not fitted; verdict is linear in it |
| capital carry | 5% a year | stated, not fitted |

## Per-protocol evidence, computed in the model

Every row carries the comparables its multiple rests on, and the page prints them rather than asserting
the number:

- **The nearest peers.** The two or three priced protocols in the same category closest in TVL, each
  with its ticker, TVL and its own `mcap / TVL`. Closest by TVL, not by multiple, because a comparable
  is a protocol of a similar size, not one that happens to be priced the same.
- **The peer premium.** Peers are compared in *premium space*: each peer's multiple divided by the size
  curve at that peer's own TVL. A raw multiple is only comparable at the same size, so the row's value
  at the peers' median premium is the honest anchor — and the detail view prints both that anchor and
  the multiple the model actually prices with. Where a category has fewer than three priced peers, the
  median falls back to the whole market's and the page says so; a one-peer median is not a median.
- **The sensitivity.** What the value becomes at the category's 25th and 75th premium — the same band
  the board draws behind each row.
- **The driver.** The one factor that most changes this value relative to the rest of the board: each of
  the week, the age and the peer multiple is scored by how far the row sits from the board's median in
  units of that factor's own spread, and the winner prints the move to its own ceiling (a +150% week, a
  four-year record, or the 75th-percentile premium) with the percentage it would add or take away.

All three are computed in `lib/model.ts` and written into `board.json`, so the page renders numbers it
can check rather than deriving them: 178 rows recompute exactly.

## The board and its subjects

All 40 house-watchlist protocols, plus the 138 pre-token protocols below the $50M floor with the most
TVL after the house's product rule: **178 rows**, ranks 1..178 by descending implied value, ties broken
by slug so two runs give the same bytes. 178 distinct implied values on this snapshot.

## Farm plans

A plan is derived from the protocol's record, and steps that do not apply are not written, so plans run
from six steps to twelve. The category picks the qualifying action and the exit test (a CDP mint, a
vault deposit, a delta-neutral pair, a restake, a payments route and a bridge transfer are six different
plans with different risks to prove out); the first chain picks the wallet and the gas and adds a bridge
step when it is not a chain a reader already has; TVL and the priced-peer count pick the position size;
the seven-day change decides whether to split the entry; the age decides whether a points season is
plausible, the cadence and the hold.
