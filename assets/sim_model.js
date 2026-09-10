/* 改善シミュレーションの経済モデル（1頭限界利益ベース）。
 * レバーごとに限界利益の構造が違う：
 *   ① 肥育日数短縮 = (a)既存出荷頭数の飼料費削減 + (b)回転向上による追加出荷の限界利益（満床なら0）
 *   ② 事故率低減   = 救命頭数 ×（1頭売上 − 1頭飼料費 − その他変動費）。素牛費は死亡時点で投下済み（サンクコスト）のため引かない
 *   ③ 分娩間隔短縮（繁殖・一貫のみ）= 追加子牛数 × 子牛の1頭限界利益（D-5）
 *       繁殖：販売額70万 − 育成原価50万 = 20万円/頭（params.json の既存値のみで完結）
 *       一貫：追加子牛は自家肥育に回り将来の追加出荷1頭になるため、その農場の1頭限界利益と同額
 *             （実効素牛費に自家育成原価が織り込み済み。素牛購入の不要分を別途加算すると二重計上）
 * パラメータは data/params.json、実効素牛費は data/context.json（calf_cost_eff_yen・生成時に確定）。
 * 表示用の内訳は displayBreakdown()：頭数を先に丸め、丸めた頭数×丸めた単価で金額を計算する（D-6）。
 */
