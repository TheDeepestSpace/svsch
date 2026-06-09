import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
]);

export default defineConfig({
  build: {
    target: 'node18',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: 'src/cli/index.ts',
      formats: ['cjs'],
      fileName: () => 'cli.js'
    },
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id) || id === 'vscode' || id.startsWith('@playwright') || id === 'playwright'
    }
  }
});
