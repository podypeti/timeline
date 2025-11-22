
// ===== Timeline config =====
const MIN_YEAR = -5000;
const MAX_YEAR = 2100;
const INITIAL_CENTER_YEAR = -4000;            // első nézet középpontja
const MIN_ZOOM = 0.2;                          // px / év
const MAX_ZOOM = 500;                          // px / év
const LABEL_ANCHOR_YEAR = -5000;               // feliratozás horgonya
const AVG_YEAR_DAYS = 365.2425;                // átlagos tropikus év hossza napokban

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
let drawHitRects = [];          // képernyő-koordináták hit-testhez (pontok és sávok)
let activeGroups = new Set();   // legend szűrés (custom módban használjuk)
let groupColors = new Map();    // Group -> szín
let groupChips = new Map();     // Group -> chip elem (class toggle-hoz)
let filterMode = 'all';         // 'all' | 'none' | 'custom'
let anchorJD = null;            // MIN_YEAR jan 1 00:00 JD

// ===== Utils =====
function sizeCanvasToCss() {
  // a látható méret (CSS) alapján állítjuk a rajzoló buffer méretét (retina dpr-rel)
  const rect = canvas.getBoundingClientRect();
  W = Math.max(1, Math.floor(rect.width * dpr));
  H = Math.max(1, Math.floor(rect.height * dpr));
  canvas.width = W;
  canvas.height = H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // minden rajz dpr-ben
}

function formatYearHuman(y) {
  return y < 0 ? `${Math.abs(y)} BCE` : `${y}`;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatMonthYear(v) {
  const year = Math.floor(v);
  const frac = v - year;
  const mIndex = Math.floor(frac * 12);
  const m = MONTHS[Math.max(0, Math.min(11, mIndex))];
  return year < 0 ? `${m} ${Math.abs(year)} BCE` : `${m} ${year}`;
}

// Nap/óra címkék (vizuális orientációhoz)
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
  // determinisztikus HSL szín a Group alapján
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

function getGroupColor(group) {
  if (!group) return '#0077ff';
  if (!groupColors.has(group)) groupColors.set(group, hashColor(group));
  return groupColors.get(group);
}

function xForYear(yearFloat) {
  return (yearFloat - MIN_YEAR) * scale + panX;
}

function yearForX(x) {
  return MIN_YEAR + (x - panX) / scale;
}

function isGroupVisible(group) {
  if (filterMode === 'all')  return true;
  if (filterMode === 'none') return false;
  // custom
  return activeGroups.has(group);
}

// ===== Proleptikus Gergely → Julian Day Number (astronomical year) =====
// Forrásalgoritmus (közismert JDN képlet) proleptikus Gergely-naptárra.
// Megjegyzés: year=0 az 1 BCE-nek felel meg (astronomical numbering).
function gregorianToJDN(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  // JDN a polgári nap kezdetén (éjfélhez igazítva)
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4)
       - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
}

// Idő (HH:MM[:SS]) sztring → napi frakció
function parseTimeFraction(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  const h = Math.min(23, Math.max(0, parseInt(m[1],10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2],10)));
  const se = m[3] ? Math.min(59, Math.max(0, parseInt(m[3],10))) : 0;
  return h/24 + mi/1440 + se/86400;
}

// Esemény dátum → év-tört (float) a MIN_YEAR Jan 1 00:00-hoz viszonyítva
function dateToYearFloat(year, month=1, day=1, timeStr='') {
  if (!Number.isFinite(year)) return NaN;
  const m = Number.isFinite(month) ? Math.max(1, Math.min(12, month)) : 1;
  const d = Number.isFinite(day)   ? Math.max(1, Math.min(31, day))   : 1;
  const jdn = gregorianToJDN(year, m, d);
  const frac = parseTimeFraction(timeStr);
  // JD ~ JDN + időfrakció
  const jd = jdn + frac;
  if (anchorJD == null) {
    // Anchor: MIN_YEAR Jan 1 00:00
    anchorJD = gregorianToJDN(MIN_YEAR, 1, 1);
  }
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
  // normálizálás
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
  // vesszők idézőjelek között ne váljanak el
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// ===== Legend (Groups) + „All” / „None” =====
function buildLegend() {
  const groups = [...new Set(events.map(e => e['Group']).filter(Boolean))].sort();
  legendEl.innerHTML = '';
  groupChips.clear();

  // Admin chips: All / None
  const addAdminChip = (label, onClick, color = '#444') => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.admin = label;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = color;
    const text = document.createElement('span');
    text.textContent = label;
    chip.appendChild(sw);
    chip.appendChild(text);
    chip.addEventListener('click', onClick);
    legendEl.appendChild(chip);
  };

  addAdminChip('All', () => {
    activeGroups = new Set(groups);          // minden aktív
    filterMode = 'all';
    groupChips.forEach((chip) => chip.classList.remove('inactive'));
    draw();
  }, '#2c7'); // zöld

  addAdminChip('None', () => {
    activeGroups.clear();                    // üres halmaz
    filterMode = 'none';                     // semmi sem látszik
    groupChips.forEach((chip) => chip.classList.add('inactive'));
    draw();
  }, '#c33'); // piros

  // Csoportchips
  groups.forEach(g => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.group = g;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = getGroupColor(g);
    const label = document.createElement('span');
    label.textContent = g;
    chip.appendChild(sw);
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      filterMode = 'custom'; // innentől a halmaz irányít
      if (activeGroups.has(g)) {
        activeGroups.delete(g);
        chip.classList.add('inactive');
      } else {
        activeGroups.add(g);
        chip.classList.remove('inactive');
      }
      draw();
    });
    legendEl.appendChild(chip);
    groupChips.set(g, chip);
    // kezdetben minden aktív (és filterMode = 'all')
    activeGroups.add(g);
  });
}

