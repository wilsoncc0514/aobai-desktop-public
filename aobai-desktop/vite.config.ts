import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // The runtime serves builtin atlases; public/pet is a local legacy cache.
    // Copy approved runtime assets explicitly after Vite finishes.
    copyPublicDir: false,
    target: "safari13",
    minify: "esbuild",
    sourcemap: false,
  },
});
