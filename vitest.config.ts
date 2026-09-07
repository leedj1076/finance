import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: '.env.local' })

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) }

// Two lanes. `unit` is pure logic and runs anywhere; `integration` needs the
// local Supabase stack, so a missing Docker daemon can't be mistaken for a
// broken build. `pnpm test` runs the unit lane only.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/integration/**', 'node_modules/**'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          // rls/migrate 테스트가 하나의 로컬 DB를 공유하므로 파일 병렬 금지
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
})
