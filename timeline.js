// ============================================================
// History Timeline — BCE/CE, dotted sticks + flags, details panel,
// WOL scripture links, and legend filter chips
// ============================================================

// WOL locale (Hungarian by default)
const WOL_LANG_SEGMENT = 'hu/lp-h';
const WOL_SEARCH_BASE = `https://wol.jw.org/${WOL_LANG_SEGMENT}/s/r1/?q=`;

const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');

let zoom = 1, minZoom = 0.2, maxZoom = 20;
let allEvents = [], visibleEvents = [], rows = [];
let panX = 0, isPanning = false, panStartClientX = 0, panStartPanX = 0, firstDraw = true;
let hitRegions = [], suppressNextClick = false;

// ---- Load CSV ----
fetch('timeline-data.csv')
  .then(r => { if (!r.ok) throw new Error('CSV HTTP ' + r.status); return r.text(); })
  .then(t => parseCSV(t))
  .then(data => {
    allEvents = data;
    initFiltersFromData();
    applyFiltersAndPack();
    buildLegend();
    draw();
    console.log('Loaded events:', visibleEvents.length);
  })
  .catch(err => { console.error('CSV load failed:', err); failMsg('Failed to load timeline data.'); });

function failMsg(msg){
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = '14px Arial';
  ctx.fillText(msg, 10, 30);
}

// ---- CSV parser ----
function csvSplit(line){
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(q && line[i+1]==='"'){ cur+='"'; i++; } else q=!q;
    } else if(ch===',' && !q){ out.push(cur); cur=''; }
    else cur+=ch;
  }
  out.push(cur);
  return out;
}
function parseTimeString(s){
  if(!s) return [0,0,0];
  const p=s.split(':').map(x=>parseInt(x,10));
  return [isNaN(p[0])?0:p[0], isNaN(p[1])?0:p[1], isNaN(p[2])?0:p[2]];
}
function toTs(year, month, day, timeStr){
  if(isNaN(year)||year===null) return NaN;
  const y=parseInt(year,10);
  const mo=isNaN(parseInt(month,10))?1:parseInt(month,10);
  const d=isNaN(parseInt(day,10))?1:parseInt(day,10);
  const [h,m,s]=parseTimeString(timeStr);
  return Date.UTC(y, Math.max(0,mo-1), Math.max(1,d), h,m,s);
}
function parseCSV(text){
  if(!text) return [];
  const raw = text.split(/?
/); // handles Windows/Unix line endings safely
  const lines = raw.map(l => l.trim()).filter((l,i) => (l.length>0) || i===0);
  if(lines.length===0) return [];

  const head = csvSplit(lines[0]).map(h => h.trim());
  const map = {}; head.forEach((h,i)=> map[h.toLowerCase()] = i);

  const out=[];
  for(let i=1; i<lines.length; i++){
    const parts = csvSplit(lines[i]);
    if(!parts || parts.length===0) continue;

    const norm={};
    Object.keys(map).forEach(k => {
      const idx = map[k];
      const rawVal = (parts[idx] !== undefined ? parts[idx] : '');
      const v = (''+rawVal).trim().replace(/^"(.*)"$/, '$1');
      norm[k] = v;
    });

    const title = norm.headline || norm.title || norm.name || '';
    const type  = norm.type || '';
    const group = norm.group || '';
    const media = norm.media || '';
    const textField = norm.text || norm['display date'] || '';

    const year    = parseInt(norm.year, 10);
    const month   = norm.month;
    const day     = norm.day;
    const timeStr = norm.time || norm['time'] || '';

    let start = toTs(year, month, day, timeStr);
    const endYear = parseInt(norm['end year'], 10);
    let end = NaN;
    if(!isNaN(endYear)){
      const endMonth = norm['end month'];
      const endDay   = norm['end day'];
      const endTime  = norm['end time'] || '';
      end = toTs(endYear, endMonth, endDay, endTime);
    }

    if(isNaN(start)){
      const single = norm.start || norm['start date'] || norm['display date'];
      if(single){ const d=new Date(single); if(!isNaN(d)) start=d.getTime(); }
    }
    if(isNaN(start)) continue;
    if(isNaN(end)) end = start;
    if(end < start){ const tmp=start; start=end; end=tmp; }

    out.push({ title, start, end, type, group, media, text:textField, raw:norm });
  }
  return out;
}

