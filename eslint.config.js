import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.npm-cache/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['backend/**/*.js', '*.js', 'frontend/vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      // JSX component references are capitalized and aren't reads in core ESLint.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]' }],
    },
  },
];
