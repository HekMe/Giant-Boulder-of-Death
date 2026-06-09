import 'https://cdn.babylonjs.com/babylon.js';

const $ = (id) => document.getElementById(id);
const toastEl = $('toast');
const showToast = (txt, ms = 1700) => {
  toastEl.textContent = txt;
  toastEl.style.display = 'block';
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => (toastEl.style.display = 'none'), ms);
};

function fatalError(message, detail) {
  const el = $('fatalError');
  if (el) {
    $('fatalMessage').textContent = message;
    $('fatalDetail').textContent = detail || '';
    el.classList.remove('hidden');
  }
  console.error(message, detail);
}

const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
if (isMobile) document.body.classList.add('mobile');

const saveKey = 'boulder_rampage_babylon_v2';
const defaultSave = () => ({
  version: 2,
  currencies: { coins: 500, gems: 30 },
  upgrades: { jump_height: 0, steering_speed: 0, overdrive_duration: 0 },
  completedGoals: [],
  goalProgress: {},
  stats: { bestDistance: 0, bestScore: 0, totalRuns: 0, totalDestructions: 0, totalOverdrives: 0 }
});
let save = (() => {
  try { return { ...defaultSave(), ...JSON.parse(localStorage.getItem(saveKey) || '{}') }; }
  catch { return defaultSave(); }
})();
const persistSave = () => localStorage.setItem(saveKey, JSON.stringify(save));

async function fetchJson(path) {
  const clean = path.replace(/^\/+/, '');
  const cands = [clean, `./${clean}`, `public/${clean}`, `/${clean}`];
  let lastErr = null;
  for (const p of cands) {
    try {
      const r = await fetch(p);
      if (r.ok) return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Cannot load ${path}${lastErr ? ` (${lastErr.message})` : ''}`);
}

let balance, objectsCfg, goalsCfg, upgradesCfg, spinnersCfg;
try {
  [balance, objectsCfg, goalsCfg, upgradesCfg, spinnersCfg] = await Promise.all([
    fetchJson('data/balance.json'),
    fetchJson('data/objects.json'),
    fetchJson('data/goals.json'),
    fetchJson('data/upgrades.json'),
    fetchJson('data/spinners.json')
  ]);
} catch (err) {
  fatalError('Could not load game configuration.',
    `${err.message}. Make sure the game is served over a web server (not file://) and that the data/ folder exists.`);
  showToast('Error: configuration failed to load', 6000);
  throw err;
}

if (typeof BABYLON === 'undefined') {
  fatalError('Babylon.js failed to load.',
    'Check your internet connection (CDN) or your CSP settings.');
  throw new Error('BABYLON undefined');
}

const R = balance.physics.radius;

// ---------------------------------------------------------------------------
// TERRAIN: a continuous, winding heightfield that descends down a mountain.
// centerX(z) is the path's centerline; terrainY(x,z) is the surface height.
// Both builds (module + gist) share the exact same functions.
// ---------------------------------------------------------------------------
const SLOPE_GRADE = 0.13;                 // overall metres dropped per metre forward
function centerX(z) {
  return Math.sin(z * 0.0062) * 7.5 + Math.sin(z * 0.019 + 1.7) * 3.2;
}
function terrainY(x, z) {
  const descent = -z * SLOPE_GRADE;                          // the hill goes down
  const rolling = Math.sin(z * 0.017) * 2.3 + Math.sin(z * 0.0055 + 0.7) * 3.1; // big rolls
  const offset = x - centerX(z);
  const valley = (Math.cos(offset * 0.11) - 1) * 0.9;        // gentle banked chute
  const ripple = Math.sin(z * 0.22 + x * 0.13) * 0.18;       // micro bumps
  return descent + rolling + valley + ripple;
}

const canvas = $('game');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.68, 0.84, 1, 1);
scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
scene.fogColor = new BABYLON.Color3(0.75, 0.85, 1);
scene.fogStart = 120; scene.fogEnd = 320;

const light = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0, 1, 0), scene);
light.intensity = 0.92;
light.groundColor = new BABYLON.Color3(0.4, 0.45, 0.5);
const dLight = new BABYLON.DirectionalLight('d', new BABYLON.Vector3(-0.4, -1, 0.3), scene);
dLight.position = new BABYLON.Vector3(40, 120, -40);
dLight.intensity = 0.7;

const camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 8, -12), scene);
camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;

const boulder = BABYLON.MeshBuilder.CreateSphere('boulder', { diameter: R * 2, segments: 20 }, scene);
const boulderMat = new BABYLON.StandardMaterial('bmat', scene);
boulderMat.diffuseColor = new BABYLON.Color3(0.56, 0.55, 0.5);
boulderMat.specularColor = BABYLON.Color3.Black();
boulder.material = boulderMat;

const trail = BABYLON.MeshBuilder.CreateCylinder('trail', { height: 3, diameterTop: 1.2, diameterBottom: 2.2, tessellation: 8 }, scene);
trail.rotation.x = Math.PI / 2;
const tmat = new BABYLON.StandardMaterial('tmat', scene);
tmat.emissiveColor = new BABYLON.Color3(0.3, 0.8, 1);
tmat.alpha = 0;
trail.material = tmat;

const CHUNK_TYPES = ['STRAIGHT','S_CURVE','NARROW','VILLAGE_CLUSTER','FOREST_DENSE','CLIFF_BUMPY','HAZARD_GAUNTLET'];
const chunkCfg = {
  STRAIGHT:{w:14,hm:0.8,dm:1}, S_CURVE:{w:12,hm:1,dm:1}, NARROW:{w:8.5,hm:.9,dm:.8},
  VILLAGE_CLUSTER:{w:13,hm:1.05,dm:1.4}, FOREST_DENSE:{w:11.2,hm:.95,dm:1.25},
  CLIFF_BUMPY:{w:9.5,hm:1.15,dm:.9}, HAZARD_GAUNTLET:{w:10.2,hm:1.6,dm:.7}
};
const chunkLen = 45;
const chunks = [];
let nextChunkZ = 0;

const objectPool = { destructible:[], hazard:[], pickup_coin:[], pickup_gem:[], telegraph:[] };
const rand = (a,b)=>a+Math.random()*(b-a);
const pickType = (id)=>objectsCfg.objects.find(o=>o.id===id);

function meshForCategory(cat) {
  let m;
  if (cat==='destructible') m = BABYLON.MeshBuilder.CreateBox('d',{size:1.2},scene);
  else if (cat==='hazard') m = BABYLON.MeshBuilder.CreateCylinder('h',{diameterTop:0,diameterBottom:1.2,height:1.3,tessellation:6},scene);
  else if (cat==='pickup_coin') m = BABYLON.MeshBuilder.CreateTorus('c',{diameter:.75,thickness:.2,tessellation:12},scene);
  else if (cat==='pickup_gem') m = BABYLON.MeshBuilder.CreatePolyhedron('g',{type:1,size:.45},scene);
  else m = BABYLON.MeshBuilder.CreatePlane('t',{size:1.1},scene);
  const mat = new BABYLON.StandardMaterial('m'+Math.random(),scene);
  if (cat==='destructible') mat.diffuseColor = new BABYLON.Color3(0.6,0.43,0.27);
  else if (cat==='hazard') mat.diffuseColor = new BABYLON.Color3(0.2,0.2,0.2);
  else if (cat==='pickup_coin') { mat.diffuseColor = new BABYLON.Color3(1,0.86,0.22); mat.emissiveColor = new BABYLON.Color3(.2,.14,0); }
  else if (cat==='pickup_gem') { mat.diffuseColor = new BABYLON.Color3(.2,.9,1); mat.emissiveColor = new BABYLON.Color3(.08,.22,.3); }
  else { mat.diffuseColor = new BABYLON.Color3(1,.77,.2); mat.emissiveColor = new BABYLON.Color3(.2,.12,0); }
  mat.specularColor = BABYLON.Color3.Black();
  m.material = mat;
  return m;
}
function getObj(cat){ return objectPool[cat].pop() || meshForCategory(cat); }
function releaseObj(o){ o.setEnabled(false); objectPool[o.metadata.category].push(o); }

