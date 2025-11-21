// ===== Configuration =====
const minZoom = 0.2;
const maxZoom = 500; // allow deep zoom for months/days
const LABEL_ANCHOR_YEAR = -5000; // start ticks from 5000 BCE
const INITIAL_CENTER_YEAR = -4000; // center view near 4000 BCE

// ===== Canvas and state =====
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
let W, H;
let scale;
let panX = 0;
let firstDraw = true;
let isDragging = false;
let dragStartX = 0;

// ===== Utility functions =====
function startOfYear(y) { return Date.UTC(y, 0, 1); }
function startOfMonth(y, m) { return Date.UTC(y, m - 1, 1); }
function formatYearHuman(y) { return y < 0 ? `${Math.abs(y)} BCE` : `${y}`; }

function formatTickLabel(ts, unit) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();

  if (unit === 'year') return formatYearHuman(y);
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

function chooseTickScale(pxPerYear) {
  const pxPerMonth = pxPerYear / 12;
  const pxPerDay = pxPerYear / 365.2425;

  if (pxPerDay >= 60) return { unit: 'day', step: 1 };
  if (pxPerDay >= 30) return { unit: 'day', step: 7 };

  if (pxPerMonth >= 24) return { unit: 'month', step: 1 };
  if (pxPerMonth >= 12) return { unit: 'month', step: 3 };
  if (pxPerMonth >= 6) return { unit: 'month', step: 6 };

  if (pxPerYear >= 120) return { unit: 'year', step: 1 };
  if (pxPerYear >= 40) return { unit: 'year', step: 10 };
  if (pxPerYear >= 12) return { unit: 'year', step: 100 };

  return { unit: 'year', step: 1000 };
}

function alignTickFromAnchor(minTs, anchorYear, unit, step) {
  const dMin = new Date(minTs);
  const minY = dMin.getUTCFullYear();

  if (unit === 'year') {
    let k = Math.ceil((minY - anchorYear) / step);
    let y0 = anchorYear + k * step;
    if (y0 === 0) y0 += step;
    return startOfYear(y0);
  }

  if (unit === 'month') {
    const absMin = dMin.getUTCFullYear() * 12 + dMin.getUTCMonth();
    const absAnc = anchorYear * 12;
    const k = Math.ceil((absMin - absAnc) / step);
    const absOut = absAnc + k * step;
    let yOut = Math.trunc(absOut / 12), mOut = (absOut % 12) + 1;
    if (yOut === 0) yOut = -1;
    return startOfMonth(yOut, mOut);
  }

  return minTs;
}

// ===== Main draw function =====
function draw(minTs, maxTs) {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  ctx.clearRect(0, 0, W, H);

  const pxPerYear = scale;
  const { unit, step } = chooseTickScale(pxPerYear);

  let t = alignTickFromAnchor(minTs, LABEL_ANCHOR_YEAR, unit, step);
  let lastRight = -Infinity;
  const gap = 10;

  while (t < maxTs) {
    const x = (t - minTs) * scale + panX;
    if (x > -50 && x < W + 50) {
      const text = formatTickLabel(t, unit);
      ctx.font = '14px sans-serif';
      const pillW = ctx.measureText(text).width + 10;
      const pillH = 20;
      const pillY = 30;
      if (x - pillW / 2 > lastRight + gap) {
        ctx.fillStyle = '#ffffffee';
        ctx.strokeStyle = '#00000022';
        ctx.beginPath();
        ctx.roundRect(x - pillW / 2, pillY, pillW, pillH, 6);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x - pillW / 2 + 5, pillY + pillH / 2);
        lastRight = x + pillW / 2;
      }
    }
    if (unit === 'year') {
      t = startOfYear(new Date(t).getUTCFullYear() + step);
    } else if (unit === 'month') {
      const d = new Date(t);
      let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
      m += step;
      while (m > 12) { y++; m -= 12; }
      t = startOfMonth(y, m);
    } else if (unit === 'day') {
      t += step * 86400000;
    }
  }

  if (firstDraw) {
    const initTs = startOfYear(INITIAL_CENTER_YEAR);
    panX = (W / 2) - ((initTs - minTs) * scale);
    firstDraw = false;
  }
}

// ===== Zoom controls =====
function zoomIn() { scale = Math.min(scale * 1.3, maxZoom); draw(minTs, maxTs); }
function zoomOut() { scale = Math.max(scale / 1.3, minZoom); draw(minTs, maxTs); }

// ===== Initialization =====
let minTs = startOfYear(-5000);
let maxTs = startOfYear(2100);

// Dynamic initial scale to fit timeline
scale = window.innerWidth / (maxTs - minTs);
draw(minTs, maxTs);

// ===== Event listeners for zoom buttons =====
document.getElementById('zoomIn').addEventListener('click', zoomIn);
document.getElementById('zoomOut').addEventListener('click', zoomOut);
document.getElementById('resetZoom').addEventListener('click', () => {
  scale = window.innerWidth / (maxTs - minTs);
  panX = 0;
  firstDraw = true;
  draw(minTs, maxTs);
});

// ===== Responsive redraw on resize =====
window.addEventListener('resize', () => {
  scale = window.innerWidth / (maxTs - minTs);
  draw(minTs, maxTs);
});

// ===== Mouse wheel zoom =====
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  scale = Math.min(Math.max(scale * zoomFactor, minZoom), maxZoom);
  draw(minTs, maxTs);
});

// ===== Drag-to-pan =====
canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.clientX;
});
canvas.addEventListener('mousemove', (e) => {
  if (isDragging) {
    panX += e.clientX - dragStartX;
    dragStartX = e.clientX;
    draw(minTs, maxTs);
  }
});
canvas.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('mouseleave', () => isDragging = false);
