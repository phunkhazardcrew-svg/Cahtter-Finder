const fs=require("fs");
function wav(path,x,sr){const n=x.length,b=Buffer.alloc(44+n*2);b.write("RIFF",0);b.writeUInt32LE(36+n*2,4);b.write("WAVE",8);b.write("fmt ",12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(x[i]*32767))),44+2*i);fs.writeFileSync(path,b);}
function rnd(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
const sr=48000;
{const n=sr*12,x=new Float32Array(n),rpm=9000,z=4,ft=rpm*z/60,fc=1183;
for(let i=0;i<n;i++){const t=i/sr;let s=0;for(let k=1;k<=6;k++)s+=0.05/k*Math.sin(2*Math.PI*k*ft*t+k);s+=0.08*Math.sin(2*Math.PI*fc*t)*(1+0.3*Math.sin(2*Math.PI*ft*t));s+=0.003*Math.sin(2*Math.PI*60*t)+0.01*rnd();x[i]=s*0.8;}
wav("test/cut.wav",x,sr);}
{const n=sr*6,x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=0.002*rnd();
for(const s of [0.6,1.6,2.7,3.8,4.9]){const i0=Math.round(s*sr);for(let i=0;i<sr*0.6&&i0+i<n;i++){const t=i/sr;x[i0+i]+=0.4*Math.exp(-0.015*2*Math.PI*2340*t)*Math.sin(2*Math.PI*2340*t)+(i<40?0.3*rnd():0);}}
wav("test/tap.wav",x,sr);}
console.log("wavs ok");
