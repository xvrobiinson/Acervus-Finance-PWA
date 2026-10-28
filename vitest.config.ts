import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "domain",
          include: ["shared/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "backend",
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        test: {
          name: "app",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
