import { describe, expect, it } from "vitest";
import { TREE } from "./config";
import { canChopTree, woodFromTree } from "./trees";

describe("canChopTree (§2)", () => {
	it("lets anyone chop on unclaimed or breached land", () => {
		expect(canChopTree("p1", [])).toBe(true);
	});

	it("lets only enclosure owners chop on claimed land", () => {
		expect(canChopTree("p1", ["p1"])).toBe(true);
		expect(canChopTree("p2", ["p1"])).toBe(false);
	});

	it("lets both inner and enclosing owners chop in a nested area", () => {
		const owners = ["inner", "outer"];
		expect(canChopTree("inner", owners)).toBe(true);
		expect(canChopTree("outer", owners)).toBe(true);
		expect(canChopTree("stranger", owners)).toBe(false);
	});
});

describe("woodFromTree", () => {
	it("stays within the configured range", () => {
		expect(woodFromTree(0)).toBe(TREE.woodMin);
		expect(woodFromTree(0.999999)).toBe(TREE.woodMax);
		expect(woodFromTree(1)).toBe(TREE.woodMax);
		expect(woodFromTree(-1)).toBe(TREE.woodMin);
	});
});
