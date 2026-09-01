import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeSystemVideoReports } from '../../scripts/merge-system-video-reports.mjs';
import { generateVideoGallery } from '../../scripts/generate-bdd-video-gallery.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function writeVersionReport(dir: string, videoBasename: string) {
  const videoDirectory = path.join(dir, 'playwright-output', 'scenario', 'videos');
  fs.mkdirSync(videoDirectory, { recursive: true });
  fs.writeFileSync(path.join(videoDirectory, videoBasename), 'video-bytes');
  fs.writeFileSync(
    path.join(dir, 'playwright-report.json'),
    JSON.stringify({
      suites: [
        {
          title: 'diagram.spec.ts',
          specs: [
            {
              title: 'opens svsch diagram',
              tests: [
                {
                  results: [
                    {
                      status: 'passed',
                      retry: 0,
                      duration: 1000,
                      attachments: [
                        {
                          name: `video:${videoBasename}`,
                          contentType: 'video/webm',
                          path: `/old/path/${videoBasename}`,
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
    }),
  );
}

describe('mergeSystemVideoReports', () => {
  it('namespaces same-named videos per version and labels each as its own feature', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-video-merge-test-'));
    temporaryDirectories.push(root);
    const versionA = path.join(root, 'a');
    const versionB = path.join(root, 'b');
    // Both versions produce a video with the same basename, mirroring how
    // vscode-test-playwright names recorded videos independent of VS Code
    // version — merging must not let one silently overwrite the other.
    writeVersionReport(versionA, 'video.webm');
    writeVersionReport(versionB, 'video.webm');

    const merged = path.join(root, 'merged');
    mergeSystemVideoReports(merged, [
      { version: '1.90.0', dir: versionA },
      { version: '1.91.0', dir: versionB },
    ]);

    expect(fs.readdirSync(path.join(merged, 'videos')).sort()).toEqual([
      '1.90.0__video.webm',
      '1.91.0__video.webm',
    ]);

    const gallery = path.join(root, 'gallery');
    const videos = generateVideoGallery(merged, gallery);
    expect(videos).toHaveLength(2);
    expect(videos.map((video) => video.feature).sort()).toEqual([
      'VS Code 1.90.0',
      'VS Code 1.91.0',
    ]);
    expect(videos.every((video) => video.scenario === 'opens svsch diagram')).toBe(true);
  });

  it('throws when no version reports are found', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-video-merge-empty-'));
    temporaryDirectories.push(root);
    expect(() =>
      mergeSystemVideoReports(path.join(root, 'merged'), [
        { version: '1.90.0', dir: path.join(root, 'missing') },
      ]),
    ).toThrow('No system video reports found to merge');
  });
});
