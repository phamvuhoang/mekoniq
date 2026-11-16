import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'artifacts/**', '**/generated/**', '**/android/**', '.venv/**', '.venv-*/**', '.lab/**', '.worktrees/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error',{argsIgnorePattern:'^_'}] } },
  { files: ['**/*.{ts,tsx,js,mjs,cjs}'], languageOptions: { globals: {
    process:'readonly', console:'readonly', Buffer:'readonly', URL:'readonly',
    fetch:'readonly', setTimeout:'readonly', clearTimeout:'readonly', setInterval:'readonly', clearInterval:'readonly',
    document:'readonly', window:'readonly', navigator:'readonly', localStorage:'readonly',
    crypto:'readonly', TextEncoder:'readonly', TextDecoder:'readonly', Request:'readonly', Response:'readonly',
    AbortSignal:'readonly', Headers:'readonly', structuredClone:'readonly'
  } } },
  {files:['docs/implementation/evidence/cloud-run/mekoniq-2026-11-14/{smoke,smoke-initial,smoke-attempt-02}.mjs'],languageOptions:{globals:{AbortController:'readonly',performance:'readonly'}}},
  {files:['docs/implementation/web-lab-to-physical/**/*.mjs'],languageOptions:{globals:{AbortController:'readonly',performance:'readonly'}}},
  {files:['docs/implementation/evidence/production/r2a-2026-11-14/browser-smoke.cjs','docs/implementation/evidence/production/r2a-2026-11-14/browser-attempt-01/browser-smoke.cjs'],languageOptions:{sourceType:'commonjs',globals:{require:'readonly',__dirname:'readonly',module:'readonly'}},rules:{'@typescript-eslint/no-require-imports':'off'}}
);
