// timeline.js — clean build

// ====== JW.org Bible link (jwlshare → opens JW Library or falls back to JW.org) ======
const JW_LOCALE = 'E'; // change to 'H' for Hungarian, etc.
// ====== Labeling configuration ======
const LABEL_ANCHOR_YEAR   = -5000; // start millennia from 5000 BCE: -5000, -4000, -3000, ...
const INITIAL_CENTER_YEAR = -4000; // optional: initial camera center near 4000 BCE
// Tick scale chooser (based on px/year):
// As you zoom in: day → month → year(1) → decade(10) → century(100) → millennium(1000)
function chooseTickScale(pxPerYear) {
  const pxPerMonth = pxPerYear / 12;
  const pxPerDay   = pxPerYear / 365.2425;

  if (pxPerDay   >= 60) return { unit: 'day',   step: 1 };
  if (pxPerDay   >= 30) return { unit: 'day',   step: 7 };

  if (pxPerMonth >= 24) return { unit: 'month', step: 1 };
  if (pxPerMonth >= 12) return { unit: 'month', step: 3 };
  if (pxPerMonth >=  6) return { unit: 'month', step: 6 };

  if (pxPerYear  >= 120) return { unit: 'year',  step: 1 };
  if (pxPerYear  >=  40) return { unit: 'year',  step: 10 };
  if (pxPerYear  >=  12) return { unit: 'year',  step: 100 };

  return { unit: 'year', step: 1000 };
}
// Align first tick using a fixed anchor (e.g., -5000 → -4000 → -3000 ...), avoiding year 0
function alignTickFromAnchor(minTs, anchorYear, unit, step) {
  const dMin  = new Date(minTs);
  const minY  = dMin.getUTCFullYear();

  if (unit === 'year') {
    // Find k so that anchorYear + k*step >= minY
    let k   = Math.ceil((minY - anchorYear) / step);
    let y0  = anchorYear + k * step;
    if (y0 === 0) y0 += step; // skip year 0
    return startOfYear(y0);
  }

  if (unit === 'month') {
    // Use January of the anchor year as the anchor month
    const anchor = Date.UTC(anchorYear, 0, 1);
    const d      = new Date(anchor);
    let y        = d.getUTCFullYear(), m = 1; // 1..12
    // absolute month index from anchor
    const absMin = dMin.getUTCFullYear() * 12 + dMin.getUTCMonth();
    const absAnc = y * 12 + (m - 1);
    const k      = Math.ceil((absMin - absAnc) / step);
    const absOut = absAnc + k * step;
    let yOut     = Math.trunc(absOut / 12), mOut = (absOut % 12) + 1;
    if (yOut === 0) yOut = -1; // simple shift across 0
    return startOfMonth(yOut, mOut);
  }

  // day: fall back to existing alignment to midnight boundary
  return alignTick(minTs, unit, step);
}
function jwFinderUrl(code8) {
  return (
    'https://www.jw.org/finder?srcid=jwlshare&wtlocale=' +
    encodeURIComponent(JW_LOCALE) +
    '&prefer=lang&bible=' +
    encodeURIComponent(code8) +
    '&pub=nwtsty'
  );
}

// ====== Canvas / state ======
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
let zoom = 1;
const minZoom = 0.2;
const maxZoom = 500;
let allEvents = [];
let visibleEvents = [];
let rows = [];
let panX = 0;
let isPanning = false;
let panStartClientX = 0;
let panStartPanX = 0;
let firstDraw = true;
let hitRegions = [];
let suppressNextClick = false;
// Reset zoom & center
const rz = document.getElementById('resetZoom');
if (rz) {
  rz.onclick = () => {
    // Reset zoom to base
    zoom = 1;

    // Compute span across visible events (fallback if none)
    let minTs = visibleEvents.length ? Math.min(...visibleEvents.map(e => e.start)) : 0;
    let maxTs = visibleEvents.length ? Math.max(...visibleEvents.map(e => e.end)) : 1;
    if (minTs === maxTs) { minTs -= 86400000; maxTs += 86400000; }

    // Center the midpoint of the span in the canvas
    const W = canvas.width || canvas.clientWidth;
    const span = (maxTs - minTs) || 1;
    const scale = (W * zoom) / span; // zoom = 1
    const midTs = (minTs + maxTs) / 2;

    // We want xOfTs(midTs) = W/2
    // xOfTs(ts) = (ts - minTs) * scale + panX
    panX = (W / 2) - ((midTs - minTs) * scale);

    clampPan();
    draw();
  };
}
  // Compute min/max across visible events (fallback if empty)
  let minTs = visibleEvents.length ? Math.min(...visibleEvents.map((e) => e.start)) : 0;
  let maxTs = visibleEvents.length ? Math.max(...visibleEvents.map((e) => e.end)) : 1;
  if (minTs === maxTs) { minTs -= 86400000; maxTs += 86400000; }

  // Center content horizontally at zoom=1
  const W = canvas.width || canvas.clientWidth;
  const span = (maxTs - minTs) || 1;
  const contentWidth = (W * zoom) * 1;   // zoom is now 1, so contentWidth = W
  panX = contentWidth <= W ? (W - contentWidth) / 2 : 0;

  // Clamp and redraw
  clampPan();
  draw();
