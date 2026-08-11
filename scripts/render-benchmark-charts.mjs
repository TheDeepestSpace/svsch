// Renders per-benchmark-suite bar charts (+ a worst/best delta table) as
// static SVG — no headless browser or charting library, just hand-rolled SVG
// since the output is a flat image embedded in a GitHub PR comment (no
// interactivity possible there anyway). Two chart shapes: a "master vs. this
// run" diff chart (system) and a stacked elaboration+rendering chart
// (visual) — see renderSuiteChart / renderStackedSuiteChart below.
//
// Diff chart palette: blue baseline bar, status-good green / status-critical
// red delta caps, blue-hatched "new" bars for entries with no baseline
// sample yet. Green/red alone fail the colorblind-separation check for a bar
// chart, so every delta also carries a direct % label and a positional cue
// (the cap grows down when faster, up when slower) — never color alone.
// Stacked chart palette: blue elaboration segment, purple rendering segment,
// hatched in the same color when that segment has no baseline yet.
const COLORS = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  inkMuted: '#898781',
  gridline: '#e1e0d9',
  axis: '#c3c2b7',
  blue: '#2a78d6',
  purple: '#7c4dcc',
  good: '#0ca30c',
  goodText: '#006300',
  critical: '#d03b3b',
};

// Bars fill the whole plot width regardless of how many there are — a
// 3-entry chart gets three wide bars instead of three skinny ones stranded in
// empty space, and an 80-entry chart gets 80 hairline bars instead of being
// truncated. BAR_WIDTH_FRACTION is how much of each bar's slot the bar itself
// occupies (the rest is gap); MIN_BAR_WIDTH is a floor so a bar never
// disappears to 0px even when there are hundreds of entries.
const BAR_WIDTH_FRACTION = 0.72;
const MIN_BAR_WIDTH = 1;
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

// "New" (no baseline yet) entries are drawn hatched rather than solid — a
// texture cue rather than relying on color alone — recolored per chart: blue
// for the system suite's single baseline-diff bar, blue/purple (matching the
// solid segment they stand in for) on the visual suite's stacked bar.
const DIFF_LEGEND_ITEMS = [
  { fill: COLORS.blue, label: 'Baseline (master)' },
  { fill: COLORS.good, label: 'Faster than baseline' },
  { fill: COLORS.critical, label: 'Slower than baseline' },
  { fill: 'url(#newHatch)', label: 'New (no baseline yet)' },
];

const STACKED_LEGEND_ITEMS = [
  { fill: COLORS.blue, label: 'Elaboration' },
  { fill: COLORS.purple, label: 'Rendering' },
  { fill: 'url(#newHatchBlue)', label: 'Elaboration (new)' },
  { fill: 'url(#newHatchPurple)', label: 'Rendering (new)' },
];

// Rough (monospace-ish upper bound) text width estimate — good enough to lay
// out legend items and size the canvas without a real font metrics API.
function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.6;
}

function legendWidth(x, items) {
  let cursorX = x;
  for (const item of items) {
    cursorX += 20 + estimateTextWidth(item.label, 12) + LEGEND_ITEM_GAP;
  }
  return cursorX;
}

function renderLegend(x, y, items) {
  let cursorX = x;
  const parts = [];
  for (const item of items) {
    parts.push(`<rect x="${cursorX}" y="${y}" width="14" height="14" rx="2" fill="${item.fill}" />`);
    const labelX = cursorX + 20;
    parts.push(`<text x="${labelX}" y="${y + 11}" font-size="12" fill="${COLORS.inkSecondary}" font-family="system-ui, -apple-system, sans-serif">${escapeXml(item.label)}</text>`);
    cursorX = labelX + estimateTextWidth(item.label, 12) + LEGEND_ITEM_GAP;
  }
  return parts.join('\n');
}

