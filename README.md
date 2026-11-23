# Token Radar

[![make.fun token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cngtn/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cngtn/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A radar for token launches that have not happened yet, entered in make.fun's
[token launch radar bounty](https://make.fun/bounty/token-radar-01). It reads one sealed DefiLlama
snapshot, ranks every protocol whose record carries no token by **the value a token claiming the
protocol would be worth**, shows the arithmetic behind every rank, and hands the reader a farm plan
built from that protocol's own record with what each step costs and how long it takes.

The board is a claim, not a forecast: it does not say whether or when a token is issued.

## The value model

```
implied = TVL × peer × momentum(change_7d) × tenure(age)
peer    = size curve(TVL) × category premium(category) × calibration
```

- **The size curve is read off the snapshot.** 128 protocols record both a market cap and a TVL, and in
  this snapshot the ratio falls with size: 0.33× under $100M of TVL, 0.03× from $1B to $10B. A least
  squares fit of `ln(mcap/TVL)` on `ln(TVL)` gives `ln(ratio) = 5.941 − 0.416·ln(TVL)`, so a dollar of
  TVL is worth 0.24× at $50M and 0.07× at $1B. One calibrated offset (1.065×) makes the fit's average
  match the market's.
- **The category premium** is each category's median residual over that curve, shrunk toward the
  market's own with a weight of **20 peers** — at 5 the held-out test got worse — so a category moves
  the multiple by a few per cent, not a third.
- **Momentum** enters at weight **0.15**, clipped to −60% … +150%. At the 0.45 an earlier version used,
  the held-out error went up; a strong week does not predict a higher multiple.
- **Tenure** ramps 0.62× → 1.34× over four years without a token, and an unrecorded age takes 0.98×.

## The model is tested, and the test is printed

Leave-one-out over the 128 priced protocols — refit on 127, predict the held-out one, 128 times. The
typical error is the factor a prediction is out by:

| Model | Calibration | Typical error | 90th |
| --- | --- | --- | --- |
| a flat multiple | 1.000 | 4.79× | 24.7× |
| + the size curve | 1.000 | 3.52× | 25.6× |
| + the category premium | 1.002 | 3.35× | 26.7× |
| + the week and the age — shipped | 1.002 | 3.36× | 29.6× |

The curve is the term the record supports; the premium helps a little; the week and the age are kept at
declared weights inside the noise, and the dashboard says so on its Method tab and in its source.

## Odds and verdicts on every row

Each row carries a **base rate** from the record — of the protocols in its category and size band
tracked two years or more, the share that record a token, with the k of n printed — and a **costed
verdict**: expected net value per hour of attention and per dollar at risk, after the plan's gas and the
carry on locked capital, at the base rate and an assumed 0.001% share of the claimed value. Both
assumptions are printed beside the number. 85 of 178 plans do not pay at that base rate, and the row
says so rather than hiding it.

No protocol name is special-cased. Protocols whose token already trades are never scored: they are
shown at their own market cap in a separate view, and their records are the curve and the premiums the
model is read from. The page recomputes every row's value from its own rounded factors in the same
order the model does and reports how many it reproduced — all 178 on this snapshot.

`DESIGN.md` has the reasoning in full, including why a flat-median first version overpriced the top of
the board by about ten times, and what each held-out test changed; `dashboard/model.md` is the version
the judge reads beside the page's source.

## What it writes

`main.ts` runs on Node 22.18 or later, standard library only, no network, and reads
`/input/snapshot.json`. One run writes:

| Path | What it is |
| --- | --- |
| `board.json` | the ranked board: 178 rows, ranks 1..178, an implied value and a farm plan each |
| `data.js` | the page's dataset as one classic script |
| `dashboard/` | this repository's dashboard, plus a generated `board-preview.json` build manifest |
| `screenshots/` | the board, a detail view and a filtered view |
| `dossier.json` | what `buildDossier` writes from the two, byte for byte |

Two runs over the same snapshot write the same bytes: every array is sorted with an explicit
comparator, and nothing reads the clock, the host or the filesystem's ordering.

```
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
node tools/verify-output.mjs --out out --input ../token-radar-01-kit/input/snapshot.json
```

`tools/verify-output.mjs` repeats the gate's rows locally — the dashboard's files and network
addresses, the board's rows and ranks, watchlist coverage, the farm steps, the screenshots' shape, and
the dossier's bytes — so a row the scorer would refuse fails on this machine first.

## The page

`dashboard/index.html`, `app.css` and `app.js`: no framework, no fonts, no images, no network. It has
three views — the board (filterable by category, evidence and floor; sortable by value, TVL, week,
tenure and multiple), the token-bearing protocols at the market's own value, and the method — and a
detail view per protocol with the factor-by-factor arithmetic, the peers the premium is read from, and
the farm plan. State lives in the address (`#p=<slug>`, `#cat=Lending`, `#q=…`), so a link opens the
same view.

## Farm plans

Every plan is derived from the protocol's own record, and steps that do not apply are not written, so
plans run from six steps to twelve. The category picks the qualifying action and the exit test — a CDP
mint, a vault deposit, a delta-neutral pair, a restake and a bridge transfer are different plans with
different risks to prove out. The first chain picks the wallet and the gas and adds a bridge step when
it is not a chain a reader already has. TVL and the priced-peer count pick the position size. The
seven-day change decides whether to split the entry. The age decides whether a points season is
plausible, the weekly cadence and the hold window.

## Licence

MIT. See `LICENSE`.
