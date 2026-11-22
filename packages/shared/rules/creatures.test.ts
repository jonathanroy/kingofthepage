import { describe, expect, it } from "vitest";
import { CREATURES } from "./config";
import { drawBearDelay } from "./creatures";

describe("drawBearDelay (§9)", () => {
	it("stays within the configured range", () => {
		expect(drawBearDelay(() => 0)).toBe(CREATURES.bearDelayMinMs);
		expect(drawBearDelay(() => 0.999_999)).toBeLessThanOrEqual(CREATURES.bearDelayMaxMs);
		expect(drawBearDelay(() => 0.5)).toBe(
			(CREATURES.bearDelayMinMs + CREATURES.bearDelayMaxMs) / 2,
		);
	});
});
