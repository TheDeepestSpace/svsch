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
});