rz && (rz.onclick = () => {
  zoom = 1;

  let minTs = visibleEvents.length ? Math.min(...visibleEvents.map((e) => e.start)) : 0;
  let maxTs = visibleEvents.length ? Math.max(...visibleEvents.map((e) => e.end)) : 1;
  if (minTs === maxTs) { minTs -= 86400000; maxTs += 86400000; }

  const W = canvas.width || canvas.clientWidth;
  const span = (maxTs - minTs) || 1;
  const scale = (W * zoom) / span; // zoom=1
  const midTs = (minTs + maxTs) / 2;

  // We want xOfTs(midTs) = W/2  →  (midTs - minTs)*scale + panX = W/2
  panX = (W / 2) - ((midTs - minTs) * scale);

  clampPan();
  draw();
});

// ====== Load CSV ======
fetch('timeline-data.csv')
  .then((r) => {
    if (!r.ok) throw new Error('CSV HTTP ' + r.status);
    return r.text();
  })
  .then((t) => parseCSV(t))
  .then((data) => {
    allEvents = data;
    initFiltersFromData();
    applyFiltersAndPack();
    buildLegend();
    draw();
    console.log('Loaded events:', visibleEvents.length);
  })
  .catch((err) => {
    console.error('CSV load failed:', err);
    message('Failed to load timeline data.');
  });

function message(msg) {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = '14px Arial';
  ctx.fillText(msg, 10, 30);
}

