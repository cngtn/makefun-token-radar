/* Token Radar: the whole page, one classic script, no network and no framework.
   It renders the board, the token-bearing view, the method, and one detail drawer per protocol.
   Every value on the screen is recomputed from the row's own factors and checked against the board. */

(function () {
  'use strict';

  var R = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;

  if (!R || !R.rows || !R.rows.length) {
    $('board').innerHTML = '<p class="empty">No data: the page reads data.js, which main.ts writes beside dashboard/.</p>';
    return;
  }

  var CATS = R.categories || [];
  var F = R.model;
  var G = R.model.global;
  var state = { tab: 'board', q: '', cat: '*', ev: '*', tier: '*', sort: 'rank', slug: null };
  var CHECK = { matched: 0, total: 0 };

  /* ------------------------------------------------------------------ text and numbers */

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function usd(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function exact(n) { return '$' + group(Math.round(n)); }
  function pct(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 'no reading';
    return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(1) + '%';
  }
  function track(age) {
    if (typeof age !== 'number') return 'no date';
    if (age < 90) return age + ' days';
    return (age / 365).toFixed(1) + ' years';
  }
  function mult(n) { return n.toFixed(2) + '×'; }
  function shift(n) { return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(2) + '×'; }
  function grade(peers) { return peers >= 10 ? 'deep' : peers >= 5 ? 'fair' : peers > 0 ? 'thin' : 'none'; }
  function gradeWord(peers) {
    if (peers === 0) return 'market only';
    return peers === 1 ? '1 peer' : peers + ' peers';
  }
  function catLabel(row) { return row.category || 'Uncategorised'; }
  function chainLine(chains, limit) {
    if (!chains || !chains.length) return 'no chain recorded';
    var shown = chains.slice(0, limit);
    return shown.join(', ') + (chains.length > limit ? ' and ' + (chains.length - limit) + ' more' : '');
  }

  /* ------------------------------------------------------------------ reading and writing the address */

  function readHash() {
    var raw = (location.hash || '').replace(/^#/, '');
    var p = new URLSearchParams(raw);
    state.tab = p.get('tab') || 'board';
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || '*';
    state.ev = p.get('ev') || '*';
    state.tier = p.get('tier') || '*';
    state.sort = p.get('sort') || 'rank';
    state.slug = p.get('p') || null;
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.cat !== '*') p.set('cat', state.cat);
    if (state.ev !== '*') p.set('ev', state.ev);
    if (state.tier !== '*') p.set('tier', state.tier);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.slug) p.set('p', state.slug);
    var next = p.toString();
    var url = location.pathname + location.search + (next ? '#' + next : '');
    history.replaceState(null, '', url);
  }

  /* ------------------------------------------------------------------ filtering and sorting */

  function byRank(a, b) { return a.rank - b.rank; }

  var SORTERS = {
    rank: function (a, b) { return a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || byRank(a, b); },
    growth: function (a, b) {
      var av = a.change_7d == null ? -Infinity : a.change_7d;
      var bv = b.change_7d == null ? -Infinity : b.change_7d;
      return bv - av || byRank(a, b);
    },
    age: function (a, b) {
      var av = a.age_days == null ? -1 : a.age_days;
      var bv = b.age_days == null ? -1 : b.age_days;
      return bv - av || byRank(a, b);
    },
    peer: function (a, b) { return b.factors.peer_multiple - a.factors.peer_multiple || byRank(a, b); }
  };

  function matches(row) {
    if (state.cat !== '*' && catLabel(row) !== state.cat) return false;
    if (state.tier !== '*' && row.tier !== state.tier) return false;
    var n = row.factors.peer_peers;
    if (state.ev === 'deep' && n < 10) return false;
    if (state.ev === 'fair' && (n < 5 || n >= 10)) return false;
    if (state.ev === 'thin' && n >= 5) return false;
    if (!state.q) return true;
    var q = state.q.toLowerCase();
    return (row.name + ' ' + row.slug + ' ' + catLabel(row) + ' ' + row.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
  }

  function visibleRows() {
    return R.rows.filter(matches).sort(SORTERS[state.sort] || SORTERS.rank);
  }

  /* ------------------------------------------------------------------ masthead, formula, controls */

  function renderFacts() {
    var covered = R.rows.filter(function (r) { return r.tier === 'watchlist'; }).length;
    var items = [
      ['Protocols ranked', String(R.meta.board_size), R.meta.below_floor + ' below the $' + Math.round(R.meta.floor_usd / 1e6) + 'M floor'],
      ['Watchlist covered', covered + '/' + R.meta.watchlist, 'every slug the snapshot names'],
      ['Priced tokens', String(R.meta.with_mcap), 'the peer evidence, of ' + R.meta.token_bearing + ' with a token'],
      ['TVL in scope', usd(R.meta.tvl_in_scope), 'records no token']
    ];
    $('facts').innerHTML = items.map(function (it) {
      return '<div><dt>' + esc(it[0]) + '</dt><dd>' + esc(it[1]) + '<small>' + esc(it[2]) + '</small></dd></div>';
    }).join('');
  }

  function renderFormula() {
    var top = R.rows[0];
    var boxes = [
      ['The formula', 'TVL × peer × momentum × tenure', 'peer-1, no name special-cased', 'eq'],
      ['Peer multiple', mult(G.median), 'median of ' + G.peers + ' priced tokens', ''],
      ['Momentum weight', F.growth_weight.toFixed(2), 'week clipped to ' + F.growth_clip_low + '% … +' + F.growth_clip_high + '%', ''],
      ['Tenure ramp', F.tenure_low.toFixed(2) + '–' + F.tenure_high.toFixed(2) + '×', 'over ' + group(F.tenure_days) + ' days with no token', ''],
      ['Rank 1 implied', usd(top.implied_value_usd), top.name + ', from ' + usd(top.tvl_usd), 'out']
    ];
    $('formula').innerHTML = boxes.map(function (b) {
      return '<div class="' + b[3] + '"><div class="k">' + esc(b[0]) + '</div>' +
        '<div class="v">' + esc(b[1]) + '</div><em class="c">' + esc(b[2]) + '</em></div>';
    }).join('');
  }

  function categoryOptions() {
    var counts = {};
    R.rows.forEach(function (r) { var k = catLabel(r); counts[k] = (counts[k] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0); })
      .map(function (k) { return { name: k, count: counts[k] }; });
  }

  function renderControls() {
    var cats = categoryOptions();
    $('cat').innerHTML = '<option value="*">Every category (' + cats.length + ')</option>' + cats.map(function (c) {
      return '<option value="' + esc(c.name) + '">' + esc(c.name) + ' (' + c.count + ')</option>';
    }).join('');
    $('q').value = state.q;
    $('cat').value = state.cat;
    $('ev').value = state.ev;
    $('tier').value = state.tier;
    $('sort').value = state.sort;
  }

  function renderStatus(rows) {
    var chips = [];
    if (state.q) chips.push('<span class="chip">find: ' + esc(state.q) + '</span>');
    if (state.cat !== '*') chips.push('<span class="chip">category: ' + esc(state.cat) + '</span>');
    if (state.ev !== '*') chips.push('<span class="chip amber">evidence: ' + esc(state.ev === 'deep' ? '10+ peers' : state.ev === 'fair' ? '5 to 9 peers' : 'under 5 peers') + '</span>');
    if (state.tier !== '*') chips.push('<span class="chip grey">' + esc(state.tier === 'watchlist' ? 'house watchlist' : 'below the floor') + '</span>');
    if (state.sort !== 'rank') chips.push('<span class="chip grey">sorted by ' + esc(state.sort === 'age' ? 'time without a token' : state.sort) + '</span>');
    var text = rows.length + ' of ' + R.rows.length + ' rows';
    $('status').innerHTML = '<span>' + esc(text) + '</span>' + chips.join('');
    $('empty').hidden = rows.length > 0;
    $('empty').textContent = rows.length ? '' : 'No protocol matches that filter. Clear one and the board comes back.';
  }

  /* ------------------------------------------------------------------ the board */

  var COLS = [
    ['rank', 'Rank', ''],
    ['', 'Protocol', ''],
    ['tvl', 'TVL', 'num'],
    ['growth', '7-day', 'num'],
    ['age', 'No token for', 'num'],
    ['peer', 'Peer ×', 'num'],
    ['rank', 'Implied value', 'num']
  ];

  function renderHead() {
    $('thead').innerHTML = COLS.map(function (c) {
      var on = c[0] && state.sort === c[0] ? ' on' : '';
      return '<span class="' + c[2] + on + '"' + (c[0] ? ' data-sort="' + c[0] + '" role="button" tabindex="0" title="Sort by ' + c[1] + '"' : '') + '>' + c[1] + '</span>';
    }).join('');
  }

  function band(points) {
    var lo = Math.log10(points.min);
    var hi = Math.log10(points.max);
    var span = hi - lo || 1;
    return function (a, b) {
      var left = ((Math.log10(Math.max(a, points.min)) - lo) / span) * 100;
      var right = ((Math.log10(Math.min(b, points.max)) - lo) / span) * 100;
      return { left: Math.max(0, Math.min(100, left)), width: Math.max(2, Math.min(100 - left, right - left)) };
    };
  }

  function renderRow(row, place) {
    var f = row.factors;
    var g = row.change_7d == null ? 'flat' : row.change_7d > 0.05 ? 'up' : row.change_7d < -0.05 ? 'down' : 'flat';
    var seg = place(row.implied_low_usd, row.implied_high_usd);
    var pin = place(row.implied_value_usd, row.implied_value_usd);
    return '<div class="row" role="row" tabindex="0" data-slug="' + esc(row.slug) + '">' +
      '<span class="rank" role="cell">' + row.rank + '</span>' +
      '<div class="who" role="cell"><b>' + esc(row.name) + '</b><small>' + esc(catLabel(row)) + ' · ' + esc(chainLine(row.chains, 2)) +
        (row.tier === 'below-floor' ? '<span class="tag">below floor</span>' : '') + '</small></div>' +
      '<div class="num-cell" role="cell">' + usd(row.tvl_usd) + '<small>TVL</small></div>' +
      '<div class="delta ' + g + '" role="cell">' + pct(row.change_7d) + '</div>' +
      '<div class="num-cell" role="cell">' + track(row.age_days) + '<small>tracked</small></div>' +
      '<div class="num-cell" role="cell">' + mult(f.peer_multiple) + '<small><span class="dot ' + grade(f.peer_peers) + '"></span>' + gradeWord(f.peer_peers) + '</small></div>' +
      '<div class="implied" role="cell"><b>' + usd(row.implied_value_usd) + '</b><span class="track"><i style="left:' + seg.left.toFixed(1) + '%;width:' + seg.width.toFixed(1) + '%"></i><u style="left:' + pin.left.toFixed(1) + '%"></u></span></div>' +
      '</div>';
  }

  function renderBoard() {
    var rows = visibleRows();
    renderStatus(rows);
    renderHead();
    var min = Infinity, max = 0;
    rows.forEach(function (r) { min = Math.min(min, r.implied_low_usd); max = Math.max(max, r.implied_high_usd); });
    var place = band({ min: Math.max(1, min), max: Math.max(2, max) });
    $('tbody').innerHTML = rows.map(function (r) { return renderRow(r, place); }).join('');
  }

  /* ------------------------------------------------------------------ the detail drawer */

  function bandDetail(row) {
    var lo = Math.log10(Math.max(1, row.implied_low_usd));
    var hi = Math.log10(Math.max(row.implied_low_usd + 1, row.implied_high_usd));
    var mid = Math.log10(row.implied_value_usd);
    var span = hi - lo || 1;
    return { pin: Math.max(0, Math.min(100, ((mid - lo) / span) * 100)) };
  }

  function whySentence(row) {
    var f = row.factors;
    var growth = row.change_7d == null
      ? 'no seven-day reading is recorded, so momentum stays neutral'
      : 'the week moved ' + pct(row.change_7d) + ', which is ' + f.momentum.toFixed(2) + '× momentum';
    var tenure = row.age_days == null
      ? 'no listing date is recorded, so tenure sits at the neutral ' + F.tenure_unknown.toFixed(2) + '×'
      : track(row.age_days) + ' without a token is ' + f.tenure.toFixed(2) + '× tenure';
    return usd(row.tvl_usd) + ' TVL × ' + f.peer_multiple.toFixed(2) + '× peer × ' + f.momentum.toFixed(2) +
      '× momentum × ' + f.tenure.toFixed(2) + '× tenure gives ' + usd(row.implied_value_usd) + ': ' + growth + ', and ' + tenure + '.';
  }

  function stepParts(text) {
    var m = /^(.*?)\s*Cost: (.*?)\.\s*Time: (.*?)\.?$/.exec(text);
    if (!m) return { action: text, cost: '', time: '' };
    return { action: m[1], cost: m[2], time: m[3] };
  }

  function renderPlan(row) {
    return '<ol class="plan">' + row.farm_steps.map(function (step) {
      var p = stepParts(step);
      return '<li>' + esc(p.action) + '<span class="cost"><i>' + esc(p.cost) + '</i><i>' + esc(p.time) + '</i></span></li>';
    }).join('') + '</ol>';
  }

  function renderPeers(row) {
    var peers = row.peer_sample || [];
    if (!peers.length) return '<p class="why">This category records no priced token, so the multiple is the market-wide median.</p>';
    return '<table class="peers"><thead><tr><th>Token-bearing protocol</th><th>Market cap</th><th>TVL</th><th>mcap / TVL</th></tr></thead><tbody>' +
      peers.map(function (p) {
        return '<tr><td>' + esc(p.name) + '</td><td class="n">' + usd(p.mcap_usd) + '</td><td class="n">' + usd(p.tvl_usd) +
          '</td><td class="n hi">' + mult(p.mult) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { row = R.rows[i]; break; }
    if (!row) { closeDetail(); return; }
    state.slug = slug;
    var f = row.factors;
    var b = bandDetail(row);
    var trophy = row.tier === 'watchlist' ? 'house watchlist' : 'below the $' + Math.round(R.meta.floor_usd / 1e6) + 'M floor';
    var draw = $('drawer');
    draw.innerHTML = '<div class="drawer-in">' +
      '<div class="drawer-top"><div>' +
        '<div class="eyebrow">Rank ' + row.rank + ' of ' + R.meta.board_size + ' · ' + trophy + ' · records no token</div>' +
        '<h2>' + esc(row.name) + '</h2>' +
        '<p class="sub"><em>' + esc(catLabel(row)) + '</em> · ' + esc(chainLine(row.chains, 4)) + ' · tracked since ' + esc(row.listed_at || 'an unrecorded date') + '</p>' +
      '</div><button type="button" class="close" id="drawer-close" aria-label="Close the detail view">×</button></div>' +

      '<div class="drawer-cols"><div class="col">' +
        '<div class="lede"><div class="unit">Implied value if its record stayed as it is</div>' +
          '<strong>' + usd(row.implied_value_usd) + '</strong>' +
          '<p class="range">Band <b>' + usd(row.implied_low_usd) + '</b> to <b>' + usd(row.implied_high_usd) + '</b> — the same arithmetic at the category\'s 25th and 75th peer multiple.</p>' +
          '<span class="track"><i></i><u style="left:' + b.pin.toFixed(1) + '%"></u></span>' +
        '</div>' +

        '<h3>The arithmetic, factor by factor</h3>' +
        '<div class="factors">' +
          '<div class="factor"><span>TVL</span><b>' + usd(row.tvl_usd) + '</b><small>' + esc(chainLine(row.chains, 2)) + '</small></div>' +
          '<div class="factor"><span>Peer ×</span><b>' + mult(f.peer_multiple) + '</b><small>' + gradeWord(f.peer_peers) + ' at ' + mult(f.peer_median) + '</small></div>' +
          '<div class="factor ' + (f.momentum >= 1 ? 'good' : 'bad') + '"><span>Momentum</span><b>' + f.momentum.toFixed(2) + '×</b><small>' + pct(row.change_7d) + ' this week</small></div>' +
          '<div class="factor"><span>Tenure</span><b>' + f.tenure.toFixed(2) + '×</b><small>' + esc(track(row.age_days)) + ' without a token</small></div>' +
        '</div>' +
        '<div class="equation">' + exact(row.tvl_usd) + ' × ' + f.peer_multiple.toFixed(4) + ' × ' + f.momentum.toFixed(4) + ' × ' + f.tenure.toFixed(4) + ' = <b>' + exact(row.implied_value_usd) + '</b></div>' +
        '<p class="why">' + esc(whySentence(row)) + '</p>' +

        '<h3>Peers the market already prices</h3>' +
        renderPeers(row) +
        '<p class="why">The same function scores every row and no name is special-cased. These token-bearing protocols are the evidence its category multiple is shrunk toward.</p>' +
      '</div><div class="col">' +
        '<h3>Farm plan: eight steps, each with its cost and its time</h3>' +
        renderPlan(row) +
        '<p class="why">Capital, gas and the hold window come from this protocol\'s own TVL tier and age, so the plan is about this protocol and not a template.</p>' +
        '<p class="caveat"><b>Records no token — not proof it has none.</b> The snapshot is DefiLlama\'s record of ' + esc(R.meta.as_of) +
        ', and a wrapped, staked or bridged product of a protocol whose token already trades is no subject for this radar. Nothing here says a token will be issued.</p>' +
      '</div></div>' +
      '</div>';
    draw.hidden = false;
    $('scrim').hidden = false;
    body.classList.add('drawing');
    $('drawer-close').addEventListener('click', closeDetail);
    draw.scrollTop = 0;
    writeHash();
  }

  function closeDetail() {
    state.slug = null;
    $('drawer').hidden = true;
    $('scrim').hidden = true;
    body.classList.remove('drawing');
    writeHash();
  }

  /* ------------------------------------------------------------------ token trades and method */

  function renderLive() {
    var rows = R.live || [];
    $('live').innerHTML =
      '<div class="panel-head"><div><h2>These tokens already trade</h2>' +
      '<p>The radar never scores them: their value is the market\'s own market cap, not a model\'s claim. They are shown because they are the reference the model is read from — every multiple beside a board row traces back to a record here.</p></div></div>' +
      '<div class="live-table"><div class="live-head"><span>Protocol</span><span>Category</span><span class="num">Market cap</span><span class="num">TVL</span><span class="num">mcap / TVL</span><span class="num">7-day TVL</span></div>' +
      rows.map(function (r) {
        return '<div class="live-row"><div class="who"><b>' + esc(r.name) + '</b><small>' + esc(chainLine(r.chains, 3)) + '</small></div>' +
          '<div class="who"><small>' + esc(r.category || 'Uncategorised') + '</small></div>' +
          '<div class="num-cell">' + usd(r.mcap_usd) + '</div>' +
          '<div class="num-cell">' + usd(r.tvl_usd) + '</div>' +
          '<div class="mult">' + (r.multiple == null ? 'n/a' : mult(r.multiple)) + '</div>' +
          '<div class="delta ' + (r.change_7d == null ? 'flat' : r.change_7d > 0.05 ? 'up' : r.change_7d < -0.05 ? 'down' : 'flat') + '">' + pct(r.change_7d) + '</div></div>';
      }).join('') + '</div>';
  }

  function renderMethod() {
    var cats = CATS.slice(0, 12);
    $('method').innerHTML =
      '<div class="panel-head"><div><h2>How the implied value is made</h2>' +
      '<p>One formula scores all ' + R.meta.board_size + ' rows. It is the same function on every protocol and no name is special-cased: the inputs are the snapshot\'s TVL, the snapshot\'s seven-day change and the protocol\'s own listing date.</p></div></div>' +
      '<div class="cards">' +
        '<div class="card wide"><h3>The formula</h3>' +
          '<p><code>implied = TVL × peer(category) × momentum(7-day) × tenure(age)</code></p>' +
          '<p>The peer multiple is read off the snapshot itself: ' + G.peers + ' token-bearing protocols record both a market cap and a TVL, and each is one reading of what the market pays per dollar of TVL. The market-wide log-median is ' + mult(G.median) + ', with a 25th percentile of ' + mult(G.p25) + ' and a 75th of ' + mult(G.p75) + '. A category\'s own reading is shrunk toward that median with a weight of ' + F.peer_shrink + ' peers, and held inside ' + mult(G.median / F.peer_band_global) + ' to ' + mult(G.median * F.peer_band_global) + '.</p>' +
          '<p>Momentum reads the seven-day change, clipped to ' + F.growth_clip_low + '% to +' + F.growth_clip_high + '% and weighted at ' + F.growth_weight + ', so a strong week moves value but cannot decide a rank. Tenure ramps from ' + F.tenure_low + '× at listing to ' + F.tenure_high + '× after ' + group(F.tenure_days) + ' days without a token: a long record is a durable claim, a few weeks is an incentive programme. An unrecorded age takes the neutral ' + F.tenure_unknown + '×.</p></div>' +
        '<div class="card"><h3>Read off the snapshot</h3><div class="spec">' +
          'priced tokens <span>' + G.peers + '</span><br>' +
          'market median <span>' + mult(G.median) + '</span><br>' +
          '25th percentile <span>' + mult(G.p25) + '</span><br>' +
          '75th percentile <span>' + mult(G.p75) + '</span><br>' +
          'peer shrink <span>' + F.peer_shrink + '</span><br>' +
          'momentum range <span>' + F.momentum_low + ' to ' + F.momentum_high + '×</span><br>' +
          'tenure ramp <span>' + F.tenure_low + ' to ' + F.tenure_high + '×</span><br>' +
          'rows below the floor <span>' + R.meta.below_floor + '</span></div></div>' +
        '<div class="card"><h3>The split the board keeps</h3>' +
          '<p><b>' + R.meta.token_bearing + '</b> of the snapshot\'s ' + R.meta.protocols + ' protocols record a token; they are never scored and never ranked. <b>' + R.meta.pre_token + '</b> record none, and ' + R.meta.watchlist + ' of those clear the $' + Math.round(R.meta.floor_usd / 1e6) + 'M floor.</p>' +
          '<p>The board is the floor plus the ' + R.meta.below_floor + ' pre-token protocols under it with the most TVL, because the floor is where the house\'s reading started, not where the radar stops.</p></div>' +
        '<div class="card wide"><h3>Categories with the most priced peers</h3>' +
          '<table class="grid-table"><thead><tr><th>Category</th><th>Peers</th><th>Median multiple</th><th>25th</th><th>75th</th></tr></thead><tbody>' +
          cats.map(function (c) {
            return '<tr><td>' + esc(c.name) + '</td><td class="n">' + c.peers + '</td><td class="n">' + mult(c.median) + '</td><td class="n">' + mult(c.p25) + '</td><td class="n">' + mult(c.p75) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
        '<div class="card wide"><h3>Farm plans</h3>' +
          '<p>Every row carries eight steps: a wallet that holds only farm money, the category\'s own entry action, season registration, a weekly cadence, a hold window from the protocol\'s age, an exit test, claim safety and a written log. Capital, gas and hold time come from the protocol\'s TVL tier and age, so a $1.6B protocol and a $48M protocol get different numbers.</p></div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ footer and the page's own check */

  function renderFoot() {
    var ok = CHECK.matched === CHECK.total;
    $('foot').innerHTML = '<span>Snapshot <b>' + esc(R.meta.as_of) + '</b> · ' + R.meta.protocols + ' protocols, ' + R.meta.pre_token +
      ' with no token, ' + R.meta.watchlist + ' on the house watchlist · floor ' + exact(R.meta.floor_usd) + '</span>' +
      '<span><b>peer-1</b> model · every value is the snapshot\'s arithmetic, not a forecast</span>' +
      '<span class="check ' + (ok ? 'ok' : 'bad') + '">' + (ok
        ? 'this page recomputed ' + CHECK.matched + ' of ' + CHECK.total + ' values from their factors: all match'
        : 'this page could not reproduce ' + (CHECK.total - CHECK.matched) + ' of ' + CHECK.total + ' values') + '</span>';
  }

  function verify() {
    var matched = 0;
    for (var i = 0; i < R.rows.length; i++) {
      var r = R.rows[i];
      var f = r.factors;
      var value = Math.max(1, Math.round(r.tvl_usd * f.peer_multiple * f.momentum * f.tenure));
      if (value === r.implied_value_usd) matched += 1;
    }
    return { matched: matched, total: R.rows.length };
  }

  /* ------------------------------------------------------------------ views and events */

  function showTab(tab) {
    state.tab = tab;
    var boardOn = tab === 'board';
    $('table').hidden = !boardOn;
    $('controls').hidden = !boardOn;
    $('status').hidden = !boardOn;
    if (!boardOn) $('empty').hidden = true;
    $('live').hidden = tab !== 'live';
    $('method').hidden = tab !== 'method';
    document.querySelectorAll('#tabs button').forEach(function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('tabs-note').textContent = boardOn
      ? R.meta.board_size + ' rows · ' + R.meta.watchlist + ' on the watchlist · '
        + (CHECK.matched === CHECK.total ? 'all ' + CHECK.total + ' values recomputed in this page' : 'the page failed to recompute ' + (CHECK.total - CHECK.matched) + ' values')
      : tab === 'live' ? R.live.length + ' token-bearing protocols, at the market\'s own value'
        : 'peer-1: TVL × peer × momentum × tenure';
    if (boardOn) renderBoard();
  }

  function rerender() {
    renderControls();
    renderBoard();
    writeHash();
  }

  function bind() {
    $('q').addEventListener('input', function (e) { state.q = e.target.value.trim(); rerender(); });
    $('cat').addEventListener('change', function (e) { state.cat = e.target.value; rerender(); });
    $('ev').addEventListener('change', function (e) { state.ev = e.target.value; rerender(); });
    $('tier').addEventListener('change', function (e) { state.tier = e.target.value; rerender(); });
    $('sort').addEventListener('change', function (e) { state.sort = e.target.value; rerender(); });
    $('reset').addEventListener('click', function () {
      state.q = ''; state.cat = '*'; state.ev = '*'; state.tier = '*'; state.sort = 'rank';
      rerender();
    });

    $('thead').addEventListener('click', function (e) {
      var key = e.target && e.target.getAttribute && e.target.getAttribute('data-sort');
      if (!key) return;
      var map = { rank: 'rank', tvl: 'tvl', growth: 'growth', age: 'age', peer: 'peer' };
      state.sort = map[key];
      $('sort').value = state.sort;
      rerender();
    });

    $('tbody').addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.row') : null;
      if (row) openDetail(row.getAttribute('data-slug'));
    });
    $('tbody').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest ? e.target.closest('.row') : null;
      if (row) { e.preventDefault(); openDetail(row.getAttribute('data-slug')); }
    });

    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-tab]') : null;
      if (b) { showTab(b.getAttribute('data-tab')); writeHash(); }
    });

    $('scrim').addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.slug) closeDetail();
    });
    window.addEventListener('hashchange', function () {
      var slug = state.slug;
      readHash();
      if (state.slug && state.slug !== slug) openDetail(state.slug);
      else if (!state.slug && $('drawer').hidden === false) closeDetail();
      showTab(state.tab);
    });
  }

  /* ------------------------------------------------------------------ start */

  readHash();
  renderFacts();
  renderFormula();
  renderControls();
  renderLive();
  renderMethod();
  CHECK = verify();
  renderFoot();
  showTab(state.tab);
  bind();
  if (state.slug) openDetail(state.slug);
})();
