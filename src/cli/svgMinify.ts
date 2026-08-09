// Deliberately NOT svgo's preset-default. This SVG embeds a large verbatim
// stylesheet (React Flow CSS + the webview CSS) containing `::before`/`::after`
// pseudo-elements, which crashes any plugin that resolves computed styles
// (removeHiddenElems, collapseGroups, convertPathData, removeEmptyContainers,
// mergePaths, removeUnknownsAndDefaults — "Pseudo-elements are not supported
// by css-select"). `inlineStyles`/`minifyStyles` also mangle the `var(--vscode-...)`
// custom properties the embedded stylesheet depends on for theme adaptivity.
// `moveElemsAttrsToGroup`/`moveGroupAttrsToElems` are also excluded: each
// `[data-node-id]` group's own `transform="translate(...)"` is read directly
// (by the CLI feature tests, and potentially other tooling) as that node's
// layout position, and those plugins fold ancestor group transforms into it,
// changing the value even though the rendered result is visually identical.
// This list keeps only plugins verified (against the visual-test goldens) to
// leave url() references (gradients/patterns via `style="...url(#id)"`),
// `viewBox`, `var(--vscode-...)`, and per-node `transform` values untouched.
// `removeViewBox` is excluded outright since width/height equal viewBox here,
// so it would strip viewBox entirely and hurt responsive embedding.
const SAFE_MINIFY_PLUGINS = [
  'removeDoctype',
  'removeXMLProcInst',
  'removeComments',
  'removeDeprecatedAttrs',
  'removeMetadata',
  'removeEditorsNSData',
  'cleanupAttrs',
  'mergeStyles',
  'cleanupIds',
  'removeUselessDefs',
  'cleanupNumericValues',
  'convertColors',
  'removeNonInheritableGroupAttrs',
  'removeUselessStrokeAndFill',
  'cleanupEnableBackground',
  'removeEmptyText',
  'convertShapeToPath',
  'convertEllipseToCircle',
  'removeEmptyAttrs',
  'removeUnusedNS',
  'sortAttrs',
  'sortDefsChildren',
  'removeDesc'
] as const;

// svgo ships ESM-only; dynamic import keeps this callable from the
// CommonJS-compiled extension bundle (tsconfig.extension.json) as well as
// the CLI's Vite/Rollup bundle.
export async function minifySvg(svg: string): Promise<string> {
  const { optimize } = await import('svgo');
  return optimize(svg, { multipass: true, plugins: [...SAFE_MINIFY_PLUGINS] }).data;
}
