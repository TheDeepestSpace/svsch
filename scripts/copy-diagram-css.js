#!/usr/bin/env node
// The exported SVG's <style> block only needs the shared diagram/node/edge/theme
// CSS, not the webview-only chrome bundled into media/webview.css by vite — so
// diagramPanel.ts's exportSvg() reads this file directly instead.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'webview', 'diagram.css');
const dest = path.join(__dirname, '..', 'media', 'diagram.css');

function copy() {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

copy();

// `npm run watch` runs vite in watch mode, which never reaches the
// build:webview step that normally triggers this copy — keep media/diagram.css
// in sync with the source as it's edited during development.
if (process.argv.includes('--watch')) {
  fs.watch(src, copy);
}
