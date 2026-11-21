# King of the Page (KOTP) — Game Design

## Overview

King of the Page is a real-time multiplayer web game where players compete for land in an open countryside world. Players chop trees for wood, build fences to enclose territory, upgrade those fences to defend it, and fight over rare gold mines. Two leaderboards rank players by land controlled and gold earned.

**Core loop:** explore → chop trees → build fences → claim land → upgrade and defend → expand or attack.

Numbers marked _(tunable)_ are starting values to adjust during playtesting.

---

## 1. World

- **View:** top-down tile grid, in the style of GameBoy-era Pokémon. Simple, fun pixel art with a limited color palette per biome.
- **Landscape:** countryside with grass, forests, lakes and hills.
- **Generation:** procedural, created as players explore. The world uses a single seed, so the same coordinates always produce the same terrain. The world is split into chunks (e.g. 32×32 tiles).
- **Size:** infinite in all directions. Walking speed is the only practical limit on how far players go.
- **Movement:** 4-directional, one tile at a time. Water (lakes) and hills can't be walked on.
- **Presence:** all online players are visible to each other in real time. Offline characters are not shown.

### Players and spawning

- A player joins by choosing a **handle**, which must be unique. A random fun name is suggested by default so a new player can start right away. No password or email.
- New players spawn on a random **unenclosed** tile **near an existing fence**. If no fence exists in the world yet, they spawn anywhere.
- Returning players reappear **where they left**, even if that spot has since been enclosed (they are then trapped, see §5 Access).

---

## 2. Wood and trees

- Players chop trees to collect wood.
- A tree takes **1 chop** and gives **1–2 wood** _(tunable)_.
- Chopped trees disappear and **grow back** after a delay _(tunable, e.g. 10 minutes)_.
- A tree doesn't grow back while a player stands on its stump; it appears as soon as the tile is empty.
- **Who can chop a tree:**
  - On unclaimed land: anyone.
  - On claimed land: only owners of an enclosure containing that tile (see §5, including enclosing owners of nested areas).
  - On breached land: anyone, since the land is no longer claimed.

---

## 3. Fences

### Building

- Fences cost wood and are placed on empty ground tiles.
- Fences can be built anywhere, **including inside someone else's land** (see §5 Nesting).

### Upgrade levels

Every fence starts basic and can be upgraded by its owner. Each level increases the number of chops an attacker needs to break it.

| Level | Chops to break | Cost           | Look                |
| ----- | -------------- | -------------- | ------------------- |
| 1     | 3              | 2 wood (build) | Twig fence          |
| 2     | 6              | +3 wood        | Plank fence         |
| 3     | 12             | +5 wood        | Log palisade        |
| 4     | 20             | +8 wood        | Reinforced palisade |

_(All values tunable.)_

### Chopping fences

| Whose fence | Chops needed      | Special rule                                                                                    |
| ----------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| Your own    | 1                 | Lets you open your own walls instantly                                                          |
| An enemy's  | Per upgrade level | —                                                                                               |
| An ally's   | Per upgrade level | Confirmation dialog before the first chop; the ally gets a notification; the alliance continues |

- Breaking any fence, **your own or someone else's**, returns **50% of the total wood invested** in it (build + upgrades), rounded down.
- **Damage persists:** chops on a fence add up until it breaks, even across sessions and from different attackers. Nothing heals it except an upgrade.
- **Upgrading repairs:** upgrading a fence resets its damage to zero, so spending wood is the defender's answer to an attack in progress.

### Gates

- A gate is a fence segment that players can walk through.
- The owner **converts one of their existing fences** into a gate for a small extra cost _(tunable, e.g. 2 wood)_. The gate keeps the fence's level and damage, and upgrades, breaks and refunds exactly like a fence.
- Only the **owner and their allies** can pass through a gate.
- Gates count as walls for enclosure purposes.

---

## 4. Alliances

- Players can become allies (friends) by **request and accept**: one player sends a request to a handle, the other accepts or declines. If both request each other, they become allies.
- Allies can pass through each other's gates.
- Allies **can** chop each other's fences, with a warning:
  - Before the first chop, a confirmation dialog appears, e.g. _"This fence belongs to your ally Marco. Removing it may open their land."_
  - The fence's owner is notified, e.g. _"Julie is chopping your fence at (142, 87)."_
  - Chopping an ally's fence does **not** end the alliance; it may simply be fixing a misplaced fence.
- Either player can end the alliance at any time, which immediately removes gate access.
- **Betrayal is an accepted part of the game.** An ally can walk in through your gate and act against you. Players should only ally with people they trust.

---

## 5. Claiming land

### Enclosure

- **Your land is what your own walls close off.** An area belongs to a player once it is fully enclosed by **their own fences (including their gates), together with water and hills**.
- **Other players' fences never close an area for you.** They still block movement, but for enclosure purposes they are treated as open ground. So neighbors can't share a wall, and a player can't claim someone else's land by building one line between that owner's walls (splitting).
- **At least half of the border must be your fences.** Water and hills can make up the rest of an area's outer border, but no more than half of it _(tunable)_. Lakes or hills lying fully inside your land don't count as border. As a result:
  - An area closed off by water and hills alone belongs to no one until someone fences enough of it.
  - A fence ring built against a lake shore or a hillside works.
  - A short fence across a valley mouth, or a few fences at the corners of a lake-locked pocket, claims nothing.
- **Maximum size:** an enclosure can't be larger than a maximum area _(tunable, e.g. 10,000 tiles)_. A larger ring claims nothing. This keeps enclosure checks fast in an infinite world.
- Enclosure is checked on 4-directional connectivity: since players can't move diagonally, fences touching only at corners still close the shape.

