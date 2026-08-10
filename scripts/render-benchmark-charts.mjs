// Renders a "master vs. this run" diff bar chart (+ a worst/best delta table)
// per benchmark suite, as static SVG — no headless browser or charting
// library, just hand-rolled SVG since the output is a flat image embedded in
// a GitHub PR comment (no interactivity possible there anyway).
//
// Palette: blue baseline bar, status-good green / status-critical red delta
// caps, green-hatched "new" bars for entries with no baseline sample yet.
// Green/red alone fail the colorblind-separation check for a bar chart, so
// every delta also carries a direct % label and a positional cue (the cap
// grows down when faster, up when slower) — never color alone.
const COLORS = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  inkMuted: '#898781',
  gridline: '#e1e0d9',
  axis: '#c3c2b7',
  blue: '#2a78d6',
  good: '#0ca30c',
  goodText: '#006300',
  critical: '#d03b3b',
};

const BAR_WIDTH = 16;
const BAR_GAP = 20;
const BAR_PITCH = BAR_WIDTH + BAR_GAP;
const PANEL_HEIGHT = 260;
const PANEL_GAP = 56;
const LABEL_LINE_HEIGHT = 11;
const LABEL_AREA_HEIGHT = 210;
const LEFT_MARGIN = 60;
const RIGHT_MARGIN = 24;
const TOP_MARGIN = 92;
const DELTA_LABEL_SPACE = 20;
const LEGEND_ITEM_GAP = 26;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Greedy word-wrap into at most maxLines lines of maxCharsPerLine, ellipsizing
// any overflow into the last line.
export function wrapLabel(text, maxCharsPerLine = 26, maxLines = 3) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  const overflow = lines.slice(maxLines).join(' ');
  const lastIndex = maxLines - 1;
  const combined = `${kept[lastIndex]} ${overflow}`;
  kept[lastIndex] = combined.length > maxCharsPerLine
    ? `${combined.slice(0, maxCharsPerLine - 1)}…`
    : combined;
  return kept;
}

// Baseline lookup from github-action-benchmark's gh-pages `dev/bench/data.js`
// payload: window.BENCHMARK_DATA.entries[suiteName] is the history for one
// `name:` (a whole CI step/suite); `.at(-1)` is its most recent commit, whose
// `.benches` array holds one entry per individually-named bench within it.
export function extractBaseline(benchmarkData, suiteName) {
  const benches = benchmarkData?.entries?.[suiteName]?.at(-1)?.benches;
  const baseline = new Map();
  if (Array.isArray(benches)) {
    for (const bench of benches) baseline.set(bench.name, bench.value);
  }
  return baseline;
}

// Joins each current-run entry with its baseline (if any) into the shape both
// the chart and the delta table consume.
export function computeDeltaRows(entries, baselineByName) {
  return entries.map((entry) => {
    const baseline = baselineByName.get(entry.name);
    if (baseline === undefined) {
      return { name: entry.name, value: entry.value, unit: entry.unit, baseline: undefined, deltaMs: undefined, deltaPct: undefined, isNew: true };
    }
    const deltaMs = entry.value - baseline;
    const deltaPct = baseline === 0 ? undefined : (deltaMs / baseline) * 100;
    return { name: entry.name, value: entry.value, unit: entry.unit, baseline, deltaMs, deltaPct, isNew: false };
  });
}

function niceStep(maxValue) {
  const roughStep = maxValue / 6;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep || 1));
  const normalized = roughStep / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return step * magnitude;
}

const LEGEND_ITEMS = [
  { swatch: 'solid', color: COLORS.blue, label: 'Baseline (master)' },
  { swatch: 'solid', color: COLORS.good, label: 'Faster than baseline' },
  { swatch: 'solid', color: COLORS.critical, label: 'Slower than baseline' },
  { swatch: 'hatch', color: COLORS.good, label: 'New (no baseline yet)' },
];

// Rough (monospace-ish upper bound) text width estimate — good enough to lay
// out legend items and size the canvas without a real font metrics API.
function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.6;
}

function legendWidth(x) {
  let cursorX = x;
  for (const item of LEGEND_ITEMS) {
    cursorX += 20 + estimateTextWidth(item.label, 12) + LEGEND_ITEM_GAP;
  }
  return cursorX;
}

function renderLegend(x, y) {
  let cursorX = x;
  const parts = [];
  for (const item of LEGEND_ITEMS) {
    const fill = item.swatch === 'hatch' ? 'url(#newHatch)' : item.color;
    parts.push(`<rect x="${cursorX}" y="${y}" width="14" height="14" rx="2" fill="${fill}" />`);
    const labelX = cursorX + 20;
    parts.push(`<text x="${labelX}" y="${y + 11}" font-size="12" fill="${COLORS.inkSecondary}" font-family="system-ui, -apple-system, sans-serif">${escapeXml(item.label)}</text>`);
    cursorX = labelX + estimateTextWidth(item.label, 12) + LEGEND_ITEM_GAP;
  }
  return parts.join('\n');
}

