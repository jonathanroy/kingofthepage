import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticHandler } from "./staticFiles";

describe("static client serving", () => {
	let server: Server;
	let base = "";

	beforeAll(async () => {
		const root = mkdtempSync(join(tmpdir(), "kotp-static-"));
		mkdirSync(join(root, "assets"));
		writeFileSync(join(root, "index.html"), "<!doctype html><title>KOTP</title>");
		writeFileSync(
			join(root, "assets", "app-abc123.js"),
			`console.log(${JSON.stringify("x".repeat(5000))});`,
		);
		writeFileSync(join(root, "..", "secret.txt"), "nope");
		const handler = createStaticHandler(root);
		server = createServer((req, res) => {
			if (!handler(req, res)) {
				res.writeHead(418);
				res.end();
			}
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const addr = server.address();
		base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
	});
	afterAll(() => new Promise<void>((r) => server.close(() => r())));

	it("serves index.html without long caching", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		expect(res.headers.get("cache-control")).toBe("no-cache");
		expect(await res.text()).toContain("KOTP");
	});

	it("caches hashed assets forever and gzips them", async () => {
		const res = await fetch(`${base}/assets/app-abc123.js`, {
			headers: { "accept-encoding": "gzip" },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toContain("immutable");
		expect(res.headers.get("content-encoding")).toBe("gzip");
		expect(await res.text()).toContain("console.log");
	});

	it("falls back to index.html for unknown pages, but 404s missing assets", async () => {
		expect(await (await fetch(`${base}/some/page`)).text()).toContain("KOTP");
		expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
	});

	it("never serves files outside the client folder", async () => {
		const res = await fetch(`${base}/..%2fsecret.txt`);
		expect(res.status).toBe(418);
	});
});
