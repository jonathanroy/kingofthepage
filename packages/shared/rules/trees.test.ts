import { describe, expect, it } from "vitest";
import { TREE } from "./config";
import { woodFromTree } from "./trees";

describe("woodFromTree", () => {
	it("stays within the configured range", () => {
		expect(woodFromTree(0)).toBe(TREE.woodMin);
		expect(woodFromTree(0.999999)).toBe(TREE.woodMax);
		expect(woodFromTree(1)).toBe(TREE.woodMax);
		expect(woodFromTree(-1)).toBe(TREE.woodMin);
	});
});
