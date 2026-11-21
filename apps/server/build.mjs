// Bundles the server (and the TypeScript it imports from @kotp/shared) into one file that plain
// `node` can run in production, without tsx.
import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts"],
	outfile: "dist/server.js",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	sourcemap: true,
	// Optional native speedups for `ws`; it works without them.
	external: ["bufferutil", "utf-8-validate"],
	// Some bundled dependencies are CommonJS and call require().
	banner: {
		js: "import { createRequire as __kotpCreateRequire } from 'node:module'; const require = __kotpCreateRequire(import.meta.url);",
	},
	logLevel: "info",
});
