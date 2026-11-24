import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // testes de integração compartilham o mesmo MySQL/Redis
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
