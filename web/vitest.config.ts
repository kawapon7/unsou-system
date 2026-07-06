import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    env: {
      // テスト専用のダミーキー（32バイト）。本番のENCRYPTION_KEYとは無関係。
      ENCRYPTION_KEY: '01234567890123456789012345678901',
    },
  },
})
