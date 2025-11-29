// ===== Version & config =====
console.log('[timeline] script loaded v6');

const ASSET_VERSION = '6';
const MIN_YEAR = -4050;
const MAX_YEAR = 2100;
const INITIAL_CENTER_YEAR = 1; // center at 1 CE
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 12000;
const LABEL_ANCHOR_YEAR = -5000;
const AVG_YEAR_DAYS = 365.2425;

// --- Clustering config ---
const CLUSTER_BY = 'pixel';
function clusterPxThreshold() {
  const ppy = scale;
  if (ppy >= 800) return 6;
  if (ppy >= 200) return 10;
  if (ppy >= 60) return 14;
  return 22;
}

// ===== DOM =====
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
const btnZoomIn = document.getElementById('zoomIn');
const btnZoomOut = document.getElementById('zoomOut');
const btnReset = document.getElementById('resetZoom');
const detailsPanel = document.getElementById('detailsPanel');
const detailsClose = document.getElementById('detailsClose');
const detailsContent = document.getElementById('detailsContent');
const panSlider = document.getElementById('panSlider');
const panValue = document.getElementById('panValue');

// ===== State =====
let dpr = Math.max(1, window.devicePixelRatio || 1);
let W = 0, H = 0;
let scale = 1;
let panX = 0;
let isDragging = false;
let dragStartX = 0;
let events = [];
let drawHitRects = [];
let groupColors = new Map();
let anchorJD = null;

// ===== Utils =====
function sizeCanvasToCss() {
  const rect = canvas.getBoundingClientRect();
  W = Math.max(1, Math.floor(rect.width * dpr));
  H = Math.max(1, Math.floor(rect.height * dpr));
  canvas.width = W;
  canvas.height = H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}


