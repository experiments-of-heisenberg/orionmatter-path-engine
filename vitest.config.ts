import { defineConfig } from "vitest/config";

/**
 * Test configuration. The only non-default settings are about patience: CI runners are slower and noisier than a
 * laptop, and a test that waits for the screen should wait for the screen, not for a deadline tuned to a fast machine.
 * A passing test never waits longer because of these numbers; only a slow machine does.
 */
export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