// ====== CSV parser (tracks date precision) ======
function csvSplit(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
function parseTimeString(s) {
  if (!s) return [0, 0, 0];
  const p = s.split(':').map((x) => parseInt(x, 10));
  return [isNaN(p[0]) ? 0 : p[0], isNaN(p[1]) ? 0 : p[1], isNaN(p[2]) ? 0 : p[2]];
}
function toTs(year, month, day, timeStr) {
  if (isNaN(year) || year === null) return NaN;
  const y = parseInt(year, 10);
  const mo = isNaN(parseInt(month, 10)) ? 1 : parseInt(month, 10);
  const d = isNaN(parseInt(day, 10)) ? 1 : parseInt(day, 10);
  const [h, m, s] = parseTimeString(timeStr);
  return Date.UTC(y, Math.max(0, mo - 1), Math.max(1, d), h, m, s);
}
function parseCSV(text) {
  if (!text) return [];
  const raw = text.split(/\r?\n/);
  const lines = raw.filter((l) => String(l).trim().length > 0);
  if (lines.length === 0) return [];
  const head = csvSplit(lines[0]).map((h) => h.trim());
  const map = {};
  head.forEach((h, i) => {
    map[h.toLowerCase()] = i;
  });
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = csvSplit(lines[i]);
    if (!parts || parts.length === 0) continue;
    const norm = {};
    Object.keys(map).forEach((k) => {
      const idx = map[k];
      const rawVal = parts[idx] !== undefined ? parts[idx] : '';
      const v = ('' + rawVal).trim().replace(/^\"(.*)\"$/, '$1');
      norm[k] = v;
    });
    const title = norm.headline || norm.title || norm.name || '';
    const type = norm.type || '';
    const group = norm.group || '';
    const media = norm.media || '';
    const textField = norm.text || norm['display date'] || '';
    const y = parseInt(norm.year, 10);
    const mo = norm.month;
    const d = norm.day;
    const timeStr = norm.time || norm['time'] || '';
    const hasMonth = !isNaN(parseInt(mo, 10));
    const hasDay = !isNaN(parseInt(d, 10));
    let start = toTs(y, mo, d, timeStr);
    let startPrec = hasDay ? 'day' : hasMonth ? 'month' : 'year';
    const endYear = parseInt(norm['end year'], 10);
    let end = NaN;
    let endPrec = startPrec;
    if (!isNaN(endYear)) {
      const emo = norm['end month'];
      const ed = norm['end day'];
      const et = norm['end time'] || '';
      const eHasMonth = !isNaN(parseInt(emo, 10));
      const eHasDay = !isNaN(parseInt(ed, 10));
      end = toTs(endYear, emo, ed, et);
      endPrec = eHasDay ? 'day' : eHasMonth ? 'month' : 'year';
    }
    // Fallbacks if "year/month/day" absent but "start" or "start date" present
    if (isNaN(start)) {
      const single = norm.start || norm['start date'] || norm['display date'];
      if (single) {
        const d2 = new Date(single);
        if (!isNaN(d2)) {
          start = d2.getTime();
          startPrec = 'day';
        }
      }
    }
    if (isNaN(start)) continue;
    if (isNaN(end)) {
      end = start;
      endPrec = startPrec;
    }
    if (end < start) {
      const tmp = start;
      start = end;
      end = tmp;
      const tp = startPrec;
      startPrec = endPrec;
      endPrec = tp;
    }
    out.push({
      title,
      start,
      end,
      type,
      group,
      media,
      text: textField,
      raw: norm,
      startPrec,
      endPrec,
    });
  }
  return out;
}

// ====== Filters & legend ======
const activeGroups = new Set();
let availableGroups = []; // [{label, keyLower}]
const chipIndex = new Map(); // keyLower -> chip element
function groupKeyFor(ev) {
  return (ev.group || ev.type || '(Other)').trim();
}
function initFiltersFromData() {
  const seen = new Map();
  allEvents.forEach((ev) => {
    const label = groupKeyFor(ev);
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, label);
  });
  availableGroups = [...seen.entries()].map(([k, l]) => ({ label: l, keyLower: k }));
  activeGroups.clear();
  availableGroups.forEach((g) => activeGroups.add(g.keyLower));
}
function applyFiltersAndPack() {
  visibleEvents = allEvents.filter((ev) => activeGroups.has(groupKeyFor(ev).toLowerCase()));
  packRows();
}
function buildLegend() {
  const host = document.getElementById('legend');
  if (!host) return;
  host.innerHTML = '';
  chipIndex.clear();

  // Control chips: "All" and "None"
  const mkControlChip = (label, action) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.setAttribute('data-role', 'control');
    chip.innerHTML = `<span class="swatch" style="background:#0000"></span><span>${label}</span>`;
    chip.addEventListener('click', () => {
      if (action === 'all') {
        activeGroups.clear();
        availableGroups.forEach((g) => activeGroups.add(g.keyLower));
      } else if (action === 'none') {
        activeGroups.clear();
      }
      // update all category chips' visual state
      chipIndex.forEach((el, key) => {
        if (el.getAttribute('data-role') === 'control') return;
        el.classList.toggle('inactive', !activeGroups.has(key));
      });
      applyFiltersAndPack();
      draw();
    });
    return chip;
  };
  host.appendChild(mkControlChip('All', 'all'));
  host.appendChild(mkControlChip('None', 'none'));

  // Category chips
  availableGroups.forEach(({ label, keyLower }) => {
    const color = COLOR_MAP[keyLower] ?? COLOR_MAP[''];
    const chip = document.createElement('div');
    chip.className = 'chip' + (activeGroups.has(keyLower) ? '' : ' inactive');
    chip.setAttribute('data-key', keyLower);
    chip.innerHTML = `<span class="swatch" style="background:${color}"></span><span>${label}</span>`;
    chip.addEventListener('click', () => {
      if (activeGroups.has(keyLower)) activeGroups.delete(keyLower);
      else activeGroups.add(keyLower);
      chip.classList.toggle('inactive');
      applyFiltersAndPack();
      draw();
    });
    host.appendChild(chip);
    chipIndex.set(keyLower, chip);
  });
  console.log('Legend built with All/None +', availableGroups.length, 'groups');
}

// ====== Colors ======
const COLOR_MAP = {
  events: '#1f77b4',
  persons: '#2ca02c',
  covenants: '#8c564b',
  'time periods': '#9467bd',
  'bible writing': '#d62728',
  'world powers': '#ff7f0e',
  prophets: '#17becf',
  judges: '#bcbd22',
  'kings of israel': '#e377c2',
  'kings of judah': '#7f7f7f',
  jesus: '#9c27b0',
  'king of the north': '#795548',
  'king of the south': '#607d8b',
  "paul's journeys": '#00acc1',
  'bible copy/translation': '#009688',
  'modern day history of jw': '#ff6f00',
  '(other)': '#007BFF',
  person: '#2ca02c',
  era: '#dc3545',
  '': '#007BFF',
};
function colorFor(ev) {
  const g = groupKeyFor(ev).toLowerCase();
  const t = (ev.type || '').toLowerCase().trim();
  return COLOR_MAP[g] || COLOR_MAP[t] || COLOR_MAP[''];
}

