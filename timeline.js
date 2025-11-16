// -------------------------
// CONFIG
// -------------------------
const canvas = document.getElementById("timelineCanvas");
const ctx = canvas.getContext("2d");

// remove any heading that says "history timeline" (case-insensitive)
(function removeTitle() {
  try {
    const candidates = document.querySelectorAll('h1, h2, .title, #title');
    candidates.forEach(el => {
      if (el && el.textContent && el.textContent.toLowerCase().includes('history timeline')) {
        el.remove();
      }
    });
  } catch (err) {
    // ignore
  }
})();

let zoom = 1;               // current zoom level
const minZoom = 0.2;
const maxZoom = 40;

let events = [];            // loaded from CSV
let rows = [];              // auto-packed rows

// Panning state (in pixels)
let panX = 0;
let isPanning = false;
let panStartClientX = 0;
let panStartPanX = 0;
let firstDraw = true;

// -------------------------
// LOAD CSV
// -------------------------
fetch("timeline-data.csv")
  .then(res => {
    if (!res.ok) throw new Error("Failed to fetch timeline-data.csv: " + res.status);
    return res.text();
  })
  .then(text => parseCSV(text))
  .then(data => {
      events = data;
      packRows();
      draw();
  })
  .catch(err => {
      console.error(err);
      // clear canvas / show message
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      ctx.font = "14px Arial";
      ctx.fillText("Failed to load timeline data.", 10, 30);
  });

// -------------------------
// CSV PARSER
// -------------------------
function csvSplit(line) {
    const parts = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            parts.push(cur); cur = "";
        } else cur += ch;
    }
    parts.push(cur);
    return parts;
}

function parseTimeString(timeStr) {
    if (!timeStr) return [0,0,0];
    const parts = timeStr.split(":").map(p => parseInt(p,10));
    const h = isNaN(parts[0]) ? 0 : parts[0];
    const m = isNaN(parts[1]) ? 0 : parts[1] || 0;
    const s = isNaN(parts[2]) ? 0 : parts[2] || 0;
    return [h,m,s];
}

function toTimestampFromParts(year, month, day, timeStr) {
    if (isNaN(year) || year === null) return NaN;
    const y = parseInt(year, 10);
    const mo = (isNaN(parseInt(month,10)) ? 1 : parseInt(month,10));
    const d = (isNaN(parseInt(day,10)) ? 1 : parseInt(day,10));
    const [h,m,s] = parseTimeString(timeStr);
    return Date.UTC(y, Math.max(0, mo - 1), Math.max(1, d), h, m, s);
}

function parseCSV(text) {
    if (!text) return [];
    const rawLines = text.split("\n");
    const lines = rawLines.map(l => l.trim()).filter((l, idx) => l.length > 0 || idx === 0);
    if (lines.length === 0) return [];
    const headerParts = csvSplit(lines[0]).map(h => h.trim());
    const headerMap = {};
    headerParts.forEach((h, idx) => { headerMap[h.toLowerCase()] = idx; });
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const raw = lines[i]; if (!raw) continue;
        const parts = csvSplit(raw);
        const norm = {};
        Object.keys(headerMap).forEach(k => {
            const idx = headerMap[k];
            const rawVal = parts[idx] !== undefined ? parts[idx] : "";
            const v = ("" + rawVal).trim().replace(/^"(.*)"$/, "$1");
            norm[k] = v;
        });
        const title = norm.headline || norm.title || norm.name || "";
        const type = norm.type || "";
        const media = norm.media || "";
        const textField = norm.text || norm['display date'] || "";
        const year = parseInt(norm.year, 10);
        const month = norm.month;
        const day = norm.day;
        const timeStr = norm.time || norm['time'] || "";
        let startTs = toTimestampFromParts(year, month, day, timeStr);
        const endYear = parseInt(norm['end year'], 10);
        let endTs = NaN;
        if (!isNaN(endYear)) {
            const endMonth = norm['end month'];
            const endDay = norm['end day'];
            const endTimeStr = norm['end time'] || "";
            endTs = toTimestampFromParts(endYear, endMonth, endDay, endTimeStr);
        }
        if (isNaN(startTs)) {
            const singleStart = norm.start || norm['start date'] || norm['display date'];
            if (singleStart) {
                const d = new Date(singleStart);
                if (!isNaN(d)) startTs = d.getTime();
            }
        }
        if (isNaN(startTs)) continue;
        if (isNaN(endTs)) endTs = startTs;
        if (endTs < startTs) { const tmp = startTs; startTs = endTs; endTs = tmp; }
        out.push({ title, start: startTs, end: endTs, type, media, text: textField, raw: norm });
    }
    return out;
}

