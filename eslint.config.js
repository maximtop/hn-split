import eslint from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const restrictedControlString = {
    selector: "Literal[value=/^(found|not_found|restricted|error|invalid_response|lookup_failed|lookup|open_discussion|get_availability_setting|set_availability_setting|adjacent_tab|reused_tab|split_view|canonical|page|automatic_availability|discussion_tab:)$/]",
    message: 'Use the named domain, protocol, or storage constant instead of a magic string.',
};

const restrictedControlTemplate = {
    selector: "TemplateElement[value.raw=/^(found|not_found|restricted|error|invalid_response|lookup_failed|lookup|open_discussion|get_availability_setting|set_availability_setting|adjacent_tab|reused_tab|split_view|canonical|page|automatic_availability|discussion_tab:)$/]",
    message: 'Use the named domain, protocol, or storage constant instead of a magic template value.',
};

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
            'src/shared/messages.ts',
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
                    selector: "MemberExpression[object.object.name='chrome'][object.property.name='storage']",
                    message: 'Options code must access settings through background messages, not chrome.storage.',
                },
            ],
        },
    },
);
