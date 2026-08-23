import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateBddVideoGallery } from '../../scripts/generate-bdd-video-gallery.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('generateBddVideoGallery', () => {
  it('copies every WebM and labels it from the merged Playwright report', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdd-video-gallery-test-'));
    temporaryDirectories.push(root);
    const input = path.join(root, 'bdd');
    const output = path.join(root, 'gallery');
    const videoDirectory = path.join(input, 'playwright-output', 'scenario', 'videos');
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
                              { contentType: 'video/webm', path: '/tmp/results/first.webm' },
                              { contentType: 'video/webm', path: '/tmp/results/second.webm' },
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

    const videos = generateBddVideoGallery(input, output, {
      mediaBaseUrl: 'https://example.test/media/',
      prNumber: '275',
      repository: 'TheDeepestSpace/svsch',
      sha: '1234567890abcdef',
    });

    expect(videos).toHaveLength(2);
    expect(fs.readdirSync(path.join(output, 'videos'))).toHaveLength(2);
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(html).toContain('Diagram &lt;interaction&gt;');
    expect(html).toContain('selects &amp; moves a node');
    expect(html).toContain('https://example.test/media/videos/');
    expect(html).toContain('12345678');
  });
});
