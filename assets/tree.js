/* 生産性ツリー（E系）— 粗利益（飼養1頭/年）を頂点に要因を分解する樹形図。
 * JASV（豚）の生産性ツリーに対応する画面。各ノードに 値・順位・A〜F判定 を付け、
 * 自分の弱点がどの経路で粗利益に効いているかを線で追えるようにする。
 *
 * ノード定義は data/tree.json（外部化）。値の計算は computeAll()：
 *   子ノードの「表示値」から親を計算する（D-6と同じ流儀）。丸め後も画面上の検算が厳密に一致する。
 * ノードの状態は3種類：
 *   measured＝実測（既存指標。順位・判定は成績表と同じ関数で算出）
 *   derived ＝導出（全45農場を同じ式で計算した分布から順位・判定。分位点は data/tree_benchmarks.json）
 *   missing ＝未取得（グレー＋「実データで取得」バッジ。順位・判定を出さない。ホバーで理由）
 * グレーのノードは「組合がこれから集めるべきデータ」の設計図——決算書だけでは灰色が埋まらないことを示す。
 */
(function (global) {
  'use strict';

  var TREE = null, TB = null, ctx = null; // ctx = { farms, PARAMS, rk, bf, gr, gc, statN }
  var DERIVED = ['gp', 'sales', 'shipRate', 'revPerHead', 'varCost', 'calfCostY', 'feedCostY', 'feedPerHead', 'otherCostY'];
  var dist = {}; // derived node → 全45農場の表示値（昇順）

  function quantile(s, q) { var p = (s.length - 1) * q, b = Math.floor(p), r = p - b; return s[b + 1] !== undefined ? s[b] + r * (s[b + 1] - s[b]) : s[b]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // 子ノードの表示値から親を計算する（唯一の計算経路。app と runChecks とベンチ生成が共用する）
  function computeAll(f, P) {
    var v = {};
    v.fatDays = f.fatDays; v.mort = f.mort; v.carcassWt = f.carcassWt; v.price = f.price;
    v.shipRate = Math.round(365 / v.fatDays * (1 - v.mort / 100) * 1000) / 1000; // 出荷頭数（飼養1頭/年）3桁
    v.revPerHead = v.carcassWt * v.price;                                        // 枝肉販売額（/頭）＝整数×整数
    v.sales = Math.round(v.shipRate * v.revPerHead);                             // 販売額（飼養1頭/年）
    v.calfCostPerHead = f.calfCostEff;                                           // 実効素牛費（未取得扱い・逆算値）
    v.feedPerDay = P.feed_yen_per_day_head;                                      // 未取得（全農場共通550円）
    v.feedPerHead = v.fatDays * v.feedPerDay;                                    // 1頭飼料費＝整数×整数
    v.calfCostY = Math.round(v.calfCostPerHead * v.shipRate);
    v.feedCostY = Math.round(v.feedPerHead * v.shipRate);
    v.otherCostY = Math.round(P.other_var_cost_yen_per_head * v.shipRate);
    v.varCost = v.calfCostY + v.feedCostY + v.otherCostY;                        // 整数の和
    v.gp = v.sales - v.varCost;                                                  // 整数の差
    return v;
  }

  function buildDist() {
    dist = {};
    DERIVED.forEach(function (id) { dist[id] = []; });
    ctx.farms.forEach(function (f) {
      var v = computeAll(f, ctx.PARAMS);
      DERIVED.forEach(function (id) { dist[id].push(v[id]); });
    });
    DERIVED.forEach(function (id) { dist[id].sort(function (a, b) { return a - b; }); });
  }

  function nodeById(id) { return TREE.nodes.filter(function (n) { return n.node_id === id; })[0]; }
  function dirOf(n) { return n.kind === 'measured' ? undefined : n.dir; }

  // 導出ノードの順位・判定（成績表と同じ閾値：A=上位10% … F=下位10%）
  function derivedRank(id, val, dir) {
    var a = dist[id], c = 1, i;
    for (i = 0; i < a.length; i++) if (dir > 0 ? a[i] > val : a[i] < val) c++;
    return c;
  }
  function derivedPct(id, val, dir) {
    var a = dist[id], c = 0, i;
    for (i = 0; i < a.length; i++) if (dir > 0 ? a[i] <= val : a[i] >= val) c++;
    return c / a.length;
  }
  function grOf(p) { return p >= .9 ? 'A' : p >= .75 ? 'B' : p >= .5 ? 'C' : p >= .25 ? 'D' : p >= .1 ? 'E' : 'F'; }

  function fmtVal(v, dec) {
    if (dec === 3) return v.toFixed(3);
    if (dec === 1) return (+v).toFixed(1);
    return Math.round(v).toLocaleString();
  }

  // ノードの表示情報（値・順位・判定・状態）をまとめる
  function nodeInfo(f, values, n) {
    var info = { id: n.node_id, label: n.label, unit: n.unit, kind: n.kind, hover: n.hover, formulaText: n.formulaText, noGrade: !!n.noGrade };
    if (n.kind === 'measured') {
      info.value = f[n.metric]; info.text = fmtVal(info.value, n.dec);
      info.rank = ctx.rk(f, n.metric); info.n = ctx.statN(n.metric, f); // F-1: shipPerYear は規模帯内のn
      info.grade = ctx.gr(ctx.bf(f, n.metric));
    } else if (n.kind === 'derived' && !n.noGrade) {
      info.value = values[n.node_id]; info.text = fmtVal(info.value, n.dec);
      info.rank = derivedRank(n.node_id, info.value, n.dir); info.n = ctx.farms.length;
      info.grade = grOf(derivedPct(n.node_id, info.value, n.dir));
    } else if (n.kind === 'derived') {
      // F-4: コスト系ノードは値と算出式のみ表示し、優劣を付けない（回転が速い農場ほど年間コストは増え、
      // 飼料費は数式上ほぼ事故率の関数になるため。JASVもコストの絶対額に判定を付けていない）
      info.value = values[n.node_id]; info.text = fmtVal(info.value, n.dec);
      info.rank = null; info.grade = null;
    } else { // missing：値は出すが順位・判定は出さない（データがない＝グレー）
      info.value = values[n.node_id]; info.text = fmtVal(info.value, n.dec);
      info.rank = null; info.grade = null;
    }
    return info;
  }

  function render(f, plotEl, cmtEl, noteEl) {
    // 繁殖はツリーを出さない（枝肉系指標が簡易表示のため。次段階で繁殖版を追加）
    if (f.ku === '繁殖') {
      plotEl.innerHTML = '<div class="note" style="padding:24px 8px;font-size:13px">繁殖経営の生産性ツリーは次段階で追加します（初期版は肥育フォーカス。繁殖の成績は「② 農場個票」の繁殖セクションへ）。</div>';
      cmtEl.innerHTML = ''; noteEl.innerHTML = '';
      return;
    }
    var P = ctx.PARAMS, L = TREE.layout, values = computeAll(f, P);
    var W = L.w, H = L.h, NW = L.nodeW, NH = L.nodeH;
    var infos = {}; TREE.nodes.forEach(function (n) { infos[n.node_id] = nodeInfo(f, values, n); });
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="min-width:1050px">';
    // 枝（実線＝計算の親子、破線＝傍系）。演算子チップを中点に置く
    TREE.nodes.forEach(function (n) {
      var to = n.parent || n.anchor; if (!to) return;
      var p = nodeById(to), side = !!n.anchor;
      var x1, y1, x2, y2;
      if (n.x >= p.x + NW) { x1 = p.x + NW; x2 = n.x; } else { x1 = p.x; x2 = n.x + NW; }
      y1 = p.y + NH / 2; y2 = n.y + NH / 2;
      var mx = (x1 + x2) / 2;
      s += '<path d="M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + x2 + '" fill="none" stroke="' + (side ? '#c3ccd8' : '#9fb0c4') + '" stroke-width="1.6"' + (side ? ' stroke-dasharray="4 4"' : '') + '/>';
      if (!side && n.op) {
        s += '<circle cx="' + mx + '" cy="' + y2 + '" r="10" fill="#fff" stroke="#9fb0c4"/>' +
          '<text x="' + mx + '" y="' + (y2 + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#5f7085">' + n.op + '</text>';
      }
    });
    // ノード
    TREE.nodes.forEach(function (n) {
      var i = infos[n.node_id], miss = n.kind === 'missing', side = !!n.anchor;
      var bg = miss ? '#eef1f4' : '#fff', border = miss ? '#c3ccd8' : (side ? '#d5dce6' : '#9fb0c4');
      s += '<g>';
      if (i.hover || i.formulaText) s += '<title>' + esc((i.hover ? i.hover : '＝ ' + i.formulaText)) + '</title>';
      s += '<rect x="' + n.x + '" y="' + n.y + '" width="' + NW + '" height="' + NH + '" rx="9" fill="' + bg + '" stroke="' + border + '" stroke-width="' + (side ? 1 : 1.4) + '"' + (side ? ' stroke-dasharray="3 3"' : '') + '/>';
      s += '<text x="' + (n.x + 10) + '" y="' + (n.y + 17) + '" font-size="10.5" font-weight="700" fill="' + (miss ? '#8595a8' : '#5f7085') + '">' + esc(n.label) + '</text>';
      s += '<text x="' + (n.x + 10) + '" y="' + (n.y + 38) + '" font-size="15" font-weight="800" fill="' + (miss ? '#8595a8' : '#0f1e33') + '">' + i.text + '<tspan font-size="10" font-weight="600" fill="#8595a8"> ' + esc(n.unit) + '</tspan></text>';
      if (miss) {
        s += '<rect x="' + (n.x + 10) + '" y="' + (n.y + 44) + '" width="86" height="15" rx="7" fill="#8a6d00" opacity="0.14"/>' +
          '<text x="' + (n.x + 53) + '" y="' + (n.y + 55) + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="#8a6d00">実データで取得</text>';
      } else if (i.noGrade) {
        // F-4: 優劣を付けないコスト系ノード。グレー（データなし）とは別の見た目＝判定バッジ位置に「—」
        s += '<text x="' + (n.x + 10) + '" y="' + (n.y + 56) + '" font-size="9.5" fill="#8595a8">優劣を付けない（コストの絶対額）</text>';
        s += '<rect x="' + (n.x + NW - 30) + '" y="' + (n.y + 38) + '" width="20" height="20" rx="5" fill="none" stroke="#c3ccd8"/>' +
          '<text x="' + (n.x + NW - 20) + '" y="' + (n.y + 52.5) + '" text-anchor="middle" font-size="11.5" font-weight="800" fill="#8595a8">—</text>';
      } else {
        s += '<text x="' + (n.x + 10) + '" y="' + (n.y + 56) + '" font-size="10" fill="#8595a8">' + i.rank + '位/' + i.n + '農場' + (n.metric === 'shipPerYear' ? '・同規模帯' : '') + '</text>';
        s += '<rect x="' + (n.x + NW - 30) + '" y="' + (n.y + 38) + '" width="20" height="20" rx="5" fill="' + ctx.gc(i.grade) + '"/>' +
          '<text x="' + (n.x + NW - 20) + '" y="' + (n.y + 52.5) + '" text-anchor="middle" font-size="11.5" font-weight="800" fill="#fff">' + i.grade + '</text>';
      }
      if (n.kind === 'derived' && n.formulaText) {
        s += '<text x="' + (n.x + 10) + '" y="' + (n.y - 5) + '" font-size="9" fill="#9fb0c4">＝ ' + esc(n.formulaText) + '</text>';
      }
      s += '</g>';
    });
    s += '</svg>';
    // F-5: 一貫の注記はツリーの直上に出す（脚注では見落とされたため）
    plotEl.innerHTML = (f.ku === '一貫' ? '<div class="note" style="margin:0 0 6px"><b>一貫経営：</b>素牛費は自家育成原価相当として表示（市場購入価格ではない）。</div>' : '') + s;

    // 自動コメント：主系列で最も判定の低いノードと、その粗利益への経路（数値・順位を必ず併記）
    // F-4: 判定を持つノードだけから選ぶ（優劣を付けないコスト系・未取得は対象外）
    var mains = TREE.nodes.filter(function (n) { return !n.anchor && n.kind !== 'missing' && !n.noGrade && n.node_id !== 'gp'; });
    function pctOf(n) { var i = infos[n.node_id]; return n.kind === 'measured' ? ctx.bf(f, n.metric) : derivedPct(n.node_id, i.value, n.dir); }
    var worst = mains.slice().sort(function (a, b) { return pctOf(a) - pctOf(b); })[0];
    var best = mains.slice().sort(function (a, b) { return pctOf(b) - pctOf(a); })[0];
    function pathTo(n) { var names = []; var cur = n; while (cur && cur.parent) { cur = nodeById(cur.parent); names.push(cur.label.replace(/（.*?）/, '')); } return names.join(' → '); }
    var wi = infos[worst.node_id], bi = infos[best.node_id];
    var h = '<h4>▸ 自動コメント</h4>' +
      '<p>最も判定が低いのは <b>' + esc(worst.label) + '</b>（' + wi.text + worst.unit + '・' + wi.rank + '位/' + wi.n + '農場・判定' + wi.grade + '）。<b>' + esc(pathTo(worst)) + '</b> の経路で粗利益を押し下げている。</p>' +
      '<p>強みは <b>' + esc(best.label) + '</b>（' + bi.text + best.unit + '・' + bi.rank + '位/' + bi.n + '農場・判定' + bi.grade + '）。ここは維持し、資源は弱点側の改善に寄せる。</p>' +
      '<p style="color:var(--muted)">グレーのノード（実効素牛費・日当たり飼料費）は未取得のサンプル値。実データ接続で埋まる＝組合がこれから集めるデータの設計図。</p>';
    cmtEl.innerHTML = h;

    noteEl.innerHTML = '<b>粗利益＝販売額−変動費。労務費・減価償却などの固定費は含まない（EBITDAとは別の指標）。</b>' +
      ' 単位の正規化＝<b>飼養1頭あたり年間</b>（牛房1枠あたり年間。豚の「母豚1頭あたり年間」に対応）。実線＝計算の親子（演算子つき）、破線＝傍系（参考指標。計算には使わない。増体DGは枝肉重量との整合データ＝歩留・生体重が未取得のため傍系）。' +
      ' <b>コストの絶対額（変動費・素牛費・飼料費・1頭飼料費・その他変動費）には優劣を付けない</b>（回転が速い農場ほど年間のコストは増えるため）。効率は売上高飼料費比率と粗利益で見る。' +
      ' 年間出荷頭数は同じ規模帯の中で比較（規模の大小は経営の巧拙ではないため）。' +
      (f.ku === '一貫' ? ' <b>一貫経営のため、素牛費は自家育成原価相当として表示している。</b>' : '') +
      ' 判定：A=上位10%／B=〜25%／C=〜50%／D=〜75%／E=〜90%／F=下位10%。';
  }

  // E系の受け入れ検査（app.js の runChecks から呼ばれる）
  function runChecksTree() {
    var fails = [], P = ctx.PARAMS;
    if (!TREE || !TB) return ['E ツリー定義または tree_benchmarks が未ロード'];
    ctx.farms.forEach(function (f) {
      if (f.ku === '繁殖') return; // ツリー対象は肥育・一貫（分布は全45農場で構築済み）
      var v = computeAll(f, P);
      // E-1: 子ノードの表示値から親を再計算して一致（独立に式を書き下す）
      if (v.revPerHead !== v.carcassWt * v.price) fails.push('E-1 枝肉販売額 不一致 ' + f.name);
      if (v.shipRate !== Math.round(365 / v.fatDays * (1 - v.mort / 100) * 1000) / 1000) fails.push('E-1 出荷頭数 不一致 ' + f.name);
      if (v.sales !== Math.round(v.shipRate * v.revPerHead)) fails.push('E-1 販売額 不一致 ' + f.name);
      if (v.feedPerHead !== v.fatDays * v.feedPerDay) fails.push('E-1 1頭飼料費 不一致 ' + f.name);
      if (v.calfCostY !== Math.round(v.calfCostPerHead * v.shipRate)) fails.push('E-1 素牛費 不一致 ' + f.name);
      if (v.feedCostY !== Math.round(v.feedPerHead * v.shipRate)) fails.push('E-1 飼料費 不一致 ' + f.name);
      if (v.otherCostY !== Math.round(P.other_var_cost_yen_per_head * v.shipRate)) fails.push('E-1 その他変動費 不一致 ' + f.name);
      if (v.varCost !== v.calfCostY + v.feedCostY + v.otherCostY) fails.push('E-1 変動費 不一致 ' + f.name);
      if (v.gp !== v.sales - v.varCost) fails.push('E-1 粗利益 不一致 ' + f.name);
      // 未取得ノードに順位・判定が付いていないこと
      ['calfCostPerHead', 'feedPerDay'].forEach(function (id) {
        var i = nodeInfo(f, v, nodeById(id));
        if (i.rank !== null || i.grade !== null) fails.push('E-1 未取得ノードに順位/判定 ' + id);
      });
      // F-4: コスト系5ノードに順位・判定が付いていないこと（値と式は表示する）
      ['varCost', 'calfCostY', 'feedCostY', 'feedPerHead', 'otherCostY'].forEach(function (id) {
        var i = nodeInfo(f, v, nodeById(id));
        if (i.rank !== null || i.grade !== null) fails.push('F-4 コスト系ノードに順位/判定 ' + id);
        if (i.value === undefined || i.text === undefined) fails.push('F-4 コスト系ノードの値が非表示 ' + id);
      });
    });
    // ツリーの carcassWt の計算経路に dg が含まれない（dgは傍系＝anchor接続のみ）
    var dgNode = nodeById('dg');
    if (!dgNode.anchor || dgNode.parent) fails.push('E-1 dg が傍系になっていない');
    // tree_benchmarks.json の分位点が、全45農場の導出値から計算した分位点と一致（閾値定義 10/25/50/75/90）
    DERIVED.forEach(function (id) {
      var row = TB.filter(function (r) { return r.node_id === id; })[0];
      if (!row) { fails.push('E tree_benchmarks に ' + id + ' がない'); return; }
      if (row.n !== ctx.farms.length) fails.push('E tree_benchmarks の n 不一致 ' + id);
      [['p10', .10], ['p25', .25], ['p50', .50], ['p75', .75], ['p90', .90]].forEach(function (pq) {
        var want = Math.round(quantile(dist[id], pq[1]) * 1000) / 1000;
        if (Math.abs(row[pq[0]] - want) > 0.0011) fails.push('E tree_benchmarks 分位点不一致 ' + id + ' ' + pq[0]);
      });
    });
    return fails;
  }

  global.TreeView = {
    init: function (c, treeJson, tbJson) { ctx = c; TREE = treeJson; TB = tbJson; buildDist(); },
    computeAll: computeAll,
    DERIVED: DERIVED,
    quantile: quantile,
    distOf: function (id) { return dist[id]; },
    render: render,
    runChecksTree: runChecksTree
  };
})(typeof window !== 'undefined' ? window : globalThis);
