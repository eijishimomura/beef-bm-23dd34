/* 肉牛ベンチマーク モック — アプリ本体
 * データは data/*.json（正規化・DB互換スキーマ）から読み込む。挙動はワイヤーv2を正として移植。
 * 画面遷移はハッシュルーティング（#/ = 全体ダッシュボード、#/farm/<id> = 農場個票）。ブラウザの「戻る」が効く。
 */
(function () {
  'use strict';
  var A = document.getElementById('app');
  var lineChart = window.Charts.lineChart, scatterChart = window.Charts.scatterChart, fmt = window.Charts.fmt;

  function cvar(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function quantile(s, q) { var p = (s.length - 1) * q, b = Math.floor(p), r = p - b; return s[b + 1] !== undefined ? s[b] + r * (s[b + 1] - s[b]) : s[b]; }

  var METRICS = {}, PROD = [], ECON = [], SCORE = [];
  var AXES = ['carcassWt', 'price', 'dg', 'ebitdaM', 'invTurn', 'capTurn', 'equity', 'ordP'];
  var KUS = ['繁殖', '肥育', '一貫'];
  var farms = [], STATS = {}, BENCH = {}, RULES = [], NP = 0, PARAMS = null;
  var kuC = { '繁殖': '#0e7c86', '肥育': '#3b5bdb', '一貫': '#7048e8' };

  // ---- データ読み込み（正規化JSON＝簡易DB） ----
  function load(name) { return fetch('data/' + name + '.json').then(function (r) { if (!r.ok) throw new Error(name + ': ' + r.status); return r.json(); }); }
  Promise.all(['farms', 'context', 'metrics', 'farm_metrics', 'timeseries', 'fiscal', 'benchmarks', 'advice_rules', 'params'].map(load))
    .then(function (t) { PARAMS = t[8]; build(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7]); init(); })
    .catch(function (e) {
      document.getElementById('loading').innerHTML = '<p class="psub" style="margin:0;color:var(--gF)">データの読み込みに失敗しました（' + e.message + '）。ローカルで開く場合は python3 scripts/dev_server.py を起動し http://localhost:8642 を開いてください。</p>';
    });

  function roll(a, w) { var o = [], i, j, s; for (i = w - 1; i < a.length; i++) { s = 0; for (j = i - w + 1; j <= i; j++) s += a[j]; o.push(s / w); } return o; }

  function build(farmsT, contextT, metricsT, fmT, tsT, fiscalT, benchT, rulesT) {
    metricsT.forEach(function (m) {
      METRICS[m.metric_id] = { lb: m.label, u: m.unit, dir: m.dir, add: m.add, group: m.group };
      (m.group === 'prod' ? PROD : ECON).push(m.metric_id);
    });
    SCORE = PROD.concat(ECON);
    RULES = rulesT.rules;

    var byId = {};
    farmsT.forEach(function (r) { byId[r.farm_id] = { id: r.farm_id, name: r.name, ku: r.ku, reg: r.region, band: r.band, head: r.head, ts: {}, rl: {}, fiscal: [] }; });
    contextT.forEach(function (r) { var f = byId[r.farm_id]; f.barnCap = r.barn_cap; f.workers = r.workers; f.calfSrc = r.calf_source; f.feedSelf = r.feed_self_pct; f.debt = r.debt_myen; f.age = r.owner_age; f.succ = r.successor; });
    fmT.forEach(function (r) { byId[r.farm_id][r.metric_id] = r.value; });
    tsT.forEach(function (r) { var f = byId[r.farm_id]; (f.ts[r.metric_id] = f.ts[r.metric_id] || []).push(r); });
    fiscalT.forEach(function (r) { byId[r.farm_id].fiscal.push(r); });
    farms = Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) { return a.id - b.id; });

    farms.forEach(function (f) {
      SCORE.forEach(function (m) {
        f.ts[m].sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
        f.ts[m] = f.ts[m].map(function (r) { return r.value; });
        f.rl[m] = roll(f.ts[m], 12);
      });
      f.fiscal.sort(function (a, b) { return a.fy - b.fy; });
      f.sales = f.fiscal[f.fiscal.length - 1].sales; // 百万円（直近期）
    });
    NP = farms[0].rl[SCORE[0]].length;

    // 分布統計：全農場の直近値から算出（ワイヤーと同一ロジック）。min/max は位置バー用
    SCORE.forEach(function (m) {
      var v = farms.map(function (f) { return f[m]; }).sort(function (a, b) { return a - b; }), d = METRICS[m].dir;
      STATS[m] = { lo10: quantile(v, d > 0 ? .1 : .9), lo25: quantile(v, d > 0 ? .25 : .75), med: quantile(v, .5), hi25: quantile(v, d > 0 ? .75 : .25), hi10: quantile(v, d > 0 ? .9 : .1), min: v[0], max: v[v.length - 1], all: v };
    });
    // benchmarks.json（segment別 p10〜p90）を索引化。成績表の分布列はこちらを使う（DB互換スキーマの実証）
    benchT.forEach(function (r) { (BENCH[r.segment] = BENCH[r.segment] || {})[r.metric_id] = r; });
  }
  // 方向を解釈して benchmarks の p10〜p90 を 上位10/25・中央・下位25/10 に読み替える
  function benchOf(m, segment) {
    var b = BENCH[segment || 'all'][m], d = METRICS[m].dir;
    return d > 0 ? { hi10: b.p90, hi25: b.p75, med: b.p50, lo25: b.p25, lo10: b.p10, n: b.n }
                 : { hi10: b.p10, hi25: b.p25, med: b.p50, lo25: b.p75, lo10: b.p90, n: b.n };
  }

  function bf(f, m) { var d = METRICS[m].dir, v = f[m], a = STATS[m].all, c = 0, i; for (i = 0; i < a.length; i++) if (d > 0 ? a[i] <= v : a[i] >= v) c++; return c / a.length; }
  function rk(f, m) { var d = METRICS[m].dir, v = f[m], c = 1; farms.forEach(function (g) { if (d > 0 ? g[m] > v : g[m] < v) c++; }); return c; }
  function gr(b) { return b >= .9 ? 'A' : b >= .75 ? 'B' : b >= .5 ? 'C' : b >= .25 ? 'D' : b >= .1 ? 'E' : 'F'; }
  function gc(g) { return cvar({ A: '--gA', B: '--gB', C: '--gC', D: '--gD', E: '--gE', F: '--gF' }[g]); }
  function ov(f) { var s = 0; SCORE.forEach(function (m) { s += bf(f, m); }); return s / SCORE.length; }
  function gapAt(i, m) {
    var v = farms.map(function (f) { return f.rl[m][i]; }).sort(function (a, b) { return a - b; }), d = METRICS[m].dir;
    return { hi: quantile(v, d > 0 ? .9 : .1), med: quantile(v, .5), lo: quantile(v, d > 0 ? .1 : .9) };
  }

  // ================= 画面A：全体ダッシュボード =================
  function renderKpis() {
    var med = STATS.ebitdaM.med, up = 0, up25 = 0;
    farms.forEach(function (f) {
      var eb = f.sales * 1e6;
      if (f.ebitdaM < med) up += (med - f.ebitdaM) / 100 * eb;
      if (f.ebitdaM < STATS.ebitdaM.hi25) up25 += (STATS.ebitdaM.hi25 - f.ebitdaM) / 100 * eb;
    });
    var oku = up / 1e8, oku25 = up25 / 1e8, hi = STATS.ebitdaM.hi10, lo = STATS.ebitdaM.lo10;
    var g0 = gapAt(0, 'ebitdaM'), g1 = gapAt(NP - 1, 'ebitdaM'), wide = (g1.hi - g1.lo) - (g0.hi - g0.lo);
    var below = farms.filter(function (f) { return f.ebitdaM < med; }).length;
    document.getElementById('kpis').innerHTML =
      '<div class="kpi hero"><div class="t">改善余地（EBITDA基準・年間）</div><div class="v">+¥' + oku.toFixed(1) + '<span> 億</span></div><div class="s">下位50%（' + below + '農場）が中位に到達した場合。上位25%水準なら +¥' + oku25.toFixed(1) + '億</div></div>' +
      '<div class="kpi"><div class="t">上位10% ⇄ 下位10% の格差</div><div class="v">' + hi.toFixed(1) + '% <span style="color:var(--muted)">vs</span> ' + lo.toFixed(1) + '%</div><div class="s">EBITDAマージン。差は24ヶ月で <span class="up">' + (wide >= 0 ? '+' : '') + wide.toFixed(1) + 'pt ' + (wide >= 0 ? '拡大' : '縮小') + '</span></div></div>' +
      '<div class="kpi"><div class="t">参加農場</div><div class="v">' + farms.length + '<span> 農場</span></div><div class="s">繁殖' + farms.filter(function (f) { return f.ku === '繁殖'; }).length + ' / 肥育' + farms.filter(function (f) { return f.ku === '肥育'; }).length + ' / 一貫' + farms.filter(function (f) { return f.ku === '一貫'; }).length + '　5地域</div></div>';
  }

  function drawGap() {
    var m = document.getElementById('selGap').value, hi = [], md = [], lo = [], i;
    for (i = 0; i < NP; i++) { var g = gapAt(i, m); hi.push(g.hi); md.push(g.med); lo.push(g.lo); }
    lineChart(document.getElementById('gapPlot'), [{ data: hi, c: '#1e8f5b' }, { data: md, c: '#5f7085', w: 1.8 }, { data: lo, c: '#c0392b' }], { h: 250 });
    var d0 = Math.abs(hi[0] - lo[0]), d1 = Math.abs(hi[NP - 1] - lo[NP - 1]), ch = d1 - d0;
    var h = '<h4>▸ 自動コメント</h4><p>' + METRICS[m].lb + 'の上位10%と下位10%の差は ' + fmt(d0) + ' → <b>' + fmt(d1) + METRICS[m].u + '</b>（24ヶ月で ' + (ch >= 0 ? '+' : '') + fmt(ch) + '）。</p>';
    h += ch > 0.02 * d0 ? '<p><span class="warn">格差は拡大している。</span>上位は伸び続け、下位が置いていかれている。組合として下位層への介入（個票の配布・伴走）に投資する根拠になる。</p>'
      : ch < -0.02 * d0 ? '<p>格差は縮小。底上げが効いている。上位の突き抜けを支援するフェーズへ。</p>'
        : '<p>格差はほぼ横ばい。母集団全体が同じ方向に動いている。</p>';
    document.getElementById('gapCmt').innerHTML = h;
  }

  function drawStrat() {
    var m = document.getElementById('selStrat').value, bands = ['小', '中', '大'];
    var h = '<thead><tr><th>規模帯 \\ 区分</th>' + KUS.map(function (k) { return '<th>' + k + '</th>'; }).join('') + '<th>行 中央値</th></tr></thead><tbody>';
    bands.forEach(function (b) {
      h += '<tr><td class="k">' + b + '規模</td>'; var rowv = [];
      KUS.forEach(function (k) {
        var sub = farms.filter(function (f) { return f.band === b && f.ku === k; });
        if (!sub.length) { h += '<td style="color:#c3ccd8">—</td>'; return; }
        var v = sub.map(function (f) { return f[m]; }).sort(function (a, b2) { return a - b2; }); rowv = rowv.concat(v);
        var md = quantile(v, .5), dev = md - STATS[m].med, good = METRICS[m].dir > 0 ? dev > 0 : dev < 0;
        h += '<td style="color:' + (Math.abs(dev) > 0.03 * Math.abs(STATS[m].med) ? (good ? '#1e8f5b' : '#c0392b') : 'inherit') + ';font-weight:700">' + fmt(md) + ' <span style="font-weight:400;color:#8595a8">(' + sub.length + ')</span></td>';
      });
      rowv.sort(function (a, b2) { return a - b2; });
      h += '<td style="background:var(--bg);font-weight:800">' + (rowv.length ? fmt(quantile(rowv, .5)) : '—') + '</td></tr>';
    });
    h += '<tr><td class="k" style="background:var(--bg)">列 中央値</td>';
    KUS.forEach(function (k) {
      var v = farms.filter(function (f) { return f.ku === k; }).map(function (f) { return f[m]; }).sort(function (a, b2) { return a - b2; });
      h += '<td style="background:var(--bg);font-weight:800">' + fmt(quantile(v, .5)) + '</td>';
    });
    h += '<td style="background:var(--ink);color:#fff;font-weight:800">' + fmt(STATS[m].med) + '</td></tr></tbody>';
    document.getElementById('stratTbl').innerHTML = h;
  }

  var st = { ku: 'all', sc: 'all', x: 'carcassWt', y: 'ebitdaM', col: 'ku' };
  function filt() { return farms.filter(function (f) { return (st.ku === 'all' || f.ku === st.ku) && (st.sc === 'all' || f.band === st.sc); }); }

  function drawSc() {
    var fs = filt(), xm = st.x, ym = st.y;
    var xs = farms.map(function (f) { return f[xm]; }), ys = farms.map(function (f) { return f[ym]; });
    var xn = Math.min.apply(0, xs), xx = Math.max.apply(0, xs), yn = Math.min.apply(0, ys), yx = Math.max.apply(0, ys);
    var dx = (xx - xn) * .07, dy = (yx - yn) * .07; xn -= dx; xx += dx; yn -= dy; yx += dy;
    function R(h) { return 6 + (Math.sqrt(h) - Math.sqrt(30)) / (Math.sqrt(950) - Math.sqrt(30)) * 18; }
    // 異常値＝稀だから意味を持つ。各軸の最上位・最下位（計最大4）＋「規模突出だが収益中位以下」1件に限定（ラベル最大5件）
    var outIds = {};
    if (fs.length) {
      var byX = fs.slice().sort(function (a, b) { return a[xm] - b[xm]; });
      var byY = fs.slice().sort(function (a, b) { return a[ym] - b[ym]; });
      [byX[0], byX[byX.length - 1], byY[0], byY[byY.length - 1]].forEach(function (f) { outIds[f.id] = 1; });
      var bigF = fs.slice().sort(function (a, b) { return b.head - a.head; })[0];
      if (bigF && bigF.head >= 500 && bf(bigF, ym) < .5) outIds[bigF.id] = 1;
    }
    scatterChart(document.getElementById('plot'), {
      xMin: xn, xMax: xx, yMin: yn, yMax: yx, xMed: STATS[xm].med, yMed: STATS[ym].med,
      xLabel: METRICS[xm].lb + ' (' + METRICS[xm].u + ')', yLabel: METRICS[ym].lb + ' (' + METRICS[ym].u + ')',
      quad: { tr: '両立ゾーン（トップ層）', tl: '少数精鋭・高収益', br: '量はあるが薄利', bl: '要改善ゾーン' },
      points: fs.map(function (f) {
        return { id: f.id, x: f[xm], y: f[ym], r: R(f.head), color: st.col === 'ku' ? kuC[f.ku] : gc(gr(ov(f))), outline: !!outIds[f.id], label: f.name };
      })
    });
    var tip = document.getElementById('tip'), wr = document.getElementById('plot');
    wr.querySelectorAll('.bub').forEach(function (c) {
      c.addEventListener('mousemove', function (e) {
        var f = farms[+c.getAttribute('data-id')], b = wr.getBoundingClientRect();
        tip.innerHTML = '<b>' + f.name + '</b>（' + f.ku + '・' + f.reg + '・' + f.band + '）<br>頭数' + f.head + '／' + METRICS[xm].lb + ' ' + f[xm] + '／' + METRICS[ym].lb + ' ' + f[ym];
        tip.style.left = (e.clientX - b.left + 12) + 'px'; tip.style.top = (e.clientY - b.top - 8) + 'px'; tip.style.opacity = 1;
      });
      c.addEventListener('mouseleave', function () { tip.style.opacity = 0; });
      c.addEventListener('click', function () { location.hash = '#/farm/' + c.getAttribute('data-id'); });
    });
    var lg = '', kk;
    if (st.col === 'ku') { for (kk in kuC) lg += '<b><span class="dot" style="background:' + kuC[kk] + '"></span>' + kk + '</b>'; }
    else ['A', 'B', 'C', 'D', 'E', 'F'].forEach(function (g) { lg += '<b><span class="dot" style="background:' + gc(g) + '"></span>' + g + '</b>'; });
    lg += '<b style="color:var(--muted)">○大きさ＝規模</b>';
    document.getElementById('legend').innerHTML = lg;
    var xM = STATS[xm].med, yM = STATS[ym].med;
    var tr = fs.filter(function (f) { return f[xm] >= xM && f[ym] >= yM; }), bl = fs.filter(function (f) { return f[xm] < xM && f[ym] < yM; });
    var worst = fs.slice().sort(function (a, b) { return bf(a, ym) - bf(b, ym); })[0], big = fs.slice().sort(function (a, b) { return b.head - a.head; })[0];
    var h = '<h4>▸ 自動コメント</h4><p>両立ゾーンに ' + tr.length + ' 農場、<span class="warn">要改善ゾーンに ' + bl.length + ' 農場</span>。</p>';
    if (worst) h += '<p>伸びしろ最大は <b>' + worst.name + '</b>（' + METRICS[ym].lb + ' ' + worst[ym] + METRICS[ym].u + '・' + rk(worst, ym) + '位）。ここへの伴走が組合の投資対効果が最も高い。</p>';
    if (big && big.head >= 500 && bf(big, ym) < .5) h += '<p>異常値：<b>' + big.name + '</b> は規模突出（' + big.head + '頭）だが ' + METRICS[ym].lb + ' は中位以下。<b>規模拡大が利益に結びついていない</b>典型。</p>';
    document.getElementById('cmt').innerHTML = h;
  }

  // ================= 赤ペン先生（ルールエンジン＋ガードレール） =================
  var CTX_LABELS = {
    occ: ['牛舎キャパ稼働率', '%'], spare: ['牛舎の空き', '頭'], perW: ['1人あたり飼養頭数', '頭'],
    workers: ['労働力（常勤換算）', '人'], head: ['常時飼養頭数', '頭'], barnCap: ['牛舎キャパ', '頭'],
    debt: ['有利子負債', '百万円'], feedSelf: ['飼料自給率', '%'], age: ['経営者年齢', '歳'], succ: ['後継者', '']
  };

  function buildPenContext(f) {
    var occ = Math.round(f.head / f.barnCap * 100), spare = f.barnCap - f.head, perW = Math.round(f.head / f.workers);
    return {
      n: farms.length, occ: occ, spare: spare, perW: perW, head: f.head, barnCap: f.barnCap, workers: f.workers,
      feedSelf: f.feedSelf, age: f.age, succ: f.succ, debt: f.debt,
      price: f.price, priceRank: rk(f, 'price'), priceGrade: gr(bf(f, 'price')),
      carcassWt: f.carcassWt, priceUp100: Math.round(f.carcassWt * 100 / 1000),
      mort: f.mort, mortGrade: gr(bf(f, 'mort')), mortAddHead: Math.round(f.head * 365 / f.fatDays * 0.01),
      fatDays: f.fatDays, fatGrade: gr(bf(f, 'fatDays')),
      invTurn: f.invTurn, turnGrade: gr(bf(f, 'invTurn')),
      turnAfter30: (f.invTurn * f.fatDays / (f.fatDays - 30)).toFixed(2),
      debtEbitda: f.debtEbitda, ebitdaM: f.ebitdaM
    };
  }

  function evalCond(cond, ctx) {
    return (cond.all || []).every(function (c) {
      var v = ctx[c.var];
      if (v === undefined) return false;
      switch (c.op) {
        case '>=': return v >= c.value; case '<=': return v <= c.value;
        case '>': return v > c.value; case '<': return v < c.value;
        case '==': return v === c.value;
        case 'in': return c.value.indexOf(v) >= 0;
        case 'not_in': return c.value.indexOf(v) < 0;
        default: return false;
      }
    });
  }

  // テンプレートの {token} を ctx で確定した値のみで埋める。未定義 token が残る場合は null（根拠のない指摘は出さない）
  function fillTemplate(tpl, ctx) {
    var missing = false;
    var s = tpl.replace(/\{(\w+)\}/g, function (_, k) { if (ctx[k] === undefined) { missing = true; return ''; } return String(ctx[k]); });
    return missing ? null : s;
  }

  // 数値照合ゲート：text 中のすべての数値が allowed（ルール側で確定した数値集合）に含まれるか検証する。
  // 将来 LLM で肉付けする際、出力前に必ずこのゲートを通し、不一致ならルールベース文へフォールバックする。
  function extractNumbers(text) { return (String(text).match(/-?\d+(?:\.\d+)?/g) || []); }
  function verifyNumbers(text, allowedNumbers) {
    var set = {}; allowedNumbers.forEach(function (x) { set[x] = 1; set[String(+x)] = 1; });
    var bad = extractNumbers(text).filter(function (x) { return !set[x] && !set[String(+x)]; });
    return { ok: bad.length === 0, mismatches: bad };
  }

  // LLM肉付けの差し込み口。本モックでは未接続（enhance = null）。
  // 接続時は enhance({title, body, evidence}) が {title, body} を返す想定。数値照合ゲートを通らない出力は破棄する。
  var PenLLM = { enhance: null };
  window.BeefBenchmark = { PenLLM: PenLLM, verifyNumbers: verifyNumbers, extractNumbers: extractNumbers };

  // コンテキスト値も母集団の中で順位づけして根拠に添える（指標名・自農場値・順位・母集団数の同居を全指摘で保証）
  var CTX_GETTERS = {
    occ: function (g) { return Math.round(g.head / g.barnCap * 100); },
    spare: function (g) { return g.barnCap - g.head; },
    perW: function (g) { return Math.round(g.head / g.workers); },
    workers: function (g) { return g.workers; }, head: function (g) { return g.head; },
    barnCap: function (g) { return g.barnCap; }, debt: function (g) { return g.debt; },
    feedSelf: function (g) { return g.feedSelf; }, age: function (g) { return g.age; }
  };
  function ctxRank(key, f) {
    var get = CTX_GETTERS[key], v = get(f), c = 1;
    farms.forEach(function (g) { if (get(g) > v) c++; });
    return c;
  }
  function evidenceLine(f, ctx, keys) {
    return keys.map(function (ek) {
      if (ek.kind === 'metric') {
        var m = ek.id;
        return METRICS[m].lb + ' ' + f[m] + METRICS[m].u + '（' + rk(f, m) + '位/' + farms.length + '農場・判定' + gr(bf(f, m)) + '）';
      }
      var cl = CTX_LABELS[ek.key] || [ek.key, ''];
      if (ek.key === 'succ') {
        var und = farms.filter(function (g) { return g.succ === '未定'; }).length;
        return cl[0] + ' ' + ctx.succ + '（後継者未定は' + farms.length + '農場中' + und + '農場）';
      }
      var rank = CTX_GETTERS[ek.key] ? '（高い順' + ctxRank(ek.key, f) + '位/' + farms.length + '農場）' : '';
      return cl[0] + ' ' + ctx[ek.key] + cl[1] + rank;
    }).join('　／　');
  }

  function penFeedback(fid) { try { return JSON.parse(localStorage.getItem('penFeedback') || '[]').filter(function (r) { return r.farm_id === fid; }); } catch (e) { return []; } }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var penSeq = 0; // 農場を素早く切り替えたとき、古い非同期描画が新しい画面を上書きしないように
  async function renderPen(f) {
    var seq = ++penSeq;
    var ctx = buildPenContext(f);
    var items = [];
    RULES.forEach(function (r) {
      if (!evalCond(r.condition, ctx)) return;
      var title = fillTemplate(r.template.title, ctx), body = fillTemplate(r.template.body, ctx);
      if (title === null || body === null) return; // ガードレール：根拠（確定値）が揃わない指摘は出さない
      var evidence = evidenceLine(f, ctx, r.evidence_keys || []);
      items.push({ rule_id: r.rule_id, p: r.priority, title: title, body: body, evidence: evidence });
    });
    // LLM肉付け口（未接続時はルール文のまま）。非同期関数にも対応し、
    // タイムアウト・例外・数値照合ゲート不通過はすべてルールベース文へフォールバックする。
    if (typeof PenLLM.enhance === 'function') {
      await Promise.all(items.map(async function (item) {
        try {
          var out = await Promise.race([
            Promise.resolve(PenLLM.enhance(item)),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 4000); })
          ]);
          if (out && verifyNumbers(String(out.title) + ' ' + String(out.body), extractNumbers(item.title + ' ' + item.body + ' ' + item.evidence)).ok) {
            item.title = String(out.title); item.body = String(out.body); // プレーンテキストとして描画（下で全エスケープ）
          }
        } catch (e) { /* フォールバック＝ルールベース文 */ }
      }));
      if (seq !== penSeq) return; // 画面が別農場に切り替わっていたら破棄
    }
    items.sort(function (a, b) { return a.p - b.p; });
    var LV = { 1: { t: '最優先', c: '#c0392b' }, 2: { t: '次に効く', c: '#e08a3c' }, 3: { t: '維持・強み', c: '#1e8f5b' } };
    var votes = {}; penFeedback(f.id).forEach(function (r) { votes[r.rule_id] = r.vote; });
    var h = '';
    items.slice(0, 5).forEach(function (it) {
      h += '<div class="item" data-rule="' + it.rule_id + '"><span class="lv" style="background:' + LV[it.p].c + '">' + LV[it.p].t + '</span>' +
        '<div class="tx"><b>' + esc(it.title) + '</b><span>' + esc(it.body) + '</span>' +
        '<span class="ev">根拠：' + esc(it.evidence) + '</span>' +
        '<span class="fb"><button data-vote="useful"' + (votes[it.rule_id] === 'useful' ? ' class="on"' : '') + '>役に立った</button><button data-vote="off"' + (votes[it.rule_id] === 'off' ? ' class="on"' : '') + '>外れ</button></span>' +
        '</div></div>';
    });
    var box = document.getElementById('penBox');
    box.innerHTML = h || '<div class="note">特筆すべき指摘なし。</div>';
    // フィードバック：生成文と根拠をペアで保持（モックでは localStorage に保存）
    box.querySelectorAll('.fb button').forEach(function (btn) {
      btn.onclick = function () {
        var itemEl = btn.closest('.item'), ruleId = itemEl.getAttribute('data-rule');
        var it = items.filter(function (x) { return x.rule_id === ruleId; })[0];
        var log = [];
        try { log = JSON.parse(localStorage.getItem('penFeedback') || '[]'); } catch (e) { }
        log = log.filter(function (r) { return !(r.farm_id === f.id && r.rule_id === ruleId); });
        log.push({ farm_id: f.id, rule_id: ruleId, vote: btn.getAttribute('data-vote'), title: it.title, body: it.body, evidence: it.evidence, at: new Date().toISOString() });
        try { localStorage.setItem('penFeedback', JSON.stringify(log)); } catch (e) { }
        itemEl.querySelectorAll('.fb button').forEach(function (b) { b.classList.toggle('on', b === btn); });
      };
    });
  }

  // ================= 画面B：農場個票 =================
  function renderScore(f) {
    var h = '<thead><tr><th style="text-align:left">指標</th><th>データ数</th><th>順位</th><th>判定</th><th>位置</th><th>上位10%</th><th>上位25%</th><th>中央値</th><th>下位25%</th><th>下位10%</th><th>自農場</th></tr></thead><tbody>';
    function sec(ttl, keys) {
      h += '<tr><td colspan="11" style="text-align:left;background:var(--ink);color:#fff;font-weight:800;font-size:10.5px;letter-spacing:.06em">' + ttl + '</td></tr>';
      keys.forEach(function (m) {
        var s = benchOf(m, 'all'), g = gr(bf(f, m)), lo = s.lo10, hi = s.hi10;
        var pos = Math.max(2, Math.min(98, (f[m] - lo) / ((hi - lo) || 1) * 100)), mp = Math.max(0, Math.min(100, (s.med - lo) / ((hi - lo) || 1) * 100));
        h += '<tr><td class="k">' + METRICS[m].lb + ' <span style="font-weight:400;color:#8595a8">' + METRICS[m].u + (METRICS[m].dir < 0 ? ' ↓良' : '') + '</span></td>' +
          '<td>' + s.n + '</td><td>' + rk(f, m) + '</td>' +
          '<td style="background:' + gc(g) + ';color:#fff;font-weight:800">' + g + '</td>' +
          '<td><span class="mini"><span class="md" style="left:' + mp.toFixed(0) + '%"></span><span class="m" style="left:' + pos.toFixed(0) + '%;background:' + gc(g) + '"></span></span></td>' +
          '<td>' + fmt(s.hi10) + '</td><td>' + fmt(s.hi25) + '</td><td>' + fmt(s.med) + '</td><td>' + fmt(s.lo25) + '</td><td>' + fmt(s.lo10) + '</td>' +
          '<td class="self">' + f[m] + '</td></tr>';
      });
    }
    sec('生産', PROD); sec('経営', ECON);
    h += '</tbody>'; document.getElementById('scoreTbl').innerHTML = h;
  }

  function renderMgmt(f) {
    var keys = ['ebitdaM', 'invTurn', 'capTurn', 'equity', 'debtEbitda'], h = '';
    keys.forEach(function (m) {
      var s = STATS[m], g = gr(bf(f, m)), lo = s.min, hi = s.max;
      var w = Math.max(2, Math.min(100, (f[m] - lo) / ((hi - lo) || 1) * 100)), mp = (s.med - lo) / ((hi - lo) || 1) * 100;
      h += '<div class="bullet"><div class="bl"><span>' + METRICS[m].lb + ' <span style="color:var(--muted)">（中位 ' + fmt(s.med) + METRICS[m].u + (METRICS[m].dir < 0 ? '・低いほど良い' : '') + '）</span></span>' +
        '<b>' + f[m] + METRICS[m].u + ' <span class="gchip" style="display:inline-flex;width:17px;height:17px;font-size:10px;background:' + gc(g) + '">' + g + '</span></b></div>' +
        '<div class="bwrap"><div class="bfill" style="width:' + w.toFixed(0) + '%;background:' + gc(g) + '40"></div><div class="bmed" style="left:' + mp.toFixed(0) + '%"></div></div></div>';
    });
    h += '<div class="note">有利子負債/EBITDA＝借入を何年分のキャッシュで返せるか。5年超は借入余力が乏しいシグナル。素牛の仕入借入が膨らむ肉牛では最重要の安全性指標。</div>';
    document.getElementById('mgmtBox').innerHTML = h;
  }

  function renderFiscal(f) {
    var h = '<thead><tr><th>期</th><th>売上高(百万円)</th><th>EBITDA(百万円)</th><th>EBITDAマージン</th><th>有利子負債(百万円)</th><th>自己資本比率</th></tr></thead><tbody>';
    f.fiscal.forEach(function (r, i) {
      var last = i === f.fiscal.length - 1;
      h += '<tr' + (last ? ' style="font-weight:800;background:#eef3fb"' : '') + '><td class="k">FY' + r.fy + (last ? '（直近）' : '') + '</td><td>' + r.sales + '</td><td>' + fmt(r.ebitda) + '</td><td>' + r.ebitda_margin + '%</td><td>' + r.debt + '</td><td>' + r.equity_ratio + '%</td></tr>';
    });
    h += '</tbody>'; document.getElementById('fiscalTbl').innerHTML = h;
  }

  function renderTree(f) {
    var dv = ['carcassWt', 'price', 'mort', 'fatDays'], w = dv.slice().sort(function (a, b) { return bf(f, a) - bf(f, b); })[0];
    function n(m) {
      var isw = m === w;
      return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;margin:2px 0;font-weight:700;' +
        (isw ? 'background:#fdecea;border:1px solid #c0392b;color:#c0392b' : 'background:#fff;border:1px solid var(--line)') + '">' + METRICS[m].lb + ' ' + f[m] + METRICS[m].u + (isw ? ' ⚠弱点' : '') + '</span>';
    }
    document.getElementById('treeBox').innerHTML = '1頭当たり利益<br>├ 売上 ＝ ' + n('carcassWt') + ' × ' + n('price') + '<br>└ コスト側 ← ' + n('fatDays') + ' ・ ' + n('mort') +
      '<br><span style="font-size:11px;color:var(--muted)">※最も順位の低い要因を弱点として自動抽出。赤ペン先生の指摘と連動。</span>';
  }

  // 改善シミュレーション：1頭限界利益ベース（モデルは assets/sim_model.js、係数は data/params.json）
  function initSim(f, occ) {
    var sF = document.getElementById('sFat'), sM = document.getElementById('sMort'); sF.value = 0; sM.value = 0;
    var ovVal = ov(f);
    function man(yen) { var v = yen / 1e4; return (v < 0 ? '−' : '+') + '¥' + Math.round(Math.abs(v)).toLocaleString() + '万'; }
    function run() {
      var dF = +sF.value, dM = +sM.value / 10;
      document.getElementById('lbFat').textContent = dF; document.getElementById('lbMort').textContent = dM.toFixed(1);
      var r = window.SimModel.simulate(f, PARAMS, ovVal, dF, dM);
      var addTotal = r.addTurn + r.saved;
      var baseE = f.sales * 1e6 * f.ebitdaM / 100;                 // 現状EBITDA（円）
      var newE = baseE + r.netGain, newSales = f.sales * 1e6 + r.salesInc;
      var ne = newE / newSales * 100;
      var nd = newE > 0 ? (f.debt * 1e6 / newE) : Infinity;
      document.getElementById('oHead').textContent = '+' + Math.round(addTotal) + ' 頭/年';
      document.getElementById('oYen').innerHTML = man(r.netGain) + '<span style="font-size:11px">/年</span>';
      document.getElementById('oEbit').innerHTML = f.ebitdaM + '% <span class="up">→ ' + ne.toFixed(1) + '%</span>';
      document.getElementById('oDebt').innerHTML = f.debtEbitda + '年 <span class="up">→ ' + (isFinite(nd) ? nd.toFixed(1) : '—') + '年</span>';
      // 内訳表：売上増 − 素牛費増 − 飼料費増減 − その他変動費増 = 純増益（画面上で検算できる）
      document.getElementById('simBreak').innerHTML =
        '<thead><tr><th style="text-align:left">項目</th><th>金額/年</th><th style="text-align:left">内容</th></tr></thead><tbody>' +
        '<tr><td class="k">売上増</td><td>' + man(r.salesInc) + '</td><td style="text-align:left">追加出荷 ' + Math.round(addTotal) + '頭（回転' + Math.round(r.addTurn) + '＋救命' + Math.round(r.saved) + '）× 1頭売上 ' + Math.round(r.eco.s / 1e4) + '万円</td></tr>' +
        '<tr><td class="k">素牛費 増</td><td>' + man(-r.calfInc) + '</td><td style="text-align:left">回転増 ' + Math.round(r.addTurn) + '頭 × ' + Math.round(r.eco.calf / 1e4) + '万円/頭（救命牛は投下済みのため除く）</td></tr>' +
        '<tr><td class="k">飼料費 増減</td><td>' + man(-r.feedIncNet) + '</td><td style="text-align:left">既存出荷の短縮削減 − 追加飼養分</td></tr>' +
        '<tr><td class="k">その他変動費 増</td><td>' + man(-r.otherInc) + '</td><td style="text-align:left">' + Math.round(PARAMS.other_var_cost_yen_per_head / 1e4) + '万円/頭（敷料・診療 等）</td></tr>' +
        '<tr style="font-weight:800;background:#eef3fb"><td class="k">純増益（EBITDA増）</td><td>' + man(r.netGain) + '</td><td style="text-align:left">1頭限界利益率 ' + (r.marginRatio * 100).toFixed(1) + '%（薄利構造）</td></tr></tbody>';
      document.getElementById('simNote').innerHTML =
        '※係数は data/params.json のサンプル値（飼料費' + PARAMS.feed_yen_per_day_head + '円/日・頭）。素牛費は、1頭限界利益率が肉牛肥育の薄利レンジ' +
        '（売上比5〜18%）に収まるよう農場の枝肉売上から逆算した実効値（区分基準値は params.json の目安）。' +
        '救命牛の素牛費は死亡時点で投下済み（サンクコスト）のため、事故率低減の増益は「売上−飼料費」で近似。';
      var cw = document.getElementById('capWarn');
      if (r.blocked && dF > 0) { cw.style.display = 'block'; cw.textContent = '⚠ 稼働率' + occ + '%で満床のため増頭できません。肥育日数短縮の効果は飼料費削減のみ反映（追加出荷0頭）。'; }
      else cw.style.display = 'none';
    }
    sF.oninput = run; sM.oninput = run; run();
  }

  // ---- 時系列 ----
  var TSK = ['ebitdaM', 'price', 'invTurn', 'carcassWt', 'mort', 'fatDays', 'debtEbitda'];
  var tsCol = { ebitdaM: '#0e7c86', price: '#3b5bdb', invTurn: '#7048e8', carcassWt: '#e0932a', mort: '#c0392b', fatDays: '#5f7085', debtEbitda: '#b5179e' };
  var tsOn = { ebitdaM: 1, price: 1, invTurn: 1 };
  function initTsChk() {
    var box = document.getElementById('tsChk');
    TSK.forEach(function (m) {
      var l = document.createElement('label');
      l.innerHTML = '<input type="checkbox" ' + (tsOn[m] ? 'checked' : '') + ' data-m="' + m + '"><span class="dot" style="background:' + tsCol[m] + '"></span>' + METRICS[m].lb;
      box.appendChild(l);
    });
    box.querySelectorAll('input').forEach(function (i) { i.onchange = function () { tsOn[i.getAttribute('data-m')] = i.checked ? 1 : 0; drawTS(curFarm); }; });
  }
  function drawTS(fid) {
    var f = farms[fid], ser = [], lg = '';
    TSK.forEach(function (m) {
      if (!tsOn[m]) return;
      var rl = f.rl[m], b = rl[0] || 1, idx = rl.map(function (v) { return b ? v / b * 100 : 100; });
      ser.push({ data: idx, c: tsCol[m] });
      var ch = idx[idx.length - 1] - 100, good = METRICS[m].dir > 0 ? ch > 0 : ch < 0;
      lg += '<b><span class="dot" style="background:' + tsCol[m] + '"></span>' + METRICS[m].lb + ' 直近 ' + fmt(rl[rl.length - 1]) + METRICS[m].u + ' <span style="color:' + (good ? '#1e8f5b' : '#c0392b') + ';font-weight:800">' + (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%</span></b>';
    });
    if (!ser.length) { document.getElementById('tsPlot').innerHTML = '<div class="note">指標を1つ以上選択してください。</div>'; document.getElementById('tsLeg').innerHTML = ''; document.getElementById('tsCmt').innerHTML = ''; return; }
    lineChart(document.getElementById('tsPlot'), ser, { h: 250, base100: true });
    document.getElementById('tsLeg').innerHTML = lg;
    var msgs = [];
    TSK.forEach(function (m) {
      if (!tsOn[m]) return;
      var rl = f.rl[m], ch = (rl[rl.length - 1] / (rl[0] || 1) - 1) * 100, good = METRICS[m].dir > 0 ? ch > 0 : ch < 0;
      if (Math.abs(ch) >= 4) msgs.push('<b>' + METRICS[m].lb + '</b> は24ヶ月で ' + (ch >= 0 ? '+' : '') + ch.toFixed(1) + '% ' + (good ? '<span style="color:#1e8f5b;font-weight:700">改善</span>' : '<span class="warn">悪化</span>'));
    });
    document.getElementById('tsCmt').innerHTML = '<h4>▸ 自動コメント</h4><p>' + (msgs.length ? msgs.join('、') + '。' : '大きな変化なし（±4%以内）。') + '</p><p style="color:var(--muted)">単月の上下ではなく12ヶ月ローリングで見るため、季節変動を除いた「実力の推移」を表す。</p>';
  }

  var curFarm = 0;
  function renderFarm(fid) {
    curFarm = fid;
    var f = farms[fid];
    document.getElementById('selFarm').value = fid;
    document.getElementById('fName').textContent = f.name;
    document.getElementById('fMeta').textContent = f.ku + '経営 ／ ' + f.reg + ' ／ ' + f.band + '規模';
    var g = gr(ov(f)), e = document.getElementById('fGrade'); e.textContent = g; e.style.background = gc(g);
    var occ = Math.round(f.head / f.barnCap * 100), perW = Math.round(f.head / f.workers);
    document.getElementById('ctxBox').innerHTML =
      '<div><div class="cl">牛舎キャパ稼働率</div><div class="cv">' + occ + '% <small>（' + f.head + '/' + f.barnCap + '頭）</small></div></div>' +
      '<div><div class="cl">労働力</div><div class="cv">' + f.workers + '人 <small>（1人あたり ' + perW + '頭）</small></div></div>' +
      '<div><div class="cl">素牛の調達</div><div class="cv">' + f.calfSrc + '</div></div>' +
      '<div><div class="cl">飼料自給率</div><div class="cv">' + f.feedSelf + '%</div></div>' +
      '<div><div class="cl">有利子負債</div><div class="cv">' + f.debt + '百万円 <small>（EBITDAの' + f.debtEbitda + '年分）</small></div></div>' +
      '<div><div class="cl">経営者・後継者</div><div class="cv">' + f.age + '歳 <small>／ 後継者' + f.succ + '</small></div></div>';
    renderPen(f); renderScore(f); renderMgmt(f); renderFiscal(f); renderTree(f); initSim(f, occ); drawTS(fid);
  }

  // ================= 受け入れチェック（コンソールで BeefBenchmark.runChecks()） =================
  // A-1: 全農場×全スライダー位置で 1頭限界利益率が5〜18%／内訳の加減算一致／満床農場の増頭0／
  //      レバー別の仕様式（①(a)+①(b)+②）による独立再計算と純増益が一致
  // A-2: 格差（p90−p10相当）が24ヶ月で拡大（EBITDAマージン+10%以上）＋順位の安定（不自然な逆転がない）
  // A-3: デフォルト農場（選定ロジックを独立に再実行）に判定AとD〜Fが混在し、最優先の赤ペン指摘が出る
  function runChecks() {
    var fails = [];
    farms.forEach(function (f) {
      var o = ov(f), occRaw = f.head / f.barnCap * 100;
      for (var dd = 0; dd <= 90; dd += 5) for (var dm = 0; dm <= 3; dm += 0.5) {
        var r = window.SimModel.simulate(f, PARAMS, o, dd, dm);
        if (r.marginRatio < 0.05 - 1e-9 || r.marginRatio > 0.18 + 1e-9) fails.push('A-1 限界利益率範囲外 ' + f.name + ' dd=' + dd + ' → ' + (r.marginRatio * 100).toFixed(1) + '%');
        if (Math.abs(r.salesInc - r.calfInc - r.feedIncNet - r.otherInc - r.netGain) > 1) fails.push('A-1 内訳不一致 ' + f.name);
        if (occRaw >= PARAMS.capacity_block_occupancy_pct && dd > 0 && r.addTurn !== 0) fails.push('A-1 満床でも増頭 ' + f.name);
        // 独立再計算：修正仕様の3式（①(a)飼料費削減＋①(b)追加出荷×1頭限界利益＋②救命×(売上−飼料費)）を
        // simulate() の内部変数を使わずに組み直し、純増益と突合する
        var E = window.SimModel.farmEconomy(f, PARAMS, o);
        var bs = f.head * 365 / f.fatDays * (1 - f.mort / 100);
        var effDm = Math.min(dm, Math.max(0, f.mort - 0.3));
        var addT = (occRaw >= PARAMS.capacity_block_occupancy_pct || dd === 0) ? 0 : f.head * 365 / (f.fatDays - dd) * (1 - f.mort / 100) - bs;
        var expected = bs * dd * E.feed
          + addT * (E.s - E.calf - (f.fatDays - dd) * E.feed - E.other)
          + f.head * 365 / f.fatDays * (effDm / 100) * (E.s - (f.fatDays - dd) * E.feed);
        if (Math.abs(expected - r.netGain) > 1) fails.push('A-1 独立再計算と不一致 ' + f.name + ' dd=' + dd + ' dm=' + dm);
      }
    });
    function gapGrowth(m) { var g0 = gapAt(0, m), g1 = gapAt(NP - 1, m); var d0 = Math.abs(g0.hi - g0.lo), d1 = Math.abs(g1.hi - g1.lo); return d1 / d0 - 1; }
    if (gapGrowth('ebitdaM') < 0.10) fails.push('A-2 EBITDAマージン格差拡大 ' + (gapGrowth('ebitdaM') * 100).toFixed(1) + '% (<10%)');
    if (gapGrowth('price') <= 0) fails.push('A-2 枝肉単価の格差が拡大していない');
    if (gapGrowth('invTurn') <= 0) fails.push('A-2 在庫回転の格差が拡大していない');
    // 順位の安定性：24ヶ月前と直近のローリング値の順位相関が高い（トレンドが不自然な逆転を生んでいない）
    ['ebitdaM', 'price', 'invTurn'].forEach(function (m) {
      function ranksAt(i) { var v = farms.map(function (f) { return f.rl[m][i]; }); var idx = v.map(function (x, k) { return [x, k]; }).sort(function (a, b) { return a[0] - b[0]; }); var rr = []; idx.forEach(function (pair, pos) { rr[pair[1]] = pos; }); return rr; }
      var r0 = ranksAt(0), r1 = ranksAt(NP - 1), n = r0.length, num = 0;
      for (var k = 0; k < n; k++) { var d = r0[k] - r1[k]; num += d * d; }
      var rho = 1 - 6 * num / (n * (n * n - 1)); // スピアマン順位相関
      if (rho < 0.7) fails.push('A-2 順位が不自然に入れ替わっている ' + m + ' (ρ=' + rho.toFixed(2) + ')');
    });
    var f0 = pickDefaultFarm(), grades = SCORE.map(function (m) { return gr(bf(f0, m)); });
    if (grades.indexOf('A') < 0 && grades.indexOf('B') < 0) fails.push('A-3 デフォルト農場に上位判定がない');
    if (!grades.some(function (g) { return 'DEF'.indexOf(g) >= 0; })) fails.push('A-3 デフォルト農場に下位判定がない');
    var pctx = buildPenContext(f0);
    if (!RULES.some(function (r) { return r.priority === 1 && evalCond(r.condition, pctx); })) fails.push('A-3 デフォルト農場に最優先指摘が出ない');
    return {
      pass: fails.length === 0, failures: fails, defaultFarm: f0.name, defaultGrades: grades.join(''),
      gapGrowthPct: { ebitdaM: +(gapGrowth('ebitdaM') * 100).toFixed(1), price: +(gapGrowth('price') * 100).toFixed(1), invTurn: +(gapGrowth('invTurn') * 100).toFixed(1) }
    };
  }

  // 個票のデフォルト農場＝上位判定（A/B）と下位判定（D〜F）の混在度が最大の農場。
  // 「全部A」の優等生でも「全部F」の脱落農場でもなく、強みと弱みが混在するギザギザな
  // プロファイル（PigINFO 日高牧場型：量は出るが単価で負ける、等）を最初に見せる。
  function pickDefaultFarm() {
    var bestMix = -1, best = farms[0];
    farms.forEach(function (f) {
      var good = 0, bad = 0, ranks = [];
      SCORE.forEach(function (m) {
        var g = gr(bf(f, m)); ranks.push(rk(f, m));
        if (g === 'A' || g === 'B') good++; else if (g !== 'C') bad++;
      });
      var mix = good * bad * 1000 + (Math.max.apply(0, ranks) - Math.min.apply(0, ranks));
      if (mix > bestMix) { bestMix = mix; best = f; }
    });
    return best;
  }

  // ================= ルーティング・初期化 =================
  function setTab(v) {
    A.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-v') === v); });
    document.getElementById('viewOv').style.display = v === 'ov' ? '' : 'none';
    document.getElementById('viewFm').style.display = v === 'fm' ? '' : 'none';
  }
  function route() {
    var m = location.hash.match(/^#\/farm\/(\d+)/);
    if (m && farms[+m[1]]) { setTab('fm'); renderFarm(+m[1]); }
    else setTab('ov');
  }

  function init() {
    document.getElementById('loading').style.display = 'none';

    curFarm = pickDefaultFarm().id;
    window.BeefBenchmark.runChecks = runChecks;

    var selGap = document.getElementById('selGap'), selStrat = document.getElementById('selStrat');
    SCORE.forEach(function (m) { [selGap, selStrat].forEach(function (sel) { var o = document.createElement('option'); o.value = m; o.textContent = METRICS[m].lb; sel.appendChild(o); }); });
    selGap.value = 'ebitdaM'; selStrat.value = 'ebitdaM';
    selGap.onchange = drawGap; selStrat.onchange = drawStrat;

    var selX = document.getElementById('selX'), selY = document.getElementById('selY');
    AXES.forEach(function (m) { [selX, selY].forEach(function (sel) { var o = document.createElement('option'); o.value = m; o.textContent = METRICS[m].lb; sel.appendChild(o); }); });
    selX.value = st.x; selY.value = st.y;
    selX.onchange = function () { st.x = selX.value; drawSc(); }; selY.onchange = function () { st.y = selY.value; drawSc(); };
    function seg(idr, key, at) {
      var el = document.getElementById(idr);
      el.querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { el.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); st[key] = b.getAttribute(at); drawSc(); };
      });
    }
    seg('segKu', 'ku', 'data-k'); seg('segSc', 'sc', 'data-s'); seg('segCol', 'col', 'data-c');

    var selFarm = document.getElementById('selFarm');
    farms.forEach(function (f) { var o = document.createElement('option'); o.value = f.id; o.textContent = f.name + '（' + f.ku + '・' + f.reg + '・' + f.band + '）'; selFarm.appendChild(o); });
    selFarm.onchange = function () { location.hash = '#/farm/' + selFarm.value; };

    A.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () { location.hash = t.getAttribute('data-v') === 'fm' ? '#/farm/' + curFarm : '#/'; };
    });
    initTsChk();

    // 初回説明の閉じる（次回以降も閉じたまま）
    var intro = document.getElementById('intro');
    try { if (localStorage.getItem('introClosed')) intro.style.display = 'none'; } catch (e) { }
    document.getElementById('introClose').onclick = function () { intro.style.display = 'none'; try { localStorage.setItem('introClosed', '1'); } catch (e) { } };

    renderKpis(); drawGap(); drawStrat(); drawSc();
    window.addEventListener('hashchange', route);
    route();
  }
})();
