import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin/index.ts', 'src/index.ts'],
  format: 'esm',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
});
