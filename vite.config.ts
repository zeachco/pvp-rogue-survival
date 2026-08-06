import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
	build: {
		rollupOptions: {
			input: {
				game: resolve(import.meta.dirname, "index.html"),
				devlog: resolve(import.meta.dirname, "devlog.html"),
			},
		},
	},
	server: {
		port: 5173,
		strictPort: false,
		proxy: {
			"/ws": {
				target: "ws://127.0.0.1:3000",
				ws: true,
			},
		},
	},
});
