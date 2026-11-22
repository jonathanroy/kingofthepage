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
- **Movement:** 4-directional, one tile at a time. Water (lakes), hills and trees can't be walked on; players walk on grass and on the stumps of chopped trees.
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
- A tree can't grow back through a fence built on its stump. When the fence is removed, the tree reappears if its regrow delay has passed.
- **Anyone can chop any tree**, on claimed land or not. Fences are what protect your trees: strangers can't reach them unless they get inside (trapped, through a gate as an ally, or through a breach).

### Iron ore

- **Iron** is the second resource. The walls that contain iron or steel (levels 4, 8, 9 and 10) need it to upgrade (see §3).
- **Ore rocks** sit on grass right next to hills, placed from the world seed like the terrain _(tunable rarity)_. They are solid like trees, can be mined by anyone, and don't count as walls for enclosure.
- Mining works like chopping: face the rock and press the chop key. Each hit gives **1 iron** _(tunable)_.
- A rock holds **a lot of iron** (80–120, set by the seed, _tunable_) and **never comes back**: once empty it turns into rubble, which can be walked on and built on.

---

## 3. Fences

### Building

- Fences cost wood and are placed on empty ground: grass or the stump of a chopped tree, never on a tile where a player is standing.
- Fences can be built anywhere, **including inside someone else's land** (see §5 Nesting).

### Upgrade levels

Every fence starts basic and can be upgraded by its owner. Each level increases the number of chops an attacker needs to break it.

| Level | Chops to break | Cost                     | Look                |
| ----- | -------------- | ------------------------ | ------------------- |
| 1     | 30             | 2 wood (build)           | Twig fence          |
| 2     | 60             | +3 wood                  | Plank fence         |
| 3     | 120            | +5 wood                  | Log palisade        |
| 4     | 200            | +8 wood, **+2 iron**     | Reinforced palisade |
| 5     | 300            | +12 wood                 | Stone wall          |
| 6     | 420            | +17 wood                 | Brick wall          |
| 7     | 560            | +23 wood                 | Fortified wall      |
| 8     | 720            | +30 wood, **+4 iron**    | Iron-bound wall     |
| 9     | 900            | +38 wood, **+6 iron**    | Steel wall          |
| 10    | 1100           | +47 wood, **+10 iron**   | King's wall         |

Breaking walls is deliberately slow so land changes hands through sustained effort rather than quick raids.

_(All values tunable.)_

### Chopping fences

| Whose fence | Chops needed      | Special rule                                                                                    |
| ----------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| Your own    | 1                 | Lets you open your own walls instantly                                                          |
| An enemy's  | Per upgrade level | —                                                                                               |
| An ally's   | Per upgrade level | Confirmation dialog before the first chop; the ally gets a notification; the alliance continues |

- Breaking any fence, **your own or someone else's**, returns **50% of the total wood and iron invested** in it (build + upgrades), each rounded down.
- **Damage persists:** chops on a fence add up until it breaks, even across sessions and from different attackers. Nothing heals it except the owner's repair.
- **Repairing:** the owner can repair a damaged fence at any level for wood (never iron): 1 wood per 20 chops of damage, rounded up _(tunable)_. Repairs don't count as wood invested, so they don't raise the 50% refund.
- **Defended walls hold:** a repair clears all damage, and the owner can repair as often as attackers can chop. An online owner with wood can therefore out-repair any attack. This is intended: walls fall when their owner is away or out of wood, so attacks reward timing and draining the defender's wood.
- **Upgrading needs full health:** a damaged fence must be repaired before it can be upgraded. The same action does both: it repairs a damaged fence, and upgrades an undamaged one.

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
- There is **no limit** on the number of allies.
- **Betrayal is an accepted part of the game.** An ally can walk in through your gate and act against you. Players should only ally with people they trust.

---

## 5. Claiming land

### Enclosure

- **Your land is what your own walls close off.** An area belongs to a player once it is fully enclosed by **their own fences (including their gates), together with water and hills**. Trees never count as walls: anyone can chop them, so only fences protect land.
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
- Anyone can enter breached land through the opening and chop its trees.
- This is why upgrading fences matters: a large territory has a long perimeter, and every segment is a potential weak point.

### Nesting

- A player can build fences inside another player's land (for example after being trapped there, or as a visiting ally).
- **Access:** an inner area is shared. Both the inner owner and the enclosing owner(s) can walk in.
- **Score and gold:** each tile has exactly one **controller**, the owner of the _smallest_ (by area) enclosure containing it. Only the controller gets the tile on the leaderboard and any gold produced there.
- **Overlapping enclosures:** two players' diagonal walls can cross without sharing a tile, so enclosures may partly overlap without one containing the other. The smallest-enclosure rule still applies tile by tile; on a tie, the **older** enclosure keeps the tile.
- **Wrapping from outside:** building a ring around someone else's whole territory is nesting seen from outside. The wrapper controls the tiles between the two fence lines, and the inner owner keeps control of their land. Like any enclosing owner, the wrapper can enter the inner land.
- **Mine theft:** building a ring around a gold mine inside someone else's land makes you the mine's controller. The outer owner's counter is to chop through that inner fence.
- **Trapped players:** they can chop the trees around them for wood. Their way out is to chop through the owner's fence, which breaches the owner's land, or to build their own inner enclosure.

---

## 6. Gold mines

