import { describe, expect, it } from "vitest";
import { checkHandle, normalizeHandle } from "./handles";

describe("checkHandle", () => {
	it("accepts letters, digits and underscores", () => {
		expect(checkHandle("Brave_Otter42").ok).toBe(true);
	});

	it.each(["ab", "x".repeat(17), "has space", "émile", "<script>"])("rejects %s", (h) => {
		expect(checkHandle(h).ok).toBe(false);
	});

	it("normalizes case for uniqueness", () => {
		expect(normalizeHandle("Marco")).toBe(normalizeHandle("marco"));
	});
});
