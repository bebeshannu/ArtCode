
const $=s=>document.querySelector(s);
let tracks=[],content={},segments={},trackState=[],ctx,master,solo=null,playing=false,duration=2756,seekBusy=false;
let playStartCtxTime=null,playStartPos=0,masterVolume=.85;
let nodes=[],ripples=[],particles=[],focus=null,frameNow=0,lastFrameNow=0,lastAspectX=1;
let camera={scale:1,cx:0,cy:0},cameraTarget={scale:1,cx:0,cy:0},focusAmt=0,focusAmtTarget=0;
const C=$('#art'),g=C.getContext('2d');
const off=document.createElement('canvas'),offG=off.getContext('2d');
const bloomC=document.createElement('canvas'),bloomG=bloomC.getContext('2d');

// Deterministic PRNG so each shard's inner mosaic is stable across reloads
// (seeded by track index) rather than reshuffling every render.
function mulberry32(seed){
  return function(){
    seed|=0;seed=seed+0x6D2B79F5|0;
    let t=Math.imul(seed^seed>>>15,1|seed);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;
  };
}
// Each shard is painted, not just colored — a small mosaic of its own,
// echoing how a real stained-glass figure is built from many individual
// panes rather than one flat pane. We have no factual basis to invent which
// saint or scene a specific 1995 church window actually showed, so instead
// of fabricating that detail, every fragment is honestly its own abstract
// composition: unique, but built from the same DNA as all 47 others — one
// piece of a larger artwork, individually and collectively.
function buildMosaic(idx){
  const rnd=mulberry32(idx*97+13);
  const N=6+Math.floor(rnd()*4);
  const seeds=[];
  for(let i=0;i<N;i++){
    const ang=rnd()*Math.PI*2,r=rnd()*.75;
    seeds.push({x:Math.cos(ang)*r,y:Math.sin(ang)*r,hueShift:(rnd()-.5)*64,lightShift:(rnd()-.5)*22,phase:rnd()*6.28});
  }
  const SIDES=20,BR=1.6,boundary=[];
  for(let k=0;k<SIDES;k++){const a=k/SIDES*Math.PI*2;boundary.push({x:Math.cos(a)*BR,y:Math.sin(a)*BR})}
  return seeds.map((s,i)=>{
    let poly=boundary;
    seeds.forEach((o,j)=>{
      if(i===j)return;
      const mx=(s.x+o.x)/2,my=(s.y+o.y)/2,dx=o.x-s.x,dy=o.y-s.y;
      poly=clipHalfplane(poly,mx,my,dx,dy);
    });
    return{poly,hueShift:s.hueShift,lightShift:s.lightShift,phase:s.phase};
  });
}

Promise.all([
  fetch('data/tracks.json').then(r=>r.json()),
  fetch('data/content.json').then(r=>r.json()),
  fetch('data/segments.json').then(r=>r.json()),
]).then(([t,c,s])=>{
  tracks=t;content=c;segments=s;
  nodes=t.map((tr,i)=>{
    const gx=tr.geo_x,gy=tr.geo_y;
    const ang=Math.atan2(gy,gx);
    const hue=(((ang/(Math.PI*2))*360+360)%360+205)%360;
    return {gx,gy,hue,glow:0,levelSmooth:0,prevLevel:0,lastStrike:0,poly:null,cx:gx,cy:gy,boundR:.1,iconType:i%4,mosaic:buildMosaic(i)};
  });
  computeVoronoi();
  initAudio();
  initContent();
  initMenuAmbient();
  resize();
  runIntroSequence();
  draw();
});

function initContent(){
  const s=content.sections||{};
  const set=(id,key)=>{const el=$('#'+id);if(el)el.textContent=s[key]||''};
  set('historyIntro','historyIntro');set('historyRaid','historyRaid');set('historyToll','historyToll');
  set('historyCity','historyCity');set('historyAftermath','historyAftermath');
  set('wallmannBio','wallmannBio');set('wallmannOrigin','wallmannOrigin');
  set('wallmannPremiere','wallmannPremiere');set('wallmannMeaning','wallmannMeaning');
  set('personalStory','personalStory');
  set('motivationWhy','motivationWhy');set('motivationGlass','motivationGlass');
  set('motivationMap','motivationMap');set('motivationSound','motivationSound');
  set('peaceText','peace');set('archiveText','archive');

  (content.historyImages||[]).forEach((img,i)=>{
    const slot=$('#histImg'+i);if(!slot)return;
    slot.innerHTML=`<img src="${img.src}" alt="${img.caption||''}" loading="lazy"><span class="imgCaption">${img.caption||''}</span><span class="imgCredit">${img.credit||''}</span>`;
  });

  const contactList=$('#contactList');
  if(contactList){
    contactList.innerHTML=(content.contacts||[]).map(c=>
      `<div class="contactCard"><h4>${c.name}</h4><p>${c.blurb}</p><a href="${c.url}" target="_blank" rel="noopener">${c.url.replace(/^https?:\/\//,'')}</a></div>`
    ).join('');
  }
  const sources=$('#sources');
  if(sources){
    sources.innerHTML=(content.sources||[]).map(s=>`<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>`).join('');
  }
}
function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el=$('#'+id);
  if(el)el.classList.add('active');
  document.body.classList.toggle('onMenu',id==='mainMenu');
  document.body.classList.toggle('onViz',id==='experience');
  menuAmbientSet(id==='mainMenu');
  // Views are always laid out (opacity-crossfaded, not display:none'd), but
  // the canvas's *drawing buffer* is only sized from clientWidth/Height once
  // up front — resize the buffer defensively in case the window changed size
  // while a different page was showing.
  if(id==='experience')resize();
}
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-view]');
  if(btn)showView(btn.dataset.view);
});
$('#menuBtn').onclick=()=>showView('mainMenu');

