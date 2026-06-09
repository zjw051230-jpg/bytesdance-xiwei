import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { getViteServerConfig } from "./scripts/web-ui-runtime.mjs";

export default defineConfig({
  plugins: [react()],
  server: getViteServerConfig(),
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}", "server/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: [...configDefaults.exclude, "agent(1)/**", "**/agent(1)/**"]
  }
});
