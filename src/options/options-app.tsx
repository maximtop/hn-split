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
} from '@mantine/core';
import { observer } from 'mobx-react-lite';

import { t } from '../shared/i18n';
import { cssVariablesResolver, theme } from '../shared/theme';
import type { OptionsStore } from './options-store';

/**
 * Supplies observable options state to the page view.
 */
export interface OptionsAppProps {
    /**
     * Owns the automatic-availability toggle state and actions.
     */
    availability: OptionsStore;
    /**
     * Owns the article-click discussion toggle state and actions.
     */
    articleClick: OptionsStore;
}

/**
 * Renders the HN Split options page from observable MobX state.
 * @param props - The observable options stores to render.
 */
function OptionsView(props: OptionsAppProps): React.JSX.Element {
    const { availability, articleClick } = props;
    return (
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
            <Container component="main" size="md" py={64}>
                <Stack gap="xl">
                    <header>
                        <Text c="brand.7" fw={800} size="sm" tt="uppercase">{t('extension_name')}</Text>
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
                                checked={availability.enabled}
                                disabled={availability.busy}
                                size="lg"
                                label={t('automatic_badge_label')}
                                labelPosition="left"
                                onChange={(event) => {
                                    void availability.changeEnabled(event.currentTarget.checked);
                                }}
                            />
                        </Group>
                    </Paper>

                    <Text c="dimmed" size="sm">{t('privacy_note')}</Text>

                    <Paper withBorder radius="lg" p="xl" shadow="sm">
                        <Group justify="space-between" align="center" wrap="nowrap" gap="xl">
                            <Stack gap="xs">
                                <Title order={2} size="h4">{t('article_click_open')}</Title>
                                <Text c="dimmed">{t('article_click_open_description')}</Text>
                            </Stack>
                            <Switch
                                checked={articleClick.enabled}
                                disabled={articleClick.busy}
                                size="lg"
                                label={t('article_click_open_label')}
                                labelPosition="left"
                                onChange={(event) => {
                                    void articleClick.changeEnabled(event.currentTarget.checked);
                                }}
                            />
                        </Group>
                    </Paper>

                    <Paper withBorder radius="lg" p="xl" shadow="sm">
                        <Stack gap="xs">
                            <Title order={2} size="h4">{t('open_in_side_panel')}</Title>
                            <Text c="dimmed">{t('side_panel_notice')}</Text>
                        </Stack>
                    </Paper>

                    {availability.message === ''
                        ? null
                        : (
                                <Alert className="settings-status" color="orange" role="status">
                                    {availability.message}
                                </Alert>
                            )}

                    {articleClick.message === ''
                        ? null
                        : (
                                <Alert className="settings-status" color="orange" role="status">
                                    {articleClick.message}
                                </Alert>
                            )}
                </Stack>
            </Container>
        </MantineProvider>
    );
}

/**
 * Reacts to observable options-store changes without effect-driven local state.
 */
export const OptionsApp = observer(OptionsView);
