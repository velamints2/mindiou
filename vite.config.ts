import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    assetsDir: ".",
    rollupOptions: {
      input: {
        g2: resolve(__dirname, "index.html"),
        desktop: resolve(__dirname, "desktop.html")
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5175,
    allowedHosts: true
  },
  preview: {
    host: "0.0.0.0",
    port: 4175,
    allowedHosts: true
  }
});
