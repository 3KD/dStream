import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [],
    test: {
        environment: 'jsdom',
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
        setupFiles: [], // Add setup file if needed
    },
});
