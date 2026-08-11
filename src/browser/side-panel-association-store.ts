import {
    isSidePanelAssociation,
} from '../shared/side-panel-association';
import type {
    SidePanelAssociation,
} from '../shared/side-panel-association';
import {
    sidePanelAssociationKey,
    sidePanelAssociationTabId,
} from '../shared/storage-keys';

/**
 * Defines the key/value storage boundary used for session associations.
 */
export interface SidePanelAssociationStorage {
    /**
     * Reads one unknown stored value.
     * @param key - Exact session-storage key to read.
     */
    get(key: string): Promise<unknown>;
    /**
     * Reads every stored key/value pair for validated listing.
     */
    getAll(): Promise<Record<string, unknown>>;
    /**
     * Writes one value under an exact session-storage key.
     * @param key - Exact session-storage key to write.
     * @param value - Strict association value to persist.
     */
    set(key: string, value: unknown): Promise<void>;
    /**
     * Removes one exact session-storage key.
     * @param key - Exact session-storage key to remove.
     */
    remove(key: string): Promise<void>;
}

/**
 * Describes one serialized association read/decide/write operation.
 */
export type SidePanelAssociationMutation =
    | { kind: 'keep' }
    | { kind: 'remove' }
    | { kind: 'set'; association: SidePanelAssociation };

/**
 * Serializes all association mutations per tab across every panel window.
 */
export class SidePanelAssociationStore {
    private readonly mutations = new Map<number, Promise<void>>();

    /**
     * Creates a strict session association store.
     * @param storage - Key/value storage used by the process-wide coordinator.
     */
    constructor(private readonly storage: SidePanelAssociationStorage) {}

    /**
     * Reads and validates one association against its key suffix.
     * @param tabId - Tab whose association is read.
     */
    async get(tabId: number): Promise<SidePanelAssociation | null> {
        const value = await this.storage.get(sidePanelAssociationKey(tabId));
        return isSidePanelAssociation(value) && value.tabId === tabId ? value : null;
    }

    /**
     * Waits for every earlier mutation of a tab before reading it.
     * @param tabId - Tab whose settled association is read.
     */
    async settledGet(tabId: number): Promise<SidePanelAssociation | null> {
        await (this.mutations.get(tabId) ?? Promise.resolve()).catch(() => undefined);
        return this.get(tabId);
    }

    /**
     * Persists one runtime-validated association.
     * @param association - Strict session association to persist.
     */
    async set(association: SidePanelAssociation): Promise<void> {
        if (!isSidePanelAssociation(association)) {
            throw new TypeError('Invalid side panel association');
        }
        await this.storage.set(sidePanelAssociationKey(association.tabId), association);
    }

    /**
     * Removes one tab association.
     * @param tabId - Tab whose association is removed.
     */
    async remove(tabId: number): Promise<void> {
        await this.storage.remove(sidePanelAssociationKey(tabId));
    }

    /**
     * Runs one read/decide/write operation after every earlier tab mutation.
     * @param tabId - Tab whose association is mutated.
     * @param operation - Pure decision based on the settled current value.
     */
    async mutate(
        tabId: number,
        operation: (
            current: SidePanelAssociation | null,
        ) => Promise<SidePanelAssociationMutation> | SidePanelAssociationMutation,
    ): Promise<SidePanelAssociation | null> {
        let result: SidePanelAssociation | null = null;
        const previous = this.mutations.get(tabId) ?? Promise.resolve();
        const mutation = previous.catch(() => undefined).then(async () => {
            const current = await this.get(tabId);
            const decision = await operation(current);
            if (decision.kind === 'keep') {
                result = current;
                return;
            }
            if (decision.kind === 'remove') {
                await this.remove(tabId);
                return;
            }
            if (decision.association.tabId !== tabId
                || !isSidePanelAssociation(decision.association)) {
                throw new TypeError('Association mutation targeted another tab or invalid value');
            }
            await this.set(decision.association);
            result = decision.association;
        });
        const tracked = mutation.finally(() => {
            if (this.mutations.get(tabId) === tracked) {
                this.mutations.delete(tabId);
            }
        });
        this.mutations.set(tabId, tracked);
        await tracked;
        return result;
    }

    /**
     * Lists every valid association whose key and embedded tab agree.
     */
    async list(): Promise<SidePanelAssociation[]> {
        return Object.entries(await this.storage.getAll()).flatMap(([key, value]) => {
            const tabId = sidePanelAssociationTabId(key);
            return tabId !== null && isSidePanelAssociation(value) && value.tabId === tabId
                ? [value]
                : [];
        });
    }
}
