import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { getViteServerConfig } from "./scripts/web-ui-runtime.mjs";

export default defineConfig({
  plugins: [react()],
  server: {
    ...getViteServerConfig(),
    watch: {
      ignored: [
        "**/agent(1)/**",
        "**/agent(2)/**",
        "**/runs/**",
        "**/reporting/**",
        "**/data/**",
        "**/dist/**",
        "**/node_modules/**"
      ]
    },
    warmup: {
      clientFiles: [
        "./src/main.jsx",
        "./src/components/WorkspaceShell.jsx",
        "./src/components/DSLWorkbench.jsx",
        "./src/components/ClarificationChat.jsx",
        "./src/components/DSLStatusConsole.jsx"
      ]
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}", "server/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: [...configDefaults.exclude, "agent(1)/**", "**/agent(1)/**", "agent(2)/**", "**/agent(2)/**"]
  }
});
