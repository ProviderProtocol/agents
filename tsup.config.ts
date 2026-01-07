import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'execution/index': 'src/execution/index.ts',
    'middleware/index': 'src/middleware/index.ts',
    'thread-tree/index': 'src/thread-tree/index.ts',
    'checkpoint/index': 'src/checkpoint/index.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  target: 'esnext',
  external: ['@providerprotocol/ai'],
  treeshake: true,
});
