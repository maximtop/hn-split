import { useEffect, useState } from 'react';

import type { HnDiscussion, HnLookupResult } from '../domain/hn';
import { readPageContext } from '../page/context';
import { isLookupResponse, isOpenDiscussionResponse } from '../shared/messages';
import type { LookupRequest, OpenDiscussionRequest } from '../shared/messages';

interface PopupState {
    articleTabId: number | null;
    result: HnLookupResult | null;
    error: string | null;
    loading: boolean;
    openingId: string | null;
}

const initialState: PopupState = {
    articleTabId: null,
    result: null,
    error: null,
    loading: true,
    openingId: null,
};

async function sendMessage(request: LookupRequest | OpenDiscussionRequest): Promise<unknown> {
    return chrome.runtime.sendMessage(request);
}

function DiscussionButton({
    discussion,
    primary,
    opening,
    onOpen,
}: {
    discussion: HnDiscussion;
    primary: boolean;
    opening: boolean;
    onOpen: () => void;
}) {
    return (
        <button className="discussion" disabled={opening} onClick={onOpen} type="button">
            <span className="discussion__label">{primary ? 'Open discussion' : 'Open alternative'}</span>
            <strong>{discussion.title}</strong>
            <span className="discussion__meta">
                {discussion.comments} comments · {discussion.points} points
            </span>
        </button>
    );
}

export function App() {
    const [state, setState] = useState<PopupState>(initialState);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab?.id === undefined) {
                    throw new Error('No active browser tab is available.');
                }
                const injections = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: readPageContext,
                });
                const result = injections[0]?.result;
                if (result === undefined) {
                    throw new Error('This page cannot be inspected.');
                }
                const response = await sendMessage({ type: 'lookup', context: result });
                if (!isLookupResponse(response)) {
                    throw new Error('Invalid response from extension.');
                }
                if (!response.ok) {
                    throw new Error(response.error);
                }
                if (!cancelled) {
                    setState({
                        articleTabId: tab.id,
                        result: response.result as HnLookupResult,
                        error: null,
                        loading: false,
                        openingId: null,
                    });
                }
            } catch (error) {
                if (!cancelled) {
                    setState({
                        articleTabId: null,
                        result: null,
                        error: error instanceof Error ? error.message : 'Unable to inspect this page.',
                        loading: false,
                        openingId: null,
                    });
                }
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const open = async (itemId: string) => {
        if (state.articleTabId === null) {
            return;
        }
        setState((current) => ({ ...current, openingId: itemId, error: null }));
        try {
            const response = await sendMessage({
                type: 'open_discussion',
                articleTabId: state.articleTabId,
                itemId,
            });
            if (!isOpenDiscussionResponse(response)) {
                throw new Error('Invalid response from extension.');
            }
            setState((current) => ({
                ...current,
                openingId: null,
                error: response.ok ? null : response.error,
            }));
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'The extension did not respond.';
            setState((current) => ({
                ...current,
                openingId: null,
                error: `Unable to open discussion: ${reason}`,
            }));
        }
    };

    const found = state.result?.status === 'found' ? state.result : null;

    return (
        <main>
            <header>
                <span className="eyebrow">HN Split</span>
                <h1>Hacker News discussion</h1>
            </header>

            {state.loading && <p className="status">Checking this article…</p>}
            {state.error !== null && <p className="status status--error">{state.error}</p>}
            {state.result?.status === 'restricted' && (
                <p className="status">This page is not an eligible public article.</p>
            )}
            {state.result?.status === 'not_found' && (
                <p className="status">No Hacker News discussion was found.</p>
            )}
            {state.result?.status === 'error' && (
                <p className="status status--error">The Hacker News lookup could not be completed.</p>
            )}

            {found !== null && (
                <section className="results" aria-label="Hacker News discussions">
                    <DiscussionButton
                        discussion={found.primary}
                        opening={state.openingId !== null}
                        primary
                        onOpen={() => { void open(found.primary.id); }}
                    />
                    {found.alternatives.map((discussion) => (
                        <DiscussionButton
                            discussion={discussion}
                            key={discussion.id}
                            opening={state.openingId !== null}
                            primary={false}
                            onOpen={() => { void open(discussion.id); }}
                        />
                    ))}
                </section>
            )}

            <footer>
                <p>
                    The first click opens an adjacent tab. Pair it with the article using Chrome Split View;
                    later selections reuse that tab.
                </p>
                <button
                    className="settings-link"
                    type="button"
                    onClick={() => { void chrome.runtime.openOptionsPage(); }}
                >
                    Availability settings
                </button>
            </footer>
        </main>
    );
}
