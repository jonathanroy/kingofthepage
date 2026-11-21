import { describe, expect, it } from "vitest";
import type { Enclosure } from "./enclosure";
import { pickController } from "./land";

function enclosure(id: string, ownerId: string, size: number, createdAt: number): Enclosure {
	return {
		id,
		ownerId,
		createdAt,
		tiles: new Set(Array.from({ length: size }, (_, i) => `${i},0`)),
	};
}

describe("pickController (§5 Nesting)", () => {
	it("returns null for unclaimed tiles", () => {
		expect(pickController([])).toBeNull();
	});

	it("picks the smallest enclosure", () => {
		expect(pickController([enclosure("1", "outer", 50, 1), enclosure("2", "inner", 9, 2)])).toBe(
			"inner",
		);
	});

	it("breaks size ties between overlapping enclosures by age, older first", () => {
		expect(pickController([enclosure("1", "young", 9, 5), enclosure("2", "old", 9, 3)])).toBe(
			"old",
		);
	});
});
