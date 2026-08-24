import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateVideoGallery } from '../../scripts/generate-bdd-video-gallery.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('generateVideoGallery', () => {
  it('copies every WebM and labels it from the merged Playwright report', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdd-video-gallery-test-'));
    temporaryDirectories.push(root);
    const input = path.join(root, 'bdd');
    const output = path.join(root, 'gallery');
    const videoDirectory = path.join(input, 'playwright-output', 'scenario', 'videos');
    const mergedVideoPath = (digit: string) =>
      `/tmp/blob-report/resources/${digit.repeat(40)}.webm`;
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
                    title: 'selects & moves a node',
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

    const videos = generateVideoGallery(input, output, {
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

  it('honors a custom title/heading/feature-fallback for non-BDD suites', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-gallery-test-'));
    temporaryDirectories.push(root);
    const input = path.join(root, 'system');
    const output = path.join(root, 'gallery');
    const videoDirectory = path.join(input, 'playwright-output', 'scenario', 'videos');
    fs.mkdirSync(videoDirectory, { recursive: true });
    fs.writeFileSync(path.join(videoDirectory, 'only.webm'), 'video');

    const videos = generateVideoGallery(input, output, {
      prNumber: '294',
      title: 'System videos',
      heading: 'System test videos',
      defaultFeatureLabel: 'System scenario',
    });

    // No playwright-report.json present, so metadata falls back to the
    // configured default label rather than the BDD-specific one.
    expect(videos).toHaveLength(1);
    expect(videos[0].feature).toBe('System scenario');
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('<title>System videos · PR #294</title>');
    expect(html).toContain('<h1>System test videos · PR #294</h1>');
  });
});
