import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'tests/server-only-stub.ts') } },
  test: { environment: 'node', env: { DATA_DIR: path.join(os.tmpdir(), 'aurora-test-data') }, include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