// ---- Filters ----
const activeGroups=new Set(); let availableGroups=[];
function groupKeyFor(ev){ return (ev.group||ev.type||'(Other)').trim(); }
function initFiltersFromData(){
  const seen=new Map();
  allEvents.forEach(ev=>{ const label=groupKeyFor(ev); const key=label.toLowerCase(); if(!seen.has(key)) seen.set(key,label); });
  availableGroups = [...seen.entries()].map(([k,l])=>({label:l, keyLower:k}));
  activeGroups.clear(); availableGroups.forEach(g=>activeGroups.add(g.keyLower));
}
function applyFiltersAndPack(){ visibleEvents=allEvents.filter(ev=>activeGroups.has(groupKeyFor(ev).toLowerCase())); packRows(); }

// ---- Row packing ----
function packRows(){
  rows=[];
  visibleEvents.forEach(ev=>{
    let placed=false;
    for(const r of rows){
      if(!r.some(e => !(ev.end<e.start || ev.start>e.end))){ r.push(ev); placed=true; break; }
    }
    if(!placed) rows.push([ev]);
  });
}

// ---- Pan/zoom helpers ----
function clampPanForSize(W){
  const content=W*zoom; const margin=80;
  if(content<=W) return (W-content)/2;
  const left=W-content-margin, right=margin;
  return Math.max(left, Math.min(right, panX));
}
function clampPan(){ panX=clampPanForSize(canvas.width); }

// ---- Formatting ----
function formatYearHuman(y){ if(y<0) return `${Math.abs(y)} BCE`; if(y>0) return `${y}`; return ''; }
function formatDateHuman(ts){ const d=new Date(ts); const y=d.getUTCFullYear(); const m=d.getUTCMonth()+1; const day=d.getUTCDate(); const yTxt=(y<0)?`${Math.abs(y)} BCE`:`${y}`; return `${yTxt}${(m&&day)?`-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`:''}`; }
function displayWhen(ev){ if(ev.raw&&ev.raw['display date']) return ev.raw['display date']; const a=formatDateHuman(ev.start), b=formatDateHuman(ev.end); return (a===b)?a:`${a} — ${b}`; }

// ---- Colors ----
const COLOR_MAP={
  'events':'#1f77b4','persons':'#2ca02c','covenants':'#8c564b','time periods':'#9467bd',
  'bible writing':'#d62728','world powers':'#ff7f0e','prophets':'#17becf','judges':'#bcbd22',
  'kings of israel':'#e377c2','kings of judah':'#7f7f7f','jesus':'#9c27b0','king of the north':'#795548',
  'king of the south':'#607d8b','paul's journeys':'#00acc1','bible copy/translation':'#009688',
  'modern day history of jw':'#ff6f00','(other)':'#007BFF','person':'#2ca02c','era':'#dc3545','':'#007BFF'
};
function colorFor(ev){ const g=groupKeyFor(ev).toLowerCase(); const t=(ev.type||'').toLowerCase().trim(); return COLOR_MAP[g]||COLOR_MAP[t]||COLOR_MAP['']; }

// ---- Legend (interactive) ----
function buildLegend(){
  const host=document.getElementById('legend'); if(!host) return;
  host.innerHTML='';
  availableGroups.forEach(({label,keyLower})=>{
    const color=COLOR_MAP[keyLower]||COLOR_MAP[''];
    const chip=document.createElement('div');
    chip.className='chip'+(activeGroups.has(keyLower)?'':' inactive');
    chip.setAttribute('data-key', keyLower);
    chip.innerHTML=`<span class="swatch" style="background:${color}"></span><span>${label}</span>`;
    chip.addEventListener('click',()=>{
      if(activeGroups.has(keyLower)) activeGroups.delete(keyLower); else activeGroups.add(keyLower);
      chip.classList.toggle('inactive');
      applyFiltersAndPack();
      draw();
    });
    host.appendChild(chip);
  });
}

