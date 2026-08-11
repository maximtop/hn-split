import { describe, expect, it, vi } from 'vitest';

import { SIDE_PANEL_FRAMING_RULE_ID, SidePanelFraming, framingRule } from '../src/background/side-panel-framing';
import type { FramingRuleClient } from '../src/background/side-panel-framing';

function client(): FramingRuleClient {
    return { updateDynamicRules: vi.fn(async () => undefined) };
}

describe('framingRule', () => {
    it('removes framing headers only for Hacker News sub-frames', () => {
        const rule = framingRule();

        expect(rule.id).toBe(SIDE_PANEL_FRAMING_RULE_ID);
        expect(rule.condition.urlFilter).toBe('||news.ycombinator.com/');
        expect(rule.condition.resourceTypes).toEqual(['sub_frame']);
        expect(rule.action.responseHeaders?.map((header) => header.header)).toEqual([
            'x-frame-options',
            'content-security-policy',
            'content-security-policy-report-only',
        ]);
        for (const header of rule.action.responseHeaders ?? []) {
            expect(header.operation).toBe('remove');
        }
    });
});

describe('SidePanelFraming', () => {
    it('installs the exception for the first panel and removes it with the last', async () => {
        const rules = client();
        const framing = new SidePanelFraming(rules);

        await framing.acquire();

        expect(framing.active).toBe(true);
        expect(rules.updateDynamicRules).toHaveBeenLastCalledWith({
            removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID],
            addRules: [framingRule()],
        });

        await framing.release();

        expect(framing.active).toBe(false);
        expect(rules.updateDynamicRules).toHaveBeenLastCalledWith({
            removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID],
        });
    });

    it('keeps the exception while another panel still holds it', async () => {
        const rules = client();
        const framing = new SidePanelFraming(rules);

        await framing.acquire();
        await framing.acquire();
        await framing.release();

        expect(framing.active).toBe(true);
        expect(rules.updateDynamicRules).toHaveBeenCalledTimes(1);

        await framing.release();

        expect(framing.active).toBe(false);
        expect(rules.updateDynamicRules).toHaveBeenCalledTimes(2);
    });

    it('ignores a release without a matching acquire', async () => {
        const rules = client();
        const framing = new SidePanelFraming(rules);

        await framing.release();

        expect(framing.active).toBe(false);
        expect(rules.updateDynamicRules).not.toHaveBeenCalled();
    });

    it('leaves no rule behind when a panel closes while the rule is still being installed', async () => {
        const calls: string[] = [];
        let releaseInstall!: () => void;
        const rules: FramingRuleClient = {
            updateDynamicRules: vi.fn(async (options: { addRules?: unknown[] }) => {
                const kind = options.addRules === undefined ? 'remove' : 'add';
                calls.push(kind);
                if (kind === 'add') {
                    await new Promise<void>((resolve) => {
                        releaseInstall = resolve;
                    });
                }
            }),
        };
        const framing = new SidePanelFraming(rules);

        const acquired = framing.acquire();
        await vi.waitFor(() => expect(calls).toEqual(['add']));
        const released = framing.release();
        releaseInstall();
        await Promise.all([acquired, released]);

        expect(framing.active).toBe(false);
        expect(calls).toEqual(['add', 'remove']);
    });

    it('clears a rule left behind by a previous worker', async () => {
        const rules = client();
        const framing = new SidePanelFraming(rules);
        await framing.acquire();

        await framing.reset();

        expect(framing.active).toBe(false);
        expect(rules.updateDynamicRules).toHaveBeenLastCalledWith({
            removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID],
        });
    });

    it('removes a stale startup rule before an immediately overlapping acquire', async () => {
        const rules = client();
        const framing = new SidePanelFraming(rules);

        const resetting = framing.reset();
        const acquiring = framing.acquire();
        await Promise.all([resetting, acquiring]);

        expect(framing.active).toBe(true);
        expect(rules.updateDynamicRules).toHaveBeenNthCalledWith(1, {
            removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID],
        });
        expect(rules.updateDynamicRules).toHaveBeenNthCalledWith(2, {
            removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID],
            addRules: [framingRule()],
        });
    });
});
