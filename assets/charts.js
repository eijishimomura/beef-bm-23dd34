/* SVG チャート描画（ワイヤーv2から抽出）。依存ライブラリなし。 */
(function (global) {
  'use strict';

  function fmt(v) { return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10; }

  // 折れ線（格差の推移・個票の時系列で共用）
  function lineChart(el, series, opts) {
    opts = opts || {};
    var W = 800, H = opts.h || 260, p = { l: 52, r: 16, t: 14, b: 26 }, all = [];
    series.forEach(function (s) { all = all.concat(s.data); });
    var mn = Math.min.apply(0, all), mx = Math.max.apply(0, all), pd = (mx - mn) * 0.12 || 1;
    mn -= pd; mx += pd;
    var n = series[0].data.length;
    function X(i) { return p.l + i / (n - 1) * (W - p.l - p.r); }
    function Y(v) { return H - p.b - (v - mn) / (mx - mn) * (H - p.t - p.b); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    s += '<rect x="' + p.l + '" y="' + p.t + '" width="' + (W - p.l - p.r) + '" height="' + (H - p.t - p.b) + '" fill="#fbfcfe" stroke="#eef2f7"/>';
    for (var g = 0; g <= 3; g++) {
      var vv = mn + (mx - mn) * g / 3, yy = Y(vv);
      s += '<line x1="' + p.l + '" y1="' + yy.toFixed(1) + '" x2="' + (W - p.r) + '" y2="' + yy.toFixed(1) + '" stroke="#eef2f7"/>';
      s += '<text x="' + (p.l - 6) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#8595a8">' + fmt(vv) + '</text>';
    }
    if (opts.base100) {
      var y1 = Y(100);
      s += '<line x1="' + p.l + '" y1="' + y1.toFixed(1) + '" x2="' + (W - p.r) + '" y2="' + y1.toFixed(1) + '" stroke="#c7d2e0" stroke-dasharray="4 3"/>';
    }
    series.forEach(function (sr) {
      var d = '';
      sr.data.forEach(function (v, i) { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' '; });
      s += '<path d="' + d + '" fill="none" stroke="' + sr.c + '" stroke-width="' + (sr.w || 2.2) + '" stroke-linejoin="round"/>';
      s += '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(sr.data[n - 1]).toFixed(1) + '" r="3.4" fill="' + sr.c + '"/>';
    });
    s += '<text x="' + p.l + '" y="' + (H - 8) + '" font-size="10" fill="#8595a8">24ヶ月前</text>';
    s += '<text x="' + (W - p.r) + '" y="' + (H - 8) + '" text-anchor="end" font-size="10" fill="#8595a8">直近</text></svg>';
    el.innerHTML = s;
  }

  // 散布図（4象限・中央値破線・異常値の輪取り）。イベント配線は呼び出し側。
  // cfg: { points:[{id,x,y,r,color,outline,label}], xMed,yMed, xLabel,yLabel, quad:{tr,tl,br,bl} }
  function scatterChart(el, cfg) {
    var W = 800, H = 440, p = { l: 58, r: 22, t: 20, b: 44 };
    var xn = cfg.xMin, xx = cfg.xMax, yn = cfg.yMin, yx = cfg.yMax;
    function X(v) { return p.l + (v - xn) / (xx - xn) * (W - p.l - p.r); }
    function Y(v) { return H - p.b - (v - yn) / (yx - yn) * (H - p.t - p.b); }
    var xp = X(cfg.xMed), yp = Y(cfg.yMed), q = '#9fb0c4';
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    s += '<rect x="' + p.l + '" y="' + p.t + '" width="' + (W - p.l - p.r) + '" height="' + (H - p.t - p.b) + '" fill="#fbfcfe" stroke="#eef2f7"/>';
    s += '<line x1="' + xp + '" y1="' + p.t + '" x2="' + xp + '" y2="' + (H - p.b) + '" stroke="#c7d2e0" stroke-dasharray="5 4"/>';
    s += '<line x1="' + p.l + '" y1="' + yp + '" x2="' + (W - p.r) + '" y2="' + yp + '" stroke="#c7d2e0" stroke-dasharray="5 4"/>';
    s += '<text x="' + ((p.l + W - p.r) / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#5f7085">' + cfg.xLabel + ' →</text>';
    s += '<text transform="translate(15,' + ((p.t + H - p.b) / 2) + ') rotate(-90)" text-anchor="middle" font-size="12" font-weight="700" fill="#5f7085">' + cfg.yLabel + ' →</text>';
    cfg.points.forEach(function (pt) {
      var cx = X(pt.x), cy = Y(pt.y);
      s += '<circle class="bub" data-id="' + pt.id + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + pt.r.toFixed(1) + '" fill="' + pt.color + '" fill-opacity=".62" stroke="' + (pt.outline ? '#0f1e33' : pt.color) + '" stroke-width="' + (pt.outline ? 2 : 1) + '" style="cursor:pointer"/>';
    });
    // 異常値ラベル：バウンディングボックスの衝突を検出し、上→下の順に退避。それでも重なる場合は非表示（ホバーで名称表示）
    var placed = [];
    function overlaps(b) { return placed.some(function (o) { return !(b.x2 < o.x1 || b.x1 > o.x2 || b.y2 < o.y1 || b.y1 > o.y2); }); }
    cfg.points.filter(function (pt) { return pt.outline; })
      .sort(function (a, b) { return Y(a.y) - Y(b.y); })
      .forEach(function (pt) {
        var cx = X(pt.x), cy = Y(pt.y), w = pt.label.length * 11 + 6, cand = [cy - pt.r - 5, cy + pt.r + 14];
        for (var i = 0; i < cand.length; i++) {
          var box = { x1: cx - w / 2, x2: cx + w / 2, y1: cand[i] - 11, y2: cand[i] + 2 };
          if (box.y1 < p.t || box.y2 > H - p.b || overlaps(box)) continue;
          placed.push(box);
          s += '<text x="' + cx.toFixed(1) + '" y="' + cand[i].toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#0f1e33" stroke="#fff" stroke-width="3" paint-order="stroke">' + pt.label + '</text>';
          break;
        }
      });
    // 象限ラベルはバブルの上に白ハロー付きで重ね、常に読めるようにする
    function quadText(x, y, anchor, txt) {
      return '<text x="' + x + '" y="' + y + '" text-anchor="' + anchor + '" font-size="11" fill="' + q + '" stroke="#fbfcfe" stroke-width="3.5" paint-order="stroke">' + txt + '</text>';
    }
    s += quadText(W - p.r - 6, p.t + 16, 'end', cfg.quad.tr);
    s += quadText(p.l + 6, p.t + 16, 'start', cfg.quad.tl);
    s += quadText(W - p.r - 6, H - p.b - 8, 'end', cfg.quad.br);
    s += quadText(p.l + 6, H - p.b - 8, 'start', cfg.quad.bl);
    s += '</svg>';
    el.innerHTML = s;
  }

  global.Charts = { lineChart: lineChart, scatterChart: scatterChart, fmt: fmt };
})(window);
