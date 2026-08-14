import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { DEFAULT_CLOCK_SIGNAL_NAMES, DEFAULT_RESET_SIGNAL_NAMES } from '../../src/parser/textExtractor';

describe('package.json configuration defaults', () => {
  const properties = packageJson.contributes.configuration.properties;

  it('svsch.clockSignalNames default matches DEFAULT_CLOCK_SIGNAL_NAMES', () => {
    expect(properties['svsch.clockSignalNames'].default).toEqual(DEFAULT_CLOCK_SIGNAL_NAMES);
  });

  it('svsch.resetSignalNames default matches DEFAULT_RESET_SIGNAL_NAMES', () => {
    expect(properties['svsch.resetSignalNames'].default).toEqual(DEFAULT_RESET_SIGNAL_NAMES);
  });
});
