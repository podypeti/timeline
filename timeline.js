// -------------------------
// CONFIG
// -------------------------
const canvas = document.getElementById("timelineCanvas");
const ctx = canvas.getContext("2d");

let zoom = 1;               // current zoom level
const minZoom = 0.2;
const maxZoom = 20;

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
// Expected header (examples):
// Year,Month,Day,Time,End Year,End Month,End Day,End Time,Display Date,Headline,Text,Media,Media Credit,Media Caption,Media Thumbnail,Type,Group,Background
// This parser will build start/end timestamps (ms) and normalize fields.
// -------------------------
function csvSplit(line) {
    // Simple CSV splitter that respects double quotes
    const parts = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            // handle escaped quotes "" -> "
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            parts.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    parts.push(cur);
    return parts;
}

function parseTimeString(timeStr) {
    // timeStr like "HH:MM" or "HH:MM:SS" or empty
    if (!timeStr) return [0,0,0];
    const parts = timeStr.split(":").map(p => parseInt(p,10));
    const h = isNaN(parts[0]) ? 0 : parts[0];
    const m = isNaN(parts[1]) ? 0 : parts[1] || 0;
    const s = isNaN(parts[2]) ? 0 : parts[2] || 0;
    return [h,m,s];
}

function toTimestampFromParts(year, month, day, timeStr) {
    // month: 1-12 or empty -> default 1 (January)
    // day: 1-31 or empty -> default 1
    // returns ms since epoch (UTC)
    if (isNaN(year) || year === null) return NaN;
    const y = parseInt(year, 10);
    const mo = (isNaN(parseInt(month,10)) ? 1 : parseInt(month,10));
    const d = (isNaN(parseInt(day,10)) ? 1 : parseInt(day,10));
    const [h,m,s] = parseTimeString(timeStr);
    // Use UTC so rendering is consistent across timezones
    return Date.UTC(y, Math.max(0, mo - 1), Math.max(1, d), h, m, s);
}

function parseCSV(text) {
    if (!text) return [];

    const rawLines = text.split("\n");
    const lines = rawLines.map(l => l.trim()).filter((l, idx) => l.length > 0 || idx === 0); // keep header even if empty-looking

    if (lines.length === 0) return [];

    const headerParts = csvSplit(lines[0]).map(h => h.trim());
    // build lowercase header map: headerLower -> originalIndex
    const headerMap = {};
    headerParts.forEach((h, idx) => {
        headerMap[h.toLowerCase()] = idx;
    });

    const out = [];

    for (let i = 1; i < lines.length; i++) {
        const raw = lines[i];
        if (!raw) continue;

        const parts = csvSplit(raw);
        // build lowercase-keyed map
        const norm = {};
        Object.keys(headerMap).forEach(k => {
            const idx = headerMap[k];
            const rawVal = parts[idx] !== undefined ? parts[idx] : "";
            // trim surrounding spaces and quotes
            const v = ("" + rawVal).trim().replace(/^"(.*)"$/, "$1");
            norm[k] = v;
        });

        // extract common fields (headline/title variations)
        const title = norm.headline || norm.title || norm.name || "";
        const type = norm.type || "";
        const media = norm.media || "";
        const textField = norm.text || norm['display date'] || "";

        // parse start date from Year/Month/Day/Time
        const year = parseInt(norm.year, 10);
        const month = norm.month;
        const day = norm.day;
        const timeStr = norm.time || norm['time'] || "";

        let startTs = toTimestampFromParts(year, month, day, timeStr);

        // parse end date (End Year etc) - if missing, use start
        const endYear = parseInt(norm['end year'], 10);
        let endTs = NaN;
        if (!isNaN(endYear)) {
            const endMonth = norm['end month'];
            const endDay = norm['end day'];
            const endTimeStr = norm['end time'] || "";
            endTs = toTimestampFromParts(endYear, endMonth, endDay, endTimeStr);
        }

        if (isNaN(startTs)) {
            // fallback: some CSVs might have a single "start" column with full date
            const singleStart = norm.start || norm['start date'] || norm['display date'];
            if (singleStart) {
                const d = new Date(singleStart);
                if (!isNaN(d)) startTs = d.getTime();
            }
        }

        if (isNaN(startTs)) {
            // cannot parse start — skip row
            continue;
        }
        if (isNaN(endTs)) endTs = startTs;

        // ensure start <= end
        if (endTs < startTs) {
            const tmp = startTs;
            startTs = endTs;
            endTs = tmp;
        }

        out.push({
            title: title,
            start: startTs,
            end: endTs,
            type: type,
            media: media,
            text: textField,
            raw: norm
        });
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
            if (!rowOverlap(r, ev)) {
                r.push(ev);
                placed = true;
                break;
            }
        }

        if (!placed) rows.push([ev]);
    });
}