// ===== Details panel =====
function showDetails(ev) {
  const baseYear = parseInt(ev['Year'], 10);
  const displayDate =
    ev['Display Date'] ||
    (Number.isFinite(baseYear) ? formatYearHuman(baseYear) : '');

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
function hideDetails(){ detailsPanel.classList.add('hidden'); detailsContent.innerHTML=''; }
detailsClose.addEventListener('click', hideDetails);
function escapeHtml(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s){ return escapeHtml(s).replace(/'/g,'&#39;'); }

// ===== Tick scale (zoom-függő részletesség) =====
function chooseTickScale(pxPerYear) {
  // RÉSZLETES SKÁLA: 1000y → 100y → 10y → 1y → hónap → nap → óra
  if (pxPerYear >= 8000) {
    // ÓRA szint – major: 1 óra (év-frakció), minor: ~10 perc
    const hour = 1 / (AVG_YEAR_DAYS * 24);
    return {
      majorStep: hour,
      format: (v) => formatHour(v),
      minor: { step: hour / 6, len: 10, faint: true }
    };
  }
  if (pxPerYear >= 1200) {
    // NAP szint – major: 1 nap, minor: ~2 óra
    const day = 1 / AVG_YEAR_DAYS;
    return {
      majorStep: day,
      format: (v) => formatDay(v),
      minor: { step: day / 12, len: 12, faint: true }
    };
  }
  if (pxPerYear >= 600) {
    // HÓNAP szint – major: 1/12 év, minor: 1/48 év (kb. heti)
    const month = 1 / 12;
    return {
      majorStep: month,
      format: (v) => formatMonthYear(v),
      minor: { step: month / 4, len: 14, faint: true }
    };
  }
  if (pxPerYear >= 200) {
    // ÉV szint – major: 1 év, minor: negyedév
    return { majorStep: 1, format: (v)=>formatYearHuman(Math.round(v)), minor: { step: 0.25, len: 14 } };
  }
  if (pxPerYear >= 60) {
    // 10 év major, 1 év minor
    return { majorStep: 10, format: formatYearHuman, minor: { step: 1, len: 12 } };
  }
  if (pxPerYear >= 18) {
    // 100 év major, 10 év minor
    return { majorStep: 100, format: formatYearHuman, minor: { step: 10, len: 10 } };
  }
  // alap: 1000 év major, 100 év minor
  return { majorStep: 1000, format: formatYearHuman, minor: { step: 100, len: 8 } };
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

  // minor ticks – vékony vonalak; ha faint, halvány rács a teljes magasságban
  if (minor && minor.step) {
    const startMinor = Math.ceil(MIN_YEAR / minor.step) * minor.step;
    for (let m = startMinor; m < MAX_YEAR; m += minor.step) {
      const mx = xForYear(m);
      if (mx > -80 && mx < W + 80) {
        ctx.strokeStyle = minor.faint ? '#00000010' : '#00000015';
        ctx.beginPath();
        ctx.moveTo(mx, 0);
        ctx.lineTo(mx, minor.len);
        ctx.stroke();
        if (minor.faint) {
          ctx.strokeStyle = '#00000008';
          ctx.beginPath();
          ctx.moveTo(mx, 0);
          ctx.lineTo(mx, H / dpr);
          ctx.stroke();
        }
      }
    }
  }

  // major ticks + címkék („pill”)
  let t = Math.ceil((MIN_YEAR - LABEL_ANCHOR_YEAR) / majorStep) * majorStep + LABEL_ANCHOR_YEAR;
  let lastRight = -Infinity;
  const gap = 10;
  const pillY = 16;

  while (t < MAX_YEAR) {
    const x = xForYear(t);
    if (x > -120 && x < W + 120) {
      // major tick vonal
      ctx.strokeStyle = '#00000033';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 40);
      ctx.stroke();

      // felirat „pill”-ben (ütközésgátlással + felső korlát)
      const text = format(t);
      const pillW = Math.min(160, ctx.measureText(text).width + 10);
      const pillH = 20;
      if (x - pillW / 2 > lastRight + gap) {
        fillStrokeRoundedRect(x - pillW / 2, pillY, pillW, pillH, 6, '#ffffffee', '#00000022');
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x - pillW / 2 + 5, pillY + pillH / 2);
        lastRight = x + pillW / 2;
      }
      // ha nem fér el, marad a tick, címke nélkül
    }
    t += majorStep;
  }
  ctx.restore();

  // középvonal + közép-év felirat
  ctx.strokeStyle = '#00000033';
  ctx.beginPath();
  ctx.moveTo(W / dpr / 2, 0);
  ctx.lineTo(W / dpr / 2, H / dpr);
  ctx.stroke();
  const centerYear = Math.round(yearForX(canvas.clientWidth / 2));
  const centerLabel = formatYearHuman(centerYear);
  ctx.fillStyle = '#00000066';
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(centerLabel, (W / dpr / 2) + 6, H / dpr - 6);

  // esemény-sáv Y pozíciók
  const rowYPoint = 110;    // pontok sora
  const rowYBar   = 180;    // időszakok (Year..End Year) sora

  // események kirajzolása
  ctx.textBaseline = 'top';
  ctx.font = '14px sans-serif';

  events.forEach(ev => {
    const group = ev['Group'] || '';
    if (!isGroupVisible(group)) return;

    const col = getGroupColor(group);

    // Precíz év-tört számítás JDN alapján
    let baseYear = parseInt(ev['Year'], 10);
    let startYearFloat = NaN;
    if (Number.isFinite(baseYear)) {
      const mVal = parseInt(ev['Month'], 10);
      const dVal = parseInt(ev['Day'], 10);
      const tVal = ev['Time'] || '';
      startYearFloat = dateToYearFloat(baseYear, mVal, dVal, tVal);
    }

    let endYear = parseInt(ev['End Year'], 10);
    let endYearFloat = NaN;
    if (Number.isFinite(endYear)) {
      const endM  = parseInt(ev['End Month'], 10);
      const endD  = parseInt(ev['End Day'], 10);
      const endT  = ev['End Time'] || '';
      endYearFloat = dateToYearFloat(endYear, endM, endD, endT);
    }

    const title = ev['Headline'] || ev['Text'] || '';

    if (Number.isFinite(startYearFloat) && Number.isFinite(endYearFloat)) {
      // időszak (sáv)
      const x1 = xForYear(startYearFloat);
      const x2 = xForYear(endYearFloat);
      const xL = Math.min(x1, x2);
      const xR = Math.max(x1, x2);
      if (xR > -50 && xL < W / dpr + 50) {
        ctx.fillStyle = col.replace('45%', '85%'); // világosabb a sáv
        fillStrokeRoundedRect(xL, rowYBar, Math.max(4, xR - xL), 16, 8, ctx.fillStyle, '#00000022');
        // cím a sáv végén
        if (title) {
          ctx.fillStyle = '#111';
          ctx.fillText(title, xR + 8, rowYBar);
        }
        drawHitRects.push({ kind: 'bar', ev, x: xL, y: rowYBar, w: Math.max(4, xR - xL), h: 16 });
      }
    } else if (Number.isFinite(startYearFloat)) {
      // pont
      const x = xForYear(startYearFloat);
      if (x > -50 && x < W / dpr + 50) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, rowYPoint, 5, 0, Math.PI * 2);
        ctx.fill();
        // cím
        if (title) {
          ctx.fillStyle = '#111';
          ctx.fillText(title, x + 8, rowYPoint + 8);
        }
        drawHitRects.push({ kind: 'point', ev, x: x - 6, y: rowYPoint - 6, w: 12, h: 12 });
      }
    }
  });
}