// ---- theme ----
(function initTheme(){
  const saved=localStorage.getItem('eom-theme');
  const theme=saved||'dark';
  document.documentElement.dataset.theme=theme;
  $('#themeToggle').textContent=theme==='dark'?'☾':'☀';
})();
$('#themeToggle').onclick=()=>{
  const next=document.documentElement.dataset.theme==='light'?'dark':'light';
  document.documentElement.dataset.theme=next;
  localStorage.setItem('eom-theme',next);
  $('#themeToggle').textContent=next==='dark'?'☾':'☀';
};

// ---- geometry: Voronoi cells of the 48 churches, clipped to a rose-window
// disc. Computed once in normalized (-1..1) space; screen position is a pure
// camera transform at draw time, so panning/zooming never touches geometry.
function clipHalfplane(poly,px,py,nx,ny){
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const da=(a.x-px)*nx+(a.y-py)*ny,db=(b.x-px)*nx+(b.y-py)*ny;
    const aIn=da<=1e-9,bIn=db<=1e-9;
    if(aIn)out.push(a);
    if(aIn!==bIn){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})}
  }
  return out;
}
function computeVoronoi(){
  const SIDES=72,BR=1.24,boundary=[];
  for(let k=0;k<SIDES;k++){const a=k/SIDES*Math.PI*2;boundary.push({x:Math.cos(a)*BR,y:Math.sin(a)*BR})}
  nodes.forEach((n,i)=>{
    let poly=boundary;
    nodes.forEach((m,j)=>{
      if(i===j)return;
      const mx=(n.gx+m.gx)/2,my=(n.gy+m.gy)/2,dx=m.gx-n.gx,dy=m.gy-n.gy;
      poly=clipHalfplane(poly,mx,my,dx,dy);
    });
    n.poly=poly;
    let cx=0,cy=0;poly.forEach(p=>{cx+=p.x;cy+=p.y});cx/=poly.length;cy/=poly.length;
    n.cx=cx;n.cy=cy;
    n.boundR=Math.max(.06,...poly.map(p=>Math.hypot(p.x-cx,p.y-cy)));
  });
}
function pointInPoly(px,py,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y;
    if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}

// ---- audio engine ----
// Streaming 48 concurrent <audio> elements hits a hard Chromium limit: only
// ~6 media elements can be "actively decoding" at once, and a continuously
// playing track never releases its slot, so the other 42 stall forever (this
// was the root cause of tracks going silent for long stretches). Instead,
// each track is pre-split into ~20s WAV segments (data/segments.json has the
// exact per-segment boundaries — ffmpeg's segmenter doesn't cut at perfectly
// even multiples). Segments are fetched with plain fetch() + decodeAudioData
// (not subject to the media-element limit) and scheduled back-to-back with
// AudioBufferSourceNode, whose start(time) is sample-accurate against the
// shared AudioContext clock — so all 48 voices start, and stay, in sync by
// construction, with no per-track drift correction needed.
function initAudio(){
  const durations=Object.values(segments).map(list=>list.length?list[list.length-1].e:0).filter(d=>d>0);
  if(durations.length){duration=Math.min(...durations);$('#seek').max=duration;$('#duration').textContent=fmt(duration)}
  trackState=tracks.map((t,i)=>({
    key:String(i+1).padStart(2,'0'),gain:null,pan:null,an:null,data:null,td:null,
    segCache:new Map(),activeSources:[],nextTimer:null,token:0,ok:false,
  }));
  let ok=0,bad=0;
  Promise.all(trackState.map(async ts=>{
    try{
      const list=segments[ts.key];
      if(!list||!list.length)throw new Error('no segments in manifest');
      const res=await fetch(`audio_segments/${ts.key}/${list[0].f}`,{method:'HEAD'});
      if(!res.ok)throw new Error('HEAD '+res.status);
      ts.ok=true;ok++;
    }catch(e){bad++;console.error('SEGMENT CHECK FAILED',ts.key,e)}
    $('#status').textContent=`${ok}/48 ready${bad?' · '+bad+' failed':''}`;
  }));
}
function setupGraph(){if(ctx)return;ctx=new AudioContext();master=ctx.createGain();master.gain.value=masterVolume;master.connect(ctx.destination);
 trackState.forEach((ts,i)=>{try{
   ts.gain=ctx.createGain();ts.pan=ctx.createStereoPanner();ts.an=ctx.createAnalyser();
   ts.an.fftSize=256;ts.data=new Uint8Array(ts.an.frequencyBinCount);ts.td=new Uint8Array(ts.an.fftSize);
   ts.gain.connect(ts.pan);ts.pan.connect(ts.an);ts.an.connect(master);
   ts.pan.pan.value=Math.max(-1,Math.min(1,(tracks[i].geo_x||0)*.9));
 }catch(e){console.error(e)}});mix()}

