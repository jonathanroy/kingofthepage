import { describe, expect, it } from "vitest";
import { createScryptHasher } from "./passwords";

// Low cost keeps the suite fast; the format and checks are what's under test.
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1 });

describe("password hashing", () => {
	it("verifies the right password and rejects others", async () => {
		const stored = await hasher.hash("correct horse");
		expect(stored).not.toContain("correct horse");
		expect(await hasher.verify("correct horse", stored)).toBe(true);
		expect(await hasher.verify("correct hors", stored)).toBe(false);
	});

	it("salts every hash", async () => {
		expect(await hasher.hash("same")).not.toBe(await hasher.hash("same"));
	});

	it("rejects malformed stored hashes", async () => {
		expect(await hasher.verify("x", "plain")).toBe(false);
	});
});
