/**
 * Describes one open tab eligible for an automatic-availability refresh.
 */
export interface TabRefreshTarget {
    /**
     * Contains the browser tab identifier to refresh.
     */
    tabId: number;
    /**
     * Contains the tab's current public URL.
     */
    url: string;
}

/**
 * Refreshes tabs through a bounded worker pool and collects every failure, so
 * enabling automatic mode in a large session cannot burst unbounded lookups.
 * @param targets - The eligible tab refresh targets to process in order.
 * @param refresh - The refresh operation applied to one tab.
 * @param concurrency - The maximum number of refresh operations running at once.
 */
export async function refreshTabsBounded(
    targets: TabRefreshTarget[],
    refresh: (tabId: number, url: string) => Promise<void>,
    concurrency: number,
): Promise<unknown[]> {
    const queue = [...targets];
    const failures: unknown[] = [];
    const workers = Array.from(
        { length: Math.max(1, Math.min(concurrency, queue.length)) },
        async () => {
            for (let target = queue.shift(); target !== undefined; target = queue.shift()) {
                try {
                    await refresh(target.tabId, target.url);
                } catch (error) {
                    failures.push(error);
                }
            }
        },
    );
    await Promise.all(workers);
    return failures;
}
