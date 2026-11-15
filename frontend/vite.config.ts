/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const cesiumBaseUrl = "cesium";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_URL ?? "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {

        manualChunks(id: string) {
          if (id.includes("node_modules/@cesium/")) return "cesium";
          if (/node_modules\/(react|react-dom|scheduler|zustand)\//.test(id)) return "react";
          return undefined;
        },
      },
    },
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
