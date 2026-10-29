// Plain JavaScript so tsdown can load it on Node 20 without an extra config loader.
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  platform: 'node',
  target: 'node20',
  fixedExtension: false,
})