function rowOverlap(row, ev) {
    return row.some(e => !(ev.end < e.start || ev.start > e.end));
}

// -------------------------
// PANNING UTIL
// -------------------------
function clampPanForSize(W) {
    // contentWidth is W * zoom (since scale = (W*zoom)/span and span*(W*zoom/span) = W*zoom)
    const contentWidth = W * zoom;
    const margin = 80; // allow a small margin so items don't hit exactly the edge

    if (contentWidth <= W) {
        // center the content
        return (W - contentWidth) / 2;
    } else {
        // allow panX between leftLimit and rightLimit
        const leftLimit = W - contentWidth - margin; // when content is shifted fully left
        const rightLimit = margin; // when content is shifted fully right
        return Math.max(leftLimit, Math.min(rightLimit, panX));
    }
}

function clampPan() {
    panX = clampPanForSize(canvas.width);
}

// -------------------------
// DRAW EVERYTHING
// -------------------------
function draw() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    const timelineY = H * 0.15;
    const rowHeight = 38;

    if (!events || events.length === 0) {
        ctx.fillStyle = "#000";
        ctx.font = "14px Arial";
        ctx.fillText("No events", 10, 30);
        return;
    }

    // find min/max timestamps
    let minTs = Math.min(...events.map(e => e.start));
    let maxTs = Math.max(...events.map(e => e.end));

    if (!isFinite(minTs) || !isFinite(maxTs)) {
        ctx.fillStyle = "#000";
        ctx.font = "14px Arial";
        ctx.fillText("Invalid event dates", 10, 30);
        return;
    }

    // protect against zero span
    if (minTs === maxTs) {
        minTs -= 24 * 3600 * 1000; // one day
        maxTs += 24 * 3600 * 1000;
    }

    const span = maxTs - minTs || 1;
    const scale = (W * zoom) / span;

    // initialize pan on first draw to center content if small
    if (firstDraw) {
        const contentWidth = W * zoom;
        if (contentWidth <= W) {
            panX = (W - contentWidth) / 2;
        } else {
            // default: show left-most part
            panX = 0;
        }
        firstDraw = false;
    }

    // clamp pan to sensible range for this canvas size
    panX = clampPanForSize(W);

    // convert timestamp → pixel using computed scale and pan offset
    function xOfTs(ts) {
        return (ts - minTs) * scale + panX;
    }

    // ---------------------
    // Draw timeline line
    // ---------------------
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, timelineY);
    ctx.lineTo(W, timelineY);
    ctx.stroke();

    // ---------------------
    // Draw year labels (dynamic) — compute based on pixels/year
    // ---------------------
    const msPerYear = 365.25 * 24 * 3600 * 1000;
    const approxPxPerYear = scale * msPerYear;

    let stepYears;
    if (approxPxPerYear < 2) stepYears = 100;
    else if (approxPxPerYear < 5) stepYears = 50;
    else if (approxPxPerYear < 12) stepYears = 20;
    else if (approxPxPerYear < 30) stepYears = 10;
    else if (approxPxPerYear < 60) stepYears = 5;
    else stepYears = 1;

    ctx.fillStyle = "#000";
    ctx.font = "12px Arial";
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1;

    const minYear = new Date(minTs).getUTCFullYear();
    const maxYear = new Date(maxTs).getUTCFullYear();
    const startLabel = Math.floor(minYear / stepYears) * stepYears;
    for (let y = startLabel; y <= maxYear; y += stepYears) {
        const ts = Date.UTC(y, 0, 1);
        const x = xOfTs(ts);
        if (x < -50 || x > W + 50) continue;
        ctx.fillText(y, x - 10, timelineY - 5);
        ctx.beginPath();
        ctx.moveTo(x, timelineY - 3);
        ctx.lineTo(x, timelineY + 3);
        ctx.stroke();
    }

    // ---------------------
    // Draw event rows
    // ---------------------
    rows.forEach((row, i) => {
        let y = timelineY + 40 + i * rowHeight;

        row.forEach(ev => {
            const x1 = xOfTs(ev.start);
            const x2 = xOfTs(ev.end);

            let color = "#007BFF";
            const t = (ev.type || "").toLowerCase();
            if (t === "person") color = "#28A745";
            else if (t === "era") color = "#DC3545";

            let left = Math.min(x1, x2);
            let right = Math.max(x1, x2);

            const width = Math.max(2, right - left);

            ctx.fillStyle = color;
            ctx.fillRect(left, y, width, 20);

            ctx.fillStyle = "#000";
            ctx.font = "12px Arial";
            const textX = left + 4;
            const textY = y + 15;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, y, width, 20);
            ctx.clip();
            ctx.fillText(ev.title || "", textX, textY);
            ctx.restore();
        });
    });
}

