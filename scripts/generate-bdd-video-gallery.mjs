import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && predicate(entryPath)) files.push(entryPath);
    }
  }
  return files;
}

function videoMetadataBySourceName(report) {
  const metadata = new Map();

  function visitSuite(suite, parents) {
    const titles = [...parents, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          for (const attachment of result.attachments ?? []) {
            if (attachment.contentType !== 'video/webm' || !attachment.path) continue;
            const sourceName = attachment.name?.startsWith('video:')
              ? attachment.name.slice('video:'.length)
              : path.basename(attachment.path);
            metadata.set(sourceName, {
              feature: titles.at(-1) ?? 'BDD scenario',
              scenario: spec.title,
              status: result.status ?? 'unknown',
              retry: result.retry ?? 0,
              duration: result.duration ?? 0,
            });
          }
        }
      }
    }
    for (const child of suite.suites ?? []) visitSuite(child, titles);
  }

  for (const suite of report?.suites ?? []) visitSuite(suite, []);
  return metadata;
}

function slug(value) {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function renderIndex(videos, options) {
  const totalBytes = videos.reduce((sum, video) => sum + video.bytes, 0);
  const repository = options.repository ?? 'TheDeepestSpace/svsch';
  const sha = options.sha ?? '';
  const shortSha = sha.slice(0, 8);
  const commitLink = sha
    ? `<a href="https://github.com/${escapeHtml(repository)}/commit/${escapeHtml(sha)}">${escapeHtml(shortSha)}</a>`
    : 'local run';
  const cards = videos
    .map((video) => {
      const attempt = video.retry > 0 ? ` · retry ${video.retry}` : '';
      const duration = video.duration ? ` · ${(video.duration / 1000).toFixed(1)}s` : '';
      const empty = video.bytes === 0 ? '<strong class="bad">empty video</strong> · ' : '';
      const search = `${video.feature} ${video.scenario} ${video.status}`.toLowerCase();
      return `<article class="card" data-search="${escapeHtml(search)}">
  <video controls preload="none" src="${escapeHtml(video.url)}"></video>
  <div class="details">
    <p class="feature">${escapeHtml(video.feature)}</p>
    <h2>${escapeHtml(video.scenario)}</h2>
    <p>${empty}${escapeHtml(video.status)}${attempt}${duration} · ${formatBytes(video.bytes)}</p>
    <a href="${escapeHtml(video.url)}">open video</a>
  </div>
</article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BDD videos · PR #${escapeHtml(options.prNumber ?? '?')}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 1500px; padding: 2rem; }
    header { display: flex; gap: 1rem; align-items: end; justify-content: space-between; flex-wrap: wrap; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 1.6rem; }
    h2 { font-size: 1rem; margin: .25rem 0 .5rem; }
    .summary, .feature { color: #777; }
    input { min-width: min(22rem, 100%); padding: .7rem; font: inherit; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1rem; margin-top: 1.5rem; }
    .card { border: 1px solid #8886; border-radius: .5rem; overflow: hidden; background: #8881; }
    video { display: block; width: 100%; aspect-ratio: 32 / 23; background: #111; }
    .details { padding: .8rem; }
    .feature { font-size: .8rem; }
    .bad { color: #d33; }
    [hidden] { display: none; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>BDD scenario videos · PR #${escapeHtml(options.prNumber ?? '?')}</h1>
      <p class="summary">${videos.length} videos · ${formatBytes(totalBytes)} · commit ${commitLink}</p>
    </div>
    <input id="filter" type="search" placeholder="Filter scenarios" aria-label="Filter scenarios">
  </header>
  <main>${cards}</main>
  <script>
    const filter = document.querySelector('#filter');
    const cards = [...document.querySelectorAll('.card')];
    filter.addEventListener('input', () => {
      const query = filter.value.trim().toLowerCase();
      for (const card of cards) card.hidden = !card.dataset.search.includes(query);
    });
  </script>
</body>
</html>`;
}

export function generateBddVideoGallery(inputDir, outputDir, options = {}) {
  const reportPath = path.join(inputDir, 'playwright-report.json');
  const report = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : undefined;
  const metadata = videoMetadataBySourceName(report);
  const sourceVideos = findFiles(inputDir, (file) => file.endsWith('.webm')).sort();
  if (!sourceVideos.length) throw new Error(`No WebM videos found under ${inputDir}`);

  fs.rmSync(outputDir, { recursive: true, force: true });
  const videosDir = path.join(outputDir, 'videos');
  fs.mkdirSync(videosDir, { recursive: true });

  const width = String(sourceVideos.length).length;
  const videos = sourceVideos.map((source, index) => {
    const info = metadata.get(path.basename(source)) ?? {
      feature: 'BDD scenario',
      scenario: path.basename(path.dirname(path.dirname(source))),
      status: 'unknown',
      retry: 0,
      duration: 0,
    };
    const filename = `${String(index + 1).padStart(width, '0')}-${slug(info.scenario) || 'scenario'}.webm`;
    const destination = path.join(videosDir, filename);
    fs.copyFileSync(source, destination);
    const relativeUrl = `videos/${filename}`;
    return {
      ...info,
      bytes: fs.statSync(destination).size,
      filename,
      url: options.mediaBaseUrl
        ? `${options.mediaBaseUrl.replace(/\/$/, '')}/${relativeUrl}`
        : relativeUrl,
    };
  });

  videos.sort((a, b) =>
    `${a.feature}\0${a.scenario}\0${a.retry}`.localeCompare(
      `${b.feature}\0${b.scenario}\0${b.retry}`,
    ),
  );
  fs.writeFileSync(path.join(outputDir, 'index.html'), renderIndex(videos, options));
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(videos, null, 2)}\n`);
  return videos;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [inputDir, outputDir] = process.argv.slice(2);
  if (!inputDir || !outputDir) {
    console.error(
      'Usage: node scripts/generate-bdd-video-gallery.mjs <bdd-results-dir> <output-dir>',
    );
    process.exitCode = 2;
  } else {
    const prNumber = process.env.PR_NUMBER;
    const videos = generateBddVideoGallery(inputDir, outputDir, {
      prNumber,
      repository: process.env.GITHUB_REPOSITORY,
      sha: process.env.GITHUB_SHA,
    });
    const totalBytes = videos.reduce((sum, video) => sum + video.bytes, 0);
    console.log(`Generated gallery for ${videos.length} videos (${formatBytes(totalBytes)})`);
  }
}
