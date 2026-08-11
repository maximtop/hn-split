import { createTheme, virtualColor } from '@mantine/core';
import type { CSSVariablesResolver, MantineColorsTuple } from '@mantine/core';

// WCAG AA (4.5:1) for small text excludes every stock Mantine orange in the
// light scheme, while the dark scheme needs a brighter shade — the ranges are
// disjoint, so the brand color must be scheme-aware.
const ACCESSIBLE_DEEP_ORANGE = '#c2410c';

// Stock Mantine orange with shades 8 and 9 replaced. Primary controls use
// shade 9 and hover through shade 8, while light controls also resolve their
// text to shade 9. Keeping both deep prevents either interaction state from
// dropping below WCAG AA. The axe E2E gate guards Mantine's mapping.
const ORANGE: MantineColorsTuple = [
    '#fff4e6',
    '#ffe8cc',
    '#ffd8a8',
    '#ffc078',
    '#ffa94d',
    '#ff922b',
    '#fd7e14',
    '#f76707',
    ACCESSIBLE_DEEP_ORANGE,
    ACCESSIBLE_DEEP_ORANGE,
];

// Light-scheme half of the brand color: deep shades meet 4.5:1 on white.
const ORANGE_DEEP: MantineColorsTuple = [
    '#fff4e6',
    '#ffe8cc',
    '#ffd8a8',
    '#ffc078',
    '#ffa94d',
    '#ff922b',
    '#fd7e14',
    ACCESSIBLE_DEEP_ORANGE,
    '#e8590c',
    ACCESSIBLE_DEEP_ORANGE,
];

/**
 * Shared Mantine theme for every extension surface. Primary controls use the
 * deep orange shade in both schemes, while `brand.7` remains scheme-aware for
 * text on the page surface.
 */
export const theme = createTheme({
    primaryColor: 'orange',
    primaryShade: {
        light: 9,
        dark: 9,
    },
    colors: {
        orange: ORANGE,
        orangeDeep: ORANGE_DEEP,
        brand: virtualColor({ name: 'brand', light: 'orangeDeep', dark: 'orange' }),
    },
});

/**
 * Raises Mantine's `dimmed` text color to WCAG AA in both schemes: gray-7
 * (#495057, 8.2:1 on white) in light and dark-1 (#b8b8b8, 7.8:1 on the dark
 * surface) in dark, replacing the stock sub-AA values.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
    variables: {},
    light: {
        '--mantine-color-dimmed': 'var(--mantine-color-gray-7)',
    },
    dark: {
        '--mantine-color-dimmed': 'var(--mantine-color-dark-1)',
    },
});
