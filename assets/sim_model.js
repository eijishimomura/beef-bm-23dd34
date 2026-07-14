/* 改善シミュレーションの経済モデル（1頭限界利益ベース）。
 * レバーごとに限界利益の構造が違う：
 *   ① 肥育日数短縮 = (a)既存出荷頭数の飼料費削減 + (b)回転向上による追加出荷の限界利益（満床なら0）
 *   ② 事故率低減   = 救命頭数 ×（1頭売上 − 1頭飼料費 − その他変動費）。素牛費は死亡時点で投下済み（サンクコスト）のため引かない
 * パラメータは data/params.json に外部化。app.js とチェックスクリプト（scripts/checks.html）の両方から使う。
 */
(function (global) {
  'use strict';

  // 農場の実効素牛費：枝肉売上・成績（ov=総合パーセンタイル0..1）に連動して補正する。
  // 1頭限界利益率 r0 = base + coef*ov を先に決め、素牛費を逆算する（素牛市場は資質を価格に織り込む）。
  // これにより全農場・全スライダー位置で 限界利益率が 5〜18% の薄利レンジに収まることを構造的に保証する。
  function farmEconomy(f, P, ov) {
    var s = f.carcassWt * f.price;                       // 1頭売上（円）
    var feed = P.feed_yen_per_day_head, other = P.other_var_cost_yen_per_head;
    var rMax = P.marginal_margin_cap - (90 * feed) / s;  // Δd=90日でも上限を超えないための天井
    var r0 = Math.min(P.marginal_margin_base + P.marginal_margin_skill_coef * ov, rMax);
    r0 = Math.max(r0, P.marginal_margin_base - 0.005);
    var calf = s * (1 - r0) - f.fatDays * feed - other;  // 実効素牛費（円/頭）
    return { s: s, feed: feed, other: other, r0: r0, calf: calf };
  }

  // dd=肥育日数短縮(日), dm=事故率低減(pt)。返り値の金額は円/年。
  function simulate(f, P, ov, dd, dm) {
    var E = farmEconomy(f, P, ov);
    var occRaw = f.head / f.barnCap * 100, occ = Math.round(occRaw);
    var newFat = f.fatDays - dd, newMort = Math.max(0.3, f.mort - dm);
    var bs = f.head * 365 / f.fatDays * (1 - f.mort / 100);       // 現状の年間出荷頭数
    var feedNew = newFat * E.feed;                                 // 1頭飼料費（短縮後）
    var margin = E.s - E.calf - feedNew - E.other;                 // 1頭限界利益（円）

    // ①(a) 既存出荷頭数の飼料費削減
    var feedSave = bs * dd * E.feed;
    // ①(b) 回転向上による追加出荷（満床＝稼働率95%以上では増頭できないため0）。判定は丸め前の実率
    var blocked = occRaw >= P.capacity_block_occupancy_pct;
    var addTurn = 0;
    if (!blocked && dd > 0) addTurn = f.head * 365 / newFat * (1 - f.mort / 100) - bs;
    // ② 事故率低減：救命頭数 ×（1頭売上 − 1頭飼料費）。下げ幅は実際の事故率（下限0.3%）までに制限
    var effDm = Math.min(dm, Math.max(0, f.mort - 0.3));
    var saved = f.head * 365 / f.fatDays * (effDm / 100);

    var salesInc = (addTurn + saved) * E.s;                        // 売上増
    var calfInc = addTurn * E.calf;                                // 素牛費 増（救命牛の素牛費はサンクコスト）
    var feedIncNet = (addTurn + saved) * feedNew - feedSave;       // 飼料費 増減（正＝増）
    var otherInc = (addTurn + saved) * E.other;                    // その他変動費 増（救命牛にも敷料・診療費はかかる）
    var netGain = salesInc - calfInc - feedIncNet - otherInc;      // 純増益 = EBITDA増

    return {
      eco: E, occ: occ, blocked: blocked,
      addTurn: addTurn, saved: saved, margin: margin, marginRatio: margin / E.s,
      salesInc: salesInc, calfInc: calfInc, feedIncNet: feedIncNet, otherInc: otherInc, netGain: netGain
    };
  }

  global.SimModel = { farmEconomy: farmEconomy, simulate: simulate };
})(typeof window !== 'undefined' ? window : globalThis);