// Build a subdivided ribbon that follows centerX + terrainY across [z0, z0+len].
function buildGroundMesh(z0, width) {
  const zSteps = 14, xSteps = 8;
  const paths = [];
  for (let i = 0; i <= zSteps; i++) {
    const z = z0 + (chunkLen * i) / zSteps;
    const cx = centerX(z);
    const row = [];
    for (let j = 0; j <= xSteps; j++) {
      const t = j / xSteps;
      const x = cx + (t - 0.5) * width;
      row.push(new BABYLON.Vector3(x, terrainY(x, z), z));
    }
    paths.push(row);
  }
  const mesh = BABYLON.MeshBuilder.CreateRibbon('ground', { pathArray: paths, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
  const gmat = new BABYLON.StandardMaterial('gm' + Math.random(), scene);
  gmat.diffuseColor = new BABYLON.Color3(0.36, 0.55, 0.32);
  gmat.specularColor = BABYLON.Color3.Black();
  gmat.backFaceCulling = false;
  mesh.material = gmat;
  return mesh;
}

function createChunk(typeName, z0) {
  const cfg = chunkCfg[typeName];
  const ground = buildGroundMesh(z0, cfg.w);
  return { typeName, width: cfg.w, z0, objects: [], ground, blocked: [] };
}
function weightedType(distance){
  const phase = distance<800?'e':distance<2400?'m':'l';
  const w={STRAIGHT:phase==='e'?1.5:1,S_CURVE:phase==='e'?1:1.3,NARROW:phase==='l'?1.4:.8,VILLAGE_CLUSTER:1.2,FOREST_DENSE:1.1,CLIFF_BUMPY:phase==='l'?1.2:.9,HAZARD_GAUNTLET:phase==='e'?.35:phase==='m'?1:1.4};
  let total=0; CHUNK_TYPES.forEach(k=>total+=w[k]);
  let r=Math.random()*total;
  for(const k of CHUNK_TYPES){ r-=w[k]; if(r<=0) return k; }
  return 'STRAIGHT';
}
function fairness(z, speed, chunk, lane){
  const minD = speed*0.65+6;
  const lookAhead = Math.max(3,Math.min(10,speed*0.22));
  if ((z-player.z) < minD-lookAhead) return false;
  if (chunk.blocked.includes(lane)) return false;
  return true;
}
function fillChunk(chunk, dif){
  const dens = dif<.33?balance.spawning.early:dif<.66?balance.spawning.mid:balance.spawning.late;
  const cfg = chunkCfg[chunk.typeName];
  const z0 = chunk.z0;
  const half = chunk.width*.5-1;
  const laneFrac = [-0.7, 0, 0.7];
  chunk.blocked=[];
  const lessSpikes = player.buffs.less_spikes?.stacks?0.75:1;
  const gemMul = player.buffs.gem_frequency?.stacks?1.25:1;

  const cD=Math.round((dens.destructibles/100)*chunkLen*cfg.dm);
  const cH=Math.round((dens.hazards/100)*chunkLen*cfg.hm*lessSpikes);
  const cC=Math.round((dens.coins/100)*chunkLen);
  const cG=Math.round((dens.gems/100)*chunkLen*gemMul);

  const place = (m, xRel, z, yOff) => {
    const x = centerX(z) + xRel;
    m.position.set(x, terrainY(x, z) + yOff, z);
  };

  for(let i=0;i<cD;i++){
    const id = i%3===0?'cart_market':i%2===0?'hut_wood_a':'fence_long';
    const type=pickType(id);
    const m=getObj(type.category); m.metadata={type,category:type.category}; m.setEnabled(true);
    place(m, rand(-half,half), z0+rand(2,chunkLen-2), 0.7);
    chunk.objects.push(m);
  }
  for(let i=0;i<cH;i++){
    const lane=Math.floor(Math.random()*3)-1;
    const xRel = laneFrac[lane+1]*half + rand(-.4,.4);
    const z = z0+rand(8,chunkLen-2);
    if(!fairness(z,player.speed,chunk,lane)) continue;
    const isMine=Math.random()<.4;
    const type=pickType(isMine?'mine_barrel':'spike_patch');
    if (isMine && player.buffs.dud_mines?.stacks && Math.random()<0.35) continue;
    const m=getObj(type.category); m.metadata={type,category:type.category}; m.setEnabled(true);
    place(m, xRel, z, 0.65); chunk.objects.push(m);
    const tele=getObj('telegraph'); tele.metadata={category:'telegraph'}; tele.setEnabled(true);
    tele.rotation.x=Math.PI/2; place(tele, xRel, z-4.5, 0.06); chunk.objects.push(tele);
    if(!chunk.blocked.includes(lane)) chunk.blocked.push(lane);
    if(chunk.blocked.length>=2 && chunk.typeName!=='HAZARD_GAUNTLET') break;
  }
  for(let i=0;i<cC;i++){
    const type=pickType('coin_pickup');
    const m=getObj(type.category); m.metadata={type,category:type.category}; m.setEnabled(true);
    place(m, rand(-half,half), z0+rand(2,chunkLen-2), 1.1); chunk.objects.push(m);
  }
  for(let i=0;i<cG;i++){
    const type=pickType('gem_pickup');
    const m=getObj(type.category); m.metadata={type,category:type.category}; m.setEnabled(true);
    place(m, rand(-half,half), z0+rand(2,chunkLen-2), 1.25); chunk.objects.push(m);
  }
}
function recycleChunk(chunk){
  chunk.objects.forEach(o=>releaseObj(o));
  chunk.objects=[];
  if (chunk.ground) { chunk.ground.material?.dispose(); chunk.ground.dispose(); chunk.ground=null; }
}
function ensureChunks(){
  while(chunks.length<12){
    const t=weightedType(player.distance);
    const c=createChunk(t, nextChunkZ);
    fillChunk(c, Math.min(1, player.distance/3000));
    chunks.push(c); nextChunkZ += chunkLen;
  }
  while(chunks.length && (chunks[0].z0 + chunkLen) < player.z-75){
    recycleChunk(chunks.shift());
  }
}
function chunkAt(z){ return chunks.find(c=>z>=c.z0 && z<c.z0+chunkLen); }

const input={steer:0,jump:false,gyro:false,g:0};
window.addEventListener('keydown',e=>{ if(e.code==='KeyA'||e.code==='ArrowLeft')input.steer=-1; if(e.code==='KeyD'||e.code==='ArrowRight')input.steer=1; if(e.code==='Space')input.jump=true; });
window.addEventListener('keyup',e=>{ if(['KeyA','ArrowLeft','KeyD','ArrowRight'].includes(e.code))input.steer=0; });
if(window.DeviceOrientationEvent){ window.addEventListener('deviceorientation',e=>{ input.g=Math.max(-1,Math.min(1,(e.gamma||0)/18)); input.gyro=true; }); }
const stickZone=$('stickZone'), stick=$('stick'); let stickActive=false;
function updStick(x,y){ const r=stickZone.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2; const dx=x-cx, dy=y-cy; const len=Math.min(45,Math.hypot(dx,dy)); const a=Math.atan2(dy,dx); const sx=Math.cos(a)*len, sy=Math.sin(a)*len; stick.style.left=`${45+sx}px`; stick.style.top=`${45+sy}px`; input.steer=sx/45; }
stickZone.addEventListener('pointerdown',e=>{stickActive=true;updStick(e.clientX,e.clientY);});
window.addEventListener('pointermove',e=>{if(stickActive)updStick(e.clientX,e.clientY);});
window.addEventListener('pointerup',()=>{stickActive=false;stick.style.left='45px';stick.style.top='45px';input.steer=0;});
$('jumpBtn').addEventListener('pointerdown',()=>input.jump=true);
window.addEventListener('pointerdown',e=>{ if(isMobile && e.clientX>innerWidth*0.6) input.jump=true; });

const player={x:0,y:0,z:0,vx:0,vy:0,speed:10,grounded:true,jumpCd:0,coyote:0,state:'NORMAL',grace:0,over:0,meter:0,score:0,distance:0,mult:1,buffs:{},paused:false,dead:false,continues:0,shake:0};

function getUpgradePct(id){ const u=upgradesCfg.upgrades.find(x=>x.id===id); const lvl=save.upgrades[id]||0; return u.bonusesPercent[lvl-1]||0; }
function buyUpgrade(id){ const u=upgradesCfg.upgrades.find(x=>x.id===id); const lvl=save.upgrades[id]||0; if(lvl>=u.costsCoins.length) return showToast('Max level'); const c=u.costsCoins[lvl]; if(save.currencies.coins<c) return showToast(`Need ${c} coins`); save.currencies.coins-=c; save.upgrades[id]=lvl+1; persistSave(); showToast(`${id} -> ${lvl+1}`); }
$('btnUpgradeJump').onclick=()=>buyUpgrade('jump_height');
$('btnUpgradeSteer').onclick=()=>buyUpgrade('steering_speed');
$('btnUpgradeOverdrive').onclick=()=>buyUpgrade('overdrive_duration');
$('btnPause').onclick=()=>player.paused=!player.paused;
$('btnRestart').onclick=()=>resetRun();

$('btnExport').onclick=()=>{ const blob=new Blob([JSON.stringify(save,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='savegame.json'; a.click(); };
$('importSave').addEventListener('change',async e=>{ const f=e.target.files?.[0]; if(!f)return; try{ save={...defaultSave(),...JSON.parse(await f.text())}; persistSave(); showToast('Save imported'); }catch{ showToast('Invalid JSON'); } });

$('btnSpin').onclick=()=>{
  if(save.currencies.gems<spinnersCfg.spinCostGems) return showToast('Not enough gems');
  save.currencies.gems-=spinnersCfg.spinCostGems;
  const all=[...spinnersCfg.buffs,...spinnersCfg.rareEvents]; const total=all.reduce((a,b)=>a+b.weight,0);
  const pick=()=>{ let r=Math.random()*total; for(const b of all){ r-=b.weight; if(r<=0) return b; } return all[0]; };
  const rolled=[];
  for(let i=0;i<3;i++){ const b=pick(); rolled.push(b.id); player.buffs[b.id]={stacks:(player.buffs[b.id]?.stacks||0)+1}; }
  if(rolled.includes('event_avalanche_frenzy')){ player.score+=3000; save.currencies.coins+=80; }
  persistSave(); showToast(`Spin: ${rolled.join(', ')}`,2200);
};

function progressGoal(type,delta){ const tree=goalsCfg.goalTrees[0]; for(const n of tree.nodes){ if(save.completedGoals.includes(n.id)) continue; if(n.type!==type) continue; save.goalProgress[n.id]=(save.goalProgress[n.id]||0)+delta; if(save.goalProgress[n.id]>=n.target){ save.completedGoals.push(n.id); save.currencies.coins += n.reward.coins||0; save.currencies.gems += n.reward.gems||0; showToast(`Goal ${n.id} complete`);} } }

function endRun(){
  if(player.dead) return;
  player.dead=true; player.paused=true;
  save.currencies.coins += Math.floor(player.distance*0.06 + save.stats.totalDestructions*0.01);
  save.stats.bestDistance=Math.max(save.stats.bestDistance,Math.floor(player.distance));
  save.stats.bestScore=Math.max(save.stats.bestScore,Math.floor(player.score));
  persistSave();
  $('goDistance').textContent=Math.floor(player.distance);
  $('goScore').textContent=Math.floor(player.score);
  $('btnContinue').textContent=`Continue (${player.continues===0?12:20} gems)`;
  $('gameOver').classList.remove('hidden');
}
$('btnContinue').onclick=()=>{
  const cost=player.continues===0?12:20;
  if(player.continues>=2) return showToast('No continues left');
  if(save.currencies.gems<cost) return showToast('Not enough gems');
  save.currencies.gems-=cost; player.continues++; player.dead=false; player.paused=false; player.state='NORMAL'; player.grace=2.0; player.vy=2.4;
  player.x=centerX(player.z); player.y=terrainY(player.x,player.z)+R;
  $('gameOver').classList.add('hidden'); persistSave();
};
$('btnNewRun').onclick=()=>resetRun();

function resetRun(){
  chunks.splice(0).forEach(recycleChunk); nextChunkZ=0;
  Object.assign(player,{x:centerX(0),y:terrainY(0,0)+R,z:0,vx:0,vy:0,speed:10,grounded:true,jumpCd:0,coyote:0,state:'NORMAL',grace:0,over:0,meter:0,score:0,distance:0,mult:1,buffs:{},paused:false,dead:false,continues:0,shake:0});
  save.stats.totalRuns++; persistSave(); $('gameOver').classList.add('hidden');
  ensureChunks();
}

function collide(){
  const rr=1.35*1.35;
  for(const c of chunks){
    for(let i=c.objects.length-1;i>=0;i--){
      const o=c.objects[i]; if(!o.isEnabled()) continue;
      const dx=o.position.x-player.x, dz=o.position.z-player.z;
      if(dx*dx+dz*dz>rr) continue;
      if(player.y - o.position.y > 1.6) continue; // jumped clear over it
      const type=o.metadata.type;
      c.objects.splice(i,1); releaseObj(o);
      if(!type) continue;
      if(type.category==='destructible' || (type.category==='hazard' && player.state==='OVERDRIVE')){
        const base=type.baseScore||50; const bonus=player.state==='OVERDRIVE'?1.3:1;
        player.score += base*player.mult*bonus;
        player.meter += (type.destructionValue||8)*(player.buffs.power_charge_rate?.stacks?1.3:1);
        player.shake=Math.max(player.shake,.14);
        save.stats.totalDestructions++; progressGoal('destroy_any',1); if(player.state==='OVERDRIVE')progressGoal('destroy_in_overdrive',1);
      } else if(type.category==='hazard'){
        if(player.grace>0){ player.grace=0; player.vx += (Math.random()*2-1)*3.5; showToast('Grace saved you'); }
        else endRun();
      } else if(type.category==='pickup_coin'){
        save.currencies.coins += type.amount||1; player.score+=10; progressGoal('collect_coin',type.amount||1);
      } else if(type.category==='pickup_gem'){
        save.currencies.gems += type.amount||1; player.score+=40; progressGoal('collect_gem',type.amount||1);
      }
    }
  }
}

function applyMagnet(dt){
  if(!player.buffs.coin_magnet?.stacks) return;
  const r2=16;
  for(const c of chunks){
    for(const o of c.objects){
      if(!o.isEnabled()||o.metadata?.type?.category!=='pickup_coin') continue;
      const dx=player.x-o.position.x, dz=player.z-o.position.z; const d=dx*dx+dz*dz;
      if(d<r2){ o.position.x += dx*dt*4.2; o.position.z += dz*dt*4.2; }
    }
  }
}

function ui(){
  $('score').textContent=Math.floor(player.score);
  $('distance').textContent=Math.floor(player.distance);
  $('coins').textContent=save.currencies.coins;
  $('gems').textContent=save.currencies.gems;
  $('mult').textContent=`x${player.mult}`;
  $('state').textContent=player.state + (player.grace>0?' (GRACE)':'');
  $('meter').style.width=`${Math.min(1,player.meter/balance.scoring.meterCapacity)*100}%`;
}

resetRun();

let last=performance.now();
engine.runRenderLoop(()=>{
  const now=performance.now(); const dt=Math.min(.033,(now-last)/1000); last=now;

  if(!player.paused){
    const steerIn = input.gyro && isMobile ? input.g : input.steer;
    const steerMul = 1 + getUpgradePct('steering_speed')/100;
    const jumpMul = 1 + getUpgradePct('jump_height')/100;
    const overMul = 1 + getUpgradePct('overdrive_duration')/100;

    // Forward acceleration scales with how steep the slope is right ahead.
    const yHere = terrainY(player.x, player.z);
    const yAhead = terrainY(player.x, player.z + 2);
    const grade = Math.max(0, (yHere - yAhead) / 2);          // downhill steepness
    const slopeBoost = 0.45 + Math.min(1.4, grade * 2.2);
    player.speed += (balance.physics.slopeAccel*slopeBoost - balance.physics.dragLongitudinal*player.speed*player.speed*0.1)*dt;
    player.speed = Math.min(balance.physics.maxForwardSpeed, player.speed);

    player.vx += steerIn*balance.physics.lateralControlStrength*steerMul*dt*12;
    player.vx *= (1-balance.physics.dragLateral*dt);
    player.x += player.vx*dt;

    // Fall off the edge of the path => run ends.
    const cur = chunkAt(player.z);
    const half = (cur?cur.width:13)*0.5;
    if (Math.abs(player.x - centerX(player.z)) > half + 0.4) endRun();

    // Jump + coyote time.
    player.jumpCd -= dt;
    player.coyote = player.grounded ? balance.physics.coyoteTime : player.coyote-dt;
    if(input.jump && player.jumpCd<=0 && (player.grounded || player.coyote>0)){
      player.vy = balance.physics.jumpImpulse*jumpMul; player.grounded=false; player.jumpCd=balance.physics.jumpCooldown;
    }
    input.jump=false;

    // Vertical physics relative to the terrain surface.
    player.vy -= balance.physics.gravity*dt;
    player.y += player.vy*dt;
    player.z += player.speed*dt; player.distance=player.z;

    const groundLevel = terrainY(player.x, player.z) + R;
    if(player.y <= groundLevel){
      if(!player.grounded) player.vx += (Math.random()-.5)*1.3;
      player.y = groundLevel; player.vy = 0; player.grounded = true;
    } else {
      player.grounded = false;
    }

    if(player.state==='OVERDRIVE'){ player.over -= dt; if(player.over<=0){ player.state='NORMAL'; player.grace=balance.physics.postOverdriveGrace; }}
    else if(player.grace>0) player.grace -= dt;

    if(player.meter>=balance.scoring.meterCapacity && player.state!=='OVERDRIVE'){
      player.state='OVERDRIVE'; player.over=balance.physics.overdriveDuration*overMul; player.meter=0; save.stats.totalOverdrives++; progressGoal('activate_overdrive',1);
    }

    const f = player.meter/balance.scoring.meterCapacity;
    player.mult = f<.17?1:f<.34?2:f<.51?3:f<.68?4:f<.85?5:6;

    ensureChunks();
    applyMagnet(dt);
    collide();
    progressGoal('distance_total', player.speed*dt);
  }

  boulder.position.set(player.x,player.y,player.z);
  boulder.rotate(BABYLON.Axis.X, -(player.speed*dt)/R, BABYLON.Space.LOCAL);
  boulder.rotate(BABYLON.Axis.Z, -(player.vx*dt)/R, BABYLON.Space.LOCAL);

  trail.position.set(player.x,player.y,player.z-1.3);
  tmat.alpha += ((player.state==='OVERDRIVE' ? .42 : 0)-tmat.alpha)*.14;
  boulderMat.emissiveColor = player.state==='OVERDRIVE' ? new BABYLON.Color3(.14,.3,.4) : BABYLON.Color3.Black();

  // Downhill chase camera: sits uphill-and-behind, looks down the slope ahead.
  player.shake=Math.max(0,player.shake-dt*1.8);
  const back = 11;
  const bz = player.z - back;
  const bx = player.x*0.55 + centerX(bz)*0.45 + (Math.random()*2-1)*player.shake;
  const by = terrainY(bx, bz) + 6.2 + (Math.random()*2-1)*player.shake;
  camera.position = BABYLON.Vector3.Lerp(camera.position, new BABYLON.Vector3(bx,by,bz), player.state==='OVERDRIVE' ? .14 : .1);
  const lookAhead = Math.max(4, Math.min(13, player.speed*0.28));
  camera.setTarget(new BABYLON.Vector3(player.x, player.y - 0.4, player.z + lookAhead));
  camera.fov += ((player.state==='OVERDRIVE'?1.28:1.17)-camera.fov)*.1;

  ui();
  scene.render();
});

window.addEventListener('resize', ()=>engine.resize());