function segIndexForTime(key,t){
  const list=segments[key];
  if(!list||!list.length)return{idx:0,offset:0};
  for(let i=0;i<list.length;i++){if(t<list[i].e||i===list.length-1)return{idx:i,offset:Math.max(0,t-list[i].s)}}
  return{idx:list.length-1,offset:0};
}
async function fetchSegment(ts,idx){
  if(ts.segCache.has(idx))return ts.segCache.get(idx);
  const list=segments[ts.key];
  if(!list||idx<0||idx>=list.length)return null;
  const url=`audio_segments/${ts.key}/${list[idx].f}`;
  const p=(async()=>{
    const res=await fetch(url);
    const bytes=await res.arrayBuffer();
    const buf=await ctx.decodeAudioData(bytes);
    ts.segCache.set(idx,buf);
    for(const k of[...ts.segCache.keys()])if(k<idx-1||k>idx+1)ts.segCache.delete(k);
    return buf;
  })().catch(e=>{console.error('SEGMENT LOAD FAILED',url,e);ts.segCache.delete(idx);return null});
  ts.segCache.set(idx,p);
  return p;
}
function stopTrack(ts){
  ts.token++;
  if(ts.nextTimer){clearTimeout(ts.nextTimer);ts.nextTimer=null}
  ts.activeSources.forEach(s=>{try{s.onended=null;s.stop()}catch(e){}try{s.disconnect()}catch(e){}});
  ts.activeSources=[];
}
async function scheduleSegment(ts,idx,whenCtxTime,offsetInSeg,myToken){
  const buf=await fetchSegment(ts,idx);
  if(!buf||ts.token!==myToken)return;
  const src=ctx.createBufferSource();
  src.buffer=buf;
  src.connect(ts.gain);
  src.start(whenCtxTime,offsetInSeg);
  ts.activeSources.push(src);
  const remaining=buf.duration-offsetInSeg,nextStart=whenCtxTime+remaining,nextIdx=idx+1;
  const list=segments[ts.key];
  if(!list||nextIdx>=list.length)return;
  const leadSec=Math.max(0,(nextStart-ctx.currentTime)-2.5);
  ts.nextTimer=setTimeout(()=>{if(ts.token===myToken)scheduleSegment(ts,nextIdx,nextStart,0,myToken)},leadSec*1000);
}
function playAllFrom(pos,leadIn){
  const when=ctx.currentTime+(leadIn||.25);
  playStartCtxTime=when;playStartPos=pos;
  trackState.forEach(ts=>{
    stopTrack(ts);
    const myToken=ts.token;
    const{idx,offset}=segIndexForTime(ts.key,pos);
    scheduleSegment(ts,idx,when,offset,myToken);
  });
}
async function start(){
 setupGraph();
 await ctx.resume();
 const ready=trackState.filter(ts=>ts.ok);
 if(!ready.length){
   console.error('No audio tracks are ready. Check /audio_segments/01/seg_0000.wav and the browser console.');
   $('#status').textContent='0/48 ready · audio unavailable';
   return;
 }
 const t=Math.max(0,Math.min(duration,+$('#seek').value||time()||0));
 playAllFrom(t);
 playing=true;
 $('#play').textContent='❚❚ PAUSE';
 mix();
}
function pause(){
 const pos=time();
 trackState.forEach(ts=>stopTrack(ts));
 playing=false;playStartPos=pos;playStartCtxTime=null;
 $('#play').textContent='▶ PLAY';
}
function mix(){if(!ctx)return;trackState.forEach((ts,i)=>{if(ts.gain)ts.gain.gain.setTargetAtTime(solo===null||solo===i?1:0,ctx.currentTime,.12)})}
function time(){if(!ctx||!playing||playStartCtxTime==null)return playStartPos;return Math.max(0,Math.min(duration,playStartPos+(ctx.currentTime-playStartCtxTime)))}
function fmt(t){return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`}
function seek(t){
 t=Math.max(0,Math.min(duration,Number(t)||0));
 if(playing&&ctx)playAllFrom(t);else playStartPos=t;
 $('#seek').value=t;$('#time').textContent=fmt(t);
}
// Game-studio-card pacing: a dim epigraph holds and fades on its own, then
// the title card fades in and waits for the user's own gesture (needed
// anyway to unlock AudioContext) before the menu appears.
function runIntroSequence(){
  setTimeout(()=>{
    $('#preIntro').classList.add('hide');
    $('#intro').classList.add('show');
  },5200);
}
function fadeAudioTo(a,target,ms,done){
  const start=a.volume,t0=performance.now();
  (function step(){
    const t=Math.min(1,(performance.now()-t0)/Math.max(1,ms));
    a.volume=start+(target-start)*t;
    if(t<1)requestAnimationFrame(step);else if(done)done();
  })();
}
function initMenuAmbient(){
  const list=segments['01'];
  if(!list||!list.length)return;
  const{idx}=segIndexForTime('01',143);
  const seg=list[idx]||list[0];
  const a=$('#menuAmbient');
  a.src=`audio_segments/01/${seg.f}`;
  a.volume=0;
}
function menuAmbientSet(active){
  const a=$('#menuAmbient');
  if(!a.src)return;
  if(active){a.play().catch(()=>{});fadeAudioTo(a,.09,900)}
  else fadeAudioTo(a,0,500,()=>a.pause());
}
$('#enter').onclick=async()=>{$('#intro').style.opacity='0';setTimeout(()=>{$('#intro').style.display='none'},600);showView('mainMenu');setupGraph();await ctx.resume()};$('#play').onclick=()=>playing?pause():start();
$('#seek').onpointerdown=()=>seekBusy=true;$('#seek').oninput=e=>{$('#time').textContent=fmt(+e.target.value)};$('#seek').onchange=e=>{seek(+e.target.value);seekBusy=false};
$('#volume').oninput=e=>{masterVolume=+e.target.value;if(master)master.gain.setTargetAtTime(masterVolume,ctx.currentTime,.05)};
function resize(){C.width=C.clientWidth*devicePixelRatio;C.height=C.clientHeight*devicePixelRatio}addEventListener('resize',resize);

// ---- bell physics: an onset (strike) jumps the glow up; each frame it
// decays like a real bell's resonance, with a live floor so sustained hum
// still shows. A strike also emits a ripple that spreads and interferes
// with others — visually, the "collective action" the piece is about.
function updateNodes(){
  nodes.forEach((n,i)=>{
    const ts=trackState[i];
    let level=0;
    if(ts?.an&&playing){
      ts.an.getByteTimeDomainData(ts.td);
      let sum=0;for(let k=0;k<ts.td.length;k++){const v=(ts.td[k]-128)/128;sum+=v*v}
      level=Math.min(1,Math.sqrt(sum/ts.td.length)*3.4);
    }
    n.levelSmooth=n.levelSmooth*.55+level*.45;
    const delta=n.levelSmooth-n.prevLevel;
    if(delta>.06&&n.levelSmooth>.09&&frameNow-n.lastStrike>220){
      const strength=Math.min(1,n.levelSmooth*1.5);
      n.glow=Math.min(1.4,n.glow+strength*1.1);
      n.lastStrike=frameNow;
      if(ripples.length>90)ripples.shift();
      ripples.push({x:n.cx,y:n.cy,t:frameNow,strength,hue:n.hue});
    }
    n.prevLevel=n.prevLevel*.85+n.levelSmooth*.15;
    n.glow*=.975;
    // Deliberately a small floor, not a proportional one: with 48 tracks,
    // giving every track's ambient noise floor real visual weight made most
    // of the window glow faintly all the time, which reads as "not synced"
    // — most of what's lit wasn't tied to an audible event. Strikes (the
    // jump logic above) should be what makes a fragment visibly light up.
    n.glow=Math.max(n.glow,Math.min(.06,n.levelSmooth*.15));
  });
}

// Each fragment gets one small painted motif — the way a real stained-glass
// piece isn't just colored glass but a leaded painting of something. We have
// no factual basis to invent which saint or scene a specific church actually
// used, so these are honest abstractions tied to the one thing we do know
// for certain: it is a church, and its bell rings. Four motifs (bell, gothic
// rosette, cross, pointed arch/window) cycle across the 48 voices so
// neighboring fragments read as distinct pieces, individually and together.
function iconPath(ctx2d,type){
  ctx2d.beginPath();
  if(type===0){
    ctx2d.moveTo(-.05,-.85);ctx2d.lineTo(.05,-.85);ctx2d.lineTo(.05,-.72);
    ctx2d.bezierCurveTo(.32,-.68,.5,-.4,.46,-.05);
    ctx2d.lineTo(.58,.28);ctx2d.quadraticCurveTo(.6,.4,.46,.4);
    ctx2d.lineTo(-.46,.4);ctx2d.quadraticCurveTo(-.6,.4,-.58,.28);
    ctx2d.lineTo(-.46,-.05);ctx2d.bezierCurveTo(-.5,-.4,-.32,-.68,-.05,-.72);
    ctx2d.closePath();
    ctx2d.moveTo(.07,.5);ctx2d.arc(0,.5,.07,0,Math.PI*2);
  }else if(type===1){
    for(let k=0;k<4;k++){
      const a=k*Math.PI/2;
      ctx2d.moveTo(Math.cos(a)*.42+.32,Math.sin(a)*.42);
      ctx2d.arc(Math.cos(a)*.42,Math.sin(a)*.42,.32,0,Math.PI*2);
    }
    ctx2d.moveTo(.18,0);ctx2d.arc(0,0,.18,0,Math.PI*2);
  }else if(type===2){
    ctx2d.rect(-.12,-.8,.24,1.6);
    ctx2d.rect(-.45,-.15,.9,.3);
  }else{
    ctx2d.moveTo(-.45,.75);ctx2d.lineTo(-.45,.05);
    ctx2d.quadraticCurveTo(-.45,-.55,0,-.85);
    ctx2d.quadraticCurveTo(.45,-.55,.45,.05);
    ctx2d.lineTo(.45,.75);
    ctx2d.moveTo(-.28,.75);ctx2d.lineTo(-.28,.1);
    ctx2d.quadraticCurveTo(-.28,-.35,0,-.55);
    ctx2d.quadraticCurveTo(.28,-.35,.28,.1);
    ctx2d.lineTo(.28,.75);
  }
}
// The mosaic is the "paint" — many small colored panes, each with its own
// slight hue/light/shimmer variation off the shard's base hue. The icon
// silhouette is the "leading" — the dark line-work a real window uses to
// define a recognizable shape over the colored glass.
function drawMosaic(ctx2d,n,toScreen,pxPerUnit){
  const glow=Math.min(1,n.glow);
  const [cx,cy]=toScreen(n.cx,n.cy);
  const size=Math.max(14,n.boundR*pxPerUnit);
  ctx2d.save();
  ctx2d.translate(cx,cy);
  ctx2d.scale(size,size);
  n.mosaic.forEach(cell=>{
    ctx2d.beginPath();
    cell.poly.forEach((p,k)=>k?ctx2d.lineTo(p.x,p.y):ctx2d.moveTo(p.x,p.y));
    ctx2d.closePath();
    const shimmer=Math.sin(frameNow*.0006+cell.phase)*3;
    const hue=n.hue+cell.hueShift;
    const light=Math.max(1.5,Math.min(74,4+glow*52+cell.lightShift*(.35+glow*.65)+shimmer*glow));
    const sat=26+glow*44;
    ctx2d.fillStyle=`hsla(${hue},${sat}%,${light}%,1)`;
    ctx2d.fill();
    ctx2d.lineWidth=.018;
    ctx2d.strokeStyle=`rgba(6,5,4,${.55+glow*.25})`;
    ctx2d.stroke();
  });
  ctx2d.restore();
}
function drawIcon(ctx2d,n,toScreen,pxPerUnit){
  const glow=Math.min(1,n.glow);
  const [cx,cy]=toScreen(n.cx,n.cy);
  const size=Math.max(12,n.boundR*pxPerUnit*.52);
  ctx2d.save();
  ctx2d.translate(cx,cy);
  ctx2d.scale(size,size);
  ctx2d.lineWidth=.07;
  iconPath(ctx2d,n.iconType);
  ctx2d.strokeStyle=`rgba(8,7,5,${.5+glow*.35})`;
  ctx2d.stroke();
  ctx2d.restore();
}
function fillShard(ctx2d,n,toScreen,pxPerUnit){
  const pts=n.poly.map(p=>toScreen(p.x,p.y));
  ctx2d.save();
  ctx2d.beginPath();
  pts.forEach((p,k)=>k?ctx2d.lineTo(p[0],p[1]):ctx2d.moveTo(p[0],p[1]));
  ctx2d.closePath();
  const glow=Math.min(1,n.glow),breath=Math.sin(frameNow*.00025+n.hue)*.5;
  const [cx,cy]=toScreen(n.cx,n.cy);
  const rad=Math.max(18*devicePixelRatio,n.boundR*pxPerUnit*1.15);
  const grad=ctx2d.createRadialGradient(cx,cy,0,cx,cy,rad);
  grad.addColorStop(0,`hsla(${n.hue},${16+glow*58}%,${2+glow*60+breath}%,1)`);
  grad.addColorStop(.65,`hsla(${n.hue},${13+glow*46}%,${1.5+glow*38+breath*.6}%,1)`);
  grad.addColorStop(1,`hsla(${n.hue},10%,${1+glow*8}%,1)`);
  ctx2d.fillStyle=grad;
  ctx2d.fill();
  // Lead-line outline is deliberately warm and visible even completely unlit
  // (rather than near-black-on-black) — with nothing playing, this is the
  // only cue that a shard is there and clickable at all.
  ctx2d.lineWidth=Math.max(1,1.3*devicePixelRatio);
  ctx2d.strokeStyle=`rgba(120,96,62,${.4+glow*.5})`;
  ctx2d.stroke();
  ctx2d.clip();
  drawMosaic(ctx2d,n,toScreen,pxPerUnit);
  drawIcon(ctx2d,n,toScreen,pxPerUnit);
  ctx2d.restore();
}
// Ripples get a hand-drawn wobble (two low-frequency sine harmonics on the
// radius) instead of a perfect arc — an organic, water-like edge rather than
// a mathematical one, closer to how light actually spreads through glass.
function drawRipples(ctx2d,toScreen,pxPerUnit){
  const lifeMs=2600,STEPS=48;
  ctx2d.save();
  ctx2d.globalCompositeOperation='lighter';
  ripples.forEach(r=>{
    const age=frameNow-r.t;
    if(age>lifeMs||age<0)return;
    const t=age/lifeMs,baseR=t*1.3*pxPerUnit,alpha=(1-t)*.5*r.strength;
    if(alpha<=.003)return;
    const [sx,sy]=toScreen(r.x,r.y);
    ctx2d.beginPath();
    for(let i=0;i<=STEPS;i++){
      const ang=(i/STEPS)*Math.PI*2;
      const wob=1+Math.sin(ang*3+r.t*.002)*.035+Math.sin(ang*7-r.t*.0015)*.02;
      const rad=baseR*wob,x=sx+Math.cos(ang)*rad,y=sy+Math.sin(ang)*rad;
      i?ctx2d.lineTo(x,y):ctx2d.moveTo(x,y);
    }
    ctx2d.closePath();
    ctx2d.strokeStyle=`hsla(${r.hue},70%,75%,${alpha})`;
    ctx2d.lineWidth=Math.max(1,(2.2-t*1.6)*devicePixelRatio);
    ctx2d.stroke();
  });
  ctx2d.restore();
  ripples=ripples.filter(r=>frameNow-r.t<lifeMs);
}
// Fine radiating lines from the window's center to every church — a quiet
// nod to the precision-data-grid aesthetic (Ikeda), and a literal reading of
// "one network, forty-eight nodes." Brightness tracks that voice's glow, so
// the network itself seems to activate when a bell rings.
function drawTracery(ctx2d,toScreen,alphaMul){
  if(alphaMul<=.01)return;
  const [cx,cy]=toScreen(0,0);
  ctx2d.save();
  nodes.forEach(n=>{
    const glow=Math.min(1,n.glow),a=(.015+glow*.32)*alphaMul;
    if(a<=.008)return;
    const [nx,ny]=toScreen(n.cx,n.cy);
    ctx2d.strokeStyle=`hsla(${n.hue},55%,72%,${a})`;
    ctx2d.lineWidth=Math.max(.4,(.4+glow*1.1)*devicePixelRatio);
    ctx2d.beginPath();ctx2d.moveTo(cx,cy);ctx2d.lineTo(nx,ny);ctx2d.stroke();
  });
  ctx2d.restore();
}
// Ambient light motes drifting up out of whichever churches are ringing —
// density and brightness follow the collective energy of all 48 tracks, so
// a fuller chorus visibly fills the window with more light, not just more
// individual glow (Anadol's flowing "data sculpture" particle clouds).
function spawnParticles(){
  const avgGlow=nodes.reduce((s,n)=>s+Math.min(1,n.glow),0)/nodes.length;
  const target=Math.min(260,Math.floor(30+avgGlow*260));
  let guard=0;
  while(particles.length<target&&guard++<12){
    const n=nodes[Math.floor(Math.random()*nodes.length)];
    const w=Math.min(1,n.glow);
    if(Math.random()>.12+w*.7)continue;
    const ang=Math.random()*Math.PI*2,r=Math.random()*n.boundR*.55;
    particles.push({
      x:n.cx+Math.cos(ang)*r,y:n.cy+Math.sin(ang)*r,
      vx:(Math.random()-.5)*.015,vy:-.015-Math.random()*.025,
      life:0,maxLife:3200+Math.random()*3200,hue:n.hue,size:.4+Math.random()*1.1,
    });
  }
}
function updateParticles(dt){
  particles.forEach(p=>{
    p.life+=dt;
    p.x+=p.vx*dt*.001;p.y+=p.vy*dt*.001;
    p.vx+=Math.sin(frameNow*.0005+p.y*10)*.00004*dt;
  });
  particles=particles.filter(p=>p.life<p.maxLife);
}
function drawParticles(ctx2d,toScreen,pxPerUnit){
  ctx2d.save();
  ctx2d.globalCompositeOperation='lighter';
  particles.forEach(p=>{
    const t=p.life/p.maxLife,alpha=Math.sin(Math.min(1,t)*Math.PI)*.5;
    if(alpha<=.01)return;
    const [sx,sy]=toScreen(p.x,p.y);
    const r=Math.max(.6,p.size*devicePixelRatio*Math.min(1.6,pxPerUnit/520));
    ctx2d.beginPath();ctx2d.arc(sx,sy,r,0,Math.PI*2);
    ctx2d.fillStyle=`hsla(${p.hue},80%,82%,${alpha})`;
    ctx2d.fill();
  });
  ctx2d.restore();
}
// Cheap bloom: downscale the current frame, blur the small copy (far fewer
// pixels than blurring at full resolution), then screen it back over the
// full-size canvas — lit fragments and ripples pick up a soft halo instead
// of reading as flat, sharply-clipped shapes.
function applyBloom(w,h){
  const bw=Math.max(64,Math.round(w/3)),bh=Math.max(64,Math.round(h/3));
  if(bloomC.width!==bw||bloomC.height!==bh){bloomC.width=bw;bloomC.height=bh}
  bloomG.clearRect(0,0,bw,bh);
  bloomG.drawImage(C,0,0,bw,bh);
  g.save();
  g.globalCompositeOperation='lighter';
  g.filter='blur(10px)';
  g.globalAlpha=.4;
  g.drawImage(bloomC,0,0,bw,bh,0,0,w,h);
  g.restore();
}
function drawFrame(ctx2d,toScreen,pxPerUnit,aspectX,alphaMul){
  if(alphaMul<=.01)return;
  const [cx,cy]=toScreen(0,0);
  ctx2d.beginPath();ctx2d.ellipse(cx,cy,1.02*pxPerUnit*aspectX,1.02*pxPerUnit,0,0,Math.PI*2);
  ctx2d.strokeStyle=`rgba(40,28,18,${.65*alphaMul})`;
  ctx2d.lineWidth=Math.max(2,4*devicePixelRatio);
  ctx2d.stroke();
  ctx2d.beginPath();ctx2d.ellipse(cx,cy,1.1*pxPerUnit*aspectX,1.1*pxPerUnit,0,0,Math.PI*2);
  ctx2d.strokeStyle=`rgba(90,68,42,${.28*alphaMul})`;
  ctx2d.lineWidth=Math.max(1,1.5*devicePixelRatio);
  ctx2d.stroke();
}

function draw(){
 requestAnimationFrame(draw);
 frameNow=performance.now();
 const dt=lastFrameNow?Math.min(100,frameNow-lastFrameNow):16;
 lastFrameNow=frameNow;
 const w=C.width,h=C.height;
 if(!w||!h)return;
 updateNodes();
 spawnParticles();
 updateParticles(dt);
 camera.scale+=(cameraTarget.scale-camera.scale)*.06;
 camera.cx+=(cameraTarget.cx-camera.cx)*.06;
 camera.cy+=(cameraTarget.cy-camera.cy)*.06;
 focusAmt+=(focusAmtTarget-focusAmt)*.07;
 if(focusAmtTarget===0&&focusAmt<.015&&focus!==null)focus=null;

 // The real geographic extent of Dresden is roughly as tall as it is wide, so
 // a true-aspect circular fit on a 65" 16:9 display leaves large empty bands
 // left and right. Stretching x uniformly fills the screen without touching
 // any north/south/east/west ordering between churches — nothing crosses
 // over, only absolute distances change, so the map is still honest.
 lastAspectX=Math.min(2.2,Math.max(1,w/h));
 const R=Math.min(w,h)*.42,baseCx=w/2,baseCy=h/2,pxPerUnit=camera.scale*R;
 const toScreen=(px,py)=>[baseCx+(px-camera.cx)*pxPerUnit*lastAspectX,baseCy+(py-camera.cy)*pxPerUnit];

 g.fillStyle='#050403';
 g.fillRect(0,0,w,h);
 drawTracery(g,toScreen,1-focusAmt);

 if(focusAmt>.01&&focus!==null){
   if(off.width!==w||off.height!==h){off.width=w;off.height=h}
   offG.setTransform(1,0,0,1,0,0);
   offG.fillStyle='#050403';offG.fillRect(0,0,w,h);
   nodes.forEach((n,i)=>{if(i!==focus)fillShard(offG,n,toScreen,pxPerUnit)});
   g.save();
   g.filter=`blur(${(4+focusAmt*14)*devicePixelRatio}px) saturate(${Math.max(.06,1-focusAmt*.85)}) brightness(${1-focusAmt*.35})`;
   g.drawImage(off,0,0);
   g.restore();
   fillShard(g,nodes[focus],toScreen,pxPerUnit);
 }else{
   nodes.forEach(n=>fillShard(g,n,toScreen,pxPerUnit));
 }

 drawRipples(g,toScreen,pxPerUnit);
 drawParticles(g,toScreen,pxPerUnit);
 applyBloom(w,h);
 drawFrame(g,toScreen,pxPerUnit,lastAspectX,1-focusAmt);

 if(!seekBusy){let t=time();$('#seek').value=t;$('#time').textContent=fmt(t)}
}

// A short, honest one-liner per church, built only from data we actually
// have (district + real bearing from the city center) rather than invented
// history — the panel's long paragraph still has the fuller description.
function kickerFor(n,t){
  if(t.confidence==='unconfirmed')return"A technical relay channel from the 1995 recording, not tied to a confirmed church.";
  const ns=n.gy<-.12?'north':n.gy>.12?'south':'',ew=n.gx<-.12?'west':n.gx>.12?'east':'';
  const dir=[ns,ew].filter(Boolean).join('') ;
  const where=dir?`${dir} of the city center`:'near the city center';
  return `${t.stadtteil?t.stadtteil+', ':''}${where} — one of forty-seven towers in Wallmann's 1995 requiem.`;
}
function select(i){
  solo=i;mix();focus=i;focusAmtTarget=1;
  const n=nodes[i],t=tracks[i];
  cameraTarget={scale:Math.min(6,Math.max(2.4,.55/n.boundR)),cx:n.cx,cy:n.cy};
  $('#scene').classList.add('focus');
  $('#detailName').textContent=t.church_name||t.archive_label;
  $('#detailTrack').textContent=`VOICE ${String(i+1).padStart(2,'0')} · ${t.stadtteil||'Dresden'}`;
  $('#detailGeo').textContent=t.confidence==='unconfirmed'
    ? 'Location unconfirmed · archival reference channel'
    : `${t.latitude.toFixed(4)}° N · ${t.longitude.toFixed(4)}° E${t.confidence==='approximate'?' (approximate)':''}`;
  $('#detailKicker').textContent=kickerFor(n,t);
  $('#detailText').textContent=`${t.description} Isolated at ${fmt(time())} in the timeline. The remaining forty-seven voices continue at the same position, unheard, so the whole city returns in sync when you step back.`;
}
function clear(){solo=null;focusAmtTarget=0;mix();cameraTarget={scale:1,cx:0,cy:0};$('#scene').classList.remove('focus')}
$('#returnCity').onclick=clear;$('#closeDetail').onclick=clear;
// ---- touch: one finger pans, two fingers pinch-zoom, a still tap selects.
// Disabled while a fragment is focused so it can't fight the programmatic
// zoom-to-fragment animation — "Return to the City" is the way out of that.
const CAM_SCALE_MIN=1,CAM_SCALE_MAX=8,CAM_PAN_LIMIT=1.9;
let activePointers=new Map(),dragState=null,pinchState=null;
function clientToCanvasPx(e){
  const r=C.getBoundingClientRect();
  return[(e.clientX-r.left)/r.width*C.width,(e.clientY-r.top)/r.height*C.height];
}
function screenToGeo(mx,my){
  const w=C.width,h=C.height,R=Math.min(w,h)*.42,pxPerUnit=camera.scale*R;
  return[(mx-w/2)/(pxPerUnit*lastAspectX)+camera.cx,(my-h/2)/pxPerUnit+camera.cy];
}
function clampCamera(){
  camera.scale=Math.min(CAM_SCALE_MAX,Math.max(CAM_SCALE_MIN,camera.scale));
  camera.cx=Math.min(CAM_PAN_LIMIT,Math.max(-CAM_PAN_LIMIT,camera.cx));
  camera.cy=Math.min(CAM_PAN_LIMIT,Math.max(-CAM_PAN_LIMIT,camera.cy));
  cameraTarget.scale=camera.scale;cameraTarget.cx=camera.cx;cameraTarget.cy=camera.cy;
}
C.addEventListener('pointerdown',e=>{
  if(focus!==null)return;
  try{C.setPointerCapture(e.pointerId)}catch(err){}
  const[mx,my]=clientToCanvasPx(e);
  activePointers.set(e.pointerId,{mx,my});
  if(activePointers.size===1){
    dragState={mx,my,camCx:camera.cx,camCy:camera.cy,moved:false};
    pinchState=null;
  }else if(activePointers.size===2){
    dragState=null;
    const pts=[...activePointers.values()];
    pinchState={
      dist:Math.max(1,Math.hypot(pts[0].mx-pts[1].mx,pts[0].my-pts[1].my)),
      scale:camera.scale,
      midMx:(pts[0].mx+pts[1].mx)/2,midMy:(pts[0].my+pts[1].my)/2,
      camCx:camera.cx,camCy:camera.cy,
    };
  }
});
C.addEventListener('pointermove',e=>{
  if(!activePointers.has(e.pointerId))return;
  const[mx,my]=clientToCanvasPx(e);
  activePointers.set(e.pointerId,{mx,my});
  const w=C.width,h=C.height,R=Math.min(w,h)*.42;
  if(activePointers.size===2&&pinchState){
    const pts=[...activePointers.values()];
    const dist=Math.max(1,Math.hypot(pts[0].mx-pts[1].mx,pts[0].my-pts[1].my));
    camera.scale=pinchState.scale*(dist/pinchState.dist);
    const midMx=(pts[0].mx+pts[1].mx)/2,midMy=(pts[0].my+pts[1].my)/2;
    const pxPerUnit=camera.scale*R;
    camera.cx=pinchState.camCx-(midMx-pinchState.midMx)/(pxPerUnit*lastAspectX);
    camera.cy=pinchState.camCy-(midMy-pinchState.midMy)/pxPerUnit;
    clampCamera();
  }else if(activePointers.size===1&&dragState){
    const dx=mx-dragState.mx,dy=my-dragState.my;
    if(Math.hypot(dx,dy)>6)dragState.moved=true;
    if(dragState.moved){
      const pxPerUnit=camera.scale*R;
      camera.cx=dragState.camCx-dx/(pxPerUnit*lastAspectX);
      camera.cy=dragState.camCy-dy/pxPerUnit;
      clampCamera();
    }
  }
});
function endPointer(e){
  const wasSingleStillTap=activePointers.size===1&&dragState&&!dragState.moved;
  activePointers.delete(e.pointerId);
  if(activePointers.size<2)pinchState=null;
  if(activePointers.size===0){
    if(wasSingleStillTap&&focus===null){
      const[mx,my]=clientToCanvasPx(e);
      const[gx,gy]=screenToGeo(mx,my);
      for(let i=0;i<nodes.length;i++){if(pointInPoly(gx,gy,nodes[i].poly)){select(i);break}}
    }
    dragState=null;
  }
}
C.addEventListener('pointerup',endPointer);
C.addEventListener('pointercancel',endPointer);
C.style.touchAction='none';
// No periodic resync loop needed: every track's playback is scheduled
// against the same AudioContext clock (see playAllFrom), so there is no
// per-track drift to correct.