// ====== Scripture linking → jwlshare ======
const BOOK_TOKEN_RE =
  /^(Gen|Ex|Lev|Num|Deut|Josh|Jg|Judg|Ruth|1\s?Sam|2\s?Sam|1\s?Ki|2\s?Ki|1\s?Ch|2\s?Ch|Chron|Ezra|Neh|Esth?|Job|Ps|Prov|Eccl|Song|Isa|Jer|Lam|Ezek|Dan|Hos|Joel|Amos|Obad|Jonah?|Mic|Nah|Zeph|Hag|Zech|Mal|Matt|Mt|Mark|Mrk|Luke|Lu|John|Jn|Acts|Rom|Ro|1\s?Cor|2\s?Cor|Gal|Eph|Phil|Col|1\s?Thess|2\s?Thess|1\s?Tim|2\s?Tim|Titus|Philem|Heb|Jas|James|1\s?Pet|2\s?Pet|1\s?John|2\s?John|3\s?John|Jude|Rev)\.?$/i;
// e.g., "Matt 24:3" or "24:3"
const REF_RE = /^(\d+):(\d+)(?:[\-–](\d+))?$/;
const BOOK_CODE = {
  genesis: '01', gen: '01', ge: '01', gn: '01',
  exodus: '02', ex: '02',
  leviticus: '03', lev: '03', le: '03',
  numbers: '04', num: '04', nu: '04', nm: '04', nb: '04',
  deuteronomy: '05', deut: '05', de: '05', dt: '05',
  joshua: '06', josh: '06', jos: '06', jo: '06',
  judges: '07', judg: '07', jg: '07',
  ruth: '08', ru: '08',
  '1 samuel': '09', '1sam': '09', '1 sam': '09', '1sa': '09', 'i sam': '09', '1sm': '09',
  '2 samuel': '10', '2sam': '10', '2 sam': '10', '2sa': '10', 'ii sam': '10', '2sm': '10',
  '1 kings': '11', '1ki': '11', '1 kgs': '11', 'i ki': '11',
  '2 kings': '12', '2ki': '12', '2 kgs': '12', 'ii ki': '12',
  '1 chronicles': '13', '1ch': '13', 'i ch': '13', '1 chron': '13',
  '2 chronicles': '14', '2ch': '14', 'ii ch': '14', '2 chron': '14',
  ezra: '15', ezr: '15',
  nehemiah: '16', neh: '16',
  esther: '17', esth: '17', es: '17',
  job: '18', jb: '18',
  psalms: '19', ps: '19', psalm: '19',
  proverbs: '20', prov: '20', pr: '20',
  ecclesiastes: '21', eccl: '21', ec: '21',
  'song of solomon': '22', song: '22', so: '22', canticles: '22', 'song of songs': '22',
  isaiah: '23', isa: '23', is: '23',
  jeremiah: '24', jer: '24', je: '24',
  lamentations: '25', lam: '25', la: '25',
  ezekiel: '26', eze: '26', ezek: '26', ek: '26',
  daniel: '27', dan: '27', da: '27',
  hosea: '28', hos: '28', ho: '28',
  joel: '29', joe: '29', jl: '29',
  amos: '30', am: '30',
  obadiah: '31', obad: '31', ob: '31',
  jonah: '32', jon: '32', jh: '32',
  micah: '33', mic: '33', mi: '33',
  nahum: '34', nah: '34', na: '34',
  habakkuk: '35', hab: '35', hb: '35',
  zephaniah: '36', zeph: '36', zp: '36',
  haggai: '37', hag: '37', hg: '37',
  zechariah: '38', zech: '38', zc: '38',
  malachi: '39', mal: '39', ml: '39',
  matthew: '40', matt: '40', mt: '40',
  mark: '41', mrk: '41', mk: '41', mr: '41',
  luke: '42', lu: '42', lk: '42',
  john: '43', jn: '43', joh: '43',
  acts: '44', ac: '44',
  romans: '45', rom: '45', ro: '45',
  '1 corinthians': '46', '1 cor': '46', 'i cor': '46', '1co': '46',
  '2 corinthians': '47', '2 cor': '47', 'ii cor': '47', '2co': '47',
  galatians: '48', gal: '48', ga: '48',
  ephesians: '49', eph: '49', ep: '49',
  philippians: '50', phil: '50', php: '50',
  colossians: '51', col: '51', co: '51',
  '1 thessalonians': '52', '1 thess': '52', '1 th': '52', '1ts': '52',
  '2 thessalonians': '53', '2 thess': '53', '2 th': '53', '2ts': '53',
  '1 timothy': '54', '1 tim': '54', '1ti': '54',
  '2 timothy': '55', '2 tim': '55', '2ti': '55',
  titus: '56', tit: '56', ti: '56',
  philemon: '57', philem: '57', phm: '57',
  hebrews: '58', heb: '58', he: '58',
  james: '59', jas: '59', jm: '59',
  '1 peter': '60', '1 pet': '60', '1pe': '60',
  '2 peter': '61', '2 pet': '61', '2pe': '61',
  '1 john': '62', '1jn': '62',
  '2 john': '63', '2jn': '63',
  '3 john': '64', '3jn': '64',
  jude: '65', jud: '65', jd: '65',
  revelation: '66', rev: '66', re: '66',
};
function normBookKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^i\s/, '1 ')
    .replace(/^ii\s/, '2 ')
    .replace(/^iii\s/, '3 ');
}
function jwCodeFor(book, ch, vs) {
  const code = BOOK_CODE[normBookKey(book)];
  if (!code) return null;
  const cc = String(parseInt(ch, 10)).padStart(3, '0');
  const vv = String(parseInt(vs || 0, 10)).padStart(3, '0');
  return code + cc + vv;
}
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function linkifyScripture(text) {
  const tokens = String(text || '').split(/(\s+)/);
  let out = '';
  let lastBook = null;
  for (let i = 0; i < tokens.length; ) {
    const tk = tokens[i];
    if (/\s+/.test(tk)) {
      out += tk; i++; continue;
    }
    const next = tokens[i + 1] || '';
    const next2 = tokens[i + 2] || '';
    if (BOOK_TOKEN_RE.test(tk) && /\s+/.test(next) && REF_RE.test(next2)) {
      lastBook = tk;
      const m = REF_RE.exec(next2);
      const code8 = jwCodeFor(tk, m[1], m[2]);
      const label = tk + next + next2;
      out += code8
        ? '<a target="_blank" rel="noopener" href="' + jwFinderUrl(code8) + '">' + escapeHtml(label) + '</a>'
        : escapeHtml(label);
      i += 3; continue;
    }
    if (REF_RE.test(tk) && lastBook) {
      const m = REF_RE.exec(tk);
      const code8 = jwCodeFor(lastBook, m[1], m[2]);
      out += code8
        ? '<a target="_blank" rel="noopener" href="' + jwFinderUrl(code8) + '">' + escapeHtml(tk) + '</a>'
        : escapeHtml(tk);
      i++; continue;
    }
    if (BOOK_TOKEN_RE.test(tk)) lastBook = tk;
    out += escapeHtml(tk);
    i++;
  }
  return out.replace(/<br\s*\/?>/gi, '<br>');
}