function renderPanel({ label, unit, rows, names, originY, maxValue }) {
  const step = niceStep(maxValue);
  const chartMax = Math.ceil((maxValue * 1.18) / step) * step || step;
  const scale = (PANEL_HEIGHT - DELTA_LABEL_SPACE) / chartMax;
  const parts = [];

  parts.push(`<text x="${LEFT_MARGIN - 12}" y="${originY - PANEL_HEIGHT - 10}" font-size="14" font-weight="600" fill="${COLORS.ink}" font-family="system-ui, -apple-system, sans-serif">${escapeXml(label)} (${escapeXml(unit)})</text>`);

  // Gridlines + y-axis ticks.
  for (let tick = 0; tick <= chartMax; tick += step) {
    const y = originY - tick * scale;
    parts.push(`<line x1="${LEFT_MARGIN}" y1="${y}" x2="${LEFT_MARGIN + names.length * BAR_PITCH}" y2="${y}" stroke="${COLORS.gridline}" stroke-width="1" />`);
    parts.push(`<text x="${LEFT_MARGIN - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="${COLORS.inkMuted}" font-family="system-ui, -apple-system, sans-serif">${Math.round(tick)}</text>`);
  }
  parts.push(`<line x1="${LEFT_MARGIN}" y1="${originY}" x2="${LEFT_MARGIN + names.length * BAR_PITCH}" y2="${originY}" stroke="${COLORS.axis}" stroke-width="1.5" />`);

  names.forEach((name, index) => {
    const row = rows.get(name);
    if (!row) return;
    const x = LEFT_MARGIN + index * BAR_PITCH + (BAR_PITCH - BAR_WIDTH) / 2;

    if (row.isNew) {
      const h = row.value * scale;
      parts.push(`<rect x="${x}" y="${originY - h}" width="${BAR_WIDTH}" height="${h}" fill="url(#newHatch)" />`);
      parts.push(`<text x="${x + BAR_WIDTH / 2}" y="${originY - h - 6}" font-size="10" text-anchor="middle" fill="${COLORS.inkSecondary}" font-family="system-ui, -apple-system, sans-serif">new</text>`);
      return;
    }

    const baselineH = row.baseline * scale;
    const valueH = row.value * scale;
    if (row.value <= row.baseline) {
      // Faster: draw the full baseline bar, then repaint the top slice
      // (the saved amount) green — the visible top edge still sits at the
      // baseline height, with the green cap showing what was shaved off.
      parts.push(`<rect x="${x}" y="${originY - valueH}" width="${BAR_WIDTH}" height="${valueH}" fill="${COLORS.blue}" />`);
      parts.push(`<rect x="${x}" y="${originY - baselineH}" width="${BAR_WIDTH}" height="${baselineH - valueH}" fill="${COLORS.good}" />`);
    } else {
      // Slower: draw the full baseline bar, then grow a red cap above it up
      // to the new (taller) value.
      parts.push(`<rect x="${x}" y="${originY - baselineH}" width="${BAR_WIDTH}" height="${baselineH}" fill="${COLORS.blue}" />`);
      parts.push(`<rect x="${x}" y="${originY - valueH}" width="${BAR_WIDTH}" height="${valueH - baselineH}" fill="${COLORS.critical}" />`);
    }

    const pct = row.deltaPct;
    if (pct !== undefined) {
      const topH = Math.max(baselineH, valueH);
      const sign = pct > 0 ? '+' : '';
      const color = pct > 0 ? COLORS.critical : pct < 0 ? COLORS.goodText : COLORS.inkMuted;
      parts.push(`<text x="${x + BAR_WIDTH / 2}" y="${originY - topH - 6}" font-size="10" text-anchor="middle" fill="${color}" font-family="system-ui, -apple-system, sans-serif">${sign}${pct.toFixed(0)}%</text>`);
    }
  });

  return parts.join('\n');
}

// Rotated 90°: each wrapped line is its own vertical strip of text that reads
// top-to-bottom, growing away from the axis; earlier lines sit closer to the
// bar they label so short labels stay tight against it.
function renderXLabels(names, originY) {
  const parts = [];
  names.forEach((name, index) => {
    const x = LEFT_MARGIN + index * BAR_PITCH + BAR_PITCH / 2;
    const lines = wrapLabel(name, 32, 3);
    lines.forEach((line, lineIndex) => {
      const lineX = x + LABEL_LINE_HEIGHT / 2 - lineIndex * LABEL_LINE_HEIGHT;
      const lineY = originY + 10;
      parts.push(`<text x="${lineX}" y="${lineY}" font-size="9.5" fill="${COLORS.inkSecondary}" font-family="system-ui, -apple-system, sans-serif" text-anchor="start" transform="rotate(90, ${lineX}, ${lineY})">${escapeXml(line)}</text>`);
    });
  });
  return parts.join('\n');
}

