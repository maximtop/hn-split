import { resolve } from 'node:path';

import { rspack } from '@rspack/core';
import type { Configuration } from '@rspack/core';

const config: Configuration = {
    mode: 'production',
    entry: {
        background: resolve(import.meta.dirname, 'src/background.ts'),
        options: resolve(import.meta.dirname, 'src/options/main.tsx'),
        popup: resolve(import.meta.dirname, 'src/popup/main.tsx'),
    },
    output: {
        path: resolve(import.meta.dirname, 'dist'),
        filename: ({ chunk }) => chunk?.name === 'background'
            ? 'background.js'
            : 'assets/[name]-[contenthash].js',
        chunkFilename: 'assets/[name]-[contenthash].js',
        cssFilename: 'assets/[name]-[contenthash].css',
        cssChunkFilename: 'assets/[name]-[contenthash].css',
        clean: true,
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.jsx', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                loader: 'builtin:swc-loader',
                options: {
                    jsc: {
                        parser: {
                            syntax: 'typescript',
                            tsx: true,
                        },
                        transform: {
                            react: {
                                runtime: 'automatic',
                            },
                        },
                    },
                },
                type: 'javascript/auto',
            },
            {
                test: /\.css$/,
                type: 'css',
            },
        ],
    },
    experiments: {
        css: true,
    },
    optimization: {
        runtimeChunk: false,
        splitChunks: false,
    },
    performance: false,
    plugins: [
        new rspack.HtmlRspackPlugin({
            chunks: ['popup'],
            filename: 'popup.html',
            template: resolve(import.meta.dirname, 'src/pages/popup.html'),
        }),
        new rspack.HtmlRspackPlugin({
            chunks: ['options'],
            filename: 'options.html',
            template: resolve(import.meta.dirname, 'src/pages/options.html'),
        }),
        new rspack.CopyRspackPlugin({
            patterns: [
                { from: 'public/manifest.json', to: 'manifest.json' },
                { from: 'public/_locales', to: '_locales' },
            ],
        }),
    ],
};

export default config;
