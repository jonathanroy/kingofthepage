const ADJECTIVES = [
	"Brave",
	"Sleepy",
	"Mossy",
	"Lucky",
	"Grumpy",
	"Swift",
	"Tiny",
	"Jolly",
	"Sneaky",
	"Rusty",
	"Misty",
	"Bold",
	"Witty",
	"Fuzzy",
	"Quiet",
	"Golden",
	"Wild",
	"Merry",
	"Clever",
	"Dusty",
];
const NOUNS = [
	"Otter",
	"Badger",
	"Beaver",
	"Fox",
	"Owl",
	"Hedgehog",
	"Moose",
	"Heron",
	"Toad",
	"Squirrel",
	"Lumberjack",
	"Shepherd",
	"Miller",
	"Woodcutter",
	"Ranger",
	"Duke",
	"Baron",
	"Squire",
	"Gnome",
	"Yeti",
];

function pick<T>(items: readonly T[], random: () => number): T {
	return items[Math.floor(random() * items.length)] as T;
}

/** A random fun handle that isn't taken yet (§1 Players and spawning). */
export function suggestHandle(random: () => number, isTaken: (handle: string) => boolean): string {
	for (let i = 0; i < 50; i++) {
		const base = `${pick(ADJECTIVES, random)}${pick(NOUNS, random)}`;
		const handle = i < 5 ? base : `${base}${Math.floor(random() * 1000)}`;
		if (handle.length <= 16 && !isTaken(handle)) return handle;
	}
	return `Player${Math.floor(random() * 1_000_000)}`;
}
