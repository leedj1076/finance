import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: '.env.local' })

export default defineConfig({
  resolve: {
    // vitest는 tsconfig paths를 자동 해석하지 않는다
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // rls/migrate 테스트가 하나의 로컬 DB를 공유하므로 파일 병렬 금지
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