// ===== Initialization =====
function initScaleAndPan() {
  sizeCanvasToCss();
  // Alap skála: látszódjon egy nagy tartomány, de ne legyen túl kicsi
  scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvas.clientWidth / (MAX_YEAR - MIN_YEAR)));
  // középre igazítás az INITIAL_CENTER_YEAR körül
  panX = (canvas.clientWidth / 2) - ((INITIAL_CENTER_YEAR - MIN_YEAR) * scale);
}

async function init() {
  // Anchor JD előkészítése
  anchorJD = gregorianToJDN(MIN_YEAR, 1, 1);

  initScaleAndPan();
  // CSV betöltés
  try {
    events = await loadCsv('timeline-data.csv');
  } catch (e) {
    console.error('CSV betöltési hiba:', e);
    events = [];
  }
  buildLegend();
  draw();
}
init();

// ===== Zoom controls =====
function zoomTo(newScale, anchorX = canvas.clientWidth / 2) {
  // Kurzor-központú zoom: az anchorX alatti év maradjon ugyanott
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
canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.clientX;
});
window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    panX += (e.clientX - dragStartX);
    dragStartX = e.clientX;
    draw();
  }
});
window.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

// Touch – egyujjas húzás
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    isDragging = true;
    dragStartX = e.touches[0].clientX;
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (isDragging && e.touches.length === 1) {
    panX += (e.touches[0].clientX - dragStartX);
    dragStartX = e.touches[0].clientX;
    draw();
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { isDragging = false; });

// ===== Hit test (kattintás a pontokra / sávokra) =====
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  for (let i = drawHitRects.length - 1; i >= 0; i--) {
    const p = drawHitRects[i];
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
      showDetails(p.ev);
      return;
    }
  }
});

// ===== Responsive redraw =====
window.addEventListener('resize', () => { draw(); });
