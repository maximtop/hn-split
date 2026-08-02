import {
    Alert,
    Container,
    Group,
    MantineProvider,
    Paper,
    Stack,
    Switch,
    Text,
    Title,
    createTheme,
} from '@mantine/core';
import { useEffect, useState } from 'react';

import { t } from '../shared/i18n';
import {
    AVAILABILITY_UPDATE_RESULT,
    updateAutomaticAvailability,
} from './availability-settings';

const STORAGE_KEY = 'automatic_availability';
const theme = createTheme({ primaryColor: 'orange' });

/** Renders and coordinates the HN Split options page. */
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
                setMessage(error instanceof Error ? error.message : t('unable_to_load_settings'));
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
            setEnabled(result === AVAILABILITY_UPDATE_RESULT.ENABLED);
            setMessage(result === AVAILABILITY_UPDATE_RESULT.ENABLED
                ? t('automatic_enabled')
                : t('automatic_disabled'));
        } catch (error) {
            const updateMessage = error instanceof Error ? error.message : t('unable_to_update_settings');
            try {
                const stored = await chrome.storage.local.get(STORAGE_KEY);
                setEnabled(stored[STORAGE_KEY] === true);
                setMessage(updateMessage);
            } catch (resyncError) {
                const resyncMessage = resyncError instanceof Error
                    ? resyncError.message
                    : t('unable_to_reload_settings');
                setMessage(`${updateMessage} ${resyncMessage}`);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <MantineProvider theme={theme} defaultColorScheme="light">
            <Container component="main" size="md" py={64}>
                <Stack gap="xl">
                    <header>
                        <Text c="orange.7" fw={800} size="sm" tt="uppercase">HN Split</Text>
                        <Title order={1}>{t('options_heading')}</Title>
                        <Text c="dimmed" mt="sm" size="lg">{t('options_intro')}</Text>
                    </header>

                    <Paper withBorder radius="lg" p="xl" shadow="sm">
                        <Group justify="space-between" align="center" wrap="nowrap" gap="xl">
                            <Stack gap="xs">
                                <Title order={2} size="h4">{t('automatic_badge')}</Title>
                                <Text c="dimmed">{t('automatic_badge_description')}</Text>
                            </Stack>
                            <Switch
                                checked={enabled}
                                disabled={busy}
                                size="lg"
                                label={t('automatic_badge_label')}
                                labelPosition="left"
                                onChange={(event) => {
                                    void changeAutomaticAvailability(event.currentTarget.checked);
                                }}
                            />
                        </Group>
                    </Paper>

                    <Text c="dimmed" size="sm">{t('privacy_note')}</Text>
                    {message === '' ? null : (
                        <Alert className="settings-status" color="orange" role="status">{message}</Alert>
                    )}
                </Stack>
            </Container>
        </MantineProvider>
    );
}
