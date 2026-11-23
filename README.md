# Token Radar

[![make.fun token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cngtn/makefun-token-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cngtn/makefun-token-radar/reward.svg)](https://make.fun/c/token-radar-01)

A radar for token launches that have not happened yet. It reads one sealed DefiLlama snapshot, ranks
every protocol whose record carries no token by **the value a token claiming the protocol would be
worth**, shows the arithmetic behind every rank, and hands the reader a farm plan for each one with
what it costs and how long it takes.

The board is a claim, not a forecast: it does not say whether or when a token is issued.

## The value model

```
implied = TVL × peer(category) × momentum(change_7d) × tenure(age)
```

- **peer(category)** is read off the snapshot itself. 128 protocols in it record both a market cap and
  a TVL, so each is one reading of what the market pays per dollar of TVL. The market-wide log-median
  is about 0.21×; a category's own log-median is shrunk toward it with a weight of five peers, and held
  inside 2.8× of it so a two-peer category cannot claim a multiple the market never pays.
- **momentum** clips the seven-day change to −60% … +150%, weights it at 0.45 and bounds the factor to
  0.55 … 1.85×, so a strong week moves value without deciding a rank.
- **tenure** ramps 0.62× → 1.34× over four years without a token: a long record is a durable claim, a
  few weeks may be one incentive programme. An unrecorded age takes the neutral 0.98×.

No protocol name is special-cased. Protocols whose token already trades are never scored: they are
shown at their own market cap in a separate view, and their multiples are the evidence the model is
read from. The page recomputes every row's value from its own rounded factors in the same order the
model does, and reports how many it reproduced — 240 of 240 on this snapshot.

`DESIGN.md` has the reasoning in full; `dashboard/model.md` is the version the judge reads beside the
page's source.

## What it writes

`main.ts` runs on Node 22.18 or later, standard library only, no network, and reads
`/input/snapshot.json`. One run writes:

| Path | What it is |
| --- | --- |
| `board.json` | the ranked board: 240 rows, ranks 1..240, an implied value and an 8-step farm plan each |
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
the dossier's bytes — so a row that the scorer would refuse fails on this machine first.

## The page

`dashboard/index.html`, `app.css` and `app.js`: no framework, no fonts, no images, no network. It has
three views — the board (filterable by category, evidence and floor, sortable by value, TVL, week,
tenure and multiple), the token-bearing protocols at the market's own value, and the method — and a
detail view per protocol with the factor-by-factor arithmetic, the peers the multiple is read from, and
the farm plan. State lives in the address (`#p=<slug>`, `#cat=Lending`, `#q=…`), so a link opens the
same view.

## Licence

MIT. See `LICENSE`.
