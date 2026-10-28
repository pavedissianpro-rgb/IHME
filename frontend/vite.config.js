import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const basePath = process.env.BASE_PATH || "/";
const apiPrefix = `${basePath}api`;

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    proxy: {
      [apiPrefix]: {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => basePath === "/" ? path : path.slice(basePath.length - 1)
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.js"
  }
});