// suiteTitle: chart headline. metrics: [{ label, unit, entries, baselineByName, emphasize? }],
// sharing one x-axis (`names`, taken from the metric with the most entries so
// every test that has *any* data gets a labeled column, even if a lighter-
// weight metric like elaboration doesn't cover it).
export function renderSuiteChart({ suiteTitle, metrics }) {
  const metricRows = metrics.map((metric) => ({
    ...metric,
    rowsByName: new Map(computeDeltaRows(metric.entries, metric.baselineByName).map((row) => [row.name, row])),
  }));
  const names = [...metricRows].sort((a, b) => b.entries.length - a.entries.length)[0]?.entries.map((e) => e.name) ?? [];

  const barsWidth = LEFT_MARGIN + Math.max(names.length, 1) * BAR_PITCH + RIGHT_MARGIN;
  const width = Math.max(barsWidth, legendWidth(24), estimateTextWidth(suiteTitle, 18) + 48);
  const panelCount = metricRows.length;
  const chartAreaHeight = panelCount * PANEL_HEIGHT + (panelCount - 1) * PANEL_GAP;
  const height = TOP_MARGIN + chartAreaHeight + LABEL_AREA_HEIGHT + 24;

  const panels = [];
  metricRows.forEach((metric, index) => {
    const originY = TOP_MARGIN + PANEL_HEIGHT + index * (PANEL_HEIGHT + PANEL_GAP);
    const maxValue = Math.max(1, ...metric.entries.map((e) => Math.max(e.value, metric.baselineByName.get(e.name) ?? 0)));
    panels.push(renderPanel({ label: metric.label, unit: metric.unit ?? 'ms', rows: metric.rowsByName, names, originY, maxValue }));
  });
  const lastOriginY = TOP_MARGIN + panelCount * PANEL_HEIGHT + (panelCount - 1) * PANEL_GAP;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">
  <defs>
    <pattern id="newHatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="${COLORS.good}" />
      <line x1="0" y1="0" x2="0" y2="8" stroke="${COLORS.surface}" stroke-width="3" />
    </pattern>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="${COLORS.surface}" />
  <text x="24" y="34" font-size="18" font-weight="600" fill="${COLORS.ink}">${escapeXml(suiteTitle)}</text>
  ${renderLegend(24, 52)}
  ${panels.join('\n')}
  ${renderXLabels(names, lastOriginY)}
</svg>`;
}

// Returns markdown for a worst-5/best-5/average delta table, or null when
// there's nothing to compare yet (first run establishing a baseline, or no
// entries at all). Worst/best breakout is only shown once there are enough
// entries with a baseline that the two lists don't just repeat each other in
// reverse order (>10, so a worst-5 and best-5 can't overlap).
export function renderDeltaTableMarkdown(rows) {
  const withBaseline = rows.filter((row) => !row.isNew && row.deltaPct !== undefined);
  if (withBaseline.length === 0) return null;

  const header = '| | test | baseline | new | Δ (nominal) | Δ (%) |\n|---|---|---:|---:|---:|---:|';
  const lines = [header];

  if (withBaseline.length > 10) {
    const byPct = [...withBaseline].sort((a, b) => b.deltaPct - a.deltaPct);
    const worst = byPct.slice(0, 5);
    const best = byPct.slice(-5).reverse();
    const formatRow = (label, row) => {
      const sign = row.deltaMs > 0 ? '+' : '';
      return `| ${label} | ${row.name} | ${row.baseline} | ${row.value} | ${sign}${row.deltaMs} ms | ${sign}${row.deltaPct.toFixed(0)}% |`;
    };
    for (const row of worst) lines.push(formatRow('Worst', row));
    for (const row of best) lines.push(formatRow('Best', row));
  }

  const avgNominal = withBaseline.reduce((sum, row) => sum + row.deltaMs, 0) / withBaseline.length;
  const avgPct = withBaseline.reduce((sum, row) => sum + row.deltaPct, 0) / withBaseline.length;
  const avgSignNominal = avgNominal > 0 ? '+' : '';
  const avgSignPct = avgPct > 0 ? '+' : '';
  lines.push(`| Avg | across ${withBaseline.length} test${withBaseline.length === 1 ? '' : 's'} with a baseline | | | ${avgSignNominal}${avgNominal.toFixed(0)} ms | ${avgSignPct}${avgPct.toFixed(1)}% |`);

  return lines.join('\n');
}

export { COLORS };
