import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/__mindiou_api": {
        target: "http://127.0.0.1:8793",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/__mindiou_api/, "")
      }
    }
  }
});