// ---- Scripture linking (now with <a href=...> anchors) ----
const BOOKS='(?:Gen|Ex|Lev|Num|Deut|Josh|Jg|Judg|Ruth|1\s?Sam|2\s?Sam|1\s?Ki|2\s?Ki|1\s?Ch|2\s?Ch|Chron|Ezra|Neh|Esth?|Job|Ps|Prov|Eccl|Song|Isa|Jer|Lam|Ezek|Dan|Hos|Joel|Amos|Obad|Jonah?|Mic|Nah|Hab|Zeph|Hag|Zech|Mal|Matt|Mt|Mark|Mrk|Luke|Lu|John|Jn|Acts|Rom|Ro|1\s?Cor|2\s?Cor|Gal|Eph|Phil|Col|1\s?Thess|2\s?Thess|1\s?Tim|2\s?Tim|Titus|Philem|Heb|Jas|James|1\s?Pet|2\s?Pet|1\s?John|2\s?John|3\s?John|Jude|Rev)\.?';
const REG_COMBINED=new RegExp(`\b(${BOOKS})\s+(\d+:\d+(?:[-–]\d+)?)|\b(\d+:\d+(?:[-–]\d+)?)`,'g');
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function linkifyScripture(text){
  const src=escapeHtml(text);
  let out='', lastIdx=0, lastBook=null; REG_COMBINED.lastIndex=0; let m;
  while((m=REG_COMBINED.exec(src))!==null){
    const idx=m.index; out+=src.slice(lastIdx, idx);
    if(m[1]&&m[2]){ // Book + ch:vs
      lastBook = m[1].replace(/\s+/g,' ').trim();
      const ref = m[2]; const q = encodeURIComponent(`${lastBook} ${ref}`);
      out += `<a target="_blank" rel="noopener" href="${WOL_SEARCH_BASE}${q}">${escapeHtml(lastBook)} ${escapeHtml(ref)}</a>`;
    } else if(m[3]){ // ch:vs inherits last book
      const ref=m[3];
      if(lastBook){ const q=encodeURIComponent(`${lastBook} ${ref}`);
        out += `<a target="_blank" rel="noopener" href="${WOL_SEARCH_BASE}${q}">${escapeHtml(ref)}</a>`;
      } else {
        out += escapeHtml(ref);
      }
    }
    lastIdx = REG_COMBINED.lastIndex;
  }
  out += src.slice(lastIdx);
  return out;
}
function isImageUrl(url){ return /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url); }

