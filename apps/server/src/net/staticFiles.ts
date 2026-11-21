import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

// Serves the built client when the game server runs without nginx in front (e.g. Railway).
// Mirrors deploy/nginx/kotp.conf: hashed assets cached forever, everything else revalidated,
// unknown paths fall back to index.html.

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".map": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".woff2": "font/woff2",
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".map", ".svg", ".txt"]);

type CachedFile = { readonly body: Buffer; readonly gzipped: Buffer | null; readonly type: string };

export type StaticHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

/** Returns a handler that answers GET/HEAD for files under `root`, or false to let others handle it. */
export function createStaticHandler(root: string): StaticHandler {
	const base = resolve(root);
	// Built files never change while the server runs, so read and compress each once.
	const cache = new Map<string, CachedFile | null>();

	function load(path: string): CachedFile | null {
		const cached = cache.get(path);
		if (cached !== undefined) return cached;
		let file: CachedFile | null = null;
		try {
			if (statSync(path).isFile()) {
				const body = readFileSync(path);
				const ext = extname(path);
				file = {
					body,
					gzipped: COMPRESSIBLE.has(ext) && body.length > 1024 ? gzipSync(body) : null,
					type: TYPES[ext] ?? "application/octet-stream",
				};
			}
		} catch {
			file = null;
		}
		cache.set(path, file);
		return file;
	}

	return (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") return false;
		let pathname: string;
		try {
			pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
		} catch {
			return false;
		}
		const target = resolve(base, `.${pathname}`);
		// Never serve anything outside the client folder.
		if (target !== base && !target.startsWith(base + sep)) return false;

		const isAsset = pathname.startsWith("/assets/");
		const file = load(target) ?? (isAsset ? null : load(resolve(base, "index.html")));
		if (!file) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("Not found\n");
			return true;
		}
		const gzip =
			file.gzipped !== null && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
		const body = gzip && file.gzipped ? file.gzipped : file.body;
		res.writeHead(200, {
			"content-type": file.type,
			"content-length": body.length,
			"cache-control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
			vary: "accept-encoding",
			...(gzip ? { "content-encoding": "gzip" } : {}),
		});
		res.end(req.method === "HEAD" ? undefined : body);
		return true;
	};
}
