import { HN_ORIGIN } from '../domain/hn';

/**
 * Identifies the single dynamic rule that lifts Hacker News framing headers.
 * The identifier is stable so a reloaded worker replaces the previous rule
 * instead of accumulating duplicates.
 */
export const SIDE_PANEL_FRAMING_RULE_ID = 1;

/**
 * Defines the dynamic-rule operations used by the framing exception.
 */
export interface FramingRuleClient {
    /**
     * Atomically removes and adds dynamic rules.
     * @param options - The rule identifiers to remove and the rules to add.
     */
    updateDynamicRules(options: {
        removeRuleIds: number[];
        addRules?: chrome.declarativeNetRequest.Rule[];
    }): Promise<void>;
}

/**
 * Builds the rule that removes the response headers preventing Hacker News
 * from rendering inside the extension side panel.
 *
 * The condition is deliberately narrow: only sub-frame requests to the Hacker
 * News origin are affected, so top-level Hacker News navigation keeps its
 * framing protection, and no other site is touched.
 */
export function framingRule(): chrome.declarativeNetRequest.Rule {
    return {
        id: SIDE_PANEL_FRAMING_RULE_ID,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            responseHeaders: [
                { header: 'x-frame-options', operation: 'remove' },
                {
                    header: 'content-security-policy',
                    operation: 'remove',
                },
                {
                    header: 'content-security-policy-report-only',
                    operation: 'remove',
                },
            ],
        },
        condition: {
            urlFilter: `||${new URL(HN_ORIGIN).host}/`,
            resourceTypes: ['sub_frame'],
        },
    };
}

/**
 * Owns the lifetime of the framing exception so it exists only while a side
 * panel is actually open. Every enable is paired with a disable, and repeated
 * calls are idempotent.
 */
export class SidePanelFraming {
    private readonly rules: FramingRuleClient;

    private holders = 0;

    private installed = false;

    // A panel that opens and closes quickly — React's development double-mount
    // does exactly this — would otherwise run an install and a removal
    // concurrently and leave whichever the browser applied last. Every rule
    // mutation is queued, and each one re-reads the current holder count, so
    // the installed state always converges on the last caller's intent.
    private queue: Promise<void> = Promise.resolve();

    /**
     * Creates the framing owner with no exception installed.
     * @param rules - The dynamic-rule client used to install the exception.
     */
    constructor(rules: FramingRuleClient) {
        this.rules = rules;
    }

    /**
     * Indicates whether at least one panel currently holds the exception.
     */
    get active(): boolean {
        return this.holders > 0;
    }

    /**
     * Installs the framing exception for one additional panel.
     */
    async acquire(): Promise<void> {
        this.holders += 1;
        await this.sync();
    }

    /**
     * Releases one panel's hold and removes the exception with the last one.
     */
    async release(): Promise<void> {
        if (this.holders === 0) {
            return;
        }
        this.holders -= 1;
        await this.sync();
    }

    /**
     * Drops every hold and removes the exception, used when the worker starts
     * so a rule left behind by a crashed session never outlives its panel.
     */
    async reset(): Promise<void> {
        this.holders = 0;
        const removeStaleRule = async (): Promise<void> => {
            await this.rules.updateDynamicRules({
                removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID],
            });
            this.installed = false;
        };
        this.queue = this.queue.then(removeStaleRule, removeStaleRule);
        await this.queue;
    }

    /**
     * Queues one convergence step that matches the installed rule to the
     * current holder count.
     */
    private async sync(): Promise<void> {
        const step = async (): Promise<void> => {
            const wanted = this.holders > 0;
            if (wanted === this.installed) {
                return;
            }
            await this.rules.updateDynamicRules(wanted
                ? { removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID], addRules: [framingRule()] }
                : { removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID] });
            this.installed = wanted;
        };
        this.queue = this.queue.then(step, step);
        await this.queue;
    }
}