function formatYearHuman(y) {
  if (y < 0) return `${Math.abs(y)} BCE`;
  if (y > 0) return `${y} CE`;
  return '1 CE'; // force 0 to become 1 CE
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatMonthYear(v) {
  const year = Math.floor(v);
  const frac = v - year;
  const mIndex = Math.floor(frac * 12);
  const m = MONTHS[Math.max(0, Math.min(11, mIndex))];
  return year < 0 ? `${m} ${Math.abs(year)} BCE` : `${m} ${year} CE`;
}
function formatDay(v) {
  const year = Math.floor(v);
  const fracY = v - year;
  const monthIdx = Math.floor(fracY * 12);
  const monthStart = monthIdx / 12;
  const dayFrac = fracY - monthStart;
  const dayIndex = Math.floor(dayFrac * AVG_YEAR_DAYS / 12);
  const labelYear = year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
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
  const labelYear = year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
  const labelMonth = MONTHS[Math.max(0, Math.min(11, monthIdx))];
  const hh = String(hour).padStart(2, '0');
  return `${labelYear} · ${labelMonth} ${dayIndex + 1}, ${hh}:00`;
}

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360},65%,45%)`;
}
function getGroupColor(group) {
  if (!group) return '#0077ff';
  if (!groupColors.has(group)) groupColors.set(group, hashColor(group));
  return groupColors.get(group);
}

function xForYear(yearFloat) { return (yearFloat - MIN_YEAR) * scale + panX; }
function yearForX(x) { return MIN_YEAR + (x - panX) / scale; }

function isGroupVisible(group) {
  if (filterMode === 'all') return true;
  if (filterMode === 'none') return false;
  return activeGroups.has(group);
}

// Slider label
function setPanValueLabel(y) {
  const yr = Math.round(y);
  panValue.textContent = yr < 0 ? `${Math.abs(yr)} BCE` : `${yr} CE`;
}
function centerOnYear(y) {
  panX = (canvas.clientWidth / 2) - ((y - MIN_YEAR) * scale);
  draw();
}

// ===== JDN =====
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
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  const se = m[3] ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0;
  return h / 24 + mi / 1440 + se / 86400;
}
function dateToYearFloat(year, month = 1, day = 1, timeStr = '') {
  if (!Number.isFinite(year)) return NaN;
  const m = Number.isFinite(month) ? Math.max(1, Math.min(12, month)) : 1;
  const d = Number.isFinite(day) ? Math.max(1, Math.min(31, day)) : 1;
  const jdn = gregorianToJDN(year, m, d);
  const frac = parseTimeFraction(timeStr);
  const jd = jdn + frac;
  if (anchorJD == null) anchorJD = gregorianToJDN(MIN_YEAR, 1, 1);
  const daysFromAnchor = jd - anchorJD;
  return MIN_YEAR + (daysFromAnchor / AVG_YEAR_DAYS);
}

// ===== Rounded-rect (Path2D full fallback) =====
function fillStrokeRoundedRect(x, y, w, h, r, fillStyle, strokeStyle) {
  const hasPath2D = (typeof Path2D === 'function');
  if (hasPath2D && Path2D.prototype.roundRect) {
    const p = new Path2D();
    p.roundRect(x, y, w, h, r);
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(p); }
    if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.stroke(p); }
  } else if (hasPath2D) {
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
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(p); }
    if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.stroke(p); }
  } else {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
    if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.stroke(); }
  }
}

// ===== CSV =====
// Robust CSV parser: handles quoted fields, escaped quotes, and line breaks inside cells.
async function loadCsv(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parseCSV(text);
}
function parseCSV(text) {
  const rows = [];
  let header = null;

  let i = 0, len = text.length;
  let cur = '';
  let row = [];
  let inQuotes = false;

  while (i < len) {
    const ch = text[i];

    if (ch === '"') {
      // Escaped double-quote inside a quoted field
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
      i++;
      continue;
    }

    // End-of-line only when not in quotes
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // consume CRLF pair
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';

      if (!header) {
        header = row.map(s => s.trim());
      } else {
        const obj = {};
        for (let j = 0; j < header.length; j++) obj[header[j]] = (row[j] ?? '').trim();
        rows.push(obj);
      }

      row = [];
      i++;
      continue;
    }

    // Regular character
    cur += ch;
    i++;
  }

  // Flush last field/row if file didn't end with newline
  row.push(cur);
  if (!header) {
    header = row.map(s => s.trim());
  } else if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = (row[j] ?? '').trim();
    rows.push(obj);
  }

  return rows;
}

// ===== Legend =====


function getGroupIcon(group) {
  if (!group) return '•';
  const map = {
    'Bible writing': '📚',
    'Bible copy/translation': '📜',
    'Events': '⭐',
    'Persons': '👤',
    'Covenants': '📜',
    'Judges': '⚖️',
    'Kings of Israel': '👑',
    'Kings of Judah': '👑',
    'Prophets': '📖',
    'World powers': '🌍',
    'Jesus': '👑',
    'Time periods': '⏳',
    'Modern day history of JW': '🕊️',
    'King of the North': '⬆️',
    'King of the South': '⬇️',
    'Pauls journeys': '🛤️',
  };
  return map[group] || '•';
}
const legendEl = document.getElementById('legend');
const groupChips = new Map();
let activeGroups = new Set();
let filterMode = 'all';


// --- Legend helpers ---
function addAdminChip(label, onClick, color) {
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.dataset.admin = label.toLowerCase(); // 'all' or 'none'
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.style.background = color;
  const text = document.createElement('span');
  text.textContent = label;
  chip.appendChild(sw);
  chip.appendChild(text);
  chip.addEventListener('click', onClick);
  legendEl.appendChild(chip);
}

function getGroupIcon(group) {
  if (!group) return '•';
  const map = {
    'Bible writing': '📚',
    'Bible copy/translation': '📜',
    'Bible copy/translation ': '📜', // trailing-space safety
    'Events': '⭐',
    'Persons': '👤',
    'Covenants': '📜',
    'Judges': '⚖️',
    'Kings of Israel': '👑',
    'Kings of Judah': '👑',
    'Prophets': '📖',
    'World powers': '🌍',
    'Jesus': '✝️',
    'Time periods': '⏳',
    'Modern day history of JW': '🕊️',
    'King of the North': '⬆️',
    'King of the South': '⬇️',
    "Paul's journeys": '🛤️',
  };
  return map[group.trim?.() ?? group] || '•';
}

function buildLegend() {
  // Collect distinct groups from CSV
  const groups = [...new Set(
    events
      .map(e => (e['Group'] ?? '').trim())
      .filter(Boolean)
  )].sort();

  // Reset legend state
  legendEl.innerHTML = '';
  groupChips.clear();
  filterMode = 'all';
  activeGroups = new Set(groups);

  // Admin chips (added ONCE here)
  addAdminChip('All', () => {
    activeGroups = new Set(groups);
    filterMode = 'all';
    groupChips.forEach(chip => chip.classList.remove('inactive'));
    draw();
  }, '#2c7');

  addAdminChip('None', () => {
    activeGroups.clear();
    filterMode = 'none';
    groupChips.forEach(chip => chip.classList.add('inactive'));
    draw();
  }, '#c33');

  // Group chips from data
  groups.forEach(g => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.group = g;

    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = getGroupColor(g);

    const icon = document.createElement('span');
    icon.className = 'chip-icon';
    icon.textContent = getGroupIcon(g);

    const label = document.createElement('span');
    label.textContent = g;

    chip.append(sw, icon, label);

    chip.addEventListener('click', () => {
      filterMode = 'custom';
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
  });

  // Wire search once, safely (no crash if element missing)
  const search = document.getElementById('legendSearch');
  if (search && !search._wired) {
    search.addEventListener('input', e => {
      const term = e.target.value.toLowerCase();
      groupChips.forEach((chip, group) => {
        chip.style.display = group.toLowerCase().includes(term) ? 'inline-flex' : 'none';
      });
    });
    search._wired = true;
  }
}

// Search filter
document.getElementById('legendSearch').addEventListener('input', e => {
  const term = e.target.value.toLowerCase();
  groupChips.forEach((chip, group) => {
    chip.style.display = group.toLowerCase().includes(term) ? 'inline-flex' : 'none';
  });
});


// Search filter
document.getElementById('legendSearch').addEventListener('input', e => {
  const term = e.target.value.toLowerCase();
  groupChips.forEach((chip, group) => {
    chip.style.display = group.toLowerCase().includes(term) ? 'inline-flex' : 'none';
  });
});

// ===== Details =====
function escapeHtml(s) {
  return (s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function showDetails(ev) {
  const baseYear = parseInt(ev['Year'], 10);
  const displayDate = (ev['Display Date'] && ev['Display Date'].trim())
    || (Number.isFinite(baseYear) ? formatYearHuman(baseYear) : '');

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
    ${text ? `<p>${text}</p>` : ''}  <!-- allow your in-field <br> markup -->
    ${credit ? `<p class="meta">${escapeHtml(credit)}</p>` : ''}
  `;
  detailsPanel.classList.remove('hidden');
}