- **Rarity:** about 1 mine per 30–50 chunks _(tunable)_, placed deterministically from the world seed.
- **Variants:** small and large; large mines are rarer and produce more.
- **Tile:** a mine is a solid tile. It can't hold a fence and must sit inside an enclosure to produce gold.
- **Production:** gold per minute _(tunable, e.g. 1/min small, 3/min large)_, credited to the mine's controller. Unclaimed mines produce nothing.
- **Offline:** earnings continue while the owner is offline.
- **Role:** mines are hotspots that pull players together and create conflict.

### Gold usage

Gold buys **collectibles at the magic shop** (§10). Spending never lowers the Gold leaderboard, which ranks total gold earned. Each player has a spendable **balance**: gold earned minus gold spent.

---

## 7. Leaderboards

| Leaderboard | Ranked by                                                   |
| ----------- | ----------------------------------------------------------- |
| Land        | Number of tiles currently controlled (innermost owner only), plus the player's own fence and gate tiles that wall their land. Other players' fences standing inside your land don't count for you; stray fences that wall nothing count for nobody. |
| Gold        | Total gold earned, all time                                 |

---

## 8. Survival

Players must eat and drink to stay alive.

### Meters

- Every player has three meters from 0 to 100: **health**, **food** and **water**.
- Food and water drain over time _(tunable, e.g. food 1 per minute, water 1.5 per minute)_, and faster while working: every chop, mining hit, build, upgrade, spear thrust or harvest costs a little extra.
- **Health** falls only while food or water is empty, or when a zombie bear bites. It recovers slowly while both food and water are at least half full.
- At **0 health** the player dies and respawns like a new player (near a fence, full meters), losing everything they carry: wood, iron, food and their spear. Their land, walls, gold and alliances stay. The axe is never lost.
- **Offline pause:** meters and food spoilage stop while a player is offline. Nobody dies or loses food overnight.

### Water

- Drink by facing a lake tile and using the **interact** key. Each sip restores a good part of the water meter _(tunable)_.

### Food

| Food | Found | Restores | Spoils (one item lost every) |
|---|---|---|---|
| Apples | Apple trees (some round trees), picked with interact | 15 | 30 min |
| Berries | Berry bushes, picked with interact | 8 | 15 min |
| Potatoes | Wild potato patches, dug with interact | 25 | 60 min |
| Meat | Hunting rabbits and deer with the spear | 35 | 12 min |

_(All values tunable.)_

- Apple trees, berry bushes and potato patches are placed from the world seed. A harvest takes everything on the plant; it grows back after a delay _(tunable)_. Chopping an apple tree removes it like any tree.
- **Limited storage:** a player carries at most 12 food items in total _(tunable)_. Harvests and kills beyond that are refused or partly lost.
- **Spoilage:** each kind of food loses one item at its own interval while the player is online, so stockpiling only goes so far.
- **Eating** uses the eat key and eats the item closest to spoiling.

---

## 9. Tools and creatures

### Tools

- Players carry an **axe** (always) and can craft one **spear** _(cost: 4 wood + 1 iron, tunable)_.
- The chop key uses whichever tool is selected; a key switches between them.
  - **Axe:** chops trees and fences, mines iron ore.
  - **Spear:** hits the rabbit, deer or zombie bear in front of the player. It doesn't chop or mine.

### Animals

- **Rabbits** (1 hit, 1 meat) and **deer** (3 hits, 3 meat) roam near online players and flee when someone comes close. They are not saved: they come and go around players.

### Zombie bears

- A **rare event** _(tunable, about once per 40 minutes of play)_: a zombie bear appears some distance from an online player and walks toward them.
- Bears **claw through fences and gates of levels 1–3**. Walls of **level 4 and up hold them back** completely, so iron-reinforced walls are the defense.
- Next to a player, a bear bites for heavy damage every second or so.
- A bear takes **12 spear hits** to kill _(tunable)_ and gives up and leaves after a few minutes.
- Bears only come for players who are online.

---

## 10. Compass and the magic shop

### Flag compass

- Every player has a **flag compass** in the HUD. It points to their nearest **base** (one of their enclosures) and shows the distance in tiles.
- With several bases, a key cycles through them. With none, the compass says so.

### The magic shop

- A **wandering magic shop** appears somewhere in the world and **moves every 24 hours** (at midnight UTC).
- Its spot is picked from the world seed and the date, on open ground within **380 tiles** of the world's center _(tunable)_, never inside claimed land. There are **no hints**: it's an easter egg, found only by exploring.
- It's a solid tile; face it and use **interact** to browse.
- Each day it offers **four collectibles**, one per rarity tier, rotating through the catalog.
- Collectibles are **purely cosmetic and visible to everyone**: hats, capes, pets that follow their owner, auras, a glowing name and a royal wall banner. Each can be bought once per player and is kept forever (never lost on death). Players choose what to wear.
- Prices are deliberately steep, measured in days of one small mine (1,440 gold a day) _(tunable)_:

| Tier | Price | About |
|---|---|---|
| Common | 21,600 gold | 15 days |
| Rare | 43,200 gold | 30 days |
| Epic | 64,800 gold | 45 days |
| Legendary | 129,600 gold | 90 days |

---

## 11. Technical notes

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

## 12. MVP scope

**Included:** movement, real-time player visibility, procedural terrain, chopping trees, wood inventory, building fences, enclosure detection, colored ownership overlay, breach detection.

**Next:** fence upgrades, gates, chopping fences with the wood refund, alliances.

**After that:** nesting and controller rules, gold mines, leaderboards.

---

## 13. Open questions

- None right now.
