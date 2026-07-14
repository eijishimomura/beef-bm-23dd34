# beef-benchmark-mock

肉牛経営ベンチマークの**動くモック**（静的サイト）。生産成績（PigINFO型の成績表）に加え、先行事例が踏み込んでいない **BS・資本効率（EBITDA・在庫回転・有利子負債/EBITDA）** まで接続するデモ。

**データはすべてサンプル（架空の45農場）。実在の農場・団体の実績ではない。**

## 構成

```
index.html                    # SPA（#/ = 全体ダッシュボード、#/farm/<id> = 農場個票）
assets/
  app.js                      # データ読込・集計・描画・赤ペン先生エンジン
  charts.js                   # SVG折れ線・散布図（依存ライブラリなし）
  style.css
data/                         # 正規化JSON（簡易DB。将来SQLite/BEへ移行できるようテーブル相当に分割）
  farms.json                  # 農場マスタ
  context.json                # 前提条件（牛舎キャパ・労働力・負債・後継者 等）
  metrics.json                # 指標定義（単位・方向性・算式・出典）
  farm_metrics.json           # 農場×指標の直近値
  timeseries.json             # 月次36ヶ月（12ヶ月ローリングは閲覧時に計算）
  fiscal.json                 # 年次・決算3期分（財務は月次遡及できないため二層で持つ）
  benchmarks.json             # segment別 p10/p25/p50/p75/p90
  advice_rules.json           # 赤ペン先生のルール（外部化。コード変更なしに改訂可）
scripts/
  generate_sample_data.mjs    # シード固定（20260709）のサンプルデータ生成
  gen_runner.html             # node が無い環境向けの生成ハーネス（dev_server.py と併用）
  dev_server.py               # ローカル確認用サーバ（python3 scripts/dev_server.py → :8642）
```

## データ再生成

```
node scripts/generate_sample_data.mjs
# node が無い場合:
python3 scripts/dev_server.py &
open http://localhost:8642/scripts/gen_runner.html
```

シード固定のため何度実行しても同じデータになる。生産KPI→1頭経済モデル→経営指標の順に連動導出しており、生産と経営が矛盾しない。レンジの根拠は秋田県サンプル値＋農水省「農業法人の財務指標」肥育牛 中位（令和3年）。異常値2件（規模突出だが薄利／小規模だが高収益）を意図的に含む。

## 赤ペン先生（ルールエンジン）

- ルールは `data/advice_rules.json` に外部化。`condition`（AND条件）→ `template`（{token} 埋め込み）→ `evidence_keys`（根拠表示）。
- token は `assets/app.js` の `buildPenContext()` が確定値として用意する（occ / spare / perW / priceRank / priceGrade / turnAfter30 など）。
- ガードレール：①全指摘に根拠（指標名・自農場値・順位・母集団数）を併記 ②数値はルール側で確定した値のみ ③数値照合ゲート `verifyNumbers()`（LLM接続時、生成文中の数値がルール値と不一致なら破棄しルール文へフォールバック） ④断定の禁止領域 ⑤伴走トーン ⑥フィードバック（役に立った／外れ）を生成文・根拠とペアで保持。
- LLM肉付けの差し込み口：`window.BeefBenchmark.PenLLM.enhance` に関数を代入すると有効化（本モックでは未接続）。

## 公開範囲

限定共有デモ。`<meta name="robots" content="noindex,nofollow">` と `robots.txt`（Disallow: /）で検索避け。URLの転載不可。
