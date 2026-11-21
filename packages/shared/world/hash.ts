// Stateless per-tile randomness, so terrain at (x, y) doesn't depend on generation order.

function hashString(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	}
	return h >>> 0;
}

function mix(h: number): number {
	let z = h >>> 0;
	z = Math.imul(z ^ (z >>> 16), 0x7feb352d);
	z = Math.imul(z ^ (z >>> 15), 0x846ca68b);
	return (z ^ (z >>> 16)) >>> 0;
}

/** Deterministic value in [0, 1) for a tile. */
export function tileRandom(seed: string, salt: string, x: number, y: number): number {
	const base = hashString(`${seed}:${salt}`);
	const h = mix(base ^ mix(Math.imul(x | 0, 0x9e3779b1) ^ mix(y | 0)));
	return h / 0x1_0000_0000;
}