function renderPanel({ label, unit, rows, names, originY, maxValue, barWidth, barPitch, annotate }) {
  const step = niceStep(maxValue);
  const chartMax = Math.ceil((maxValue * 1.18) / step) * step || step;
  const scale = (PANEL_HEIGHT - DELTA_LABEL_SPACE) / chartMax;
  const parts = [];
  const plotWidth = names.length * barPitch;

  parts.push(`<text x="${LEFT_MARGIN - 12}" y="${originY - PANEL_HEIGHT - 10}" font-size="14" font-weight="600" fill="${COLORS.ink}" font-family="system-ui, -apple-system, sans-serif">${escapeXml(label)} (${escapeXml(unit)})</text>`);

  // Gridlines + y-axis ticks.
  for (let tick = 0; tick <= chartMax; tick += step) {
    const y = originY - tick * scale;
    parts.push(`<line x1="${LEFT_MARGIN}" y1="${y}" x2="${LEFT_MARGIN + plotWidth}" y2="${y}" stroke="${COLORS.gridline}" stroke-width="1" />`);
    parts.push(`<text x="${LEFT_MARGIN - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="${COLORS.inkMuted}" font-family="system-ui, -apple-system, sans-serif">${Math.round(tick)}</text>`);
  }
  parts.push(`<line x1="${LEFT_MARGIN}" y1="${originY}" x2="${LEFT_MARGIN + plotWidth}" y2="${originY}" stroke="${COLORS.axis}" stroke-width="1.5" />`);

  names.forEach((name, index) => {
    const row = rows.get(name);
    if (!row) return;
    const x = LEFT_MARGIN + index * barPitch + (barPitch - barWidth) / 2;

    if (row.isNew) {
      const h = row.value * scale;
      parts.push(`<rect x="${x}" y="${originY - h}" width="${barWidth}" height="${h}" fill="url(#newHatch)" />`);
      if (annotate) {
        parts.push(`<text x="${x + barWidth / 2}" y="${originY - h - 6}" font-size="10" text-anchor="middle" fill="${COLORS.inkSecondary}" font-family="system-ui, -apple-system, sans-serif">new</text>`);
      }
      return;
    }

    const baselineH = row.baseline * scale;
    const valueH = row.value * scale;
    if (row.value <= row.baseline) {
      // Faster: draw the full baseline bar, then repaint the top slice
      // (the saved amount) green — the visible top edge still sits at the
      // baseline height, with the green cap showing what was shaved off.
      parts.push(`<rect x="${x}" y="${originY - valueH}" width="${barWidth}" height="${valueH}" fill="${COLORS.blue}" />`);
      parts.push(`<rect x="${x}" y="${originY - baselineH}" width="${barWidth}" height="${baselineH - valueH}" fill="${COLORS.good}" />`);
    } else {
      // Slower: draw the full baseline bar, then grow a red cap above it up
      // to the new (taller) value.
      parts.push(`<rect x="${x}" y="${originY - baselineH}" width="${barWidth}" height="${baselineH}" fill="${COLORS.blue}" />`);
      parts.push(`<rect x="${x}" y="${originY - valueH}" width="${barWidth}" height="${valueH - baselineH}" fill="${COLORS.critical}" />`);
    }

    const pct = row.deltaPct;
    if (annotate && pct !== undefined) {
      const topH = Math.max(baselineH, valueH);
      const sign = pct > 0 ? '+' : '';
      const color = pct > 0 ? COLORS.critical : pct < 0 ? COLORS.goodText : COLORS.inkMuted;
      parts.push(`<text x="${x + barWidth / 2}" y="${originY - topH - 6}" font-size="10" text-anchor="middle" fill="${color}" font-family="system-ui, -apple-system, sans-serif">${sign}${pct.toFixed(0)}%</text>`);
    }
  });

  return parts.join('\n');
}

