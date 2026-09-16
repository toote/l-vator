/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/L-vator/',
  test: {
    globals: false,
  },
});
