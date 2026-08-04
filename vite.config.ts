import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    assetsDir: ".",
    rollupOptions: {
      input: {
        main: "index.html",
        desktop: "desktop.html",
        report: "report.html",
        mvp1: "mvp1.html",
        training: "training.html",
        "cognitive-profile": "cognitive-profile.html",
        "cognitive-report": "cognitive-report.html"
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5175,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:8793",
      "/health": "http://localhost:8793"
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4175,
    allowedHosts: true
  }
});
