import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/content.js',
        'src/lai-main.js',
        'src/options.js',
        'src/jslib/user_input_ribbon.js',
        'src/jslib/ribbon.js',
        'src/jslib/stt.js',
        'src/jslib/solomd2html.js',
        'tests/**'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
