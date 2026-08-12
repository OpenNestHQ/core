import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintPrettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  eslintPrettier,
)
