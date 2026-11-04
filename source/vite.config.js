import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` → dist/ with separate, cacheable images.
// `npm run build:single` → dist-single/index.html with everything inlined (one file to share or submit).
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "single" ? [viteSingleFile()] : [],
  build: {
    outDir: mode === "single" ? "dist-single" : "dist",
    assetsInlineLimit: mode === "single" ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 2000,
  },
  resolve: { preserveSymlinks: true },
  server: { port: 5173 },
}));