### Access

- Only the owner (and allies through gates) can enter claimed land.
- Players inside an area when it gets closed are **not** teleported out. They are trapped inside.

### Breach

- If removing a fence leaves the area no longer closed off by the owner's own walls, the owner **loses all of it instantly**.
- If the area is still closed off (for example, the owner removes a dividing fence between two of their own areas), it simply becomes one larger area. Nothing is lost.
- Anyone can enter breached land through the opening, and its trees become choppable by anyone.
- This is why upgrading fences matters: a large territory has a long perimeter, and every segment is a potential weak point.

### Nesting

- A player can build fences inside another player's land (for example after being trapped there, or as a visiting ally).
- **Access:** an inner area is shared. Both the inner owner and the enclosing owner(s) can walk in and chop its trees.
- **Score and gold:** each tile has exactly one **controller**, the owner of the _smallest_ (by area) enclosure containing it. Only the controller gets the tile on the leaderboard and any gold produced there.
- **Overlapping enclosures:** two players' diagonal walls can cross without sharing a tile, so enclosures may partly overlap without one containing the other. The smallest-enclosure rule still applies tile by tile; on a tie, the **older** enclosure keeps the tile.
- **Wrapping from outside:** building a ring around someone else's whole territory is nesting seen from outside. The wrapper controls the tiles between the two fence lines, and the inner owner keeps control of their land. Like any enclosing owner, the wrapper can enter the inner land and chop its trees.
- **Mine theft:** building a ring around a gold mine inside someone else's land makes you the mine's controller. The outer owner's counter is to chop through that inner fence.
- **Trapped players:** they can't chop trees inside (unless they own an enclosure there). Their way out is to chop through the owner's fence, which breaches the owner's land, or to build their own inner enclosure with wood they were carrying.

---

## 6. Gold mines

- **Rarity:** about 1 mine per 30–50 chunks _(tunable)_, placed deterministically from the world seed.
- **Variants:** small and large; large mines are rarer and produce more.
- **Tile:** a mine is a solid tile. It can't hold a fence and must sit inside an enclosure to produce gold.
- **Production:** gold per minute _(tunable, e.g. 1/min small, 3/min large)_, credited to the mine's controller. Unclaimed mines produce nothing.
- **Offline:** earnings continue while the owner is offline.
- **Role:** mines are hotspots that pull players together and create conflict.

### Gold usage

For now, gold is only for **bragging rights** on the leaderboard. Future ideas: trading, rewards, cosmetics.

---

## 7. Leaderboards

| Leaderboard | Ranked by                                                   |
| ----------- | ----------------------------------------------------------- |
| Land        | Number of tiles currently controlled (innermost owner only), plus the player's own fence and gate tiles that wall their land. Other players' fences standing inside your land don't count for you; stray fences that wall nothing count for nobody. |
| Gold        | Total gold earned, all time                                 |

---

## 8. Technical notes

### Terrain and storage

- Use seeded simplex noise to generate terrain per chunk. Base terrain is never stored.
- Store only the changes to the world: chopped trees (with timestamp), fences (owner, level, wood invested), gates, enclosures and tile controllers.

### Lazy updates (no timers)

- **Tree regrowth:** when a chunk loads, a tree whose chop timestamp is older than the regrow delay simply exists again.
- **Gold:** each mine stores `controller_id` and `controlled_since`. When control changes, or when a balance is read, credit `minutes_elapsed × rate` to the controller and reset `controlled_since`. Leaderboards compute the same amount without writing it, so viewing them doesn't cause database writes.

### Enclosure detection

- On every fence placement or removal, re-run a flood fill from the tiles next to that fence, treating only **that fence owner's** fences, water and hills as walls. Only that owner's enclosures can change.
- An area is enclosed if the fill stops before reaching the maximum area and at least half of its outer border is the owner's fences (§5). The maximum area keeps every fill finite in the infinite world.
- Recompute `controller_id` for affected tiles, picking the innermost enclosure.
- Settle gold for any mine whose controller changes.

### Networking

- The server is authoritative. It validates movement, chops, wood counts, fence placement and gate access.
- Interest management: only send each client the players and changes in chunks near them.

### Stack (to decide)

- **Client:** JavaScript with Phaser 3 (tilemaps and sprites).
- **Server:** either Node.js (Colyseus or Socket.IO), the natural fit for real-time multiplayer, or Laravel with Reverb (WebSockets) to stay in PHP.

---

## 9. MVP scope

**Included:** movement, real-time player visibility, procedural terrain, chopping trees, wood inventory, building fences, enclosure detection, colored ownership overlay, breach detection.

**Next:** fence upgrades, gates, chopping fences with the wood refund, alliances.

**After that:** nesting and controller rules, gold mines, leaderboards.

---

## 10. Open questions

- Can allies chop trees inside your land?
- Should alliances be capped (e.g. 3–5 allies) to prevent everyone allying with everyone?
- Can trees act as walls for enclosure? (Water and hills can; trees are undecided.)
- **Assumed in code, please confirm:**
  - Trees block movement (like Pokémon), so players walk only on grass and on stumps of chopped trees.
  - Fences can be built on stumps, and a tree can't regrow through a fence. When the fence is removed, the tree reappears if its regrow delay has passed.
  - A fence can't be built on a tile where a player is standing.
- **Repairing max-level fences:** upgrading is the only repair and damage never heals, so a level-4 fence can only get weaker over time. Allow a paid repair at max level, or let damage heal slowly?