function showClusterDetails(cluster) {
  const itemsHtml = cluster.events.map((ev, idx) => {
    const Y = ev._labelDate || ev['Display Date'] || formatYearHuman(parseInt(ev['Year'], 10));
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
      const idx = parseInt(li.dataset.idx, 10);
      const ev = cluster.events[idx];
      showDetails(ev);
    });
  });
}
function hideDetails(){ detailsPanel.classList.add('hidden'); detailsContent.innerHTML = ''; }
detailsClose.addEventListener('click', hideDetails);

// ===== Month smart formatter =====
function formatMonthSmart(yearFloat, targetWidthPx) {
  // targetWidthPx is the available width for the pill text (in CSS pixels)
  // Use actual canvas font measurements to pick the longest readable form.
  const year = Math.floor(yearFloat);
  const frac = Math.abs(yearFloat - year);
  // When negative years (BCE) the fractional calculation still works since we floor.
  const mIndex = Math.floor(frac * 12);
  const safeMi = Math.max(0, Math.min(11, isNaN(mIndex) ? 0 : mIndex));
  const monthName = MONTHS[safeMi];   // Jan, Feb, Mar...
  const monthLetter = monthName[0];   // J, F, M
  const monthNumber = (safeMi + 1);   // 1..12

  const yFull = year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
  const yShort = String(year);

  // Candidate forms ordered from longest → shortest
  const options = [
    `${monthName}`,           
    `${monthName}`,          
    `${monthName.slice(0,3)}`, 
    `${monthLetter}`,        
    `${monthNumber}`,        
  ];

  ctx.font = "14px sans-serif"; // ensure consistent measurement
  // Try to pick the longest that fits
  for (const opt of options) {
    if (ctx.measureText(opt).width + 10 <= targetWidthPx) return opt;
  }

  // If nothing fits, return the tightest numeric form
  return `${monthNumber}`;
}

