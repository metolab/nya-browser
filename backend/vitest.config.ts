import os from 'os';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      DATA_DIR: path.join(os.tmpdir(), 'nya-vitest-data'),
    },
  },
});