// ====== Draw empty timeline ======
function drawEmptyTimeline() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  hitRegions = [];
  const W = canvas.width;
  const H = canvas.clientHeight;
  const topPadding = 6;
  const labelH = 26;
  const timelineY = topPadding + labelH;
  ctx.clearRect(0, 0, W, H);
  // Axis
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, timelineY);
  ctx.lineTo(W, timelineY);
  ctx.stroke();
  // Message
  ctx.font = '14px Arial';
  ctx.fillStyle = '#000';
  ctx.fillText('No events selected', 10, timelineY + 20);
}

// ====== Draw ======
function draw() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  hitRegions = [];
  const W = canvas.width;
  const H = canvas.clientHeight;
  const topPadding = 6;
  const labelH = 26;
  const timelineY = topPadding + labelH;
  const rowH = 40;

  // If no events visible → still draw axis, but show message
  if (!visibleEvents || visibleEvents.length === 0) {
    drawEmptyTimeline();
    return;
  }

  ctx.clearRect(0, 0, W, H);
  let minTs = Math.min(...visibleEvents.map((e) => e.start));
  let maxTs = Math.max(...visibleEvents.map((e) => e.end));
  if (!isFinite(minTs) || !isFinite(maxTs)) {
    message('Invalid event dates');
    return;
  }
  if (minTs === maxTs) {
    minTs -= 86400000;
    maxTs += 86400000;
  }
  const span = (maxTs - minTs) || 1;
  const scale = (W * zoom) / span;

 
if (firstDraw) {
  // Center the initial view around a chosen year (e.g., -4000)
  const initTs = startOfYear(INITIAL_CENTER_YEAR);
  panX = (W / 2) - ((initTs - minTs) * scale);
  firstDraw = false;
}

  panX = clampPanForSize(W);

  const xOfTs = (ts) => (ts - minTs) * scale + panX;

  // main axis
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, timelineY);
  ctx.lineTo(W, timelineY);
  ctx.stroke();

  // ====== Adaptive timeline labels (centuries → decades → years → months → days) ======
  const msPerYear = 365.2425 * 24 * 3600 * 1000;
  const pxPerYear = scale * msPerYear;
  const tickScale = chooseTickScale(pxPerYear); // {unit, step}
  const unit = tickScale.unit;
  const step = tickScale.step;

  ctx.font = '12px Arial';
  ctx.textBaseline = 'middle';
  const gap = 12;
  let lastRight = -Infinity;
