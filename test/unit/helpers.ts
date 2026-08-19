import { expect } from 'vitest';
import type { DesignModule, DiagramNode } from '../../src/ir/types';

export function expectMuxSelector(
  module: DesignModule,
  mux: DiagramNode | undefined,
  signal: string,
): void {
  expect(mux).toBeDefined();
  const selectorPort = mux?.ports.find((port) => port.name === 'sel');
  expect(selectorPort).toBeDefined();
  expect(
    module.edges.some(
      (edge) =>
        edge.source === `port:${module.name}:${signal}` &&
        edge.target === mux?.id &&
        edge.targetPort === selectorPort?.id &&
        edge.signal === signal,
    ),
  ).toBe(true);
}