// ===== Adaptive plural-step + dynamic tick selection =====
function chooseTickScale(pxPerYear) {
  // pxPerYear: pixels per 1 year at current scale
  // Candidate units (fine → coarse)
  const baseUnits = [
    { majorStep: 1 / (AVG_YEAR_DAYS * 24), format: v => formatHour(v), type: 'hour' },
    { majorStep: 1 / AVG_YEAR_DAYS, format: v => formatDay(v), type: 'day' },
    { majorStep: 1 / 12, format: v => formatMonthYear(v), type: 'month' }, // month will get special handling
    { majorStep: 1, format: v => formatYearHuman(Math.round(v)), type: 'year' },
  ];

  // Generate nice year steps (plural steps): 1,2,3,5 × 10^k
  const niceBases = [1, 2, 3, 5];
  const niceSteps = [];
  for (let exp = 0; exp <= 5; exp++) {
    const pow = Math.pow(10, exp);
    for (const b of niceBases) niceSteps.push(b * pow);
  }
  const yearSteps = niceSteps.map(n => ({ majorStep: n, format: formatYearHuman, type: 'plural-year' }));

  const candidates = [...baseUnits, ...yearSteps];

  const MIN_GAP = 8; // minimal extra gap between pill centers
  ctx.font = '14px sans-serif';

  // sample positions across the canvas to estimate widths
  const sampleX = [
    canvas.clientWidth * 0.12,
    canvas.clientWidth * 0.32,
    canvas.clientWidth * 0.52,
    canvas.clientWidth * 0.72,
    canvas.clientWidth * 0.92,
  ];

  // Keep best month candidate for fallback
  let bestMonthCandidate = null;
  let bestMonthStepPx = 0;

  for (const c of candidates) {
    const stepPx = c.majorStep * pxPerYear;
    if (!(stepPx > 0)) continue;

    const widths = [];

    for (const sx of sampleX) {
      const yr = yearForX(sx);
      // snap to nearest tick for that unit
      const snapped = Math.round(yr / c.majorStep) * c.majorStep;

      // For month candidate, try to get a realistic text for the available width
      if (c.type === 'month') {
        // available width for a pill at this step
        const availW = Math.max(24, Math.floor(stepPx - MIN_GAP));
        const text = formatMonthSmart(snapped, availW);
        const w = ctx.measureText(text).width + 10;
        widths.push(w);
        continue;
      }

      // normal candidate
      const text = c.format(snapped);
      const w = ctx.measureText(text).width + 10; // pill padding
      widths.push(w);
    }

    // median width to avoid outlier rejection
    widths.sort((a, b) => a - b);
    const medianW = widths[Math.floor(widths.length / 2)];

    const fits = stepPx >= medianW + MIN_GAP;

    if (c.type === 'month') {
      if (stepPx > bestMonthStepPx) {
        bestMonthStepPx = stepPx;
        bestMonthCandidate = { ...c, medianW };
      }
      if (fits) {
        // return a format that will adapt per-tick using available width
        return {
          majorStep: c.majorStep,
          format: v => {
            const avail = Math.max(24, Math.floor((c.majorStep * pxPerYear) - MIN_GAP));
            return formatMonthSmart(v, avail);
          },
          minor: null
        };
      }
      continue;
    }

    if (fits) {
      return {
        majorStep: c.majorStep,
        format: c.format,
        minor: null
      };
    }
  }

  // Month soft fallback: if months almost fit (>=75% of median), use months with shortened forms
  if (bestMonthCandidate && bestMonthStepPx >= bestMonthCandidate.medianW * 0.75) {
    return {
      majorStep: 1 / 12,
      format: v => {
        const avail = Math.max(24, Math.floor(((1/12) * pxPerYear) - MIN_GAP));
        return formatMonthSmart(v, avail);
      },
      minor: null
    };
  }

  // fallback to coarsest plural step
  const lastStep = yearSteps[yearSteps.length - 1].majorStep;
  return {
    majorStep: lastStep,
    format: formatYearHuman,
    minor: null
  };
}

