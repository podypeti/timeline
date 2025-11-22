
// ===== Timeline config =====
const MIN_YEAR = -5000;
const MAX_YEAR = 2100;
const INITIAL_CENTER_YEAR = -4000;            // első nézet középpontja
const MIN_ZOOM = 0.2;                          // px / év
const MAX_ZOOM = 12000;                        // deeper zoom (was 500)
const LABEL_ANCHOR_YEAR = -5000;               // feliratozás horgonya
const AVG_YEAR_DAYS = 365.2425;                // átlagos tropikus év hossza napokban

// --- Clustering config ---
const CLUSTER_BY = 'pixel';    // 'pixel' | 'year'

// Zoom-aware pixel threshold: clusters dissolve earlier at higher zoom
function clusterPxThreshold() {
  const ppy = scale; // pixels per year
  if (ppy >= 800) return 6;     // very high zoom → tiny cluster radius
  if (ppy >= 200) return 10;
  if (ppy >= 60)  return 14;
  return 22;                    // low zoom → generous clustering
}

// Labels will be drawn at all zoom levels (we’ll manage clutter via multi-rows)
const SHOW_LABEL_SCALE = 0;     // draw labels regardless of zoom

// ===== DOM =====
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
const legendEl = document.getElementById('legend');
const btnZoomIn = document.getElementById('zoomIn');
const btnZoomOut = document.getElementById('zoomOut');
const btnReset = document.getElementById('resetZoom');
const detailsPanel = document.getElementById('detailsPanel');
const detailsClose = document.getElementById('detailsClose');
const detailsContent = document.getElementById('detailsContent');

// ===== State =====
let dpr = Math.max(1, window.devicePixelRatio || 1);
let W = 0, H = 0;               // canvas pixeles mérete (backing store)
let scale = 1;                  // px / év
let panX = 0;                   // vízszintes eltolás (px)
let isDragging = false;
let dragStartX = 0;
let events = [];                // CSV-ből betöltött események
let drawHitRects = [];          // képernyő-koordináták hit-testhez (pontok, sávok, klaszterek)
let activeGroups = new Set();   // legend szűrés (custom módban használjuk)
let groupColors = new Map();    // Group -> szín
let groupChips = new Map();     // Group -> chip elem (class toggle-hoz)
let filterMode = 'all';         // 'all' | 'none' | 'custom'
let anchorJD = null;            // MIN_YEAR Jan 1 00:00 JD

