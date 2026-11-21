import { defineConfig } from "vite";

export default defineConfig({
	server: {
		port: 5173,
		// Same-origin /ws in dev, like nginx in production.
		proxy: { "/ws": { target: "ws://localhost:8080", ws: true } },
	},
});
