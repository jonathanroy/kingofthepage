import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from "node:crypto";

// scrypt is built into Node, so passwords need no native dependency. The cost settings are
// stored with each hash so they can be raised later without breaking existing profiles.

export type PasswordHasher = {
	hash(password: string): Promise<string>;
	verify(password: string, stored: string): Promise<boolean>;
};

const KEY_LENGTH = 32;
const DEFAULT_COST = { N: 16384, r: 8, p: 1 } as const;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) => {
			if (err) reject(err);
			else resolve(key);
		});
	});
}

export function createScryptHasher(
	cost: { N: number; r: number; p: number } = DEFAULT_COST,
): PasswordHasher {
	return {
		async hash(password) {
			const salt = randomBytes(16);
			const key = await derive(password, salt, { ...cost, maxmem: 128 * cost.N * cost.r * 2 });
			return [
				"scrypt",
				cost.N,
				cost.r,
				cost.p,
				salt.toString("base64"),
				key.toString("base64"),
			].join("$");
		},
		async verify(password, stored) {
			const [scheme, n, r, p, salt, key] = stored.split("$");
			if (scheme !== "scrypt" || !salt || !key) return false;
			const N = Number(n);
			const R = Number(r);
			const options = { N, r: R, p: Number(p), maxmem: 128 * N * R * 2 };
			const expected = Buffer.from(key, "base64");
			const actual = await derive(password, Buffer.from(salt, "base64"), options);
			return actual.length === expected.length && timingSafeEqual(actual, expected);
		},
	};
}
