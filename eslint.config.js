import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // 忽略文件
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      '*.config.js',
      '*.config.ts',
    ],
  },

  // JavaScript/TypeScript 基础配置
  js.configs.recommended,

  // TypeScript 严格配置
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react': react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // ==========================================
      // TypeScript 严格规则
      // ==========================================
      // 禁用基础 no-unused-vars，使用 TypeScript 版本
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',

      // ==========================================
      // React 严格规则
      // ==========================================
      'react/jsx-uses-react': 'off',  // React 17+ 不需要
      'react/react-in-jsx-scope': 'off',  // React 17+ 不需要
      'react/prop-types': 'off',  // 使用 TypeScript
      'react/jsx-key': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-deprecated': 'error',
      'react/no-direct-mutation-state': 'error',
      'react/no-unescaped-entities': 'warn',
      'react/no-unknown-property': 'error',
      'react/self-closing-comp': 'warn',

      // ==========================================
      // React Hooks 严格规则
      // ==========================================
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ==========================================
      // 通用代码质量规则
      // ==========================================
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-template': 'warn',
      'no-nested-ternary': 'warn',
      'no-unneeded-ternary': 'warn',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-return-await': 'warn',
      'require-await': 'warn',
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'warn',
      'no-promise-executor-return': 'error',

      // ==========================================
      // 代码风格（严格）
      // ==========================================
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'always-multiline'],
      'no-trailing-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
      'eol-last': ['error', 'always'],
      'indent': ['error', 2, { SwitchCase: 1 }],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'arrow-spacing': 'error',
      'block-spacing': 'error',
      'comma-spacing': 'error',
      'key-spacing': 'error',
      'keyword-spacing': 'error',
      'space-before-blocks': 'error',
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',
    },
  },

  // ==========================================
  // E2E（Playwright）目录：环境声明 + 物理上不适用的 React 规则
  // ==========================================
  // 为什么必须单列一块：
  //   1. e2e 跑在 **Node** 里（process / Buffer / node:fs），上面那块只给了浏览器 globals
  //      ⇒ 不补 node globals，`process` 会被判成 `no-undef`（那是环境声明缺失，不是代码错）；
  //   2. e2e 里一行 React 都没有。Playwright 的 fixture 形参固定叫 `use`，
  //      被 react-hooks 当成 React 的 `use()` Hook 误报（helpers/test-fixtures.ts 的 `page` fixture）。
  //      形参名由 Playwright 的 API 定死，改不了 ⇒ 只能在这一目录关掉这一条 React 规则。
  // 🔴 这里只做「环境声明 + 关掉物理上不适用的那一条」。真正在查代码质量的规则
  //    （no-explicit-any / curly / no-console / quotes / no-unused-vars / …）**一条都没放宽** ——
  //    e2e 目录纳入 lint 的意义就在这里，用整目录 eslint-disable 变绿等于没纳入。
  {
    files: ['e2e/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
];

