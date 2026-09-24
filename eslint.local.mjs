/**
 * @file Lint rules that only this repository needs. The entries come before the common config, which already sets
 * `no-restricted-syntax` for every file and would replace a local one, so the selectors run as rules of a local plugin.
 */

// `discussion` is deliberately absent: it is also a CSS class name in the popup
// markup, where a literal is the only way to write it.
const CONTROL_VALUE_PATTERN = '^(found|not_found|restricted|error|invalid_response|lookup_failed|lookup|open_discussion|open_discussion_for_click|get_availability_setting|set_availability_setting|get_article_click_setting|set_article_click_setting|adjacent_tab|reused_tab|split_view|canonical|page|pending|unavailable|open_in_split_link|automatic_availability|article_click_discussion|discussion_tab:)$';

/**
 * Builds a rule that reports every node matched by one selector.
 *
 * @param {string} selector Selector of the nodes to report.
 * @param {string} message Report message.
 * @returns {object} ESLint rule.
 */
const selectorRule = (selector, message) => ({
    meta: {
        type: 'problem',
        schema: [],
        messages: { restricted: message },
    },
    create: (context) => ({
        [selector](node) {
            context.report({ node, messageId: 'restricted' });
        },
    }),
});

const local = {
    rules: {
        'no-control-string': selectorRule(
            `Literal[value=/${CONTROL_VALUE_PATTERN}/]`,
            'Use the named domain, protocol, or storage constant instead of a magic string.',
        ),
        'no-control-template': selectorRule(
            `TemplateElement[value.raw=/${CONTROL_VALUE_PATTERN}/]`,
            'Use the named domain, protocol, or storage constant instead of a magic template value.',
        ),
        'no-chrome-storage': selectorRule(
            'MemberExpression[object.object.name="chrome"][object.property.name="storage"]',
            'Options code must access settings through background messages, not chrome.storage.',
        ),
    },
};

export default [
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
        plugins: { local },
        rules: {
            'local/no-control-string': 'error',
            'local/no-control-template': 'error',
        },
    },
    {
        files: ['src/options/**/*.{ts,tsx}'],
        plugins: { local },
        rules: {
            'local/no-chrome-storage': 'error',
        },
    },
];
