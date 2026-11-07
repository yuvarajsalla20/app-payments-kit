import { defineConfig } from 'vitest/config';

const stub = (name: string) => new URL(`./tests/stubs/${name}`, import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      'react-native-purchases': stub('purchases.ts'),
      '@revenuecat/purchases-js': stub('purchases-web.ts'),
      'react-native': stub('react-native.ts'),
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
