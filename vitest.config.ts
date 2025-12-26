/**
 * Vitest 配置文件
 *
 * 测试框架配置：
 * - 使用 jsdom 模拟浏览器环境
 * - 支持 React 组件测试
 * - 集成覆盖率报告
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    // 测试环境
    environment: 'jsdom',

    // 全局设置文件
    setupFiles: ['./tests/setup.ts'],

    // 测试文件匹配模式
    include: [
      'tests/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
    ],

    // 排除目录
    exclude: [
      'node_modules',
      'dist',
      'src-tauri',
    ],

    // 全局变量
    globals: true,

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      // 覆盖率阈值
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 30,
        lines: 30,
      },
    },

    // 超时设置
    testTimeout: 10000,

    // 并行执行
    pool: 'threads',
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});

