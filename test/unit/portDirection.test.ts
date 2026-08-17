import { describe, expect, test } from 'vitest';
import { isInputSidePort, isInoutPort } from '../../src/diagram/portDirection';
import type { DiagramPort } from '../../src/ir/types';

describe('port direction layout policy', () => {
  test.each([
    ['input', true],
    ['inout', true],
    ['unknown', true],
    ['output', false]
  ] satisfies Array<[DiagramPort['direction'], boolean]>)('places %s ports in the input-side lane: %s', (direction, expected) => {
    expect(isInputSidePort({ direction })).toBe(expected);
  });

  test.each([
    ['input', false],
    ['inout', true],
    ['unknown', false],
    ['output', false]
  ] satisfies Array<[DiagramPort['direction'], boolean]>)('identifies only %s as bidirectional: %s', (direction, expected) => {
    expect(isInoutPort({ direction })).toBe(expected);
  });
});
