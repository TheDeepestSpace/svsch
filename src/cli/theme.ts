export type SvgThemeName = 'dark' | 'light';

interface BaseTheme {
  editorBackground: string;
  editorWidgetBackground: string;
  foreground: string;
  mutedForeground: string;
  chartsBlue: string;
  chartsGreen: string;
  chartsRed: string;
  chartsPurple: string;
  chartsOrange: string;
  chartsYellow: string;
}

const baseThemes: Record<SvgThemeName, BaseTheme> = {
  dark: {
    editorBackground: '#1e1e1e',
    editorWidgetBackground: '#252526',
    foreground: '#cccccc',
    mutedForeground: '#8b949e',
    chartsBlue: '#3794ff',
    chartsGreen: '#89d185',
    chartsRed: '#f14c4c',
    chartsPurple: '#c586f6',
    chartsOrange: '#d18616',
    chartsYellow: '#cca700',
  },
  light: {
    editorBackground: '#ffffff',
    editorWidgetBackground: '#f6f8fa',
    foreground: '#1f2328',
    mutedForeground: '#57606a',
    chartsBlue: '#0969da',
    chartsGreen: '#1a7f37',
    chartsRed: '#cf222e',
    chartsPurple: '#8250df',
    chartsOrange: '#bc4c00',
    chartsYellow: '#9a6700',
  },
};

function mix(hex1: string, w1: number, hex2: string): string {
  const p = (h: string, o: number) => parseInt(h.slice(o, o + 2), 16);
  const w2 = 1 - w1;
  const r = Math.round(p(hex1, 1) * w1 + p(hex2, 1) * w2);
  const g = Math.round(p(hex1, 3) * w1 + p(hex2, 3) * w2);
  const b = Math.round(p(hex1, 5) * w1 + p(hex2, 5) * w2);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function themeCss(themeName: SvgThemeName): string {
  const t = baseThemes[themeName];
  const bg = t.editorBackground;
  const fg = t.foreground;
  const edgeColor = mix(fg, 0.68, bg);

  return [
    ':root {',
    `  --vscode-editor-background: ${bg};`,
    `  --vscode-editor-foreground: ${fg};`,
    `  --vscode-descriptionForeground: ${t.mutedForeground};`,
    `  --vscode-editorWidget-background: ${t.editorWidgetBackground};`,
    `  --vscode-charts-blue: ${t.chartsBlue};`,
    `  --vscode-charts-green: ${t.chartsGreen};`,
    `  --vscode-charts-red: ${t.chartsRed};`,
    `  --vscode-charts-purple: ${t.chartsPurple};`,
    `  --vscode-charts-orange: ${t.chartsOrange};`,
    `  --vscode-charts-yellow: ${t.chartsYellow};`,
    // Edge colours — pre-computed from the webview's color-mix() formulas
    `  --svsch-edge-color: ${edgeColor};`,
    `  --svsch-edge-stacked-back: ${mix(fg, 0.5, bg)};`,
    `  --svsch-edge-stacked-middle: ${mix(fg, 0.75, bg)};`,
    `  --svsch-edge-stacked-front: ${fg};`,
    // Interface edge
    `  --svsch-interface-stripe: ${mix(fg, 0.7, t.chartsBlue)};`,
    `  --svsch-interface-bg-edge: ${mix(edgeColor, 0.5, bg)};`,
    // Node fills / strokes derived from chart colours
    `  --svsch-mux-fill: ${mix(t.chartsPurple, 0.12, bg)};`,
    `  --svsch-alu-fill: ${mix(t.chartsOrange, 0.14, bg)};`,
    `  --svsch-interface-fill: ${mix(t.chartsBlue, 0.12, bg)};`,
    `  --svsch-interface-stroke: ${mix(t.chartsBlue, 0.6, fg)};`,
    `  --svsch-interface-port-fill: ${mix(t.chartsBlue, 0.28, bg)};`,
    `  --svsch-port-skin-fill: ${mix(t.chartsYellow, 0.36, bg)};`,
    `  --svsch-port-skin-stroke: ${t.chartsYellow};`,
    // Label boxes
    `  --svsch-label-background: ${t.editorWidgetBackground};`,
    `  --svsch-label-border: ${t.mutedForeground};`,
    // Legacy aliases kept for any external SVG customisation
    `  --svsch-node-fill: ${t.editorWidgetBackground};`,
    `  --svsch-node-border: ${t.chartsBlue};`,
    `  --svsch-node-header: ${t.editorWidgetBackground};`,
    `  --svsch-port-fill: ${mix(t.chartsYellow, 0.36, bg)};`,
    `  --svsch-port-border: ${t.chartsYellow};`,
    '}',
  ].join('\n');
}