// ===== Label layout helpers =====
function rowsForScale() { if (scale >= 800) return 4; if (scale >= 200) return 3; return 2; }
function gapForScale() { if (scale >= 200) return 8; return 12; }
function maxLabelWidthForScale() { if (scale >= 800) return 320; if (scale >= 200) return 240; return 180; }

function shortenToFit(text, maxWidth) {
  let t = text; if (!t) return '';
  if (ctx.measureText(t).width <= maxWidth) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = ((lo + hi) >> 1);
    const cand = t.slice(0, mid) + '…';
    if (ctx.measureText(cand).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  return t.slice(0, Math.max(1, lo - 1)) + '…';
}

function layoutSingleLabels(singleClusters, options = {}) {
  const gap = options.gap ?? gapForScale();
  const rowsN = options.rows ?? rowsForScale();
  const yBase = options.y ?? 118;
  const dy = options.dy ?? 18;
  const maxW = options.maxW ?? maxLabelWidthForScale();
  const showLeader = options.leader ?? true;

  const rows = Array.from({ length: rowsN }, () => ({ right: -Infinity, items: [] }));
  singleClusters.forEach(c => {
    const ev = c.events[0];
    const title = ev['Headline'] || ev['Text'] || '';
    if (!title) return;
    const text = shortenToFit(title, maxW);
    const labelW = Math.min(maxW, ctx.measureText(text).width + 6);
    for (let r = 0; r < rowsN; r++) {
      const row = rows[r];
      if (c.centerX - labelW / 2 > row.right + gap) {
        row.items.push({ x: c.centerX, w: labelW, text, dotY: c.y });
        row.right = c.centerX + labelW / 2;
        return;
      }
    }
    const last = rows[rowsN - 1];
    last.items.push({ x: c.centerX, w: labelW, text, dotY: c.y });
    last.right = Math.max(last.right, c.centerX + labelW / 2);
  });

  ctx.fillStyle = '#111';
  ctx.textBaseline = 'top';
  ctx.font = '14px sans-serif';
  rows.forEach((row, ri) => {
    const y = yBase + ri * dy;
    row.items.forEach(it => {
      ctx.fillText(it.text, it.x + 8, y);
      if (showLeader) {
        ctx.strokeStyle = '#00000022';
        ctx.beginPath();
        ctx.moveTo(it.x, it.dotY + 5);
        ctx.lineTo(it.x + 6, y);
        ctx.stroke();
      }
    });
  });
}

// ===== Main draw =====
function draw() {
  sizeCanvasToCss();
  // console.log('[timeline] draw()', { W, H, scale, panX });
  ctx.clearRect(0, 0, W, H);
  drawHitRects = [];

  // background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // scale / ticks
  ctx.save();
  ctx.font = '14px sans-serif';
  const { majorStep, format, minor } = chooseTickScale(scale);

  if (minor && minor.step) {
    const startMinor = Math.ceil(MIN_YEAR / minor.step) * minor.step;
    for (let m = startMinor; m < MAX_YEAR; m += minor.step) {
      const mx = xForYear(m);
      if (mx > -80 && mx < W + 80) {
        ctx.strokeStyle = minor.faint ? '#00000010' : '#00000015';
        ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, minor.len); ctx.stroke();
        if (minor.faint) {
          ctx.strokeStyle = '#00000008';
          ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H / dpr); ctx.stroke();
        }
      }
    }
  }

  let t = Math.ceil((MIN_YEAR - LABEL_ANCHOR_YEAR) / majorStep) * majorStep + LABEL_ANCHOR_YEAR;
  let lastRight = -Infinity;
  const gap = 10, pillY = 16;
  while (t < MAX_YEAR) {
    const x = xForYear(t);
    if (x > -120 && x < W + 120) {
      ctx.strokeStyle = '#00000033';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 40); ctx.stroke();

      // use the chosen format; for month format it's already adaptive
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

  // center line + center-year label + slider sync
  ctx.strokeStyle = '#00000033';
  ctx.beginPath();
  ctx.moveTo(W / dpr / 2, 0);
  ctx.lineTo(W / dpr / 2, H / dpr);
  ctx.stroke();

  const centerYear = yearForX(canvas.clientWidth / 2);
  panSlider.value = Math.round(centerYear);
  setPanValueLabel(centerYear);

  ctx.fillStyle = '#00000066'; ctx.font = '12px sans-serif'; ctx.textBaseline = 'bottom';
  ctx.fillText(formatYearHuman(Math.round(centerYear)), (W / dpr / 2) + 6, H / dpr - 6);

  // rows Y
  const rowYPoint = 110;
  const rowYBar = 180;

  // visible points/bars
  const visiblePoints = [];
  events.forEach(ev => {
    const group = ev['Group'] || '';
    if (!isGroupVisible(group)) return;

    const baseYear = parseInt(ev['Year'], 10);
    let startYearFloat = NaN;
    if (Number.isFinite(baseYear)) {
      const mVal = parseInt(ev['Month'], 10);
      const dVal = parseInt(ev['Day'], 10);
      const tVal = ev['Time'] || '';
      startYearFloat = dateToYearFloat(baseYear, mVal, dVal, tVal);
    }

    const endYear = parseInt(ev['End Year'], 10);
    let endYearFloat = NaN;
    if (Number.isFinite(endYear)) {
      const endM = parseInt(ev['End Month'], 10);
      const endD = parseInt(ev['End Day'], 10);
      const endT = ev['End Time'] || '';
      endYearFloat = dateToYearFloat(endYear, endM, endD, endT);
    }

    const title = ev['Headline'] || ev['Text'] || '';

    // ranges -> bar
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

    // single points
    if (Number.isFinite(startYearFloat)) {
      const x = xForYear(startYearFloat);
      if (x > -50 && x < W / dpr + 50) {
        const color = getGroupColor(group);
        ev._labelDate = ev['Display Date'] || formatYearHuman(Math.round(parseInt(ev['Year'], 10)));
        visiblePoints.push({
          ev, x, yLabel: rowYPoint, title, group, color,
          yearFloat: startYearFloat,
          yearKey: Math.round(startYearFloat)
        });
      }
    }
  });

  // clustering
  visiblePoints.sort((a, b) => a.x - b.x);
  const clusters = [];
  let current = null;
  function pushCurrent() { if (current) { clusters.push(current); current = null; } }

  for (const p of visiblePoints) {
    if (!current) {
      current = { events: [p.ev], xs: [p.x], y: p.yLabel, groups: new Set([p.group]), colors: [p.color], centerX: p.x, centerYear: p.yearFloat };
      continue;
    }
    const effPx = (scale >= 400 ? 0 : clusterPxThreshold());
    const sameBucket =
      (CLUSTER_BY === 'pixel') ? (Math.abs(p.x - current.centerX) <= effPx)
                               : (p.yearKey === Math.round(current.centerYear));
    if (sameBucket) {
      current.events.push(p.ev);
      current.xs.push(p.x);
      current.groups.add(p.group);
      current.colors.push(p.color);
      const sumX = current.xs.reduce((s, v) => s + v, 0);
      current.centerX = sumX / current.xs.length;
      const sumYears = current.events.reduce((s, ev) => {
        const Y = parseInt(ev['Year'], 10), M = parseInt(ev['Month'], 10), D = parseInt(ev['Day'], 10);
        const T = ev['Time'] || '';
        const yf = dateToYearFloat(Y, M, D, T);
        return s + (Number.isFinite(yf) ? yf : current.centerYear);
      }, 0);
      current.centerYear = sumYears / current.events.length;
    } else {
      pushCurrent();
      current = { events: [p.ev], xs: [p.x], y: p.yLabel, groups: new Set([p.group]), colors: [p.color], centerX: p.x, centerYear: p.yearFloat };
    }
  }
  pushCurrent();

  // draw clusters
  ctx.textBaseline = 'top';
  ctx.font = '14px sans-serif';
  clusters.forEach(cluster => {
    const n = cluster.events.length;
    const x = cluster.centerX;
    const y = cluster.y;
    if (n === 1) {
      const ev = cluster.events[0];
      const group = ev['Group'] || '';
      const col = getGroupColor(group);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      drawHitRects.push({ kind: 'point', ev, x: x - 6, y: y - 6, w: 12, h: 12 });
    } else {
      const r = Math.min(14, 7 + Math.log2(n + 1));
      ctx.fillStyle = '#0077ff';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(String(n), x, y);
      drawHitRects.push({ kind: 'cluster', cluster, x: x - (r + 2), y: y - (r + 2), w: (r + 2) * 2, h: (r + 2) * 2 });
    }
  });

  // multi-row labels for single points
  const singles = clusters.filter(c => c.events.length === 1);
  layoutSingleLabels(singles, { gap: gapForScale(), rows: rowsForScale(), y: 118, dy: 18, maxW: maxLabelWidthForScale(), leader: true });
}

