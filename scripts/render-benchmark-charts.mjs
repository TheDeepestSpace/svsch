// Renders per-benchmark-suite bar charts (+ a worst/best delta table) as
// static SVG — no headless browser or charting library, just hand-rolled SVG
// since the output is a flat image embedded in a GitHub PR comment (no
// interactivity possible there anyway). Stacked elaboration+rendering chart
// (visual) — see renderStackedSuiteChart below.
//
// Stacked chart palette: blue elaboration segment, purple rendering segment,
// hatched in the same color when that segment has no baseline yet. Each
// segment's baseline-vs-current diff is drawn with status-good green /
// status-critical red caps — green/red alone fail the colorblind-separation
// check for a bar chart, so every delta also carries a direct % label and a
// positional cue (the cap grows down when faster, up when slower) — never
// color alone.
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
  kept[lastIndex] =
    combined.length > maxCharsPerLine ? `${combined.slice(0, maxCharsPerLine - 1)}…` : combined;
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

// Derives the historical per-master-run averages directly from
// github-action-benchmark's own gh-pages payload (dev/bench/data.js) rather
// than a separately maintained file — every master push already appends one
// entry per tracked suite there (see the `auto-push` steps in ci.yml), so
// this just re-shapes that data into the {sha, date, elaborationAvgMs,
// renderingAvgMs} points the trend chart wants. Entries are matched across
// suites by commit id (both are tracked in the same job run, so a push that
// recorded one recorded the other) and any commit missing one side is
// dropped rather than plotted with a gap.
export function computeBenchmarkHistory(benchmarkData) {
  const elaborationEntries =
    benchmarkData?.entries?.['visual-elaboration-diagram-generation-duration'] ?? [];
  const renderingByCommit = new Map(
    (benchmarkData?.entries?.['visual-rendering-diagram-generation-duration'] ?? []).map(
      (entry) => [entry.commit.id, entry],
    ),
  );
  const average = (benches) => benches.reduce((sum, bench) => sum + bench.value, 0) / benches.length;
  return elaborationEntries
    .filter((entry) => renderingByCommit.has(entry.commit.id))
    .map((entry) => ({
      sha: entry.commit.id,
      date: new Date(entry.date).toISOString(),
      elaborationAvgMs: average(entry.benches),
      renderingAvgMs: average(renderingByCommit.get(entry.commit.id).benches),
    }));
}

// Joins each current-run entry with its baseline (if any) into the shape both
// the chart and the delta table consume.
export function computeDeltaRows(entries, baselineByName) {
  return entries.map((entry) => {
    const baseline = baselineByName.get(entry.name);
    if (baseline === undefined) {
      return {
        name: entry.name,
        value: entry.value,
        unit: entry.unit,
        baseline: undefined,
        deltaMs: undefined,
        deltaPct: undefined,
        isNew: true,
      };
    }
    const deltaMs = entry.value - baseline;
    const deltaPct = baseline === 0 ? undefined : (deltaMs / baseline) * 100;
    return {
      name: entry.name,
      value: entry.value,
      unit: entry.unit,
      baseline,
      deltaMs,
      deltaPct,
      isNew: false,
    };
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
// texture cue rather than relying on color alone — colored to match the
// solid segment they stand in for on the visual suite's stacked bar.
const STACKED_LEGEND_ITEMS = [
  { fill: COLORS.blue, label: 'Elaboration' },
  { fill: COLORS.purple, label: 'Rendering' },
  { fill: COLORS.good, label: 'Faster than baseline' },
  { fill: COLORS.critical, label: 'Slower than baseline' },
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
    parts.push(
      `<rect x="${cursorX}" y="${y}" width="14" height="14" rx="2" fill="${item.fill}" />`,
    );
    const labelX = cursorX + 20;
    parts.push(
      `<text x="${labelX}" y="${y + 11}" font-size="12" fill="${COLORS.inkSecondary}" font-family="system-ui, -apple-system, sans-serif">${escapeXml(item.label)}</text>`,
    );
    cursorX = labelX + estimateTextWidth(item.label, 12) + LEGEND_ITEM_GAP;
  }
  return parts.join('\n');
}

// Draws one baseline-vs-current bar segment (a solid bar up to whichever of
// baseline/value is shorter, capped in green/red up to whichever is taller)
// anchored at `baseY` — the bottom of *this* segment, not necessarily the
// chart's own origin. That indirection is what lets renderStackedSuiteChart
// reuse this for a second segment stacked on top of the first: it just
// passes the first segment's returned `top` back in as the second's `baseY`
// offset. Returns the segment's own rendered height (px) so the caller can
// do that stacking (or place an annotation above a single segment).
function renderDiffSegment({ x, width, baseY, row, scale, solidFill, hatchFill }) {
  if (!row) return { parts: [], top: 0 };

  if (row.isNew) {
    const h = row.value * scale;
    return {
      parts: [
        `<rect x="${x}" y="${baseY - h}" width="${width}" height="${h}" fill="${hatchFill}" />`,
      ],
      top: h,
    };
  }

  const baselineH = row.baseline * scale;
  const valueH = row.value * scale;
  const parts = [];
  if (row.value <= row.baseline) {
    // Faster: draw the full baseline bar, then repaint the top slice
    // (the saved amount) green — the visible top edge still sits at the
    // baseline height, with the green cap showing what was shaved off.
    parts.push(
      `<rect x="${x}" y="${baseY - valueH}" width="${width}" height="${valueH}" fill="${solidFill}" />`,
    );
    parts.push(
      `<rect x="${x}" y="${baseY - baselineH}" width="${width}" height="${baselineH - valueH}" fill="${COLORS.good}" />`,
    );
  } else {
    // Slower: draw the full baseline bar, then grow a red cap above it up
    // to the new (taller) value.
    parts.push(
      `<rect x="${x}" y="${baseY - baselineH}" width="${width}" height="${baselineH}" fill="${solidFill}" />`,
    );
    parts.push(
      `<rect x="${x}" y="${baseY - valueH}" width="${width}" height="${valueH - baselineH}" fill="${COLORS.critical}" />`,
    );
  }
  return { parts, top: Math.max(baselineH, valueH) };
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
      parts.push(
        `<text x="${lineX}" y="${lineY}" font-size="9.5" fill="${COLORS.inkSecondary}" font-family="system-ui, -apple-system, sans-serif" text-anchor="start" transform="rotate(90, ${lineX}, ${lineY})">${escapeXml(line)}</text>`,
      );
    });
  });
  return parts.join('\n');
}

