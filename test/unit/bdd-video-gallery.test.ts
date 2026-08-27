import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateBddVideoGallery } from '../../scripts/generate-bdd-video-gallery.mjs';
import { scenarioKey } from '../../scripts/diff-bdd-scenarios.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeGalleryInput(scenarioTitle: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdd-video-gallery-test-'));
  temporaryDirectories.push(root);
  const input = path.join(root, 'bdd');
  const output = path.join(root, 'gallery');
  const videoDirectory = path.join(input, 'playwright-output', 'scenario', 'videos');
  const mergedVideoPath = (digit: string) => `/tmp/blob-report/resources/${digit.repeat(40)}.webm`;
  fs.mkdirSync(videoDirectory, { recursive: true });
  fs.writeFileSync(path.join(videoDirectory, 'first.webm'), 'video-one');
  fs.writeFileSync(path.join(videoDirectory, 'second.webm'), 'video-two');
  fs.writeFileSync(
    path.join(input, 'playwright-report.json'),
    JSON.stringify({
      suites: [
        {
          title: 'feature.spec.js',
          specs: [],
          suites: [
            {
              title: 'Diagram <interaction>',
              suites: [],
              specs: [
                {
                  title: scenarioTitle,
                  tests: [
                    {
                      results: [
                        {
                          status: 'passed',
                          retry: 0,
                          duration: 1200,
                          attachments: [
                            {
                              name: 'video:first.webm',
                              contentType: 'video/webm',
                              path: mergedVideoPath('1'),
                            },
                            {
                              name: 'video:second.webm',
                              contentType: 'video/webm',
                              path: mergedVideoPath('2'),
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  return { input, output };
}

describe('generateBddVideoGallery', () => {
  it('copies every WebM and labels it from the merged Playwright report', () => {
    const { input, output } = makeGalleryInput('selects & moves a node');

    const videos = generateBddVideoGallery(input, output, {
      prNumber: '275',
      repository: 'TheDeepestSpace/svsch',
      sha: '1234567890abcdef',
    });

    expect(videos).toHaveLength(2);
    expect(videos.every((video) => video.feature === 'Diagram <interaction>')).toBe(true);
    expect(videos.every((video) => video.scenario === 'selects & moves a node')).toBe(true);
    expect(videos.every((video) => video.url.startsWith('videos/'))).toBe(true);
    expect(fs.readdirSync(path.join(output, 'videos'))).toHaveLength(2);
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('Diagram &lt;interaction&gt;');
    expect(html).toContain('selects &amp; moves a node');
    expect(html).toContain('src="videos/');
    expect(html).toContain('12345678');
  });

  it('labels a Scenario Outline row with the outline name and keeps the Feature name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdd-video-gallery-test-'));
    temporaryDirectories.push(root);
    const input = path.join(root, 'bdd');
    const output = path.join(root, 'gallery');
    const videoDirectory = path.join(input, 'playwright-output', 'scenario', 'videos');
    const mergedVideoPath = (digit: string) =>
      `/tmp/blob-report/resources/${digit.repeat(40)}.webm`;
    fs.mkdirSync(videoDirectory, { recursive: true });
    fs.writeFileSync(path.join(videoDirectory, 'plain.webm'), 'video-plain');
    fs.writeFileSync(path.join(videoDirectory, 'outline.webm'), 'video-outline');
    fs.writeFileSync(
      path.join(input, 'playwright-report.json'),
      JSON.stringify({
        suites: [
          {
            title: 'command_line_interface.feature.spec.js',
            specs: [],
            suites: [
              {
                title: 'Command Line Interface',
                specs: [
                  {
                    title: 'Help command output',
                    tests: [
                      {
                        results: [
                          {
                            status: 'passed',
                            retry: 0,
                            duration: 500,
                            attachments: [
                              {
                                name: 'video:plain.webm',
                                contentType: 'video/webm',
                                path: mergedVideoPath('1'),
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
                suites: [
                  {
                    title: 'SVG themes',
                    specs: [
                      {
                        title: 'Example #1',
                        tests: [
                          {
                            results: [
                              {
                                status: 'passed',
                                retry: 0,
                                duration: 800,
                                attachments: [
                                  {
                                    name: 'video:outline.webm',
                                    contentType: 'video/webm',
                                    path: mergedVideoPath('2'),
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                    suites: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const videos = generateBddVideoGallery(input, output, {
      prNumber: '297',
      repository: 'TheDeepestSpace/svsch',
      sha: 'abcdef1234567890',
    });

    const plain = videos.find((video) => video.scenario === 'Help command output');
    const outline = videos.find((video) => video.scenario === 'SVG themes › Example #1');

    expect(plain).toBeDefined();
    expect(plain?.feature).toBe('Command Line Interface');
    expect(outline).toBeDefined();
    expect(outline?.feature).toBe('Command Line Interface');
  });

  it('defaults changeStatus to unchanged and omits the badge when no status map is given', () => {
    const { input, output } = makeGalleryInput('an unmodified scenario');

    const videos = generateBddVideoGallery(input, output, { prNumber: '292' });

    expect(videos.every((video) => video.changeStatus === 'unchanged')).toBe(true);
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('data-status="unchanged"');
    expect(html).not.toContain('class="badge');
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    const allUnchanged = manifest.every(
      (video: { changeStatus: string }) => video.changeStatus === 'unchanged',
    );
    expect(allUnchanged).toBe(true);
  });

  it('tags a new scenario with the NEW badge and data-status', () => {
    const { input, output } = makeGalleryInput('a brand new scenario');
    const changeStatus = new Map([
      [scenarioKey('Diagram <interaction>', 'a brand new scenario'), 'new'],
    ]);

    const videos = generateBddVideoGallery(input, output, { prNumber: '292', changeStatus });

    expect(videos.every((video) => video.changeStatus === 'new')).toBe(true);
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('data-status="new"');
    expect(html).toContain('class="badge badge-new">NEW</span>');
  });

  it('tags a modified scenario with the MODIFIED badge, from a plain object status map', () => {
    const { input, output } = makeGalleryInput('a tweaked scenario');
    const changeStatus = {
      [scenarioKey('Diagram <interaction>', 'a tweaked scenario')]: 'modified',
    };

    const videos = generateBddVideoGallery(input, output, { prNumber: '292', changeStatus });

    expect(videos.every((video) => video.changeStatus === 'modified')).toBe(true);
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('data-status="modified"');
    expect(html).toContain('class="badge badge-modified">MODIFIED</span>');
  });

  it('renders the status filter alongside the search input', () => {
    const { input, output } = makeGalleryInput('any scenario');

    generateBddVideoGallery(input, output, { prNumber: '292' });

    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('id="statusFilter"');
    expect(html).toContain('<option value="new">New</option>');
    expect(html).toContain('<option value="modified">Modified</option>');
    expect(html).toContain('<option value="unchanged">Unchanged</option>');
    expect(html).toContain('<option value="removed">Removed</option>');
  });

  it('renders a video-less red card for a scenario removed at head', () => {
    const { input, output } = makeGalleryInput('a surviving scenario');
    const changeStatus = new Map([
      [scenarioKey('Diagram <interaction>', 'a surviving scenario'), 'unchanged'],
      [scenarioKey('Diagram <interaction>', 'a deleted scenario'), 'removed'],
    ]);

    const videos = generateBddVideoGallery(input, output, { prNumber: '292', changeStatus });

    expect(videos.some((video) => video.scenario === 'a deleted scenario')).toBe(true);
    const removedEntry = videos.find((video) => video.scenario === 'a deleted scenario');
    expect(removedEntry?.changeStatus).toBe('removed');
    expect(removedEntry?.bytes).toBe(0);

    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('data-status="removed"');
    expect(html).toContain('class="badge badge-removed">REMOVED</span>');
    expect(html).toContain('Scenario removed');
    expect(html).toContain('a deleted scenario');

    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    expect(
      manifest.some(
        (video: { scenario: string; changeStatus: string }) =>
          video.scenario === 'a deleted scenario' && video.changeStatus === 'removed',
      ),
    ).toBe(true);
  });
});