// -------------------------
// AUTO-PACK EVENTS INTO ROWS
// -------------------------
function packRows() {
    rows = [];
    events.forEach(ev => {
        let placed = false;
        for (let r of rows) {
            if (!rowOverlap(r, ev)) { r.push(ev); placed = true; break; }
        }
        if (!placed) rows.push([ev]);
    });
}
function rowOverlap(row, ev) { return row.some(e => !(ev.end < e.start || ev.start > e.end)); }

// -------------------------
// UTIL: YEAR LABEL FORMATTING & COLORS
// -------------------------
function formatYearLabel(y) {
    // y is astronomical year (can be negative or zero). Display negative/zero as BCE.
    if (typeof y !== 'number' || isNaN(y)) return '';
    if (y > 0) return String(y);
    if (y === 0) return '1 BCE';
    return `${Math.abs(y)} BCE`;
}

const GROUP_COLORS = {
    'event': '#007BFF',
    'person': '#28A745',
    'era': '#DC3545',
    'place': '#6f42c1',
    'default': '#007BFF'
};
function colorForEvent(ev) {
    const g = (ev.raw && (ev.raw.group || ev.raw['group'])) || ev.type || '';
    const key = ('' + g).toLowerCase();
    if (GROUP_COLORS[key]) return GROUP_COLORS[key];
    // fallback: hash to a color
    let h = 0; for (let i=0;i<key.length;i++) h = (h<<5)-h + key.charCodeAt(i);
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 70% 45%)`;
}

// -------------------------
// PANNING UTIL
// -------------------------
function clampPanForSize(W) {
    const contentWidth = W * zoom;
    const margin = 80;
    if (contentWidth <= W) return (W - contentWidth) / 2;
    const leftLimit = W - contentWidth - margin;
    const rightLimit = margin;
    return Math.max(leftLimit, Math.min(rightLimit, panX));
}
function clampPan() { panX = clampPanForSize(canvas.width); }

// -------------------------
// DRAW EVERYTHING
// -------------------------
function draw() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const W = canvas.width; const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // timeline line and labels at top
    const topPadding = 8;
    const labelAreaHeight = 30;
    const timelineY = topPadding + labelAreaHeight;
    const rowHeight = 34;

    if (!events || events.length === 0) {
        ctx.fillStyle = "#000"; ctx.font = "14px Arial"; ctx.fillText("No events", 10, timelineY + 20); return;
    }

    let minTs = Math.min(...events.map(e => e.start));
    let maxTs = Math.max(...events.map(e => e.end));
    if (!isFinite(minTs) || !isFinite(maxTs)) { ctx.fillStyle = "#000"; ctx.font = "14px Arial"; ctx.fillText("Invalid event dates", 10, 30); return; }
    if (minTs === maxTs) { minTs -= 24*3600*1000; maxTs += 24*3600*1000; }
    const span = maxTs - minTs || 1;
    const scale = (W * zoom) / span;

    if (firstDraw) { const contentWidth = W * zoom; panX = contentWidth <= W ? (W - contentWidth)/2 : 0; firstDraw = false; }
    panX = clampPanForSize(W);
    function xOfTs(ts) { return (ts - minTs) * scale + panX; }

    // draw timeline line
    ctx.strokeStyle = "#222"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, timelineY); ctx.lineTo(W, timelineY); ctx.stroke();

    // draw dynamic date labels at top (non-overlapping)
    const msPerYear = 365.25 * 24 * 3600 * 1000;
    const approxPxPerYear = scale * msPerYear;
    let stepYears;
    if (approxPxPerYear < 2) stepYears = 200;
    else if (approxPxPerYear < 6) stepYears = 100;
    else if (approxPxPerYear < 14) stepYears = 50;
    else if (approxPxPerYear < 30) stepYears = 20;
    else if (approxPxPerYear < 60) stepYears = 10;
    else if (approxPxPerYear < 120) stepYears = 5;
    else if (approxPxPerYear < 240) stepYears = 2;
    else stepYears = 1;

    const minYear = new Date(minTs).getUTCFullYear();
    const maxYear = new Date(maxTs).getUTCFullYear();
    const startLabel = Math.floor(minYear / stepYears) * stepYears;
    ctx.font = "12px Arial"; ctx.textBaseline = 'middle';
    const minLabelGap = 6; let lastLabelRight = -Infinity;

    for (let y = startLabel; y <= maxYear; y += stepYears) {
        // skip the astronomical year 0 display issue by formatting specially
        const ts = Date.UTC(y,0,1);
        const x = xOfTs(ts);
        if (x < -100 || x > W + 100) continue;
        const text = formatYearLabel(y);
        const textW = ctx.measureText(text).width;
        const pillW = textW + 10; const pillH = 20;
        const pillX = x - pillW/2; const pillY = topPadding; const pillLeft = Math.max(4, pillX); const pillRight = pillLeft + pillW;
        if (pillLeft <= lastLabelRight + minLabelGap) continue;
        ctx.fillStyle = '#ffffffee'; ctx.strokeStyle = '#00000022'; roundRect(ctx, pillLeft, pillY, pillW, pillH, 6, true, false);
        ctx.fillStyle = '#000'; ctx.fillText(text, pillLeft + 5, pillY + pillH/2);
        lastLabelRight = pillRight;
        ctx.beginPath(); ctx.setLineDash([3,3]); ctx.moveTo(x, pillY + pillH); ctx.lineTo(x, timelineY - 4); ctx.stroke(); ctx.setLineDash([]);
    }

    // rows and events
    rows.forEach((row, i) => {
        let y = timelineY + 18 + i * rowHeight;
        row.forEach(ev => {
            const x1 = xOfTs(ev.start); const x2 = xOfTs(ev.end);
            const left = Math.min(x1,x2); const right = Math.max(x1,x2);
            const rawWidth = right - left; const minVisualWidth = 10;
            const color = colorForEvent(ev);

            // draw dotted connector from event to its label area (dotted stick)
            const labelParts = [];
            if (ev.title) labelParts.push(ev.title);
            if (ev.raw && ev.raw['display date']) labelParts.push(ev.raw['display date']);
            const label = labelParts.join(' — ');
            ctx.font = '12px Arial';
            const paddingX = 6; const paddingY = 4; const textWidth = ctx.measureText(label).width;
            const pillW = Math.min(260, textWidth + paddingX*2); const pillH = 18;

            let pillX = right + 8; if (pillX + pillW > W - 8) pillX = left - 8 - pillW; if (pillX < 4) pillX = 4;
            const pillY = y + 10 - pillH/2;

            if (rawWidth < minVisualWidth) {
                const cx = (x1+x2)/2; const r = 6; ctx.beginPath(); ctx.fillStyle = color; ctx.arc(cx, y+10, r, 0, Math.PI*2); ctx.fill();
                // dotted stick from marker up to pill (if pill is above)
                const stickX = cx; const stickTop = pillY + pillH; const stickBottom = y+10 - r;
                ctx.beginPath(); ctx.strokeStyle = color; ctx.setLineDash([4,4]); ctx.moveTo(stickX, stickBottom); ctx.lineTo(stickX, stickTop); ctx.stroke(); ctx.setLineDash([]);
            } else {
                const drawLeft = left; const drawWidth = Math.max(6, rawWidth); ctx.fillStyle = color; ctx.fillRect(drawLeft, y, drawWidth, 20);
                // dotted stick from center of bar up to pill
                const stickX = drawLeft + drawWidth/2; const stickTop = pillY + pillH; const stickBottom = y;
                ctx.beginPath(); ctx.strokeStyle = color; ctx.setLineDash([4,4]); ctx.moveTo(stickX, stickBottom); ctx.lineTo(stickX, stickTop); ctx.stroke(); ctx.setLineDash([]);
            }

            // draw pill label with colored border to indicate group
            ctx.fillStyle = '#ffffffdd'; ctx.strokeStyle = color; ctx.lineWidth = 1; roundRect(ctx, pillX, pillY, pillW, pillH, 6, true, true);
            ctx.fillStyle = '#000'; ctx.fillText(label, pillX + paddingX, pillY + pillH - paddingY - 2);
        });
    });
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    if (typeof r === 'undefined') r = 5; ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); if (fill) ctx.fill(); if (stroke) ctx.stroke(); }

// Panning handlers & zoom buttons
function onPointerDown(clientX) { isPanning = true; panStartClientX = clientX; panStartPanX = panX; canvas.style.cursor = 'grabbing'; }
function onPointerMove(clientX) { if (!isPanning) return; const dx = clientX - panStartClientX; panX = panStartPanX + dx; clampPan(); draw(); }
function onPointerUp() { isPanning = false; canvas.style.cursor = 'grab'; }
canvas.style.cursor = 'grab';
canvas.addEventListener('mousedown', e => { e.preventDefault(); onPointerDown(e.clientX); });
window.addEventListener('mousemove', e => { onPointerMove(e.clientX); });
window.addEventListener('mouseup', e => { onPointerUp(); });
canvas.addEventListener('touchstart', e => { if (!e.touches || e.touches.length===0) return; onPointerDown(e.touches[0].clientX); });
canvas.addEventListener('touchmove', e => { if (!e.touches || e.touches.length===0) return; onPointerMove(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchend', e => { onPointerUp(); });
canvas.addEventListener('touchcancel', e => { onPointerUp(); });
document.getElementById('zoomIn').onclick = () => {
    const oldZoom = zoom; const newZoom = Math.min(maxZoom, zoom * 1.3); if (newZoom === oldZoom) return; const W = canvas.width || canvas.clientWidth; let minTs = events.length ? Math.min(...events.map(e=>e.start)) : 0; let maxTs = events.length ? Math.max(...events.map(e=>e.end)) : 1; if (minTs===maxTs){ minTs -= 24*3600*1000; maxTs += 24*3600*1000;} const span = maxTs-minTs||1; const oldScale = (W*oldZoom)/span; const newScale = (W*newZoom)/span; panX = panX * (newScale/oldScale); zoom = newZoom; clampPan(); draw(); };

document.getElementById('zoomOut').onclick = () => {
    const oldZoom = zoom; const newZoom = Math.max(minZoom, zoom / 1.3); if (newZoom === oldZoom) return; const W = canvas.width || canvas.clientWidth; let minTs = events.length ? Math.min(...events.map(e=>e.start)) : 0; let maxTs = events.length ? Math.max(...events.map(e=>e.end)) : 1; if (minTs===maxTs){ minTs -= 24*3600*1000; maxTs += 24*3600*1000;} const span = maxTs-minTs||1; const oldScale = (W*oldZoom)/span; const newScale = (W*newZoom)/span; panX = panX * (newScale/oldScale); zoom = newZoom; clampPan(); draw(); };