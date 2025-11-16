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

// -------------------------
// LOAD CSV
// -------------------------
fetch("timeline-data.csv")
  .then(res => res.text())
  .then(text => parseCSV(text))
  .then(data => {
      events = data;
      packRows();
      draw();
  });

// -------------------------
// CSV PARSER
// Expected columns: Title, Start, End, Type
// -------------------------
function parseCSV(text) {
    const lines = text.trim().split("\n");
    lines.shift(); // skip header

    return lines.map(line => {
        const [title, start, end, type] = line.split(",");

        return {
            title: title.trim(),
            start: parseInt(start.trim()),
            end: end.trim() ? parseInt(end.trim()) : parseInt(start.trim()),
            type: type.trim()
        };
    });
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

    // find min/max years
    let minYear = Math.min(...events.map(e => e.start));
    let maxYear = Math.max(...events.map(e => e.end));

    const totalYears = (maxYear - minYear) / zoom;

    // convert year → pixel
    function xOf(year) {
        return ((year - minYear) / (maxYear - minYear)) * W * zoom;
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
    // Draw year labels (dynamic)
    // ---------------------
    let step;
    if (zoom < 0.4) step = 100;
    else if (zoom < 1) step = 50;
    else if (zoom < 2) step = 20;
    else if (zoom < 6) step = 10;
    else step = 5;

    ctx.fillStyle = "#000";
    ctx.font = "12px Arial";

    for (let y = minYear - (minYear % step); y <= maxYear; y += step) {
        let x = xOf(y);
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
            const x1 = xOf(ev.start);
            const x2 = xOf(ev.end);

            let color = "#007BFF";
            if (ev.type === "Person") color = "#28A745";
            else if (ev.type === "Era") color = "#DC3545";

            const width = Math.max(2, x2 - x1);

            ctx.fillStyle = color;
            ctx.fillRect(x1, y, width, 20);

            ctx.fillStyle = "#000";
            ctx.font = "12px Arial";
            ctx.fillText(ev.title, x1 + 4, y + 15);
        });
    });
}

// -------------------------
// ZOOM BUTTONS
// -------------------------
document.getElementById("zoomIn").onclick = () => {
    zoom = Math.min(maxZoom, zoom * 1.3);
    draw();
};
document.getElementById("zoomOut").onclick = () => {
    zoom = Math.max(minZoom, zoom / 1.3);
    draw();
};