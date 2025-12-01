
// ==== timeline.js (clean v7.1) ====
console.log('[timeline] loaded v7.1');

// ---- Config ----
const MIN_YEAR = -4050;
const MAX_YEAR = 2100;
const INITIAL_CENTER_YEAR = 1;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 12000;

// ---- DOM ----
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
const btnZoomIn = document.getElementById('zoomIn');
const btnZoomOut = document.getElementById('zoomOut');
const btnResetFloating = document.getElementById('resetZoomFloating');
const legendEl = document.getElementById('legend');
const detailsPanel = document.getElementById('detailsPanel');
const detailsClose = document.getElementById('detailsClose');
const detailsContent = document.getElementById('detailsContent');

// ---- State ----
let dpr = Math.max(1, window.devicePixelRatio || 1);
let W = 0, H = 0;
let scale = 1;
let panX = 0;
let isDragging = false;
let dragStartX = 0;
let events = [];
let groupChips = new Map();
let activeGroups = new Set();
let filterMode = 'all';
let eventSearchTerm = '';

// ---- Utils ----
function sizeCanvasToCss(){
  const rect = canvas.getBoundingClientRect();
  W = Math.max(1, Math.floor(rect.width * dpr));
  H = Math.max(1, Math.floor(rect.height * dpr));
  canvas.width = W; canvas.height = H;
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
function xForYear(y){ return (y - MIN_YEAR) * scale + panX; }
function yearForX(x){ return MIN_YEAR + (x - panX) / scale; }
function formatYearHuman(y){ if(y<0) return `${Math.abs(y)} BCE`; if(y>0) return `${y} CE`; return '1 CE'; }
function hashColor(str){ let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))>>>0; return `hsl(${h%360},65%,45%)`; }
const groupColors = new Map();
function getGroupColor(g){ const k=(g??'').trim(); if(!k) return '#0077ff'; if(!groupColors.has(k)) groupColors.set(k, hashColor(k)); return groupColors.get(k); }
function isGroupVisible(g){ const k=(g??'').trim(); if(filterMode==='all') return true; if(filterMode==='none') return false; return activeGroups.has(k); }

// ---- CSV ----
async function loadCsv(url){ const res = await fetch(url); const txt = await res.text(); return parseCSV(txt); }
function parseCSV(text){
  const rows=[]; let header=null; let i=0,cur='',row=[],inQ=false;
  while(i<text.length){ const ch=text[i];
    if(ch==='"'){ if(inQ && text[i+1]==='"'){ cur+='"'; i+=2; continue; } inQ=!inQ; i++; continue; }
    if(ch===',' && !inQ){ row.push(cur); cur=''; i++; continue; }
    if((ch==='\n'||ch==='\r') && !inQ){ if(ch==='\r' && text[i+1]==='\n') i++; row.push(cur); cur='';
      if(!header) header=row.map(s=>s.trim()); else { const obj={}; for(let j=0;j<header.length;j++) obj[header[j]]=(row[j]??'').trim(); rows.push(obj); }
      row=[]; i++; continue; }
    cur+=ch; i++; }
  row.push(cur);
  if(!header) header=row.map(s=>s.trim()); else if(row.length>1 || (row.length===1 && row[0]!=='')){ const obj={}; for(let j=0;j<header.length;j++) obj[header[j]]=(row[j]??'').trim(); rows.push(obj); }
  return rows;
}

// ---- Legend ----
function addAdminChip(label,onClick,color){ const chip=document.createElement('div'); chip.className='chip'; const sw=document.createElement('span'); sw.className='swatch'; sw.style.background=color; const text=document.createElement('span'); text.textContent=label; chip.append(sw,text); chip.addEventListener('click',onClick); legendEl.appendChild(chip); }
function getGroupIcon(group){ const g=(group??'').trim(); const map={ 'Bible writing':'📚','Bible copy/translation':'📜','Events':'⭐','Persons':'👤','Covenants':'📜','Judges':'⚖️','Kings of Israel':'👑','Kings of Judah':'👑','Prophets':'📖','World powers':'🌍','Jesus':'👑🧔','Time periods':'⏳','Modern day history of JW':'🕊️','King of the North':'⬆️','King of the South':'⬇️',"Paul's journeys":'🛤️'}; return map[g]||'•'; }
function buildLegend(){
  const groups=[...new Set(events.map(e=>(e['Group']??'').trim()).filter(Boolean))].sort();
  legendEl.innerHTML=''; groupChips.clear(); filterMode='all'; activeGroups=new Set(groups);
  // keep Only None admin chip
  addAdminChip('None',()=>{ activeGroups.clear(); filterMode='none'; groupChips.forEach(ch=>ch.classList.add('inactive')); draw(); }, '#c33');
  groups.forEach(g=>{ const chip=document.createElement('div'); chip.className='chip'; chip.dataset.group=g;
    const sw=document.createElement('span'); sw.className='swatch'; sw.style.background=getGroupColor(g);
    const icon=document.createElement('span'); icon.className='chip-icon'; icon.textContent=getGroupIcon(g);
    const label=document.createElement('span'); label.textContent=g; chip.append(sw,icon,label);
    chip.addEventListener('click',()=>{ filterMode='custom'; if(activeGroups.has(g)){ activeGroups.delete(g); chip.classList.add('inactive'); } else { activeGroups.add(g); chip.classList.remove('inactive'); } draw(); });
    legendEl.appendChild(chip); groupChips.set(g,chip); });
  const search=document.getElementById('legendSearch'); if(search && !search._wired){ search.addEventListener('input',e=>{ const t=e.target.value.toLowerCase(); groupChips.forEach((chip,group)=>{ chip.style.display=group.toLowerCase().includes(t)?'inline-flex':'none'; }); }); search._wired=true; }
  const es=document.getElementById('eventSearch'); if(es && !es._wired){ let timer=null; es.addEventListener('input',()=>{ clearTimeout(timer); timer=setTimeout(()=>{ eventSearchTerm=es.value||''; draw(); },120); }); es._wired=true; }
}

