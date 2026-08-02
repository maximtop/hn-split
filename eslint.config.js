import eslint from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['coverage/**', 'dist/**', 'node_modules/**'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.webextensions,
            },
        },
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            '@typescript-eslint/consistent-type-imports': 'error',
        },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: {
            jsdoc,
        },
        settings: {
            jsdoc: {
                mode: 'typescript',
            },
        },
        rules: {
            'jsdoc/require-description': 'error',
            'jsdoc/require-jsdoc': ['error', {
                contexts: [
                    'FunctionDeclaration',
                    'TSInterfaceDeclaration',
                    'TSMethodSignature[parent.type="TSInterfaceBody"]',
                    'TSPropertySignature[parent.type="TSInterfaceBody"]',
                ],
            }],
        },
    },
);