let t = alignTickFromAnchor(minTs, LABEL_ANCHOR_YEAR, unit, step);

  while (t <= maxTs) {
    // Skip label exactly at year 0
    if (unit === 'year') {
      const y0 = new Date(t).getUTCFullYear();
      if (y0 === 0) {
        t = addYears(t, step);
        continue;
      }
    }
    const x = xOfTs(t);
    if (x > W + 200) break;
    if (x >= -200) {
      const text = formatTickLabel(t, unit);
      if (text) {
        const textW = ctx.measureText(text).width;
        const pillW = textW + 10;
        const pillH = 18;
        const pillX = x - pillW / 2;
        const pillY = topPadding;
        const left = Math.max(4, pillX);
        const right = left + pillW;
        // Prevent overlap
        if (left > lastRight + gap) {
          // draw label pill
          ctx.fillStyle = '#ffffffee';
          ctx.strokeStyle = '#00000022';
          roundRect(ctx, left, pillY, pillW, pillH, 6, true, false);
          ctx.fillStyle = '#000';
          ctx.fillText(text, left + 5, pillY + pillH / 2);
          // guide to axis
          ctx.strokeStyle = '#00000033';
          ctx.beginPath();
          ctx.moveTo(x, pillY + pillH);
          ctx.lineTo(x, timelineY - 4);
          ctx.stroke();
          lastRight = right;
        }
      }
    }
    // Advance tick
    if (unit === 'year') t = addYears(t, step);
    else if (unit === 'month') t = addMonths(t, step);
    else t = addDays(t, step);
  }

  // rows and events
  rows.forEach((row, i) => {
    const yTop = timelineY + 18 + i * rowH;
    row.forEach((ev) => {
      const x1 = xOfTs(ev.start);
      const x2 = xOfTs(ev.end);
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const w = right - left;
      const color = colorFor(ev);
      const stickX = w < 10 ? x1 : left;

      // guide from axis
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = color + 'AA';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(stickX, timelineY);
      ctx.lineTo(stickX, yTop + 10);
      ctx.stroke();
      ctx.restore();

      if (w >= 10) {
        ctx.fillStyle = color;
        const barX = left;
        const barY = yTop + 18;
        const barW = Math.max(6, w);
        const barH = 6;
        ctx.fillRect(barX, barY, barW, barH);
        hitRegions.push({ x: barX, y: barY - 4, w: barW, h: barH + 8, ev, kind: 'bar' });
      } else {
        const r = 4;
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(stickX, yTop + 21, r, 0, Math.PI * 2);
        ctx.fill();
        hitRegions.push({ x: stickX - 6, y: yTop + 15, w: 12, h: 12, ev, kind: 'dot' });
      }

      // label flag
      const title = ev.title || '';
      const dateTxt = displayWhen(ev);
      const lines = wrapText(ctx, title, 320, 'bold 12px Arial').concat(
        wrapText(ctx, dateTxt, 320, '11px Arial')
      );
      const padX = 8;
      const padY = 6;
      const lineGap = 2;
      const heights = lines.map((l) => (l.font.startsWith('bold') ? 13 : 12));
      const textW = Math.min(
        360,
        Math.max(...lines.map((l) => ctx.measureText(l.text).width))
      );
      const pillW = Math.max(120, textW + padX * 2);
      const pillH = padY * 2 + heights.reduce((a, b) => a + b, 0) + (lines.length - 1) * lineGap;
      let pillX = stickX + 10;
      if (pillX + pillW > W - 8) pillX = stickX - 10 - pillW;
      if (pillX < 4) pillX = 4;
      const pillY = yTop;
      ctx.fillStyle = '#ffffffdd';
      ctx.strokeStyle = '#00000022';
      ctx.lineWidth = 1;
      roundRect(ctx, pillX, pillY, pillW, pillH, 8, true, false);

      let ty = pillY + padY + (heights[0] - 2);
      lines.forEach((ln, idx) => {
        ctx.font = ln.font;
        ctx.fillStyle = idx === 0 ? '#000' : '#333';
        ctx.fillText(ln.text, pillX + padX, ty);
        ty += heights[idx] + lineGap;
      });

      hitRegions.push({ x: pillX, y: pillY, w: pillW, h: pillH, ev, kind: 'flag' });
    });
  });
}