// ---- Reset ----
function resetAll(){
  const es=document.getElementById('eventSearch'); if(es) es.value=''; eventSearchTerm='';
  const groups=[...new Set(events.map(e=>(e['Group']??'').trim()).filter(Boolean))]; activeGroups=new Set(groups); filterMode='all'; groupChips.forEach(ch=>ch.classList.remove('inactive'));
  const ls=document.getElementById('legendSearch'); if(ls){ ls.value=''; groupChips.forEach(ch=>ch.style.display='inline-flex'); }
  const legendDetails=document.querySelector('.legend-panel'); if(legendDetails) legendDetails.open=false;
  initScaleAndPan(); draw();
}
if(btnResetFloating) btnResetFloating.addEventListener('click', resetAll);

// ---- Init scale/pan ----
function initScaleAndPan(){ sizeCanvasToCss(); scale=Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvas.clientWidth/(MAX_YEAR-MIN_YEAR))); panX=(canvas.clientWidth/2) - ((INITIAL_CENTER_YEAR - MIN_YEAR) * scale); }

// ---- Draw ----
function draw(){
  sizeCanvasToCss(); ctx.clearRect(0,0,W,H); ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
  // center line
  ctx.strokeStyle='#00000033'; ctx.beginPath(); ctx.moveTo(W/dpr/2,0); ctx.lineTo(W/dpr/2,H/dpr); ctx.stroke();
  const centerYear = yearForX(canvas.clientWidth/2);
  // tick labels (coarse)
  ctx.font='14px sans-serif'; ctx.textBaseline='top'; const step=500; for(let t=MIN_YEAR; t<=MAX_YEAR; t+=step){ const x=xForYear(t); if(x>-100 && x < W/dpr+100){ ctx.fillStyle='#000'; ctx.fillText(formatYearHuman(t), x-20, 16); } }
  // events points
  events.forEach(ev=>{ const group=(ev['Group']??'').trim(); if(!isGroupVisible(group)) return; if(eventSearchTerm && !matchesEventSearch(ev,eventSearchTerm)) return; const baseYear=parseInt(ev['Year'],10); if(!Number.isFinite(baseYear)) return; const x=xForYear(baseYear); if(x>-50 && x < W/dpr+50){ ctx.fillStyle=getGroupColor(group); ctx.beginPath(); ctx.arc(x, 110, 5, 0, Math.PI*2); ctx.fill(); }});
}
function matchesEventSearch(ev, term){ if(!term) return true; const t=term.trim().toLowerCase(); if(!t) return true; const fields=[ev['Headline'],ev['Text'],ev['Display Date'],ev['Type'],ev['Group']]; return fields.some(f=> (f??'').toLowerCase().includes(t)); }

// ---- Controls ----
if(btnZoomIn) btnZoomIn.addEventListener('click', ()=>{ scale=Math.min(MAX_ZOOM, scale*1.3); draw(); });
if(btnZoomOut) btnZoomOut.addEventListener('click', ()=>{ scale=Math.max(MIN_ZOOM, scale/1.3); draw(); });
canvas.addEventListener('mousedown', e=>{ isDragging=true; dragStartX=e.clientX; });
window.addEventListener('mousemove', e=>{ if(isDragging){ panX += (e.clientX - dragStartX); dragStartX=e.clientX; draw(); } });
window.addEventListener('mouseup', ()=>{ isDragging=false; });
canvas.addEventListener('wheel', e=>{ e.preventDefault(); const z=e.deltaY<0?1.1:0.9; const anchor=(e.offsetX ?? (e.clientX - canvas.getBoundingClientRect().left)); const anchorYear=yearForX(anchor); scale=Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale*z)); panX = anchor - (anchorYear - MIN_YEAR) * scale; draw(); }, { passive:false });
window.addEventListener('resize', draw);

// ---- Exported helpers for page ----
window.timelineBuildLegend = buildLegend;
window.timelineInit = function(){ initScaleAndPan(); draw(); };
window.timelineLoadCsv = loadCsv;
