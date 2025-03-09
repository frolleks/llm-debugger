import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin/index.ts'],
  format: 'esm',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
});
