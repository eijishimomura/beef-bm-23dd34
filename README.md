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

シード固定のため何度実行しても同じデータになる。経営指標は生産KPIから**1頭経済モデルで算式導出**する：

- 年間出荷頭数 ＝ 頭数 × 365/肥育日数 ×（1−事故率）
- 在庫回転 ＝ 年間出荷頭数 ÷ 平均飼養頭数
- 売上 ＝ 出荷頭数 × 枝肉重量 × 枝肉単価
- 原価 ＝ 素牛費 ＋ 飼料費（円/日 × 肥育日数。飼料自給率で減額）→ EBITDA ＝ 売上 − 原価 − 労務費 − その他
- 総資本回転 ＝ 売上 ÷（牛群簿価＋牛舎＋運転資金）、有利子負債/EBITDA ＝ 借入残高 ÷ EBITDA

このため生産と経営が矛盾しない（例：肥育日数を短くすると在庫回転・EBITDAが連動して良くなる）。係数はサンプル（スタイライズ値）。レンジの参考は秋田県サンプル値＋農水省「農業法人の財務指標」肥育牛 中位（令和3年）。異常値2件（`巨牛ファーム`＝規模突出だが薄利・高負債／`匠牧場`＝小規模だが高収益）は出力の直接上書きではなく**入力条件**で作っている。

### 既知の限界（モックの割り切り。Codexレビュー 2026-07-14 指摘）

- 数値照合ゲートは「数値の集合一致」のみ検証（フィールド対応の構造化照合は実データ接続時に）
- 牛舎キャパ警告は「稼働率92%以上×日数短縮」の簡易条件（在槽頭数ピークの実計算はしない）
- 散布図ツールチップはマウスホバー専用（タップではバブル→個票遷移のみ）
- JSONの起動時スキーマ検証・自動テストは未実装（farm_id は 0..44 連番前提）

## 赤ペン先生（ルールエンジン）

- ルールは `data/advice_rules.json` に外部化。`condition`（AND条件）→ `template`（{token} 埋め込み）→ `evidence_keys`（根拠表示）。
- token は `assets/app.js` の `buildPenContext()` が確定値として用意する（occ / spare / perW / priceRank / priceGrade / turnAfter30 など）。
- ガードレール：①全指摘に根拠（指標名・自農場値・順位・母集団数）を併記 ②数値はルール側で確定した値のみ ③数値照合ゲート `verifyNumbers()`（LLM接続時、生成文中の数値がルール値と不一致なら破棄しルール文へフォールバック） ④断定の禁止領域 ⑤伴走トーン ⑥フィードバック（役に立った／外れ）を生成文・根拠とペアで保持。
- LLM肉付けの差し込み口：`window.BeefBenchmark.PenLLM.enhance` に関数を代入すると有効化（本モックでは未接続）。

## 公開範囲

限定共有デモ。`<meta name="robots" content="noindex,nofollow">` と `robots.txt`（Disallow: /）で検索避け。URLの転載不可。
