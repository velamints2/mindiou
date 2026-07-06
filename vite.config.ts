import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    assetsDir: ".",
    rollupOptions: {
      input: {
        main: "index.html",
        desktop: "desktop.html",
        report: "report.html"
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