// ===== Init =====
function initScaleAndPan() {
  sizeCanvasToCss();
  scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvas.clientWidth / (MAX_YEAR - MIN_YEAR)));
  panX = (canvas.clientWidth / 2) - ((INITIAL_CENTER_YEAR - MIN_YEAR) * scale);
  panSlider.min = String(MIN_YEAR);
  panSlider.max = String(MAX_YEAR);
  panSlider.step = "1";
  panSlider.value = String(INITIAL_CENTER_YEAR);
  setPanValueLabel(INITIAL_CENTER_YEAR);
}


// ===== Zoom / Pan =====
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

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const anchor = (e.offsetX ?? (e.clientX - canvas.getBoundingClientRect().left));
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  zoomTo(scale * zoomFactor, anchor);
}, { passive: false });

canvas.addEventListener('mousedown', (e) => { isDragging = true; dragStartX = e.clientX; });
window.addEventListener('mousemove', (e) => { if (isDragging) { panX += (e.clientX - dragStartX); dragStartX = e.clientX; draw(); } });
window.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { isDragging = true; dragStartX = e.touches[0].clientX; } }, { passive: true });
canvas.addEventListener('touchmove', (e) => { if (isDragging && e.touches.length === 1) { panX += (e.touches[0].clientX - dragStartX); dragStartX = e.touches[0].clientX; draw(); } }, { passive: true });
canvas.addEventListener('touchend', () => { isDragging = false; });

// Slider → center
panSlider.addEventListener('input', () => {
  const targetYear = parseFloat(panSlider.value);
  setPanValueLabel(targetYear);
  centerOnYear(targetYear);
});

// ===== Hit test =====
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

// ===== Responsive =====
window.addEventListener('resize', () => { draw(); });