// ---- Draw ----
function draw(){
  canvas.width=canvas.clientWidth; canvas.height=canvas.clientHeight; hitRegions=[];
  const W=canvas.width, H=canvas.height; ctx.clearRect(0,0,W,H);

  const topPadding=8, labelH=28, timelineY=topPadding+labelH, rowH=40;
  if(!visibleEvents || visibleEvents.length===0){ ctx.fillStyle='#000'; ctx.font='14px Arial'; ctx.fillText('No events', 10, timelineY+20); return; }

  let minTs=Math.min(...visibleEvents.map(e=>e.start));
  let maxTs=Math.max(...visibleEvents.map(e=>e.end));
  if(!isFinite(minTs) || !isFinite(maxTs)){ ctx.fillStyle='#000'; ctx.font='14px Arial'; ctx.fillText('Invalid event dates',10,30); return; }
  if(minTs===maxTs){ minTs-=86400000; maxTs+=86400000; }
  const span=(maxTs-minTs)||1; const scale=(W*zoom)/span;

  if(firstDraw){ const content=W*zoom; panX=(content<=W)?(W-content)/2:0; firstDraw=false; }
  panX=clampPanForSize(W);
  const xOfTs=ts => (ts-minTs)*scale + panX;

  // Main line
  ctx.strokeStyle='#222'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(0,timelineY); ctx.lineTo(W,timelineY); ctx.stroke();

  // Year labels (skip 0)
  const msPerYear=365.2425*24*3600*1000; const approx=scale*msPerYear; let step;
  if(approx<2) step=200; else if(approx<6) step=100; else if(approx<14) step=50; else if(approx<30) step=20; else if(approx<60) step=10; else if(approx<100) step=5; else if(approx<200) step=2; else step=1;
  const minYear=new Date(minTs).getUTCFullYear(); const maxYear=new Date(maxTs).getUTCFullYear(); const startLab=Math.floor(minYear/step)*step;
  ctx.font='12px Arial'; ctx.textBaseline='middle'; const gap=6; let lastRight=-Infinity;
  for(let y=startLab; y<=maxYear; y+=step){ if(y===0) continue; const ts=Date.UTC(y,0,1); const x=xOfTs(ts); if(x<-120||x>W+120) continue; const text=formatYearHuman(y); if(!text) continue; const textW=ctx.measureText(text).width; const pillW=textW+10; const pillH=20; const pillX=x-pillW/2; const pillY=topPadding; const left=Math.max(4,pillX); const right=left+pillW; if(left<=lastRight+gap) continue; ctx.fillStyle='#ffffffee'; ctx.strokeStyle='#00000022'; roundRect(ctx,left,pillY,pillW,pillH,6,true,false); ctx.fillStyle='#000'; ctx.fillText(text,left+5,pillY+pillH/2); lastRight=right; ctx.strokeStyle='#00000033'; ctx.beginPath(); ctx.moveTo(x,pillY+pillH); ctx.lineTo(x,timelineY-4); ctx.stroke(); }

  // Rows & events
  rows.forEach((row,i)=>{
    const yTop=timelineY+18+i*rowH;
    row.forEach(ev=>{
      const x1=xOfTs(ev.start), x2=xOfTs(ev.end); const left=Math.min(x1,x2), right=Math.max(x1,x2); const w=right-left;
      const color=colorFor(ev); const stickX=(w<10)?x1:left;

      // Dotted stick
      ctx.save(); ctx.setLineDash([3,4]); ctx.strokeStyle=color+'AA'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(stickX,timelineY); ctx.lineTo(stickX,yTop+10); ctx.stroke(); ctx.restore();

      // Bar or dot
      if(w>=10){ ctx.fillStyle=color; const barX=left, barY=yTop+18, barW=Math.max(6,w), barH=6; ctx.fillRect(barX,barY,barW,barH); hitRegions.push({x:barX,y:barY-4,w:barW,h:barH+8,ev,kind:'bar'}); }
      else { const r=4; ctx.beginPath(); ctx.fillStyle=color; ctx.arc(stickX,yTop+21,r,0,Math.PI*2); ctx.fill(); hitRegions.push({x:stickX-6,y:yTop+15,w:12,h:12,ev,kind:'dot'}); }

      // Flag with title + date
      const title=ev.title||''; const dateTxt=(ev.raw&&ev.raw['display date'])?ev.raw['display date']:formatDateHuman(ev.start);
      const lines=wrapText(ctx,title,320,'bold 12px Arial').concat(wrapText(ctx,dateTxt,320,'11px Arial'));
      const padX=8, padY=6, lineGap=2; const heights=lines.map(l=>l.font.startsWith('bold')?13:12);
      const textW=Math.min(360, Math.max(...lines.map(l=>ctx.measureText(l.text).width)));
      const pillW=Math.max(120, textW+padX*2); const pillH=padY*2 + heights.reduce((a,b)=>a+b,0) + (lines.length-1)*lineGap;
      let pillX=stickX+10; if(pillX+pillW>W-8) pillX=stickX-10-pillW; if(pillX<4) pillX=4; const pillY=yTop;
      ctx.fillStyle='#ffffffdd'; ctx.strokeStyle='#00000022'; ctx.lineWidth=1; roundRect(ctx,pillX,pillY,pillW,pillH,8,true,false);
      let ty=pillY+padY+(heights[0]-2); lines.forEach((ln,idx)=>{ ctx.font=ln.font; ctx.fillStyle=idx===0?'#000':'#333'; ctx.fillText(ln.text, pillX+padX, ty); ty+=heights[idx]+lineGap; });
      hitRegions.push({x:pillX,y:pillY,w:pillW,h:pillH,ev,kind:'flag'});
    });
  });
}

function roundRect(ctx,x,y,w,h,r,fill,stroke){ if(typeof r==='undefined') r=5; ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y,y+h? r: r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); if(fill) ctx.fill(); if(stroke) ctx.stroke(); }
function wrapText(ctx,text,maxWidth,font='12px Arial'){
  const words=String(text||'').split(/\s+/); const lines=[]; let line=''; ctx.font=font;
  words.forEach(w=>{ const test = line ? (line+' '+w) : w; if(ctx.measureText(test).width>maxWidth && line){ lines.push({text:line,font}); line=w; } else { line=test; } });
  if(line) lines.push({text:line,font}); return lines;
}

// ---- Interaction ----
function onPointerDown(x){ isPanning=true; suppressNextClick=false; panStartClientX=x; panStartPanX=panX; canvas.style.cursor='grabbing'; }
function onPointerMove(x){ if(!isPanning) return; const dx=x-panStartClientX; if(Math.abs(dx)>3) suppressNextClick=true; panX=panStartPanX+dx; clampPan(); draw(); }
function onPointerUp(){ isPanning=false; canvas.style.cursor='grab'; }

