import { describe, expect, it } from "vitest";
import { AllianceBook } from "./alliances";

describe("AllianceBook (§4)", () => {
	it("forms an alliance by request and accept", () => {
		const book = new AllianceBook();
		expect(book.request("a", "b")).toBe("requested");
		expect(book.incomingRequests("b")).toEqual(["a"]);
		expect(book.outgoingRequests("a")).toEqual(["b"]);
		expect(book.areAllies("a", "b")).toBe(false);
		expect(book.accept("b", "a")).toBe(true);
		expect(book.areAllies("b", "a")).toBe(true);
		expect(book.incomingRequests("b")).toEqual([]);
	});

	it("forms immediately when both ask each other", () => {
		const book = new AllianceBook();
		book.request("a", "b");
		expect(book.request("b", "a")).toBe("formed");
		expect(book.alliesOf("a")).toEqual(["b"]);
	});

	it("rejects self, duplicates and accepting a request that doesn't exist", () => {
		const book = new AllianceBook();
		expect(book.request("a", "a")).toBe("self");
		book.request("a", "b");
		expect(book.request("a", "b")).toBe("alreadyRequested");
		expect(book.accept("a", "b")).toBe(false);
		book.accept("b", "a");
		expect(book.request("a", "b")).toBe("alreadyAllies");
	});

	it("lets either player end it, and declines drop the request", () => {
		const book = new AllianceBook();
		book.request("a", "b");
		book.accept("b", "a");
		expect(book.end("b", "a")).toBe(true);
		expect(book.areAllies("a", "b")).toBe(false);
		expect(book.alliesOf("a")).toEqual([]);
		expect(book.end("a", "b")).toBe(false);

		book.request("a", "c");
		expect(book.decline("c", "a")).toBe(true);
		expect(book.incomingRequests("c")).toEqual([]);
	});
});