// ===== Utils =====
function sizeCanvasToCss() {
  const rect = canvas.getBoundingClientRect();
  W = Math.max(1, Math.floor(rect.width * dpr));
  H = Math.max(1, Math.floor(rect.height * dpr));
  canvas.width = W;
  canvas.height = H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function formatYearHuman(y) { return y < 0 ? `${Math.abs(y)} BCE` : `${y}`; }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatMonthYear(v) {
  const year = Math.floor(v);
  const frac = v - year;
  const mIndex = Math.floor(frac * 12);
  const m = MONTHS[Math.max(0, Math.min(11, mIndex))];
  return year < 0 ? `${m} ${Math.abs(year)} BCE` : `${m} ${year}`;
}

// Vizualizációs nap/óra címkék (orientációhoz)
function formatDay(v) {
  const year = Math.floor(v);
  const fracY = v - year;
  const monthIdx = Math.floor(fracY * 12);
  const monthStart = monthIdx / 12;
  const dayFrac = fracY - monthStart;
  const dayIndex = Math.floor(dayFrac * AVG_YEAR_DAYS / 12);
  const labelYear = year < 0 ? `${Math.abs(year)} BCE` : `${year}`;
  const labelMonth = MONTHS[Math.max(0, Math.min(11, monthIdx))];
  return `${labelYear} · ${labelMonth} ${dayIndex + 1}`;
}

function formatHour(v) {
  const year = Math.floor(v);
  const fracY = v - year;
  const monthIdx = Math.floor(fracY * 12);
  const monthStart = monthIdx / 12;
  const dayFrac = fracY - monthStart;
  const dayIndex = Math.floor(dayFrac * AVG_YEAR_DAYS / 12);
  const dayRemainder = (dayFrac * AVG_YEAR_DAYS / 12) - dayIndex;
  const hour = Math.floor(dayRemainder * 24);
  const labelYear = year < 0 ? `${Math.abs(year)} BCE` : `${year}`;
  const labelMonth = MONTHS[Math.max(0, Math.min(11, monthIdx))];
  const hh = String(hour).padStart(2, '0');
  return `${labelYear} · ${labelMonth} ${dayIndex + 1}, ${hh}:00`;
}

function hashColor(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 65%, 45%)`;
}
function getGroupColor(group) {
  if (!group) return '#0077ff';
  if (!groupColors.has(group)) groupColors.set(group, hashColor(group));
  return groupColors.get(group);
}
function xForYear(yearFloat) { return (yearFloat - MIN_YEAR) * scale + panX; }
function yearForX(x) { return MIN_YEAR + (x - panX) / scale; }

function isGroupVisible(group) {
  if (filterMode === 'all')  return true;
  if (filterMode === 'none') return false;
  return activeGroups.has(group);
}

// ===== Proleptic Gregorian → Julian Day Number (astronomical year) =====
function gregorianToJDN(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4)
       - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
}
function parseTimeFraction(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  const h  = Math.min(23, Math.max(0, parseInt(m[1],10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2],10)));
  const se = m[3] ? Math.min(59, Math.max(0, parseInt(m[3],10))) : 0;
  return h/24 + mi/1440 + se/86400;
}
function dateToYearFloat(year, month=1, day=1, timeStr='') {
  if (!Number.isFinite(year)) return NaN;
  const m = Number.isFinite(month) ? Math.max(1, Math.min(12, month)) : 1;
  const d = Number.isFinite(day)   ? Math.max(1, Math.min(31, day))   : 1;
  const jdn = gregorianToJDN(year, m, d);
  const frac = parseTimeFraction(timeStr);
  const jd = jdn + frac;
  if (anchorJD == null) anchorJD = gregorianToJDN(MIN_YEAR, 1, 1);
  const daysFromAnchor = jd - anchorJD;
  return MIN_YEAR + (daysFromAnchor / AVG_YEAR_DAYS);
}

// ===== Rounded-rect fallback (Path2D) =====
function roundedRectPath(x, y, w, h, r) {
  const p = new Path2D();
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  return p;
}
function fillStrokeRoundedRect(x, y, w, h, r, fillStyle, strokeStyle) {
  const path = (Path2D.prototype.roundRect)
    ? (() => { const p = new Path2D(); p.roundRect(x, y, w, h, r); return p; })()
    : roundedRectPath(x, y, w, h, r);
  if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(path); }
  if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.stroke(path); }
}

// ===== CSV parsing (quoted commas supported) =====
async function loadCsv(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parseCSV(text);
}
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j].trim();
      const val = (cols[j] ?? '').trim().replace(/^"|"$/g, '');
      obj[key] = val;
    }
    rows.push(obj);
  }
  return rows;
}
function splitCsvLine(line) {
  const result = []; let cur = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// ===== Legend (Groups) + „All” / „None” =====
function buildLegend() {
  const groups = [...new Set(events.map(e => e['Group']).filter(Boolean))].sort();
  legendEl.innerHTML = ''; groupChips.clear();

  const addAdminChip = (label, onClick, color = '#444') => {
    const chip = document.createElement('div');
    chip.className = 'chip'; chip.dataset.admin = label;
    const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = color;
    const text = document.createElement('span'); text.textContent = label;
    chip.appendChild(sw); chip.appendChild(text); chip.addEventListener('click', onClick);
    legendEl.appendChild(chip);
  };

  addAdminChip('All', () => {
    activeGroups = new Set(groups); filterMode = 'all';
    groupChips.forEach((chip) => chip.classList.remove('inactive'));
    draw();
  }, '#2c7');

  addAdminChip('None', () => {
    activeGroups.clear(); filterMode = 'none';
    groupChips.forEach((chip) => chip.classList.add('inactive'));
    draw();
  }, '#c33');

  groups.forEach(g => {
    const chip = document.createElement('div');
    chip.className = 'chip'; chip.dataset.group = g;
    const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = getGroupColor(g);
    const label = document.createElement('span'); label.textContent = g;
    chip.appendChild(sw); chip.appendChild(label);
    chip.addEventListener('click', () => {
      filterMode = 'custom';
      if (activeGroups.has(g)) { activeGroups.delete(g); chip.classList.add('inactive'); }
      else { activeGroups.add(g); chip.classList.remove('inactive'); }
      draw();
    });
    legendEl.appendChild(chip); groupChips.set(g, chip);
    activeGroups.add(g); // kezdetben minden aktív
  });
}

// ===== Details panel =====
function showDetails(ev) {
  const baseYear = parseInt(ev['Year'], 10);
  const displayDate = ev['Display Date'] || (Number.isFinite(baseYear) ? formatYearHuman(baseYear) : '');
  const headline = ev['Headline'] || '';
  const text = ev['Text'] || '';
  const media = ev['Media'] || '';
  const credit = ev['Media Credit'] || '';
  const caption = ev['Media Caption'] || '';
  detailsContent.innerHTML = `
    <h3>${escapeHtml(headline)}</h3>
    <div class="meta">${escapeHtml(displayDate)}${ev['Type'] ? ' • ' + escapeHtml(ev['Type']) : ''}${ev['Group'] ? ' • ' + escapeHtml(ev['Group']) : ''}</div>
    ${media ? `<div class="media">${escapeAttr(media)}</div>` : ''}
    ${caption ? `<p><em>${escapeHtml(caption)}</em></p>` : ''}
    ${text ? `<p>${text}</p>` : ''}
    ${credit ? `<p class="meta">${escapeHtml(credit)}</p>` : ''}
  `;
  detailsPanel.classList.remove('hidden');
}
function showClusterDetails(cluster) {
  const itemsHtml = cluster.events.map((ev, idx) => {
    const Y = ev._labelDate || ev['Display Date'] || formatYearHuman(parseInt(ev['Year'],10));
    const T = ev['Headline'] || ev['Text'] || '(no title)';
    return `<li class="cluster-item" data-idx="${idx}">
              <strong>${escapeHtml(Y)}</strong> — ${escapeHtml(T)}
            </li>`;
  }).join('');
  detailsContent.innerHTML = `
    <h3>${cluster.events.length} events</h3>
    <div class="meta">Cluster around ${formatYearHuman(Math.round(cluster.centerYear))}</div>
    <ul style="margin:8px 0 0; padding-left:18px">${itemsHtml}</ul>
    <p class="meta">Click an item to open its details.</p>
  `;
  detailsPanel.classList.remove('hidden');
  detailsContent.querySelectorAll('.cluster-item').forEach(li => {
    li.addEventListener('click', () => {
      const idx = parseInt(li.dataset.idx,10);
      const ev = cluster.events[idx];
      showDetails(ev);
    });
  });
}
function hideDetails(){ detailsPanel.classList.add('hidden'); detailsContent.innerHTML=''; }
detailsClose.addEventListener('click', hideDetails);
function escapeHtml(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s){ return escapeHtml(s).replace(/'/g,'&#39;'); }

// ===== Tick scale (zoom-függő részletesség) =====
function chooseTickScale(pxPerYear) {
  if (pxPerYear >= 8000) {
    const hour = 1 / (AVG_YEAR_DAYS * 24);
    return { majorStep: hour, format: (v) => formatHour(v), minor: { step: hour / 6, len: 10, faint: true } };
  }
  if (pxPerYear >= 1200) {
    const day = 1 / AVG_YEAR_DAYS;
    return { majorStep: day, format: (v) => formatDay(v), minor: { step: day / 12, len: 12, faint: true } };
  }
  if (pxPerYear >= 600) {
    const month = 1 / 12;
    return { majorStep: month, format: (v) => formatMonthYear(v), minor: { step: month / 4, len: 14, faint: true } };
  }
  if (pxPerYear >= 200) return { majorStep: 1, format: (v)=>formatYearHuman(Math.round(v)), minor: { step: 0.25, len: 14 } };
  if (pxPerYear >= 60)  return { majorStep: 10, format: formatYearHuman, minor: { step: 1, len: 12 } };
  if (pxPerYear >= 18)  return { majorStep: 100, format: formatYearHuman, minor: { step: 10, len: 10 } };
  return { majorStep: 1000, format: formatYearHuman, minor: { step: 100, len: 8 } };
}

// ===== Dynamic label layout helpers (multi-rows + leader lines) =====
function rowsForScale() {
  if (scale >= 800) return 4;
  if (scale >= 200) return 3;
  return 2;
}
function gapForScale() {
  if (scale >= 200) return 8;
  return 12;
}
function maxLabelWidthForScale() {
  if (scale >= 800) return 320;
  if (scale >= 200) return 240;
  return 180;
}
// shorten a label so it fits into maxWidth (adds ellipsis)
function shortenToFit(text, maxWidth) {
  let t = text;
  if (!t) return '';
  if (ctx.measureText(t).width <= maxWidth) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = ((lo + hi) >> 1);
    const cand = t.slice(0, mid) + '…';
    if (ctx.measureText(cand).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  const final = t.slice(0, Math.max(1, lo - 1)) + '…';
  return final;
}

// Layout multiple rows of labels with collision avoidance
function layoutSingleLabels(singleClusters, options = {}) {
  // dynamic defaults
  const gap   = options.gap  ?? gapForScale();
  const rowsN = options.rows ?? rowsForScale();
  const yBase = options.y    ?? 118;
  const dy    = options.dy   ?? 18;
  const maxW  = options.maxW ?? maxLabelWidthForScale();
  const showLeader = options.leader ?? true;

  const rows = Array.from({ length: rowsN }, () => ({ right: -Infinity, items: [] }));

  // Measure and assign labels to rows with collision avoidance
  singleClusters.forEach(c => {
    const ev    = c.events[0];
    const title = ev['Headline'] || ev['Text'] || '';
    if (!title) return;

    const text  = shortenToFit(title, maxW);
    const labelW = Math.min(maxW, ctx.measureText(text).width + 6);

    // Try to place on an available row
    for (let r = 0; r < rowsN; r++) {
      const row = rows[r];
      if (c.centerX - labelW / 2 > row.right + gap) {
        row.items.push({ x: c.centerX, w: labelW, text, dotY: c.y });
        row.right = c.centerX + labelW / 2;
        return;
      }
    }
    // If none fits, force onto the last row (minimal overlap but guaranteed visibility)
    const last = rows[rowsN - 1];
    last.items.push({ x: c.centerX, w: labelW, text, dotY: c.y });
    last.right = Math.max(last.right, c.centerX + labelW / 2);
  });

  // Draw labels row by row
  ctx.fillStyle = '#111';
  ctx.textBaseline = 'top';
  ctx.font = '14px sans-serif';

  rows.forEach((row, ri) => {
    const y = yBase + ri * dy;
    row.items.forEach(it => {
      ctx.fillText(it.text, it.x + 8, y); // label text
      if (showLeader) {
        ctx.strokeStyle = '#00000022';
        ctx.beginPath();
        ctx.moveTo(it.x, it.dotY + 5); // from dot bottom
        ctx.lineTo(it.x + 6, y);       // to label start
        ctx.stroke();
      }
    });
  });
}

// ===== Fő rajz =====
function draw() {
  sizeCanvasToCss();
  ctx.clearRect(0, 0, W, H);
  drawHitRects = [];

  // háttér
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // skála és tickek
  ctx.save();
  ctx.font = '14px sans-serif';

  const { majorStep, format, minor } = chooseTickScale(scale);

  // minor ticks + faint grid
  if (minor && minor.step) {
    const startMinor = Math.ceil(MIN_YEAR / minor.step) * minor.step;
    for (let m = startMinor; m < MAX_YEAR; m += minor.step) {
      const mx = xForYear(m);
      if (mx > -80 && mx < W + 80) {
        ctx.strokeStyle = minor.faint ? '#00000010' : '#00000015';
        ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, minor.len); ctx.stroke();
        if (minor.faint) { ctx.strokeStyle = '#00000008'; ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H / dpr); ctx.stroke(); }
      }
    }
  }

  // major ticks + címkék
  let t = Math.ceil((MIN_YEAR - LABEL_ANCHOR_YEAR) / majorStep) * majorStep + LABEL_ANCHOR_YEAR;
  let lastRight = -Infinity;
  const gap = 10, pillY = 16;
  while (t < MAX_YEAR) {
    const x = xForYear(t);
    if (x > -120 && x < W + 120) {
      ctx.strokeStyle = '#00000033';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 40); ctx.stroke();
      const text = format(t);
      const pillW = Math.min(160, ctx.measureText(text).width + 10);
      const pillH = 20;
      if (x - pillW / 2 > lastRight + gap) {
        fillStrokeRoundedRect(x - pillW / 2, pillY, pillW, pillH, 6, '#ffffffee', '#00000022');
        ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
        ctx.fillText(text, x - pillW / 2 + 5, pillY + pillH / 2);
        lastRight = x + pillW / 2;
      }
    }
    t += majorStep;
  }
  ctx.restore();

  // középvonal + közép-év felirat
  ctx.strokeStyle = '#00000033';
  ctx.beginPath(); ctx.moveTo(W / dpr / 2, 0); ctx.lineTo(W / dpr / 2, H / dpr); ctx.stroke();
  const centerYear = Math.round(yearForX(canvas.clientWidth / 2));
  ctx.fillStyle = '#00000066'; ctx.font = '12px sans-serif'; ctx.textBaseline = 'bottom';
  ctx.fillText(formatYearHuman(centerYear), (W / dpr / 2) + 6, H / dpr - 6);

  // esemény-sáv Y pozíciók
  const rowYPoint = 110;    // pontok sora
  const rowYBar   = 180;    // időszakok sora

  // ====== 1) Precíz eseménypozíciók kiszámítása ======
  const visiblePoints = []; // {ev, x, yLabel, title, group, color, yearFloat, yearKey}

  events.forEach(ev => {
    const group = ev['Group'] || '';
    if (!isGroupVisible(group)) return;

    // start
    const baseYear = parseInt(ev['Year'], 10);
    let startYearFloat = NaN;
    if (Number.isFinite(baseYear)) {
      const mVal = parseInt(ev['Month'], 10);
      const dVal = parseInt(ev['Day'], 10);
      const tVal = ev['Time'] || '';
      startYearFloat = dateToYearFloat(baseYear, mVal, dVal, tVal);
    }

    // end
    const endYear = parseInt(ev['End Year'], 10);
    let endYearFloat = NaN;
    if (Number.isFinite(endYear)) {
      const endM  = parseInt(ev['End Month'], 10);
      const endD  = parseInt(ev['End Day'], 10);
      const endT  = ev['End Time'] || '';
      endYearFloat = dateToYearFloat(endYear, endM, endD, endT);
    }

    const title = ev['Headline'] || ev['Text'] || '';

    // időszak → rajzoljuk külön sávként (nem része a pont-klaszterezésnek)
    if (Number.isFinite(startYearFloat) && Number.isFinite(endYearFloat)) {
      const x1 = xForYear(startYearFloat), x2 = xForYear(endYearFloat);
      const xL = Math.min(x1, x2), xR = Math.max(x1, x2);
      if (xR > -50 && xL < W / dpr + 50) {
        const col = getGroupColor(group);
        ctx.fillStyle = col.replace('45%', '85%');
        fillStrokeRoundedRect(xL, rowYBar, Math.max(4, xR - xL), 16, 8, ctx.fillStyle, '#00000022');
        if (title) { ctx.fillStyle = '#111'; ctx.fillText(title, xR + 8, rowYBar); }
        drawHitRects.push({ kind: 'bar', ev, x: xL, y: rowYBar, w: Math.max(4, xR - xL), h: 16 });
      }
      return;
    }

    // pont → belép a klaszterezésbe
    if (Number.isFinite(startYearFloat)) {
      const x = xForYear(startYearFloat);
      if (x > -50 && x < W / dpr + 50) {
        const color = getGroupColor(group);
        ev._labelDate = ev['Display Date'] || formatYearHuman(parseInt(ev['Year'],10));
        visiblePoints.push({
          ev, x, yLabel: rowYPoint, title, group, color,
          yearFloat: startYearFloat,
          yearKey: Math.round(startYearFloat) // fallback 'year' módhoz
        });
      }
    }
  });

  // ====== 2) Klaszterezés (zoom-aware pixel threshold; auto dissolve at very high zoom) ======
  visiblePoints.sort((a,b) => a.x - b.x);
  const clusters = [];
  let current = null;

  function pushCurrent() { if (current) { clusters.push(current); current = null; } }

  for (const p of visiblePoints) {
    if (!current) {
      current = { events:[p.ev], xs:[p.x], y:p.yLabel, groups:new Set([p.group]), colors:[p.color], centerX:p.x, centerYear:p.yearFloat };
      continue;
    }
    const effPx = (scale >= 400 ? 0 : clusterPxThreshold());  // no clustering ≥ 400 px/year
    const sameBucket =
      (CLUSTER_BY === 'pixel') ? (Math.abs(p.x - current.centerX) <= effPx)
                               : (p.yearKey === Math.round(current.centerYear));
    if (sameBucket) {
      current.events.push(p.ev);
      current.xs.push(p.x);
      current.groups.add(p.group);
      current.colors.push(p.color);
      // új közép: átlag
      const sumX = current.xs.reduce((s,v)=>s+v,0);
      current.centerX = sumX / current.xs.length;
      const sumYears = current.events.reduce((s,ev)=>{
        const Y = parseInt(ev['Year'],10), M = parseInt(ev['Month'],10), D = parseInt(ev['Day'],10);
        const T = ev['Time'] || '';
        const yf = dateToYearFloat(Y, M, D, T);
        return s + (Number.isFinite(yf) ? yf : current.centerYear);
      }, 0);
      current.centerYear = sumYears / current.events.length;
    } else {
      pushCurrent();
      current = { events:[p.ev], xs:[p.x], y:p.yLabel, groups:new Set([p.group]), colors:[p.color], centerX:p.x, centerYear:p.yearFloat };
    }
  }
  pushCurrent();

  // ====== 3) Klaszterek rajzolása (1 → dot, >1 → bubble with count) ======
  ctx.textBaseline = 'top';
  ctx.font = '14px sans-serif';

  clusters.forEach(cluster => {
    const n = cluster.events.length;
    const x = cluster.centerX;
    const y = cluster.y;

    if (n === 1) {
      // single event — draw dot now; labels handled later in multi-row layout
      const ev = cluster.events[0];
      const group = ev['Group'] || '';
      const col = getGroupColor(group);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();

      drawHitRects.push({ kind:'point', ev, x: x - 6, y: y - 6, w: 12, h: 12 });
    } else {
      // cluster bubble
      const r = Math.min(14, 7 + Math.log2(n + 1));
      ctx.fillStyle = '#0077ff';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

      // count inside
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(String(n), x, y);

      drawHitRects.push({ kind:'cluster', cluster, x: x - (r+2), y: y - (r+2), w: (r+2)*2, h: (r+2)*2 });
    }
  });

  // ====== 4) Multi-row label layout for singles (collision-avoiding, with leader lines) ======
  const singles = clusters.filter(c => c.events.length === 1);

  // Draw labels unconditionally (we manage clutter by rows/gaps/widths)
  layoutSingleLabels(singles, {
    gap: gapForScale(),
    rows: rowsForScale(),
    y: 118,
    dy: 18,
    maxW: maxLabelWidthForScale(),
    leader: true
  });
}

// ===== Initialization =====
function initScaleAndPan() {
  sizeCanvasToCss();
  scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvas.clientWidth / (MAX_YEAR - MIN_YEAR)));
  panX = (canvas.clientWidth / 2) - ((INITIAL_CENTER_YEAR - MIN_YEAR) * scale);
}
async function init() {
  anchorJD = gregorianToJDN(MIN_YEAR, 1, 1);
  initScaleAndPan();
  try { events = await loadCsv('timeline-data.csv'); }
  catch (e) { console.error('CSV betöltési hiba:', e); events = []; }
  buildLegend();
  draw();
}
init();

// ===== Zoom controls =====
function zoomTo(newScale, anchorX = canvas.clientWidth / 2) {
  const anchorYear = yearForX(anchorX);
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
  scale = clamped;
  panX = anchorX - (anchorYear - MIN_YEAR) * scale;
  draw();
}
function zoomIn(anchorX){ zoomTo(scale * 1.3, anchorX); }
function zoomOut(anchorX){ zoomTo(scale / 1.3, anchorX); }
btnZoomIn.addEventListener('click', () => zoomIn(canvas.clientWidth / 2));
btnZoomOut.addEventListener('click', () => zoomOut(canvas.clientWidth / 2));
btnReset.addEventListener('click', () => { initScaleAndPan(); draw(); });

// egérgörgő zoom (passive:false, hogy preventDefault működjön)
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const anchor = (e.offsetX ?? (e.clientX - canvas.getBoundingClientRect().left));
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  zoomTo(scale * zoomFactor, anchor);
}, { passive: false });

// ===== Drag-to-pan =====
canvas.addEventListener('mousedown', (e) => { isDragging = true; dragStartX = e.clientX; });
window.addEventListener('mousemove', (e) => {
  if (isDragging) { panX += (e.clientX - dragStartX); dragStartX = e.clientX; draw(); }
});
window.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

// Touch – egyujjas húzás
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) { isDragging = true; dragStartX = e.touches[0].clientX; }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (isDragging && e.touches.length === 1) {
    panX += (e.touches[0].clientX - dragStartX); dragStartX = e.touches[0].clientX; draw();
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { isDragging = false; });

// ===== Hit test (kattintás a pontokra / sávokra / klaszterekre) =====
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  for (let i = drawHitRects.length - 1; i >= 0; i--) {
    const p = drawHitRects[i];
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
      if (p.kind === 'cluster') showClusterDetails(p.cluster);
      else if (p.kind === 'point') showDetails(p.ev);
      else if (p.kind === 'bar') showDetails(p.ev);
      return;
    }
  }
});

// ===== Responsive redraw =====
window.addEventListener('resize', () => { draw(); });