(function (global) {
  'use strict';

  // 農場の1頭経済。実効素牛費はデータ生成時に確定した値（context.json の calf_cost_eff_yen）を使う。
  // 生成側で 1頭限界利益率が 5〜18% の薄利レンジに収まるよう逆算済み（B-2 に明記した循環構造）。
  function farmEconomy(f, P) {
    var s = f.carcassWt * f.price;                       // 1頭売上（円）
    var feed = P.feed_yen_per_day_head, other = P.other_var_cost_yen_per_head;
    var calf = f.calfCostEff;                            // 実効素牛費（円/頭・データ側で確定）
    if (calf === undefined) {                            // フォールバック（古いデータ互換）
      var rMax = P.marginal_margin_cap - (90 * feed) / s;
      var r0f = Math.max(P.marginal_margin_base - 0.005, Math.min(P.marginal_margin_base + 0.025, rMax));
      calf = s * (1 - r0f) - f.fatDays * feed - other;
    }
    var margin0 = s - calf - f.fatDays * feed - other;   // 1頭限界利益（現状の肥育日数ベース）
    return { s: s, feed: feed, other: other, calf: calf, margin0: margin0, r0: margin0 / s };
  }

  // 子牛1頭の限界利益（D-5：区分で構造が違う）
  function perCalfMargin(f, P, E) {
    if (f.ku === '繁殖') return P.calf_sale_yen['繁殖'] - P.calf_cost_yen['繁殖']; // 販売額 − 育成原価
    return E.margin0;                                    // 一貫：将来の追加出荷1頭の限界利益
  }

  // dd=肥育日数短縮(日), dm=事故率低減(pt), dc=分娩間隔短縮(ヶ月・繁殖/一貫のみ)。返り値の金額は円/年（連続値）。
  function simulate(f, P, dd, dm, dc) {
    dc = dc || 0;
    var E = farmEconomy(f, P);
    var occRaw = f.head / f.barnCap * 100, occ = Math.round(occRaw);
    var newFat = f.fatDays - dd, newMort = Math.max(0.3, f.mort - dm);
    var bs = f.head * 365 / f.fatDays * (1 - f.mort / 100);       // 現状の年間出荷頭数
    var feedNew = newFat * E.feed;                                 // 1頭飼料費（短縮後）
    var margin = E.s - E.calf - feedNew - E.other;                 // 1頭限界利益（短縮後・円）

    // ①(a) 既存出荷頭数の飼料費削減
    var feedSave = bs * dd * E.feed;
    // ①(b) 回転向上による追加出荷（満床＝稼働率95%以上では増頭できないため0）。判定は丸め前の実率
    var blocked = occRaw >= P.capacity_block_occupancy_pct;
    var addTurn = 0;
    if (!blocked && dd > 0) addTurn = f.head * 365 / newFat * (1 - f.mort / 100) - bs;
    // ② 事故率低減：救命頭数。下げ幅は実際の事故率（下限0.3%）までに制限
    var effDm = Math.min(dm, Math.max(0, f.mort - 0.3));
    var saved = f.head * 365 / f.fatDays * (effDm / 100);

    // ③ 分娩間隔短縮：追加子牛数 = 母牛数 ×（12/(分娩間隔−Δc) − 12/分娩間隔）× 子牛生存率
    // 短縮後の分娩間隔は12.0ヶ月を下限とする（妊娠期間≈9.5ヶ月の生物学的限界の目安）
    var calfAdd = 0, calfMarginYen = perCalfMargin(f, P, E), calfGain = 0, effDc = 0;
    if (dc > 0 && f.calvingInterval) {
      effDc = Math.min(dc, Math.max(0, f.calvingInterval - 12));
      if (effDc > 0) {
        calfAdd = f.head * (12 / (f.calvingInterval - effDc) - 12 / f.calvingInterval) * (f.calfSurvival || 90) / 100;
        calfGain = calfAdd * calfMarginYen;               // D-5: 販売額まるごとではなく限界利益で計上
      }
    }

    var salesInc = (addTurn + saved) * E.s;                        // 売上増
    var calfInc = addTurn * E.calf;                                // 素牛費 増（救命牛の素牛費はサンクコスト）
    var feedIncNet = (addTurn + saved) * feedNew - feedSave;       // 飼料費 増減（正＝増）
    var otherInc = (addTurn + saved) * E.other;                    // その他変動費 増（救命牛にも敷料・診療費はかかる）
    var netGain = salesInc - calfInc - feedIncNet - otherInc + calfGain; // 純増益 = EBITDA増

    return {
      eco: E, occ: occ, blocked: blocked,
      addTurn: addTurn, saved: saved, margin: margin, marginRatio: margin / E.s,
      calfAdd: calfAdd, calfGain: calfGain, calfMarginYen: calfMarginYen, effDc: effDc,
      salesInc: salesInc, calfInc: calfInc, feedIncNet: feedIncNet, otherInc: otherInc, netGain: netGain
    };
  }

  // D-6: 表示用内訳。頭数を先に丸め（round）、丸めた頭数 × 丸めた単価（万円）で金額を計算する。
  // 画面はこの値をそのまま表示するため「頭数 × 単価 = 表示金額」が全レバー・全位置で厳密に一致する。
  function displayBreakdown(f, P, dd, dm, dc) {
    var r = simulate(f, P, dd, dm, dc);
    var nTurn = Math.round(r.addTurn), nSaved = Math.round(r.saved), nCalf = Math.round(r.calfAdd);
    var uSales = Math.round(r.eco.s / 1e4);                        // 1頭売上（万円）
    var uCalf = Math.round(r.eco.calf / 1e4);                      // 実効素牛費（万円/頭）
    var uOther = Math.round(r.eco.other / 1e4);                    // その他変動費（万円/頭）
    var uCalfMargin = Math.round(r.calfMarginYen / 1e4);           // 子牛1頭の限界利益（万円）
    var feedNew = (f.fatDays - dd) * r.eco.feed;
    var bs = f.head * 365 / f.fatDays * (1 - f.mort / 100);
    var rows = {
      sales: (nTurn + nSaved) * uSales,                            // 売上増 = 頭数 × 1頭売上
      calfInc: nTurn * uCalf,                                      // 素牛費 増 = 回転増頭数 × 実効素牛費
      feed: Math.round(((nTurn + nSaved) * feedNew - bs * dd * r.eco.feed) / 1e4), // 飼料費 増減（積形式でないため丸めのみ）
      other: (nTurn + nSaved) * uOther,                            // その他変動費 増 = 頭数 × 3万円
      calfGain: nCalf * uCalfMargin                                // 子牛増の限界利益 = 子牛頭数 × 1頭限界利益
    };
    rows.net = rows.sales - rows.calfInc - rows.feed - rows.other + rows.calfGain; // 純増益（万円・行の加減算）
    return {
      sim: r, nTurn: nTurn, nSaved: nSaved, nCalf: nCalf,
      uSales: uSales, uCalf: uCalf, uOther: uOther, uCalfMargin: uCalfMargin, rows: rows
    };
  }

  global.SimModel = { farmEconomy: farmEconomy, perCalfMargin: perCalfMargin, simulate: simulate, displayBreakdown: displayBreakdown };
})(typeof window !== 'undefined' ? window : globalThis);
