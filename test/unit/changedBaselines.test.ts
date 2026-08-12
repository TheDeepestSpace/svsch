import { describe, expect, it } from 'vitest';
import { parseChangedBaselines } from '../changedBaselines';

function nameStatus(...records: string[]): string {
  return `${records.join('\0')}\0`;
}

describe('parseChangedBaselines', () => {
  it('pairs a plain modification with itself', () => {
    const output = nameStatus('M', 'test/visual/__screenshots__/foo.spec.ts-snapshots/bar.png');
    expect(parseChangedBaselines(output)).toEqual({
      pairs: [
        {
          oldPath: 'test/visual/__screenshots__/foo.spec.ts-snapshots/bar.png',
          newPath: 'test/visual/__screenshots__/foo.spec.ts-snapshots/bar.png',
        },
      ],
      ambiguous: [],
    });
  });

  it('pairs a detected rename (R record) old and new paths', () => {
    const output = nameStatus(
      'R087',
      'test/visual/__screenshots__/old.spec.ts-snapshots/example.png',
      'test/visual/__screenshots__/renamed.spec.ts-snapshots/example.png'
    );
    expect(parseChangedBaselines(output)).toEqual({
      pairs: [
        {
          oldPath: 'test/visual/__screenshots__/old.spec.ts-snapshots/example.png',
          newPath: 'test/visual/__screenshots__/renamed.spec.ts-snapshots/example.png',
        },
      ],
      ambiguous: [],
    });
  });

  it('re-pairs same-basename add/delete records git could not link as a rename', () => {
    const output = nameStatus(
      'D',
      'test/visual/__screenshots__/old.spec.ts-snapshots/example.png',
      'A',
      'test/visual/__screenshots__/renamed.spec.ts-snapshots/example.png'
    );
    expect(parseChangedBaselines(output)).toEqual({
      pairs: [
        {
          oldPath: 'test/visual/__screenshots__/old.spec.ts-snapshots/example.png',
          newPath: 'test/visual/__screenshots__/renamed.spec.ts-snapshots/example.png',
        },
      ],
      ambiguous: [],
    });
  });

  it('does not pair add/delete records with different basenames', () => {
    const output = nameStatus(
      'D',
      'test/visual/__screenshots__/old.spec.ts-snapshots/a.png',
      'A',
      'test/visual/__screenshots__/new.spec.ts-snapshots/b.png'
    );
    expect(parseChangedBaselines(output)).toEqual({ pairs: [], ambiguous: [] });
  });

  it('reports ambiguity instead of pairing by index when a basename has multiple candidates', () => {
    const output = nameStatus(
      'D',
      'test/visual/__screenshots__/a.spec.ts-snapshots/foo.png',
      'D',
      'test/visual/__screenshots__/b.spec.ts-snapshots/foo.png',
      'A',
      'test/visual/__screenshots__/c.spec.ts-snapshots/foo.png',
      'A',
      'test/visual/__screenshots__/d.spec.ts-snapshots/foo.png'
    );
    expect(parseChangedBaselines(output)).toEqual({
      pairs: [],
      ambiguous: [
        {
          basename: 'foo.png',
          deletedPaths: [
            'test/visual/__screenshots__/a.spec.ts-snapshots/foo.png',
            'test/visual/__screenshots__/b.spec.ts-snapshots/foo.png',
          ],
          addedPaths: [
            'test/visual/__screenshots__/c.spec.ts-snapshots/foo.png',
            'test/visual/__screenshots__/d.spec.ts-snapshots/foo.png',
          ],
        },
      ],
    });
  });

  it('handles a mix of modifications, renames, and unrelated files', () => {
    const output = nameStatus(
      'M',
      'test/visual/__screenshots__/foo.spec.ts-snapshots/bar.png',
      'R100',
      'test/visual/__screenshots__/old.spec.ts-snapshots/baz.png',
      'test/visual/__screenshots__/new.spec.ts-snapshots/baz.png',
      'A',
      'README.md',
      'M',
      'docs/guide.md'
    );
    expect(parseChangedBaselines(output)).toEqual({
      pairs: [
        {
          oldPath: 'test/visual/__screenshots__/foo.spec.ts-snapshots/bar.png',
          newPath: 'test/visual/__screenshots__/foo.spec.ts-snapshots/bar.png',
        },
        {
          oldPath: 'test/visual/__screenshots__/old.spec.ts-snapshots/baz.png',
          newPath: 'test/visual/__screenshots__/new.spec.ts-snapshots/baz.png',
        },
      ],
      ambiguous: [],
    });
  });

  it('returns nothing for empty output', () => {
    expect(parseChangedBaselines('')).toEqual({ pairs: [], ambiguous: [] });
  });
});
