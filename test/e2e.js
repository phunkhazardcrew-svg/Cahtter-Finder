const {chromium}=require("playwright");const http=require("http"),fs=require("fs"),path=require("path");
const root=path.resolve(".");
const srv=http.createServer((q,r)=>{const f=path.join(root,q.url==="/"?"index.html":q.url.split("?")[0]);fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{"content-type":f.endsWith(".html")?"text/html":"application/octet-stream"});r.end(d);});}).listen(8765);
(async()=>{
 const wavCut=path.resolve("test/cut.wav");
 const b=await chromium.launch({args:["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--use-file-for-fake-audio-capture="+wavCut,"--autoplay-policy=no-user-gesture-required"]});
 const errs=[];
 for(const [w,h,name] of [[390,844,"phone"],[1280,900,"desk"]]){
  const p=await b.newPage({viewport:{width:w,height:h}});
  p.on("console",m=>{if(m.type()==="error")errs.push(name+": "+m.text());});p.on("pageerror",e=>errs.push(name+" pageerror: "+e.message));
  await p.goto("http://localhost:8765/");
  await p.fill("#in-rpm","9000");await p.selectOption("#in-z-pick","4");
  await p.click("#btn-mic");await p.waitForTimeout(3500);
  const live=await p.evaluate(()=>({pill:document.getElementById("res-pill").textContent,f:document.getElementById("res-f").textContent,st:document.getElementById("st-text").textContent}));
  console.log(name,"live",JSON.stringify(live));
  await p.click("#btn-capture");await p.waitForTimeout(3600);
  const cap=await p.evaluate(()=>({pill:document.getElementById("res-pill").textContent,f:document.getElementById("res-f").textContent,rows:[...document.querySelectorAll("#sp-body tr")].map(r=>r.innerText.replace(/\s+/g," ")).slice(0,4),adv:document.getElementById("sp-advice").textContent,src:document.getElementById("res-src").textContent}));
  console.log(name,"capture",JSON.stringify(cap,null,0));
  const sw=await p.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);console.log(name,"scroll",sw);
  await p.screenshot({path:`test/${name}-measure.png`,fullPage:true});
  await p.click("#btn-snap");
  // second snapshot after "fix": change rpm + capture again
  await p.click("#btn-totool");await p.waitForTimeout(200);await p.fill("#t-name","T12 test");await p.click("#t-save");
  const tl=await p.evaluate(()=>document.getElementById("tool-list").innerText.slice(0,200));console.log(name,"tools",JSON.stringify(tl));
  await p.screenshot({path:`test/${name}-tools.png`,fullPage:true});
  await p.goto("http://localhost:8765/#measure");await p.fill("#in-rpm","8870");await p.waitForTimeout(500);await p.click("#btn-capture");await p.waitForTimeout(3600);await p.click("#btn-snap");
  await p.goto("http://localhost:8765/#compare");await p.waitForTimeout(300);
  const cmp=await p.evaluate(()=>document.getElementById("cmp-kv").innerText+" | "+document.getElementById("cmp-verdict").textContent);console.log(name,"compare",JSON.stringify(cmp));
  await p.screenshot({path:`test/${name}-compare.png`,fullPage:true});
  await p.goto("http://localhost:8765/#fix");await p.waitForTimeout(300);await p.screenshot({path:`test/${name}-fix.png`,fullPage:true});
  const sw2=await p.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);console.log(name,"fix scroll",sw2);
  await p.goto("http://localhost:8765/#machines");await p.waitForTimeout(200);await p.screenshot({path:`test/${name}-machines.png`,fullPage:true});
  // file upload tap mode
  await p.goto("http://localhost:8765/#measure");await p.click("#mode-tap");
  await p.setInputFiles("#in-file",path.resolve("test/tap.wav"));await p.waitForTimeout(1500);
  const tap=await p.evaluate(()=>({pill:document.getElementById("res-pill").textContent,f:document.getElementById("res-f").textContent,kv:document.getElementById("res-kv").innerText.replace(/\s+/g," "),st:document.getElementById("st-text").textContent}));console.log(name,"tapfile",JSON.stringify(tap));
  await p.click("#mode-cut");await p.setInputFiles("#in-file",path.resolve("test/cut.wav"));await p.waitForTimeout(2000);
  const cf=await p.evaluate(()=>({pill:document.getElementById("res-pill").textContent,f:document.getElementById("res-f").textContent}));console.log(name,"cutfile",JSON.stringify(cf));
  await p.close();
 }
 console.log("ERRORS",errs);await b.close();srv.close();
})();
