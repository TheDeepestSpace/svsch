import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import type { DiagramViewModel } from '../ir/types';

export async function renderHeadless(
  view: DiagramViewModel,
  outputPath: string
): Promise<void> {
  const { chromium } = await import('@playwright/test').catch(() => {
    throw new Error(
      'Headless rendering requires @playwright/test to be installed.\n' +
      'Run: npm install -D @playwright/test && npx playwright install chromium'
    );
  });

  const mediaDir = findMediaDir();
  const port = await getFreePort();
  const server = serveDir(mediaDir, port);

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1600, height: 1000 });

    await page.addInitScript(() => {
      (window as any).acquireVsCodeApi = () => ({
        postMessage: () => {}
      });
    });

    await page.goto(`http://127.0.0.1:${port}/`);

    await page.evaluate(({ view, moduleName }) => {
      (window as any).postMessage(
        { type: 'graph', view, modules: [moduleName] },
        '*'
      );
    }, { view, moduleName: view.moduleName });

    await page.waitForSelector('.react-flow__node', { timeout: 30000 });

    // fit-view so all nodes are visible
    const fitBtn = page.locator('button.react-flow__controls-fitview');
    if (await fitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fitBtn.click();
    }
    await page.waitForTimeout(600);

    const canvas = page.locator('.canvas');
    const screenshot = await canvas.screenshot({ type: 'png' });
    fs.writeFileSync(outputPath, screenshot);
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function findMediaDir(): string {
  const candidates = [
    path.join(__dirname, '..', 'media'),
    path.join(__dirname, 'media'),
    path.join(process.cwd(), 'media'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  throw new Error(
    `Built webview not found. Run: npm run compile\nSearched: ${candidates.join(', ')}`
  );
}

function serveDir(root: string, port: number): http.Server {
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  const server = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : (req.url ?? '/index.html');
    const file = path.join(root, urlPath.split('?')[0]);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const type = mime[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(file));
  });

  server.listen(port, '127.0.0.1');
  return server;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}
