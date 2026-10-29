const C=require("../src/core.js");
const sr=48000,N=32768;
function rnd(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function signal(sec,{rpm,z,chat,chatAmp,noise=0.01,mains=0.003}){
  const n=Math.round(sec*sr),x=new Float32Array(n),ft=rpm*z/60,fr=rpm/60;
  for(let i=0;i<n;i++){const t=i/sr;let s=0;
    for(let k=1;k<=6;k++)s+=0.05/k*Math.sin(2*Math.PI*k*ft*t+k);
    s+=0.01*Math.sin(2*Math.PI*fr*t);
    if(chat){s+=chatAmp*Math.sin(2*Math.PI*chat*t)*(1+0.3*Math.sin(2*Math.PI*ft*t));}
    s+=mains*Math.sin(2*Math.PI*60*t)+noise*rnd();x[i]=s;}
  return x;}
let ok=0,fail=0;const chk=(c,m)=>{if(c){ok++;}else{fail++;console.log("FAIL",m);}};
// 1 chatter
for(const [rpm,z,fc,amp] of [[9000,4,1183,0.08],[3000,2,2470,0.05],[14500,3,890,0.06],[1200,6,640,0.06],[18000,4,3125,0.04]]){
  const x=signal(3,{rpm,z,chat:fc,chatAmp:amp});
  const P=C.welch(x,N),r=C.analyzeCut(P,sr,N,{rpm,z,mains:60});
  console.log(rpm,z,fc,"->",r.verdict,r.cand&&r.cand.f.toFixed(1),"conf",r.confidence.toFixed(2),"sb",r.sidebands,"res",r.resolvable);
  chk(r.cand&&Math.abs(r.cand.f-fc)<2,"fc "+fc);
  chk(r.verdict==="chatter"||r.verdict==="possible","verdict "+fc);
}
// 2 no chatter
for(const [rpm,z] of [[9000,4],[3000,2],[16000,3]]){
  const x=signal(3,{rpm,z});const P=C.welch(x,N),r=C.analyzeCut(P,sr,N,{rpm,z,mains:60});
  console.log("clean",rpm,z,"->",r.verdict,r.cand&&r.cand.f);chk(r.verdict==="forced"||r.verdict==="clean","clean "+rpm);
}
// 3 speeds
const rows=C.suggestSpeeds(1183,4,9000,20,12000,8);console.log(rows.map(r=>r.nRound).join(" "));
chk(Math.abs(rows[0].n-60*1183/(4*1))<1e-6||rows[0].n<=12000,"rows");
chk(rows.every(r=>r.n<=12000&&r.n>=20),"range");
const rec=C.pickRecommendations(rows,9000);console.log("above",rec.above&&rec.above.nRound,"nearest",rec.nearest.nRound);
const ph=C.phaseInfo(1183,4,9000);console.log(ph);
// 4 overhang
const a=C.overhang(16,48,"carbide"),b=C.overhang(16,80,"carbide");console.log(a,b,b.k/a.k,Math.pow(48/80,3));
chk(Math.abs(b.k/a.k-Math.pow(48/80,3))<1e-9,"k ratio");chk(Math.abs(b.fn/a.fn-Math.pow(48/80,2))<1e-9,"fn ratio");
// 5 taps
const n=Math.round(5*sr),x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=0.002*rnd();
const fnTrue=2340,zeta=0.015,starts=[0.5,1.5,2.6,3.7];
for(const s of starts){const i0=Math.round(s*sr);for(let i=0;i<sr*0.6&&i0+i<n;i++){const t=i/sr;x[i0+i]+=0.4*Math.exp(-zeta*2*Math.PI*fnTrue*t)*Math.sin(2*Math.PI*fnTrue*Math.sqrt(1-zeta*zeta)*t)+(i<40?0.3*rnd():0);}}
const hits=C.detectTaps(x,sr);console.log("hits",hits.map(h=>(h/sr).toFixed(3)).join(" "));chk(hits.length===4,"taps");
let acc=null;for(const h of hits){const P=C.tapSpectrum(x,sr,h,32768);if(!acc)acc=P;else for(let k=0;k<P.length;k++)acc[k]+=P[k];}
const tr=C.analyzeTap(acc,sr,32768);console.log("fn",tr.fn.toFixed(1),"zeta",tr.zeta.toFixed(4));chk(Math.abs(tr.fn-fnTrue*Math.sqrt(1-zeta*zeta))<3,"tap fn");
// 6 sine calibration
const s1=new Float32Array(N);for(let i=0;i<N;i++)s1[i]=Math.sin(2*Math.PI*1000*i/sr);const Pc=C.frameSpectrum(s1,N);let m=0;for(const v of Pc)m=Math.max(m,v);console.log("fullscale dB",(10*Math.log10(m)).toFixed(2));
console.log("OK",ok,"FAIL",fail);
// 7 wrong rpm entered (override 98.5%)
{let ok2=0;for(const [rpmReal,rpmIn,z,fc] of [[9000,9140,4,1183],[9000,8870,4,null],[6000,6300,3,1420],[12000,11500,2,null]]){
 const x=signal(3,{rpm:rpmReal,z,chat:fc,chatAmp:0.08});const P=C.welch(x,N);const r=C.analyzeCut(P,sr,N,{rpm:rpmIn,z,mains:60});
 console.log("wrongrpm",rpmReal,rpmIn,"est",r.rpmEst&&r.rpmEst.toFixed(1),r.verdict,r.cand&&r.cand.f.toFixed(1));
 if(Math.abs(r.rpmEst-rpmReal)<rpmReal*0.002 && (fc?Math.abs(r.cand.f-fc)<2:(r.verdict==="forced"||r.verdict==="clean")))ok2++;}
 console.log("wrongrpm ok",ok2,"/4");}
// 8 correct rpm must not trigger estimate
{const x=signal(3,{rpm:9000,z:4,chat:1183,chatAmp:0.08});const r=C.analyzeCut(C.welch(x,N),sr,N,{rpm:9000,z:4,mains:60});console.log("no false est",isNaN(r.rpmEst));}
// 9 review fixes
{let ok3=0,fail3=0;const t=(c,m)=>{if(c)ok3++;else{fail3++;console.log("FAIL",m);}};
 // low rpm: the speed table must contain the pockets next to the current speed
 const rows=C.suggestSpeeds(3000,4,2000,20,12000,8),rec=C.pickRecommendations(rows,2000),first=rec.above||rec.nearest;
 t(Math.abs(first.change)<0.05,"low-rpm try-first within 5 % (got "+first.nRound+")");
 t(rows.some(r=>r.n<2000)&&rows.some(r=>r.n>2000),"low-rpm table brackets current speed");
 // runout comb of a face mill at low speed (no chatter) must not read as chatter
 function sig2(o){const n=3*sr,x=new Float32Array(n),fr=o.rpm/60,ft=fr*o.z;for(let i=0;i<n;i++){const t=i/sr;let s=0;
  for(let k=1;k<=6;k++)s+=0.05/k*Math.sin(2*Math.PI*k*ft*t+k);for(let k=1;k<=(o.rk||1);k++)s+=(o.ro||0.01)/Math.sqrt(k)*Math.sin(2*Math.PI*k*fr*t+0.7*k*k);
  for(const c of o.chat||[])s+=c.a*Math.sin(2*Math.PI*c.f*t)*(1+0.3*Math.sin(2*Math.PI*ft*t));s+=0.003*Math.sin(2*Math.PI*60*t)+0.01*rnd();x[i]=s;}return x;}
 for(const [rpm,z] of [[600,10],[1000,8],[400,12]]){const r=C.analyzeCut(C.welch(sig2({rpm,z,rk:40,ro:0.03}),N),sr,N,{rpm,z,mains:60});
  t(r.verdict!=="chatter"&&!(r.verdict==="possible"&&r.confidence>0.5),"runout comb z"+z+" "+rpm+" -> "+r.verdict+" "+(r.cand&&r.cand.f.toFixed(1)));}
 // chatter a few Hz beside a tooth harmonic is still found
 for(const fc of [4788,4794]){const r=C.analyzeCut(C.welch(sig2({rpm:9000,z:4,chat:[{f:fc,a:0.06}]}),N),sr,N,{rpm:9000,z:4,mains:60});
  t(r.cand&&Math.abs(r.cand.f-fc)<2,"near-harmonic chatter "+fc+" -> "+r.verdict+" "+(r.cand&&r.cand.f.toFixed(1)));}
 // tap test: stiff tool ringing at 9 kHz with only a few ms of ring-down
 const n=5*sr,x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=0.002*rnd();
 for(const s of [0.5,1.5,2.6,3.7]){const i0=Math.round(s*sr);for(let i=0;i<sr*0.3;i++){const tt=i/sr;x[i0+i]+=0.4*Math.exp(-0.01*2*Math.PI*9000*tt)*Math.sin(2*Math.PI*9000*tt);}}
 let acc=null;for(const h of C.detectTaps(x,sr)){const P=C.tapSpectrum(x,sr,h,32768);if(!acc)acc=P;else for(let k=0;k<P.length;k++)acc[k]+=P[k];}
 const tr=C.analyzeTap(acc,sr,32768);t(Math.abs(tr.fn-9000)<0.003*9000,"tap 9 kHz fn "+tr.fn);t(Math.abs(tr.zeta-0.01)<0.004,"tap 9 kHz zeta "+tr.zeta);
 console.log("review fixes OK",ok3,"FAIL",fail3);}