// Shared by renderStackedSuiteChart and the CSV export (comment-benchmark-summary.mjs)
// so the CSV's row order always matches the chart's left-to-right bar order:
// fastest-to-slowest by total (elaboration + rendering), not by name.
export function computeStackedData(metrics) {
  const [elaboration, rendering] = metrics;
  const elabRows = new Map(
    computeDeltaRows(elaboration.entries, elaboration.baselineByName).map((row) => [row.name, row]),
  );
  const renderRows = new Map(
    computeDeltaRows(rendering.entries, rendering.baselineByName).map((row) => [row.name, row]),
  );
  const totalFor = (name) => (elabRows.get(name)?.value ?? 0) + (renderRows.get(name)?.value ?? 0);
  const names = [...new Set([...elabRows.keys(), ...renderRows.keys()])].sort(
    (a, b) => totalFor(a) - totalFor(b),
  );
  return { elabRows, renderRows, names };
}

// Visual suite's chart: one stacked bar per test instead of two separate
// baseline-diff panels — elaboration segment stacked first (blue), rendering
// stacked on top (purple), so the bar height reads as total diagram-open
// time. Sorted fastest-to-slowest by current-run total (not by name) so the
// shape of the distribution is visible left-to-right. Each segment carries
// its own baseline-vs-current diff (renderDiffSegment) — a green/red cap —
// so a slowdown in just one half (e.g. rendering regresses while elaboration
// doesn't) is still visible rather than being averaged away into the
// combined bar height. A segment with no
// baseline yet (first time this test's elaboration/rendering ran) is hatched
// instead of solid, in the same color as its solid counterpart — a test can
// gain a baseline for one half before the other, so "new" is tracked per
// segment.
export function renderStackedSuiteChart({ suiteTitle, metrics, showLabels = true }) {
  const { elabRows, renderRows, names } = computeStackedData(metrics);

  const width = Math.max(
    legendWidth(24, STACKED_LEGEND_ITEMS),
    estimateTextWidth(suiteTitle, 18) + 48,
  );
  const barPitch = Math.max(width - LEFT_MARGIN - RIGHT_MARGIN, 1) / Math.max(names.length, 1);
  const barWidth = Math.max(MIN_BAR_WIDTH, barPitch * BAR_WIDTH_FRACTION);
  const labelAreaHeight = showLabels ? LABEL_AREA_HEIGHT : 0;
  const height = TOP_MARGIN + PANEL_HEIGHT + labelAreaHeight + 24;
  const originY = TOP_MARGIN + PANEL_HEIGHT;
  const plotWidth = names.length * barPitch;

  // A segment's rendered top is max(baseline, value) — same as the diff
  // chart's single bar — since a "slower" cap grows past the current value
  // while a "faster" cap grows past it up to the (taller) baseline.
  const diffTop = (row) => (!row ? 0 : row.isNew ? row.value : Math.max(row.baseline, row.value));
  const maxValue = Math.max(
    1,
    ...names.map((name) => diffTop(elabRows.get(name)) + diffTop(renderRows.get(name))),
  );
  const step = niceStep(maxValue);
  const chartMax = Math.ceil((maxValue * 1.18) / step) * step || step;
  const scale = (PANEL_HEIGHT - DELTA_LABEL_SPACE) / chartMax;

  const parts = [];
  parts.push(
    `<text x="${LEFT_MARGIN - 12}" y="${originY - PANEL_HEIGHT - 10}" font-size="14" font-weight="600" fill="${COLORS.ink}" font-family="system-ui, -apple-system, sans-serif">Elaboration + rendering duration (ms)</text>`,
  );

  for (let tick = 0; tick <= chartMax; tick += step) {
    const y = originY - tick * scale;
    parts.push(
      `<line x1="${LEFT_MARGIN}" y1="${y}" x2="${LEFT_MARGIN + plotWidth}" y2="${y}" stroke="${COLORS.gridline}" stroke-width="1" />`,
    );
    parts.push(
      `<text x="${LEFT_MARGIN - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="${COLORS.inkMuted}" font-family="system-ui, -apple-system, sans-serif">${Math.round(tick)}</text>`,
    );
  }
  parts.push(
    `<line x1="${LEFT_MARGIN}" y1="${originY}" x2="${LEFT_MARGIN + plotWidth}" y2="${originY}" stroke="${COLORS.axis}" stroke-width="1.5" />`,
  );

  // Elaboration is drawn as its own baseline-vs-current diff segment
  // (renderDiffSegment), then rendering stacks on top starting from wherever
  // the elaboration segment actually topped out — so each half's own
  // faster/slower-than-baseline cap is visible, not just the combined total.
  names.forEach((name, index) => {
    const x = LEFT_MARGIN + index * barPitch + (barPitch - barWidth) / 2;
    const elabRow = elabRows.get(name);
    const renderRow = renderRows.get(name);

    const elab = renderDiffSegment({
      x,
      width: barWidth,
      baseY: originY,
      row: elabRow,
      scale,
      solidFill: COLORS.blue,
      hatchFill: 'url(#newHatchBlue)',
    });
    parts.push(...elab.parts);

    const render = renderDiffSegment({
      x,
      width: barWidth,
      baseY: originY - elab.top,
      row: renderRow,
      scale,
      solidFill: COLORS.purple,
      hatchFill: 'url(#newHatchPurple)',
    });
    parts.push(...render.parts);
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
// Average nominal/pct delta across every row with a baseline, or null when
// none have one yet (first run establishing a baseline). Shared by the
// top-of-report summary line and the per-suite delta table's own "Avg" row
// so the two can never disagree.
export function computeAverageDelta(rows) {
  const withBaseline = rows.filter((row) => !row.isNew && row.deltaPct !== undefined);
  if (withBaseline.length === 0) return null;
  const avgNominal = withBaseline.reduce((sum, row) => sum + row.deltaMs, 0) / withBaseline.length;
  const avgPct = withBaseline.reduce((sum, row) => sum + row.deltaPct, 0) / withBaseline.length;
  return { avgNominal, avgPct, count: withBaseline.length };
}

export function renderDeltaTableMarkdown(rows) {
  const avg = computeAverageDelta(rows);
  if (!avg) return null;
  const withBaseline = rows.filter((row) => !row.isNew && row.deltaPct !== undefined);

  // Worst/Best is folded into a bold prefix on the test name (rather than its
  // own leading column), the two delta figures share one column, and base/new
  // now share a column too ("174 → 240") — three data columns next to the
  // wide test column leaves each one real room instead of getting squeezed
  // down to character-by-character wrapping on narrow viewports (GitHub
  // mobile in particular).
  const header = '| test | base → new | Δ |\n|---|---:|---:|';
  const lines = [header];

  if (withBaseline.length > 10) {
    const byPct = [...withBaseline].sort((a, b) => b.deltaPct - a.deltaPct);
    const worst = byPct.slice(0, 5);
    const best = byPct.slice(-5).reverse();
    const formatRow = (label, row) => {
      const sign = row.deltaMs > 0 ? '+' : '';
      return `| **${label}** — ${escapeMarkdownCell(row.name)} | ${row.baseline} → ${row.value} | ${sign}${row.deltaMs} ms (${sign}${row.deltaPct.toFixed(0)}%) |`;
    };
    for (const row of worst) lines.push(formatRow('Worst', row));
    for (const row of best) lines.push(formatRow('Best', row));
  }

  const avgSignNominal = avg.avgNominal > 0 ? '+' : '';
  const avgSignPct = avg.avgPct > 0 ? '+' : '';
  lines.push(`| **Avg** — across ${avg.count} test${avg.count === 1 ? '' : 's'} with a baseline | | ${avgSignNominal}${avg.avgNominal.toFixed(0)} ms (${avgSignPct}${avg.avgPct.toFixed(1)}%) |`);

  return lines.join('\n');
}

// Line-chart trend data prep: turns persisted history (oldest→newest, as
// computed by computeBenchmarkHistory) plus the current — not yet merged —
// PR run's averages into the ordered point list both
// renderHistoryTrendChart and its tests consume, so "which point is the PR
// preview" can never disagree between them.
export function computeHistoryTrendData(history, currentRunAverages) {
  const points = history.map((entry) => ({
    label: entry.sha.slice(0, 7),
    elaborationAvgMs: entry.elaborationAvgMs,
    renderingAvgMs: entry.renderingAvgMs,
    isCurrent: false,
  }));
  points.push({
    label: 'this PR',
    elaborationAvgMs: currentRunAverages.elaborationAvgMs,
    renderingAvgMs: currentRunAverages.renderingAvgMs,
    isCurrent: true,
  });
  return points;
}

const TREND_LEFT_MARGIN = 60;
const TREND_RIGHT_MARGIN = 24;
const TREND_TOP_MARGIN = 92;
const TREND_PANEL_HEIGHT = 220;
const TREND_LABEL_AREA_HEIGHT = 40;
const TREND_POINT_PITCH = 64;
const TREND_LEGEND_ITEMS = [
  { fill: COLORS.blue, label: 'Elaboration avg' },
  { fill: COLORS.purple, label: 'Rendering avg' },
];

// One line per metric (elaboration, rendering) across every recorded master
// run, each point a filled dot; the final segment — into the current, not
// yet merged, PR run — is dashed and its point drawn hollow rather than
// filled, the same "texture cue, not color alone" convention the stacked
// chart above uses for its own "new" bars, so the preview point reads as
// unconfirmed even in grayscale.
export function renderHistoryTrendChart({ title, history, currentRunAverages }) {
  const points = computeHistoryTrendData(history, currentRunAverages);
  const plotWidth = Math.max((points.length - 1) * TREND_POINT_PITCH, TREND_POINT_PITCH);
  const width = Math.max(
    TREND_LEFT_MARGIN + plotWidth + TREND_RIGHT_MARGIN,
    legendWidth(24, TREND_LEGEND_ITEMS),
    estimateTextWidth(title, 18) + 48
  );
  const height = TREND_TOP_MARGIN + TREND_PANEL_HEIGHT + TREND_LABEL_AREA_HEIGHT;
  const originY = TREND_TOP_MARGIN + TREND_PANEL_HEIGHT;

  const maxValue = Math.max(1, ...points.flatMap((p) => [p.elaborationAvgMs, p.renderingAvgMs]));
  const step = niceStep(maxValue);
  const chartMax = Math.ceil((maxValue * 1.18) / step) * step || step;
  const scale = TREND_PANEL_HEIGHT / chartMax;

  const xFor = (index) => (points.length <= 1
    ? TREND_LEFT_MARGIN + plotWidth / 2
    : TREND_LEFT_MARGIN + (index / (points.length - 1)) * plotWidth);
  const yFor = (value) => originY - value * scale;

  const parts = [];
  parts.push(`<text x="${TREND_LEFT_MARGIN - 12}" y="${originY - TREND_PANEL_HEIGHT - 10}" font-size="14" font-weight="600" fill="${COLORS.ink}" font-family="system-ui, -apple-system, sans-serif">Average duration per master run (ms) — dashed segment is this PR, not yet merged</text>`);

  for (let tick = 0; tick <= chartMax; tick += step) {
    const y = originY - tick * scale;
    parts.push(`<line x1="${TREND_LEFT_MARGIN}" y1="${y}" x2="${TREND_LEFT_MARGIN + plotWidth}" y2="${y}" stroke="${COLORS.gridline}" stroke-width="1" />`);
    parts.push(`<text x="${TREND_LEFT_MARGIN - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="${COLORS.inkMuted}" font-family="system-ui, -apple-system, sans-serif">${Math.round(tick)}</text>`);
  }
  parts.push(`<line x1="${TREND_LEFT_MARGIN}" y1="${originY}" x2="${TREND_LEFT_MARGIN + plotWidth}" y2="${originY}" stroke="${COLORS.axis}" stroke-width="1.5" />`);

  const drawSeries = (key, color) => {
    for (let i = 0; i < points.length - 1; i += 1) {
      const isPreviewSegment = points[i + 1].isCurrent;
      const x1 = xFor(i);
      const y1 = yFor(points[i][key]);
      const x2 = xFor(i + 1);
      const y2 = yFor(points[i + 1][key]);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" ${isPreviewSegment ? 'stroke-dasharray="5,4"' : ''} />`);
    }
    points.forEach((p, i) => {
      const x = xFor(i);
      const y = yFor(p[key]);
      if (p.isCurrent) {
        parts.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="${COLORS.surface}" stroke="${color}" stroke-width="2" />`);
      } else {
        parts.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" />`);
      }
    });
  };
  drawSeries('elaborationAvgMs', COLORS.blue);
  drawSeries('renderingAvgMs', COLORS.purple);

  const labelParts = points.map((p, i) => {
    const x = xFor(i);
    const label = p.isCurrent ? 'this PR' : p.label;
    return `<text x="${x}" y="${originY + 16}" font-size="10" text-anchor="middle" fill="${p.isCurrent ? COLORS.ink : COLORS.inkSecondary}" font-family="system-ui, -apple-system, sans-serif" font-weight="${p.isCurrent ? '600' : '400'}">${escapeXml(label)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${COLORS.surface}" />
  <text x="24" y="34" font-size="18" font-weight="600" fill="${COLORS.ink}">${escapeXml(title)}</text>
  ${renderLegend(24, 52, TREND_LEGEND_ITEMS)}
  ${parts.join('\n')}
  ${labelParts.join('\n')}
</svg>`;
}

// Benchmark names come from spec filenames and test titles (see
// test/visual/helper.ts), which a PR can control — escape table-breaking
// pipes/newlines and Markdown link/image syntax before embedding them in a
// PR comment.
function escapeMarkdownCell(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replace(/\r?\n/g, ' ');
}

function csvField(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Full per-entry data as CSV — the complete dataset behind a chart that drops
// labels/per-bar text to stay legible with many entries (unlike the delta
// table above, which only ever shows a worst-5/best-5 slice).
export function renderDeltaCsv(rows) {
  const header = ['name', 'unit', 'baseline', 'value', 'delta_ms', 'delta_pct', 'is_new'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.unit,
        row.baseline ?? '',
        row.value,
        row.deltaMs ?? '',
        row.deltaPct !== undefined ? row.deltaPct.toFixed(2) : '',
        row.isNew ? 'true' : 'false',
      ]
        .map(csvField)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

// One CSV row per test covering both stacked-chart segments (elaboration +
// rendering) instead of a separate file per segment, since a test's total
// diagram-open time — the thing the stacked chart actually visualizes — only
// exists when both halves sit side by side. Ordered fastest-to-slowest by
// that total, same as computeStackedData/the chart itself, so this file and
// the chart it backs never disagree on row order.
export function renderStackedCsv(metrics) {
  const { elabRows, renderRows, names } = computeStackedData(metrics);
  const metricFields = (row) => [
    row?.unit ?? '',
    row?.baseline ?? '',
    row?.value ?? '',
    row?.deltaMs ?? '',
    row?.deltaPct !== undefined ? row.deltaPct.toFixed(2) : '',
    row ? (row.isNew ? 'true' : 'false') : '',
  ];

  const header = [
    'name',
    'elaboration_unit',
    'elaboration_baseline',
    'elaboration_value',
    'elaboration_delta_ms',
    'elaboration_delta_pct',
    'elaboration_is_new',
    'rendering_unit',
    'rendering_baseline',
    'rendering_value',
    'rendering_delta_ms',
    'rendering_delta_pct',
    'rendering_is_new',
    'total_value',
  ];
  const lines = [header.join(',')];
  for (const name of names) {
    const elabRow = elabRows.get(name);
    const renderRow = renderRows.get(name);
    const totalValue = (elabRow?.value ?? 0) + (renderRow?.value ?? 0);
    lines.push(
      [name, ...metricFields(elabRow), ...metricFields(renderRow), totalValue]
        .map(csvField)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export { COLORS };