// ====== Row packing (non-overlapping lanes) ======
function packRows() {
  rows = [];
  if (!visibleEvents || visibleEvents.length === 0) return;
  // Sort by (start, then end) asc for stable packing
  const sorted = [...visibleEvents].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });
  const R = [];
  sorted.forEach((ev) => {
    const start = ev.start;
    const end = Math.max(ev.end, ev.start);
    let placed = false;
    for (let r = 0; r < R.length; r++) {
      const lane = R[r];
      const last = lane._lastEnd ?? -Infinity;
      if (start >= last) {
        lane.push(ev);
        lane._lastEnd = end + 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const lane = [ev];
      lane._lastEnd = end + 1;
      R.push(lane);
    }
  });
  rows = R.map((lane) => lane.map((x) => x));
}

// ====== Helpers ======
// UTC date math + alignment (avoid year 0 labels)
function startOfYear(year) { return Date.UTC(year, 0, 1); }
function startOfMonth(year, month1) { return Date.UTC(year, month1 - 1, 1); }
function startOfDay(year, month1, day) { return Date.UTC(year, month1 - 1, day); }
function addYears(ts, n) { const d = new Date(ts); const y = d.getUTCFullYear(); return Date.UTC(y + n, 0, 1); }
function addMonths(ts, n) { const d = new Date(ts); const y = d.getUTCFullYear(); const m = d.getUTCMonth(); return Date.UTC(y, m + n, 1); }
function addDays(ts, n) { return ts + n * 24 * 3600 * 1000; }
function alignTick(minTs, unit, step) {
  const d = new Date(minTs);
  let y = d.getUTCFullYear();
  if (unit === 'year') {
    let startY = Math.floor(y / step) * step;
    if (Date.UTC(startY, 0, 1) < minTs) startY += step;
    if (startY === 0) startY += step; // avoid year 0
    return startOfYear(startY);
  }
  if (unit === 'month') {
    // align by absolute month index
    let y0 = y, m0 = d.getUTCMonth() + 1; // 1..12
    let abs = y0 * 12 + (m0 - 1);
    let alignedAbs = Math.ceil(abs / step) * step;
    let ay = Math.trunc(alignedAbs / 12), am = (alignedAbs % 12) + 1;
    if (ay === 0) ay = -1; // simple shift to avoid 0; label code also skips 0 anyway
    return startOfMonth(ay, am);
  }
  // day
  const y0 = d.getUTCFullYear(), m0 = d.getUTCMonth() + 1, day = d.getUTCDate();
  const atBoundary = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (!atBoundary) return Date.UTC(y0, m0 - 1, day + 1);
  return startOfDay(y0, m0, day);
}
function formatYearHuman(y) {
  if (y < 0) return `${Math.abs(y)}\u202fBCE`;
  if (y > 0) return `${y}`;
  return '';
}
function formatTickLabel(ts, unit) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  if (unit === 'year') {
    return formatYearHuman(y); // BCE or CE
  }
  if (unit === 'month') {
    const m = d.getUTCMonth() + 1;
    const yTxt = (y < 0) ? `${Math.abs(y)} BCE` : `${y}`;
    return `${yTxt}-${String(m).padStart(2,'0')}`;
  }
  if (unit === 'day') {
    const m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const yTxt = (y < 0) ? `${Math.abs(y)} BCE` : `${y}`;
    return `${yTxt}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return '';
}
function wrapText(ctx, text, maxWidth, font) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  ctx.font = font || '12px Arial';
  words.forEach((w) => {
    const test = line ? (line + ' ' + w) : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push({ text: line, font: ctx.font });
      line = w;
    } else {
      line = test;
    }
  });
  if (line) lines.push({ text: line, font: ctx.font });
  return lines;
}
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
function clampPanForSize(W) {
  const content = W * zoom;
  const margin = 80;
  if (content <= W) return (W - content) / 2;
  const left = W - content - margin;
  const right = margin;
  return Math.max(left, Math.min(right, panX));
}
function clampPan() { panX = clampPanForSize(canvas.width); }
function formatDateHuman(ts, precision) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  if (precision === 'year') return (y < 0 ? `${Math.abs(y)}\u202fBCE` : `${y}`);
  if (precision === 'month') {
    const m = d.getUTCMonth() + 1;
    const yTxt = (y < 0) ? `${Math.abs(y)}\u202fBCE` : `${y}`;
    return `${yTxt}-${String(m).padStart(2,'0')}`;
  }
  const m = d.getUTCMonth() + 1, day = d.getUTCDate();
  const yTxt = (y < 0) ? `${Math.abs(y)}\u202fBCE` : `${y}`;
  return `${yTxt}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function displayWhen(ev) {
  if (ev.raw && ev.raw['display date']) return ev.raw['display date'];
  const a = formatDateHuman(ev.start, ev.startPrec || 'day');
  const b = formatDateHuman(ev.end, ev.endPrec || 'day');
  return (a === b) ? a : `${a} — ${b}`;
}

// ====== Interaction ======
function onPointerDown(x) {
  isPanning = true;
  suppressNextClick = false;
  panStartClientX = x;
  panStartPanX = panX;
  canvas.style.cursor = 'grabbing';
}
function onPointerMove(x) {
  if (!isPanning) return;
  const dx = x - panStartClientX;
  if (Math.abs(dx) > 3) suppressNextClick = true;
  panX = panStartPanX + dx;
  clampPan();
  draw();
}
function onPointerUp() {
  isPanning = false;
  canvas.style.cursor = 'grab';
}
canvas.style.cursor = 'grab';
canvas.addEventListener('mousedown', (e) => { e.preventDefault(); onPointerDown(e.clientX); });
window.addEventListener('mousemove', (e) => onPointerMove(e.clientX));
window.addEventListener('mouseup', () => onPointerUp());
canvas.addEventListener('touchstart', (e) => { if (!e.touches || e.touches.length === 0) return; onPointerDown(e.touches[0].clientX); });
canvas.addEventListener('touchmove', (e) => { if (!e.touches || e.touches.length === 0) return; onPointerMove(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchend', () => onPointerUp());
canvas.addEventListener('touchcancel', () => onPointerUp());

canvas.addEventListener('click', (e) => {
  if (suppressNextClick) { suppressNextClick = false; return; }
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  for (let i = hitRegions.length - 1; i >= 0; i--) {
    const h = hitRegions[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) { showDetails(h.ev); return; }
  }
  hideDetails();
});

const detailsPanel = document.getElementById('detailsPanel');
const detailsClose = document.getElementById('detailsClose');
const detailsContent = document.getElementById('detailsContent');
detailsClose?.addEventListener('click', hideDetails);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideDetails(); });

function showDetails(ev) {
  if (!detailsPanel || !detailsContent) return;
  const title = ev.title || '(untitled)';
  const when = displayWhen(ev);
  const group = groupKeyFor(ev);
  const text = ev.text || '';
  const mediaUrl = (ev.media || '').trim();
  let mediaHtml = '';
  if (mediaUrl) {
    mediaHtml = (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(mediaUrl))
      ? ('<div class="media"><img alt="" src="' + escapeHtml(mediaUrl) + '"></div>')
      : ('<div class="media"><a target="_blank" rel="noopener" href="' + escapeHtml(mediaUrl) + '">Open media</a></div>');
  }
  const textHtml = text ? ('<p>' + linkifyScripture(text) + '</p>') : '';
  detailsContent.innerHTML =
    '<h3 id="detailsTitle">' + escapeHtml(title) + '</h3>' +
    '<div class="meta">' + escapeHtml(when) + (group ? (' • ' + escapeHtml(group)) : '') + '</div>' +
    textHtml + mediaHtml;
  detailsPanel.classList.remove('hidden');
}
function hideDetails() { if (!detailsPanel) return; detailsPanel.classList.add('hidden'); }

// Zoom buttons
const zi = document.getElementById('zoomIn');
const zo = document.getElementById('zoomOut');

zi && (zi.onclick = () => {
  const old = zoom;
  const nz = Math.min(maxZoom, zoom * 1.3);
  if (nz === old) return;
  const W = canvas.width || canvas.clientWidth;
  let minTs = visibleEvents.length ? Math.min(...visibleEvents.map((e) => e.start)) : 0;
  let maxTs = visibleEvents.length ? Math.max(...visibleEvents.map((e) => e.end)) : 1;
  if (minTs === maxTs) { minTs -= 86400000; maxTs += 86400000; }
  const span = (maxTs - minTs) || 1;
  const oldS = (W * old) / span;
  const newS = (W * nz) / span;
  panX = panX * (newS / oldS);
  zoom = nz;
  clampPan();
  draw();
});

zo && (zo.onclick = () => {
  const old = zoom;
  const nz = Math.max(minZoom, zoom / 1.3);
  if (nz === old) return;
  const W = canvas.width || canvas.clientWidth;
  let minTs = visibleEvents.length ? Math.min(...visibleEvents.map((e) => e.start)) : 0;
  let maxTs = visibleEvents.length ? Math.max(...visibleEvents.map((e) => e.end)) : 1;
  if (minTs === maxTs) { minTs -= 86400000; maxTs += 86400000; }
  const span = (maxTs - minTs) || 1;
  const oldS = (W * old) / span;
  const newS = (W * nz) / span;
  panX = panX * (newS / oldS);
  zoom = nz;
  clampPan();
  draw();
});

// Redraw on resize
window.addEventListener('resize', () => { clampPan(); draw(); });
