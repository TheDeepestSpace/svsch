import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseFeatureScenarios,
  collectScenarioBlocks,
  diffScenarioBlocks,
  diffBddScenarios,
  scenarioKey,
  splitScenarioKey,
} from '../../scripts/diff-bdd-scenarios.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeFeaturesDir(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-bdd-scenarios-test-'));
  temporaryDirectories.push(root);
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(root, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return root;
}

describe('parseFeatureScenarios', () => {
  it('splits a feature file into per-scenario blocks keyed by title', () => {
    const scenarios = parseFeatureScenarios(`Feature: Widgets

  Scenario: First
    Given a thing
    Then it works

  Scenario: Second
    Given another thing
    Then it also works
`);

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0].feature).toBe('Widgets');
    expect(scenarios[0].scenario).toBe('First');
    expect(scenarios[0].block).toContain('Given a thing');
    expect(scenarios[0].block).not.toContain('Second');
    expect(scenarios[1].scenario).toBe('Second');
    expect(scenarios[1].block).toContain('Given another thing');
  });

  it('attaches tags directly above a scenario to that scenario, not the previous one', () => {
    const scenarios = parseFeatureScenarios(`Feature: Widgets

  Scenario: First
    Given a thing

  @skip
  Scenario: Second
    Given another thing
`);

    expect(scenarios[0].block).not.toContain('@skip');
    expect(scenarios[1].block).toContain('@skip');
    expect(scenarios[1].block).toContain('Scenario: Second');
  });

  it('includes a Scenario Outline block through its Examples table', () => {
    const scenarios = parseFeatureScenarios(`Feature: Widgets

  Scenario Outline: Sized widget
    Given a widget of size <size>

    Examples:
      | size |
      | 1    |
      | 2    |

  Scenario: Trailing
    Given the end
`);

    expect(scenarios[0].scenario).toBe('Sized widget');
    expect(scenarios[0].block).toContain('Examples:');
    expect(scenarios[0].block).toContain('| 2    |');
    expect(scenarios[0].block).not.toContain('Trailing');
  });

  it('falls back to a default feature name when no Feature: line is present', () => {
    const scenarios = parseFeatureScenarios('  Scenario: Orphan\n    Given nothing\n');
    expect(scenarios[0].feature).toBe('BDD scenario');
  });
});

describe('diffScenarioBlocks', () => {
  it('classifies scenarios present only at head as new', () => {
    const base = new Map([[scenarioKey('F', 'A'), 'Scenario: A\nGiven x']]);
    const head = new Map([
      [scenarioKey('F', 'A'), 'Scenario: A\nGiven x'],
      [scenarioKey('F', 'B'), 'Scenario: B\nGiven y'],
    ]);

    const status = diffScenarioBlocks(base, head);
    expect(status.get(scenarioKey('F', 'A'))).toBe('unchanged');
    expect(status.get(scenarioKey('F', 'B'))).toBe('new');
  });

  it('classifies scenarios whose block text changed as modified', () => {
    const base = new Map([[scenarioKey('F', 'A'), 'Scenario: A\nGiven x']]);
    const head = new Map([[scenarioKey('F', 'A'), 'Scenario: A\nGiven x and y']]);

    expect(diffScenarioBlocks(base, head).get(scenarioKey('F', 'A'))).toBe('modified');
  });

  it('classifies scenarios present only at base as removed', () => {
    const base = new Map([[scenarioKey('F', 'A'), 'Scenario: A\nGiven x']]);
    const head = new Map();

    const status = diffScenarioBlocks(base, head);
    expect(status.get(scenarioKey('F', 'A'))).toBe('removed');
    expect(status.size).toBe(1);
  });
});

describe('splitScenarioKey', () => {
  it('recovers the feature/scenario pair encoded by scenarioKey', () => {
    expect(splitScenarioKey(scenarioKey('Widgets', 'First'))).toEqual({
      feature: 'Widgets',
      scenario: 'First',
    });
  });
});

describe('diffBddScenarios (filesystem integration)', () => {
  it('diffs .feature files across base and head checkouts', () => {
    const base = makeFeaturesDir({
      'a.feature': `Feature: A\n\n  Scenario: Unchanged\n    Given x\n\n  Scenario: WillChange\n    Given y\n`,
    });
    const head = makeFeaturesDir({
      'a.feature': `Feature: A\n\n  Scenario: Unchanged\n    Given x\n\n  Scenario: WillChange\n    Given y and z\n\n  Scenario: Added\n    Given w\n`,
    });

    const status = diffBddScenarios(base, head);
    expect(status.get(scenarioKey('A', 'Unchanged'))).toBe('unchanged');
    expect(status.get(scenarioKey('A', 'WillChange'))).toBe('modified');
    expect(status.get(scenarioKey('A', 'Added'))).toBe('new');
  });

  it('marks a scenario present only in the base checkout as removed', () => {
    const base = makeFeaturesDir({
      'a.feature': `Feature: A\n\n  Scenario: Gone\n    Given x\n`,
    });
    const head = makeFeaturesDir({
      'a.feature': `Feature: A\n`,
    });

    const status = diffBddScenarios(base, head);
    expect(status.get(scenarioKey('A', 'Gone'))).toBe('removed');
  });

  it('treats a missing base directory as every head scenario being new', () => {
    const head = makeFeaturesDir({
      'a.feature': `Feature: A\n\n  Scenario: Fresh\n    Given x\n`,
    });

    const status = diffBddScenarios(path.join(head, 'does-not-exist'), head);
    expect(status.get(scenarioKey('A', 'Fresh'))).toBe('new');
  });
});

describe('collectScenarioBlocks', () => {
  it('returns an empty map for a missing directory', () => {
    expect(collectScenarioBlocks('/does/not/exist').size).toBe(0);
  });
});
