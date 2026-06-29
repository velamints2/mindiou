import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    assetsDir: "."
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
