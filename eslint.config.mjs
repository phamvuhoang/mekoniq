import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'artifacts/**', '**/generated/**', '**/android/**', '.venv/**', '.lab/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error',{argsIgnorePattern:'^_'}] } },
  { files: ['**/*.{ts,tsx,js,mjs,cjs}'], languageOptions: { globals: {
    process:'readonly', console:'readonly', Buffer:'readonly', URL:'readonly',
    fetch:'readonly', setTimeout:'readonly', clearTimeout:'readonly', setInterval:'readonly', clearInterval:'readonly',
    document:'readonly', window:'readonly', navigator:'readonly', localStorage:'readonly',
    crypto:'readonly', TextEncoder:'readonly', TextDecoder:'readonly', Request:'readonly', Response:'readonly',
    AbortSignal:'readonly', Headers:'readonly', structuredClone:'readonly'
  } } }
);
