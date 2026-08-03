import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// `discussion` is deliberately absent: it is also a CSS class name in the popup
// markup, where a literal is the only way to write it.
const CONTROL_VALUE_PATTERN = '^(found|not_found|restricted|error|invalid_response|lookup_failed|lookup|open_discussion|open_discussion_for_click|get_availability_setting|set_availability_setting|get_article_click_setting|set_article_click_setting|adjacent_tab|reused_tab|split_view|canonical|page|pending|unavailable|open_in_split_link|automatic_availability|article_click_discussion|discussion_tab:)$';

const restrictedControlString = {
    selector: `Literal[value=/${CONTROL_VALUE_PATTERN}/]`,
    message: 'Use the named domain, protocol, or storage constant instead of a magic string.',
};

const restrictedControlTemplate = {
    selector: `TemplateElement[value.raw=/${CONTROL_VALUE_PATTERN}/]`,
    message: 'Use the named domain, protocol, or storage constant instead of a magic template value.',
};

export default tseslint.config(
    {
        ignores: ['coverage/**', 'dist/**', 'node_modules/**'],
    },
    eslint.configs.recommended,
    // Type-aware linting backed by the TypeScript project service.
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files: ['**/*.{js,mjs}'],
        ...tseslint.configs.disableTypeChecked,
    },
    {
        files: ['tests/**/*.{ts,tsx}'],
        rules: {
            // Vitest assertions pass method references (vi.mocked, toHaveBeenCalled)
            // and use awaitless async stubs to build promise-returning fakes.
            '@typescript-eslint/unbound-method': 'off',
            '@typescript-eslint/require-await': 'off',
            // Test doubles and malformed-input fixtures bypass strict typing on purpose.
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
        },
    },
    // Formatting conventions matching the existing codebase style.
    stylistic.configs.customize({
        arrowParens: true,
        braceStyle: '1tbs',
        indent: 4,
        jsx: true,
        quotes: 'single',
        semi: true,
    }),
    {
        rules: {
            // Multiline assignments keep `=` on the declaration line.
            '@stylistic/operator-linebreak': ['error', 'before', { overrides: { '=': 'after' } }],
        },
    },
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
            'jsdoc/multiline-blocks': ['error', {
                noSingleLineBlocks: true,
            }],
            'jsdoc/require-description': 'error',
            'jsdoc/require-jsdoc': ['error', {
                contexts: [
                    'FunctionDeclaration',
                    'TSInterfaceDeclaration',
                    'TSMethodSignature[parent.type="TSInterfaceBody"]',
                    'TSPropertySignature[parent.type="TSInterfaceBody"]',
                ],
            }],
            'jsdoc/require-param': 'error',
            'jsdoc/require-param-description': 'error',
        },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        ignores: [
            'src/domain/hn.ts',
            'src/domain/url.ts',
            'src/shared/content-scripts.ts',
            'src/shared/context-menus.ts',
            'src/shared/messages.ts',
            'src/shared/side-panel-content.ts',
            'src/shared/storage-keys.ts',
        ],
        rules: {
            'no-restricted-syntax': ['error', restrictedControlString, restrictedControlTemplate],
        },
    },
    {
        files: ['src/options/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                restrictedControlString,
                restrictedControlTemplate,
                {
                    selector: 'MemberExpression[object.object.name="chrome"][object.property.name="storage"]',
                    message: 'Options code must access settings through background messages, not chrome.storage.',
                },
            ],
        },
    },
);