// -------------------------
// PANNING EVENT HANDLERS
// -------------------------
function onPointerDown(clientX) {
    isPanning = true;
    panStartClientX = clientX;
    panStartPanX = panX;
    canvas.style.cursor = "grabbing";
}

function onPointerMove(clientX) {
    if (!isPanning) return;
    const dx = clientX - panStartClientX;
    panX = panStartPanX + dx;
    clampPan();
    draw();
}

function onPointerUp() {
    isPanning = false;
    canvas.style.cursor = "grab";
}

// mouse
canvas.style.cursor = "grab";
canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onPointerDown(e.clientX);
});
window.addEventListener("mousemove", (e) => {
    onPointerMove(e.clientX);
});
window.addEventListener("mouseup", (e) => {
    onPointerUp();
});
canvas.addEventListener("mouseleave", (e) => {
    // if pointer leaves canvas while dragging, don't immediately end — we listen on window mouseup; still safe to do nothing here
});

// touch
canvas.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length === 0) return;
    onPointerDown(e.touches[0].clientX);
});
canvas.addEventListener("touchmove", (e) => {
    if (!e.touches || e.touches.length === 0) return;
    onPointerMove(e.touches[0].clientX);
    e.preventDefault(); // prevent scrolling while panning
}, { passive: false });
canvas.addEventListener("touchend", (e) => {
    onPointerUp();
});
canvas.addEventListener("touchcancel", (e) => {
    onPointerUp();
});

// -------------------------
// ZOOM BUTTONS
// -------------------------
document.getElementById("zoomIn").onclick = () => {
    const oldZoom = zoom;
    const newZoom = Math.min(maxZoom, zoom * 1.3);
    if (newZoom === oldZoom) return;
    // adjust pan so the current view remains approximately at same place
    const W = canvas.width || canvas.clientWidth;
    let minTs = events.length ? Math.min(...events.map(e => e.start)) : 0;
    let maxTs = events.length ? Math.max(...events.map(e => e.end)) : 1;
    if (minTs === maxTs) { minTs -= 24*3600*1000; maxTs += 24*3600*1000; }
    const span = maxTs - minTs || 1;
    const oldScale = (W * oldZoom) / span;
    const newScale = (W * newZoom) / span;
    // scale panX proportionally
    panX = panX * (newScale / oldScale);
    zoom = newZoom;
    clampPan();
    draw();
};
document.getElementById("zoomOut").onclick = () => {
    const oldZoom = zoom;
    const newZoom = Math.max(minZoom, zoom / 1.3);
    if (newZoom === oldZoom) return;
    const W = canvas.width || canvas.clientWidth;
    let minTs = events.length ? Math.min(...events.map(e => e.start)) : 0;
    let maxTs = events.length ? Math.max(...events.map(e => e.end)) : 1;
    if (minTs === maxTs) { minTs -= 24*3600*1000; maxTs += 24*3600*1000; }
    const span = maxTs - minTs || 1;
    const oldScale = (W * oldZoom) / span;
    const newScale = (W * newZoom) / span;
    panX = panX * (newScale / oldScale);
    zoom = newZoom;
    clampPan();
    draw();
};