// Rotated 90°: each wrapped line is its own vertical strip of text that reads
// top-to-bottom, growing away from the axis; earlier lines sit closer to the
// bar they label so short labels stay tight against it.
function renderXLabels(names, originY, barPitch) {
  const parts = [];
  names.forEach((name, index) => {
    const x = LEFT_MARGIN + index * barPitch + barPitch / 2;
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
// sharing one x-axis (`names`, the ordered union of every metric's entry
// names so every test that has *any* data gets a labeled column, even if a
// lighter-weight metric like elaboration doesn't cover it). showLabels turns
// off x-axis names and per-bar value text — for suites with too many entries
// to label legibly, showing every bar (however thin) beats showing a legible
// label on a truncated subset of them.
export function renderSuiteChart({ suiteTitle, metrics, showLabels = true }) {
  const metricRows = metrics.map((metric) => ({
    ...metric,
    rowsByName: new Map(computeDeltaRows(metric.entries, metric.baselineByName).map((row) => [row.name, row])),
  }));
  const names = [...new Set(metricRows.flatMap((metric) => metric.entries.map((entry) => entry.name)))];

  const width = Math.max(legendWidth(24, DIFF_LEGEND_ITEMS), estimateTextWidth(suiteTitle, 18) + 48);
  const barPitch = Math.max(width - LEFT_MARGIN - RIGHT_MARGIN, 1) / Math.max(names.length, 1);
  const barWidth = Math.max(MIN_BAR_WIDTH, barPitch * BAR_WIDTH_FRACTION);
  const panelCount = metricRows.length;
  const chartAreaHeight = panelCount * PANEL_HEIGHT + (panelCount - 1) * PANEL_GAP;
  const labelAreaHeight = showLabels ? LABEL_AREA_HEIGHT : 0;
  const height = TOP_MARGIN + chartAreaHeight + labelAreaHeight + 24;

  const panels = [];
  metricRows.forEach((metric, index) => {
    const originY = TOP_MARGIN + PANEL_HEIGHT + index * (PANEL_HEIGHT + PANEL_GAP);
    const maxValue = Math.max(1, ...metric.entries.map((e) => Math.max(e.value, metric.baselineByName.get(e.name) ?? 0)));
    panels.push(renderPanel({ label: metric.label, unit: metric.unit ?? 'ms', rows: metric.rowsByName, names, originY, maxValue, barWidth, barPitch, annotate: showLabels }));
  });
  const lastOriginY = TOP_MARGIN + panelCount * PANEL_HEIGHT + (panelCount - 1) * PANEL_GAP;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">
  <defs>
    <pattern id="newHatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="${COLORS.blue}" />
      <line x1="0" y1="0" x2="0" y2="8" stroke="${COLORS.surface}" stroke-width="3" />
    </pattern>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="${COLORS.surface}" />
  <text x="24" y="34" font-size="18" font-weight="600" fill="${COLORS.ink}">${escapeXml(suiteTitle)}</text>
  ${renderLegend(24, 52, DIFF_LEGEND_ITEMS)}
  ${panels.join('\n')}
  ${showLabels ? renderXLabels(names, lastOriginY, barPitch) : ''}
</svg>`;
}

// Shared by renderStackedSuiteChart and the CSV export (comment-benchmark-summary.mjs)
// so the CSV's row order always matches the chart's left-to-right bar order:
// fastest-to-slowest by total (elaboration + rendering), not by name.
export function computeStackedData(metrics) {
  const [elaboration, rendering] = metrics;
  const elabRows = new Map(computeDeltaRows(elaboration.entries, elaboration.baselineByName).map((row) => [row.name, row]));
  const renderRows = new Map(computeDeltaRows(rendering.entries, rendering.baselineByName).map((row) => [row.name, row]));
  const totalFor = (name) => (elabRows.get(name)?.value ?? 0) + (renderRows.get(name)?.value ?? 0);
  const names = [...new Set([...elabRows.keys(), ...renderRows.keys()])].sort((a, b) => totalFor(a) - totalFor(b));
  return { elabRows, renderRows, names };
}

// Visual suite's chart: one stacked bar per test instead of two separate
// baseline-diff panels — elaboration segment stacked first (blue), rendering
// stacked on top (purple), so the bar height reads as total diagram-open
// time. Sorted fastest-to-slowest by that total (not by name) so the shape
// of the distribution is visible left-to-right. A segment with no baseline
// yet (first time this test's elaboration/rendering ran) is hatched instead
// of solid, in the same color as its solid counterpart — a test can gain a
// baseline for one half before the other, so "new" is tracked per segment.
export function renderStackedSuiteChart({ suiteTitle, metrics, showLabels = true }) {
  const { elabRows, renderRows, names } = computeStackedData(metrics);

  const width = Math.max(legendWidth(24, STACKED_LEGEND_ITEMS), estimateTextWidth(suiteTitle, 18) + 48);
  const barPitch = Math.max(width - LEFT_MARGIN - RIGHT_MARGIN, 1) / Math.max(names.length, 1);
  const barWidth = Math.max(MIN_BAR_WIDTH, barPitch * BAR_WIDTH_FRACTION);
  const labelAreaHeight = showLabels ? LABEL_AREA_HEIGHT : 0;
  const height = TOP_MARGIN + PANEL_HEIGHT + labelAreaHeight + 24;
  const originY = TOP_MARGIN + PANEL_HEIGHT;
  const plotWidth = names.length * barPitch;

  const maxValue = Math.max(1, ...names.map((name) => (elabRows.get(name)?.value ?? 0) + (renderRows.get(name)?.value ?? 0)));
  const step = niceStep(maxValue);
  const chartMax = Math.ceil((maxValue * 1.18) / step) * step || step;
  const scale = (PANEL_HEIGHT - DELTA_LABEL_SPACE) / chartMax;

  const parts = [];
  parts.push(`<text x="${LEFT_MARGIN - 12}" y="${originY - PANEL_HEIGHT - 10}" font-size="14" font-weight="600" fill="${COLORS.ink}" font-family="system-ui, -apple-system, sans-serif">Elaboration + rendering duration (ms)</text>`);

  for (let tick = 0; tick <= chartMax; tick += step) {
    const y = originY - tick * scale;
    parts.push(`<line x1="${LEFT_MARGIN}" y1="${y}" x2="${LEFT_MARGIN + plotWidth}" y2="${y}" stroke="${COLORS.gridline}" stroke-width="1" />`);
    parts.push(`<text x="${LEFT_MARGIN - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="${COLORS.inkMuted}" font-family="system-ui, -apple-system, sans-serif">${Math.round(tick)}</text>`);
  }
  parts.push(`<line x1="${LEFT_MARGIN}" y1="${originY}" x2="${LEFT_MARGIN + plotWidth}" y2="${originY}" stroke="${COLORS.axis}" stroke-width="1.5" />`);

  names.forEach((name, index) => {
    const x = LEFT_MARGIN + index * barPitch + (barPitch - barWidth) / 2;
    const elabRow = elabRows.get(name);
    const renderRow = renderRows.get(name);
    const elabH = (elabRow?.value ?? 0) * scale;
    const renderH = (renderRow?.value ?? 0) * scale;

    if (elabRow) {
      const fill = elabRow.isNew ? 'url(#newHatchBlue)' : COLORS.blue;
      parts.push(`<rect x="${x}" y="${originY - elabH}" width="${barWidth}" height="${elabH}" fill="${fill}" />`);
    }
    if (renderRow) {
      const fill = renderRow.isNew ? 'url(#newHatchPurple)' : COLORS.purple;
      parts.push(`<rect x="${x}" y="${originY - elabH - renderH}" width="${barWidth}" height="${renderH}" fill="${fill}" />`);
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">
  <defs>
    <pattern id="newHatchBlue" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="${COLORS.blue}" />
      <line x1="0" y1="0" x2="0" y2="8" stroke="${COLORS.surface}" stroke-width="3" />
    </pattern>
    <pattern id="newHatchPurple" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="${COLORS.purple}" />
      <line x1="0" y1="0" x2="0" y2="8" stroke="${COLORS.surface}" stroke-width="3" />
    </pattern>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="${COLORS.surface}" />
  <text x="24" y="34" font-size="18" font-weight="600" fill="${COLORS.ink}">${escapeXml(suiteTitle)}</text>
  ${renderLegend(24, 52, STACKED_LEGEND_ITEMS)}
  ${parts.join('\n')}
  ${showLabels ? renderXLabels(names, originY, barPitch) : ''}
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

// Full per-entry data as CSV — the complete dataset behind a chart that drops
// labels/per-bar text to stay legible with many entries (unlike the delta
// table above, which only ever shows a worst-5/best-5 slice).
export function renderDeltaCsv(rows) {
  const csvField = (value) => {
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = ['name', 'unit', 'baseline', 'value', 'delta_ms', 'delta_pct', 'is_new'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push([
      row.name,
      row.unit,
      row.baseline ?? '',
      row.value,
      row.deltaMs ?? '',
      row.deltaPct !== undefined ? row.deltaPct.toFixed(2) : '',
      row.isNew ? 'true' : 'false',
    ].map(csvField).join(','));
  }
  return lines.join('\n') + '\n';
}

export { COLORS };