canvas.style.cursor='grab';
canvas.addEventListener('mousedown', e=>{ e.preventDefault(); onPointerDown(e.clientX); });
window.addEventListener('mousemove', e=> onPointerMove(e.clientX));
window.addEventListener('mouseup',   ()=> onPointerUp());
canvas.addEventListener('touchstart', e=>{ if(!e.touches||e.touches.length===0) return; onPointerDown(e.touches[0].clientX); });
canvas.addEventListener('touchmove',  e=>{ if(!e.touches||e.touches.length===0) return; onPointerMove(e.touches[0].clientX); e.preventDefault(); }, {passive:false});
canvas.addEventListener('touchend',   ()=> onPointerUp());
canvas.addEventListener('touchcancel',()=> onPointerUp());

canvas.addEventListener('click', e=>{
  if(suppressNextClick){ suppressNextClick=false; return; }
  const rect=canvas.getBoundingClientRect(); const x=e.clientX-rect.left, y=e.clientY-rect.top;
  for(let i=hitRegions.length-1;i>=0;i--){ const h=hitRegions[i]; if(x>=h.x && x<=h.x+h.w && y>=h.y && y<=h.y+h.h){ showDetails(h.ev); return; } }
  hideDetails();
});

// ---- Details panel ----
const detailsPanel=document.getElementById('detailsPanel');
const detailsClose=document.getElementById('detailsClose');
const detailsContent=document.getElementById('detailsContent');

detailsClose?.addEventListener('click', hideDetails);
document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideDetails(); });

function showDetails(ev){
  if(!detailsPanel||!detailsContent) return;
  const title=ev.title||'(untitled)';
  const when = displayWhen(ev);
  const group=groupKeyFor(ev);
  const text = ev.text || '';
  const mediaUrl=(ev.media||'').trim();
  let mediaHtml='';
  if(mediaUrl){
    if(isImageUrl(mediaUrl)) mediaHtml = `<div class="media"><img alt="" src="${escapeHtml(mediaUrl)}"></div>`;
    else mediaHtml = `<div class="media"><a target="_blank" rel="noopener" href="${escapeHtml(mediaUrl)}">Open media</a></div>`;
  }
  detailsContent.innerHTML = `
    <h3 id="detailsTitle">${escapeHtml(title)}</h3>
    <div class="meta">${escapeHtml(when)}${group?` • ${escapeHtml(group)}`:''}</div>
    ${text? `<p>${linkifyScripture(text)}</p>`: ''}
    ${mediaHtml}
  `;
  detailsPanel.classList.remove('hidden');
}
function hideDetails(){ if(!detailsPanel) return; detailsPanel.classList.add('hidden'); }

// ---- Zoom buttons ----
document.getElementById('zoomIn').onclick = ()=>{
  const old=zoom; const nz=Math.min(maxZoom, zoom*1.3); if(nz===old) return;
  const W=canvas.width||canvas.clientWidth;
  let minTs=visibleEvents.length? Math.min(...visibleEvents.map(e=>e.start)) : 0;
  let maxTs=visibleEvents.length? Math.max(...visibleEvents.map(e=>e.end))   : 1;
  if(minTs===maxTs){ minTs-=86400000; maxTs+=86400000; }
  const span=(maxTs-minTs)||1; const oldS=(W*old)/span; const newS=(W*nz)/span; panX = panX*(newS/oldS); zoom=nz; clampPan(); draw();
};

document.getElementById('zoomOut').onclick = ()=>{
  const old=zoom; const nz=Math.max(minZoom, zoom/1.3); if(nz===old) return;
  const W=canvas.width||canvas.clientWidth;
  let minTs=visibleEvents.length? Math.min(...visibleEvents.map(e=>e.start)) : 0;
  let maxTs=visibleEvents.length? Math.max(...visibleEvents.map(e=>e.end))   : 1;
  if(minTs===maxTs){ minTs-=86400000; maxTs+=86400000; }
  const span=(maxTs-minTs)||1; const oldS=(W*old)/span; const newS=(W*nz)/span; panX = panX*(newS/oldS); zoom=nz; clampPan(); draw();
};
