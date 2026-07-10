import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true
      }
    }
  }
});
