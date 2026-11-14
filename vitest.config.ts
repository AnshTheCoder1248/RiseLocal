import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // Integration tests share one real database (TEST_DATABASE_URL); run files one at a time.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
