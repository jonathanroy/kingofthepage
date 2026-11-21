import type { PlayerId } from "./types";

function pairKey(a: PlayerId, b: PlayerId): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type AllianceRequestResult =
	| "requested"
	| "formed"
	| "alreadyAllies"
	| "alreadyRequested"
	| "self";

/**
 * §4 Alliances: formed by request and accept, ended by either player.
 * Requests are transient; formed alliances are what gets persisted.
 */
export class AllianceBook {
	private readonly pairs = new Set<string>();
	private readonly alliesByPlayer = new Map<PlayerId, Set<PlayerId>>();
	/** target -> players who asked them */
	private readonly incoming = new Map<PlayerId, Set<PlayerId>>();

	areAllies(a: PlayerId, b: PlayerId): boolean {
		return this.pairs.has(pairKey(a, b));
	}

	alliesOf(id: PlayerId): PlayerId[] {
		return [...(this.alliesByPlayer.get(id) ?? [])];
	}

	incomingRequests(id: PlayerId): PlayerId[] {
		return [...(this.incoming.get(id) ?? [])];
	}

	outgoingRequests(id: PlayerId): PlayerId[] {
		return [...this.incoming.entries()].filter(([, from]) => from.has(id)).map(([to]) => to);
	}

	request(from: PlayerId, to: PlayerId): AllianceRequestResult {
		if (from === to) return "self";
		if (this.areAllies(from, to)) return "alreadyAllies";
		// Asking someone who already asked you is a yes.
		if (this.incoming.get(from)?.has(to)) {
			this.form(from, to);
			return "formed";
		}
		const set = this.incoming.get(to) ?? new Set();
		if (set.has(from)) return "alreadyRequested";
		set.add(from);
		this.incoming.set(to, set);
		return "requested";
	}

	/** Returns false when there was no such request. */
	accept(by: PlayerId, from: PlayerId): boolean {
		if (!this.incoming.get(by)?.has(from)) return false;
		this.form(by, from);
		return true;
	}

	decline(by: PlayerId, from: PlayerId): boolean {
		return this.incoming.get(by)?.delete(from) ?? false;
	}

	/** Either player may end it, at any time (§4). Returns false when they weren't allies. */
	end(a: PlayerId, b: PlayerId): boolean {
		if (!this.pairs.delete(pairKey(a, b))) return false;
		this.alliesByPlayer.get(a)?.delete(b);
		this.alliesByPlayer.get(b)?.delete(a);
		return true;
	}

	/** Restores a persisted alliance. */
	form(a: PlayerId, b: PlayerId): void {
		this.incoming.get(a)?.delete(b);
		this.incoming.get(b)?.delete(a);
		this.pairs.add(pairKey(a, b));
		for (const [x, y] of [
			[a, b],
			[b, a],
		] as const) {
			const set = this.alliesByPlayer.get(x) ?? new Set();
			set.add(y);
			this.alliesByPlayer.set(x, set);
		}
	}
}
