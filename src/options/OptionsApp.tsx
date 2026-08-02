import { useEffect, useState } from 'react';

import { updateAutomaticAvailability } from './availabilitySettings';

const STORAGE_KEY = 'automatic_availability';

export function OptionsApp(): React.JSX.Element {
    const [enabled, setEnabled] = useState(false);
    const [busy, setBusy] = useState(true);
    const [message, setMessage] = useState('');

    useEffect(() => {
        let cancelled = false;
        void chrome.storage.local.get(STORAGE_KEY).then((stored) => {
            if (!cancelled) {
                setEnabled(stored[STORAGE_KEY] === true);
                setBusy(false);
            }
        }).catch((error: unknown) => {
            if (!cancelled) {
                setMessage(error instanceof Error ? error.message : 'Unable to load settings.');
                setBusy(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const changeAutomaticAvailability = async (nextEnabled: boolean): Promise<void> => {
        setBusy(true);
        setMessage('');
        try {
            const result = await updateAutomaticAvailability(nextEnabled, {
                notifyChanged: async (value) => chrome.runtime.sendMessage({
                        type: 'availability_setting_changed',
                        enabled: value,
                    }),
            });
            setEnabled(result === 'enabled');
            setMessage(result === 'enabled'
                ? 'Automatic availability badges are enabled.'
                : 'Automatic checks are disabled.');
        } catch (error) {
            const updateMessage = error instanceof Error ? error.message : 'Unable to update settings.';
            try {
                const stored = await chrome.storage.local.get(STORAGE_KEY);
                setEnabled(stored[STORAGE_KEY] === true);
                setMessage(updateMessage);
            } catch (resyncError) {
                const resyncMessage = resyncError instanceof Error
                    ? resyncError.message
                    : 'Unable to reload settings.';
                setMessage(`${updateMessage} ${resyncMessage}`);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="options-shell">
            <header>
                <p className="eyebrow">HN Split</p>
                <h1>Availability indicator</h1>
                <p className="intro">
                    Choose when HN Split may check whether the current article has a Hacker News discussion.
                </p>
            </header>

            <section className="option-card">
                <div>
                    <h2>Automatic toolbar badge</h2>
                    <p>
                        Check article URLs as tabs navigate. When a discussion exists, show an orange badge
                        with its comment count.
                    </p>
                </div>
                <label className="switch">
                    <input
                        type="checkbox"
                        checked={enabled}
                        disabled={busy}
                        onChange={(event) => void changeAutomaticAvailability(event.currentTarget.checked)}
                    />
                    <span aria-hidden="true" />
                    <span className="sr-only">Automatically check article URLs</span>
                </label>
            </section>

            <p className="permission-note">
                Off by default. The installed tab access is used for these checks only when this setting is on.
                Page contents are not read. Discussion tabs still open only after your click.
            </p>

            {message === '' ? null : <p className="settings-status" role="status">{message}</p>}
        </main>
    );
}
