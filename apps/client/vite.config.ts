import { defineConfig } from "vite";

export default defineConfig({
	build: {
		// Phaser alone is ~1.4 MB minified; splitting it buys nothing for a single-page game.
		chunkSizeWarningLimit: 2000,
	},
	server: {
		port: 5173,
		// Same-origin /ws in dev, like nginx in production.
		proxy: { "/ws": { target: "ws://localhost:8080", ws: true } },
	},
});
