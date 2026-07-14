// 肉牛ベンチマーク モック — サンプルデータ生成
// シード固定（20260709）。何度実行しても同じ data/*.json を出力する。
// 使い方:
//   Node   : node scripts/generate_sample_data.mjs      → data/*.json を上書き
//   ブラウザ: scripts/gen_runner.html を開く（node が無い環境向けの実行ハーネス）
//
// 生成ロジックはワイヤーv2（視覚SSOT）の実装を正としてそのまま移植している。
// 生産KPI → 1頭経済モデル → 経営指標 の順に導出し、生産と経営が矛盾しないことを保証する。

// ---- 乱数（mulberry32・シード固定） ----
function rng(s){return function(){s|=0;s=s+0x6D2B79F5|0;var t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

export const SEED = 20260709;

export const METRICS = [
  { metric_id:'carcassWt',  label:'枝肉重量',          unit:'kg',   group:'prod', dir: 1, formula:'出荷牛の平均枝肉重量', source:'と畜成績（枝肉証明書）' },
  { metric_id:'price',      label:'枝肉単価',          unit:'円/kg', group:'prod', dir: 1, formula:'枝肉売上 ÷ 枝肉重量', source:'市場データ' },
  { metric_id:'dg',         label:'増体 DG',           unit:'g/日',  group:'prod', dir: 1, formula:'(出荷体重 − 導入体重) ÷ 飼養日数', source:'飼養記録' },
  { metric_id:'mort',       label:'事故率',            unit:'%',    group:'prod', dir:-1, formula:'事故頭数 ÷ 飼養頭数 × 100', source:'飼養記録' },
  { metric_id:'fatDays',    label:'肥育日数',          unit:'日',   group:'prod', dir:-1, formula:'導入から出荷までの平均日数', source:'飼養記録' },
  { metric_id:'ebitdaM',    label:'EBITDAマージン',    unit:'%',    group:'econ', dir: 1, formula:'EBITDA ÷ 売上高 × 100', source:'決算書（損益計算書）' },
  { metric_id:'invTurn',    label:'在庫回転(牛群)',    unit:'回',   group:'econ', dir: 1, formula:'年間出荷頭数 ÷ 平均飼養頭数', source:'飼養記録・出荷実績' },
  { metric_id:'capTurn',    label:'総資本回転',        unit:'回',   group:'econ', dir: 1, formula:'売上高 ÷ 総資本', source:'決算書（貸借対照表）' },
  { metric_id:'equity',     label:'自己資本比率',      unit:'%',    group:'econ', dir: 1, formula:'自己資本 ÷ 総資本 × 100', source:'決算書（貸借対照表）' },
  { metric_id:'ordP',       label:'経常利益率',        unit:'%',    group:'econ', dir: 1, add: 1, formula:'経常利益 ÷ 売上高 × 100', source:'決算書（損益計算書）' },
  { metric_id:'debtEbitda', label:'有利子負債/EBITDA', unit:'年',   group:'econ', dir:-1, formula:'有利子負債残高 ÷ EBITDA', source:'決算書' }
];
const MMAP = Object.fromEntries(METRICS.map(m=>[m.metric_id,m]));
const PROD=['carcassWt','price','dg','mort','fatDays'];
const ECON=['ebitdaM','invTurn','capTurn','equity','ordP','debtEbitda'];
const SCORE=PROD.concat(ECON);

const KUS=['繁殖','肥育','一貫'], REGS=['北海道','東北','関東','中国','九州'];
// 架空名のみ。実在農場を想起させる名前は使わない。45件目（ほしぞら）は重複回避のため追加。
const NAMES=['ひなた','あおぞら','みどり','大地','清流','こもれび','いなほ','はるかぜ','ゆたか','あかつき','しらかば','つばさ','いずみ','まきば','あさひ','こまち','ふじ','なでしこ','たいよう','わかば','みのり','かがやき','ほくと','こうよう','せせらぎ','くろべ','はやて','ときわ','あゆみ','しおん','なぎさ','こはる','あおば','ゆうひ','みなみ','きたかぜ','すずらん','やまびこ','あかね','ひかり','つむぎ','こだま','さくら','わたぼうし','ほしぞら'];

// 月次ラベル：直近36ヶ月（最新＝2026-06）
function months(n){
  const out=[]; let y=2026, m=6;
  for(let i=0;i<n;i++){ out.unshift(y+'-'+String(m).padStart(2,'0')); m--; if(m===0){m=12;y--;} }
  return out;
}

function quantile(sorted,q){const p=(sorted.length-1)*q,b=Math.floor(p),r=p-b;return sorted[b+1]!==undefined?sorted[b]+r*(sorted[b+1]-sorted[b]):sorted[b];}
const r1=v=>Math.round(v*10)/10, r2=v=>Math.round(v*100)/100, r3=v=>Math.round(v*1000)/1000;

export function generate(){
  const rnd=rng(SEED);
  const pick=a=>a[Math.floor(rnd()*a.length)];
  const gauss=()=>(rnd()+rnd()+rnd()+rnd()-2)/2;

  // ---- 農場マスタ + 生産KPI → 1頭経済モデル → 経営指標 ----
  const farms=[]; let id=0;
  for(let r=0;r<REGS.length;r++)for(let k=0;k<KUS.length;k++)for(let c=0;c<3;c++){
    const band=pick(['小','中','大']);
    const head=band==='小'?30+Math.floor(rnd()*60):band==='中'?100+Math.floor(rnd()*160):300+Math.floor(rnd()*600);
    const skill=Math.min(1,Math.max(0,0.5+gauss()*0.5));
    const f={id,name:NAMES[id%NAMES.length]+'牧場',ku:KUS[k],reg:REGS[r],band,head,skill};
    // 生産KPI（レンジ根拠：秋田県サンプル値＋農水省「農業法人の財務指標」肥育牛 中位・令和3年）
    f.carcassWt=Math.round(400+skill*110+gauss()*20); f.price=Math.round(1950+skill*520+gauss()*90);
    f.dg=Math.round(760+skill*230+gauss()*40); f.mort=+(5.5-skill*3.8+Math.abs(gauss())*1.2).toFixed(1);
    f.fatDays=Math.round(690-skill*130+gauss()*30);
    // 経営指標（生産KPIと同一の skill から連動導出 → 生産と経営が矛盾しない）
    f.sales=Math.round(head*(1.0+skill*0.35)); // 百万円
    f.ebitdaM=+(6+skill*15+gauss()*2.4).toFixed(1); f.invTurn=+(0.42+skill*0.32+gauss()*0.03).toFixed(2);
    f.capTurn=+(0.42+skill*0.42+gauss()*0.04).toFixed(2); f.equity=Math.max(3,Math.round(8+skill*52+gauss()*8));
    f.ordP=+(-2+skill*9+gauss()*1.4).toFixed(1);
    f.debt=Math.round(f.sales*(1.5-skill*0.85+Math.abs(gauss())*0.3)); // 百万円
    const eb=Math.max(1,f.sales*f.ebitdaM/100); f.debtEbitda=+(f.debt/eb).toFixed(1);
    // コンテキスト（前提条件）
    f.barnCap=Math.round(head*(1.03+rnd()*0.32)); f.workers=Math.max(1,Math.round(head/70+rnd()*2));
    f.calfSrc=(f.ku==='肥育')?'市場購入':'自家産'; f.feedSelf=Math.round(rnd()*45);
    f.age=Math.round(42+rnd()*30); f.succ=rnd()<0.55?'あり':'未定';
    farms.push(f); id++;
  }
  // 意図した異常値2件（デモの山場）
  farms[5].head=880;farms[5].barnCap=900;farms[5].ebitdaM=8.2;farms[5].name='巨牛ファーム';farms[5].debtEbitda=7.4;
  farms[12].ebitdaM=23.5;farms[12].price=2680;farms[12].head=55;farms[12].barnCap=58;farms[12].name='匠牧場';farms[12].debtEbitda=1.4;
  // 上書きした頭数・負債倍率に合わせ、売上・労働力・負債残高を1頭経済モデルで再導出する
  // （ワイヤーでは未再計算のため「負債残高とEBITDA倍率が矛盾する」表示になっていた。整合性要件を優先）
  function refit(f,intensity){
    f.sales=Math.round(f.head*intensity);
    f.workers=Math.max(1,Math.round(f.head/70));
    f.debt=Math.round(f.debtEbitda*(f.sales*f.ebitdaM/100));
  }
  refit(farms[5],1.05); refit(farms[12],1.35);

  // ---- 時系列（36ヶ月・月次） ----
  function mkTS(base,add){const drift=(rnd()-0.45)*0.24,a=[];for(let t=0;t<36;t++){const p=(35-t)/35;
    a.push(add? base+drift*3*p+(rnd()-0.5)*0.8 : base*(1+drift*p)*(1+(rnd()-0.5)*0.08));}return a;}
  farms.forEach(f=>{f.ts={};SCORE.forEach(m=>{f.ts[m]=mkTS(f[m],MMAP[m].add);});});

  // ---- 年次（決算3期分）— 財務は月次で遡及できないため年次の二層で持つ ----
  // 直近期=現在値。過去2期は EBITDAマージンの時系列ドリフトと整合させて導出する。
  function yearAvg(a,from,to){let s=0;for(let i=from;i<to;i++)s+=a[i];return s/(to-from);}
  const fiscal=[];
  farms.forEach(f=>{
    [0,1,2].forEach(k=>{ // k=0:FY2023 … k=2:FY2025(直近)
      const fy=2023+k, i0=k*12, i1=k*12+12;
      const em=yearAvg(f.ts.ebitdaM,i0,i1);
      const salesK=k===2?f.sales:Math.round(f.sales*(0.94+k*0.03)*(1+(rnd()-0.5)*0.04));
      const emK=k===2?f.ebitdaM:r1(em);
      const debtK=k===2?f.debt:Math.round(f.debt*(1.06-k*0.03)*(1+(rnd()-0.5)*0.04));
      const eqK=k===2?f.equity:Math.max(3,Math.round(f.equity*(0.94+k*0.03)));
      fiscal.push({farm_id:f.id, fy, sales:salesK, ebitda:r1(salesK*emK/100), ebitda_margin:emK, debt:debtK, equity_ratio:eqK});
    });
  });

  // ---- ベンチマーク分布（segment別 p10/p25/p50/p75/p90・生値の昇順分位。方向は metrics.dir で解釈） ----
  const benchmarks=[];
  function seg(name,sub){
    if(!sub.length)return;
    SCORE.forEach(m=>{
      const v=sub.map(f=>f[m]).sort((a,b)=>a-b);
      benchmarks.push({metric_id:m,segment:name,n:v.length,
        p10:r3(quantile(v,.10)),p25:r3(quantile(v,.25)),p50:r3(quantile(v,.50)),p75:r3(quantile(v,.75)),p90:r3(quantile(v,.90))});
    });
  }
  seg('all',farms);
  ['小','中','大'].forEach(b=>seg('band:'+b,farms.filter(f=>f.band===b)));
  KUS.forEach(k=>seg('ku:'+k,farms.filter(f=>f.ku===k)));
  REGS.forEach(r=>seg('region:'+r,farms.filter(f=>f.reg===r)));

  // ---- テーブル化 ----
  const ymList=months(36);
  const period=ymList[ymList.length-1];
  const tables={
    farms: farms.map(f=>({farm_id:f.id,name:f.name,ku:f.ku,region:f.reg,band:f.band,head:f.head})),
    context: farms.map(f=>({farm_id:f.id,barn_cap:f.barnCap,workers:f.workers,calf_source:f.calfSrc,feed_self_pct:f.feedSelf,debt_myen:f.debt,owner_age:f.age,successor:f.succ})),
    metrics: METRICS,
    farm_metrics: farms.flatMap(f=>SCORE.map(m=>({farm_id:f.id,metric_id:m,value:f[m],period}))),
    timeseries: farms.flatMap(f=>SCORE.flatMap(m=>f.ts[m].map((v,i)=>({farm_id:f.id,metric_id:m,ym:ymList[i],value:r3(v)})))),
    fiscal,
    benchmarks
  };
  return tables;
}

// ---- Node 実行時：data/*.json を書き出す（advice_rules.json はルール定義ファイルのため上書きしない） ----
if (typeof process!=='undefined' && process.versions && process.versions.node){
  const {writeFileSync,mkdirSync}=await import('node:fs');
  const {dirname,join}=await import('node:path');
  const {fileURLToPath}=await import('node:url');
  const root=join(dirname(fileURLToPath(import.meta.url)),'..');
  const dir=join(root,'data'); mkdirSync(dir,{recursive:true});
  const t=generate();
  for(const name of Object.keys(t)){
    writeFileSync(join(dir,name+'.json'),JSON.stringify(t[name],null,name==='timeseries'?0:1)+'\n');
    console.log('wrote data/'+name+'.json ('+t[name].length+' rows)');
  }
}
