// Decorative-only placement planner for the source-parts castle.
//
// This module deliberately does not import the traversal catalog.  Scenery is
// never a route, connection, integrity group, stair-smoothing target, or demo
// room.  Its catalog therefore contains only the data needed to choose and
// place the already-generated mcstructure files.

export const SOURCE_PARTS_SCENERY_SCHEMA_VERSION = 3;
// Scenery is packed into the empty volume around the playable pieces.  Keep a
// full eight-block service lane around every authored piece/opening, then aim
// for twelve empty blocks in the normal plan.  The old scenery planner used a
// single aggregate castle AABB and started 128 blocks away; that produced an
// isolated outer ring instead of filling the castle silhouette.
export const SCENERY_SAFE_MINIMUM_GAP = 8;
export const SCENERY_INITIAL_GAP = 12;
// `shell` now selects one of three positions along a facade.  This small depth
// relief prevents an unnaturally flat wall while keeping every piece nearby.
export const SCENERY_SHELL_STEP = 6;
export const SCENERY_MAX_SOLID_BLOCKS = 220000;
export const SCENERY_MAX_AABB_VOLUME = 1800000;
export const SCENERY_PLACEMENT_CLEARANCE = 2;
export const SCENERY_NEAR_GAP_MAX = 64;
export const SCENERY_CLUSTER_COUNT = 6;
export const SCENERY_CLUSTER_ATTACHMENT_GAP = 2;
export const SCENERY_CLUSTER_STRONG_GAP = 8;
export const SCENERY_CLUSTER_SEPARATION = 9;
export const SCENERY_CLUSTER_CORE_GAP_MAX = 48;
// Runtime guards use the same per-piece clearance when testing a moving core.
export const SCENERY_CORE_CLEARANCE = SCENERY_SAFE_MINIMUM_GAP;
export const DEFAULT_SCENERY_DENSITY = "default";

export const SOURCE_PARTS_SCENERY_DENSITY = Object.freeze({
    DEFAULT: "default",
    DENSE: "dense",
});

export const SOURCE_PARTS_SCENERY_CATEGORY_COUNTS = Object.freeze({
    default: Object.freeze({ crossroads: 8, room: 8, bridge: 8, stairs: 12 }),
    dense: Object.freeze({ crossroads: 8, room: 8, bridge: 8, stairs: 20 }),
});

const rawVariants = [
    ["castle_part_001_up_r0", "castle_part_001", "交差廊下", "crossroads", "up", 48, 31, 48, 10365],
    ["castle_part_001_up_r1", "castle_part_001", "交差廊下", "crossroads", "up", 48, 31, 48, 10365],
    ["castle_part_001_up_r2", "castle_part_001", "交差廊下", "crossroads", "up", 48, 31, 48, 10365],
    ["castle_part_001_up_r3", "castle_part_001", "交差廊下", "crossroads", "up", 48, 31, 48, 10365],
    ["castle_part_002_up_r3", "castle_part_002", "部屋１", "room", "up", 43, 31, 43, 8142],
    ["castle_part_002_south_r2", "castle_part_002", "部屋１", "room", "south", 43, 43, 31, 8142],
    ["castle_part_002_east_r2", "castle_part_002", "部屋１", "room", "east", 31, 43, 43, 8142],
    ["castle_part_003_up_r2", "castle_part_003", "渡り廊下", "bridge", "up", 19, 31, 48, 5548],
    ["castle_part_003_up_r3", "castle_part_003", "渡り廊下", "bridge", "up", 48, 31, 19, 5548],
    ["castle_part_004_up_r3", "castle_part_004", "階段１", "stairs", "up", 13, 48, 45, 893],
    ["castle_part_004_down_r2", "castle_part_004", "階段１", "stairs", "down", 45, 48, 13, 893],
    ["castle_part_004_north_r3", "castle_part_004", "階段１", "stairs", "north", 13, 45, 48, 893],
    ["castle_part_004_south_r2", "castle_part_004", "階段１", "stairs", "south", 45, 13, 48, 893],
    ["castle_part_004_west_r3", "castle_part_004", "階段１", "stairs", "west", 48, 13, 45, 893],
    ["castle_part_004_east_r2", "castle_part_004", "階段１", "stairs", "east", 48, 45, 13, 893],
    ["castle_part_005_up_r3", "castle_part_005", "階段２", "stairs", "up", 37, 13, 41, 703],
    ["castle_part_005_south_r2", "castle_part_005", "階段２", "stairs", "south", 41, 37, 13, 703],
    ["castle_part_005_east_r2", "castle_part_005", "階段２", "stairs", "east", 13, 41, 37, 703],
    ["castle_part_006_up_r3", "castle_part_006", "階段３", "stairs", "up", 37, 13, 41, 703],
    ["castle_part_006_south_r2", "castle_part_006", "階段３", "stairs", "south", 41, 37, 13, 703],
    ["castle_part_006_east_r2", "castle_part_006", "階段３", "stairs", "east", 13, 41, 37, 703],
];

export const SOURCE_PARTS_SCENERY_VARIANTS = Object.freeze(rawVariants.map((item) => {
    const [id, source, displayName, category, floorNormal, x, y, z, solidBlockCount] = item;
    return Object.freeze({
        id,
        structureId: `infinite_castle:generated_variants/${id}`,
        source,
        displayName,
        category,
        floorNormal,
        size: Object.freeze({ x, y, z }),
        solidBlockCount,
        aabbVolume: x * y * z,
        purpose: "decorative",
    });
}));

const VALID_CATEGORIES = Object.freeze(["crossroads", "room", "bridge", "stairs"]);
const TIERS = Object.freeze(["lower", "middle", "upper"]);
const SIDES = Object.freeze(["north", "east", "south", "west"]);
const CORNERS = Object.freeze(["northwest", "northeast", "southeast", "southwest"]);
const SHELL_VERTICAL_OFFSETS = Object.freeze([-6, 0, 6]);
const SHELL_LONGITUDINAL_RATIOS = Object.freeze([0.18, 0.5, 0.82]);
const OUTWARD_SEARCH_OFFSETS = Object.freeze([0, 8, 20, 36, 58, 84]);
const ALONG_SEARCH_OFFSETS = Object.freeze([0, -18, 18, -40, 40, -68, 68]);
const VERTICAL_SEARCH_OFFSETS = Object.freeze([0, -12, 12, -28, 28]);

// Every tier receives two massive parts of each kind and six light stair parts.
// Rotating the four entries per shell changes the silhouette without changing
// the per-tier/category guarantees.
const SIDE_CATEGORY_PATTERN = Object.freeze([
    Object.freeze(["crossroads", "stairs", "room", "stairs"]),
    Object.freeze(["bridge", "stairs", "crossroads", "stairs"]),
    Object.freeze(["room", "stairs", "bridge", "stairs"]),
]);

const DENSE_CORNER_LAYOUT = Object.freeze([
    Object.freeze({ tier: "lower", shell: 0, corner: "northwest" }),
    Object.freeze({ tier: "lower", shell: 0, corner: "southeast" }),
    Object.freeze({ tier: "middle", shell: 1, corner: "northeast" }),
    Object.freeze({ tier: "middle", shell: 1, corner: "southwest" }),
    Object.freeze({ tier: "upper", shell: 2, corner: "northwest" }),
    Object.freeze({ tier: "upper", shell: 2, corner: "southeast" }),
    Object.freeze({ tier: "lower", shell: 2, corner: "northeast" }),
    Object.freeze({ tier: "upper", shell: 0, corner: "southwest" }),
]);

// One compact six-building mass lives on each side of every vertical tier.
// The bridge is used as a cap at the far ends of two parallel stair flights;
// the room and the extra large piece thicken the mass vertically.  This keeps
// long parts visibly supported instead of scattering them across the sky.
const DEFAULT_CLUSTER_LAYOUT = Object.freeze([
    Object.freeze({ tier: "lower", side: "east", extraCategory: "crossroads" }),
    Object.freeze({ tier: "lower", side: "west", extraCategory: "crossroads" }),
    Object.freeze({ tier: "middle", side: "east", extraCategory: "room" }),
    Object.freeze({ tier: "middle", side: "west", extraCategory: "room" }),
    Object.freeze({ tier: "upper", side: "east", extraCategory: "bridge" }),
    Object.freeze({ tier: "upper", side: "west", extraCategory: "bridge" }),
]);

function finiteInteger(value, label) {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
    return Math.trunc(value);
}

function positiveSize(value, label) {
    if (!value) throw new Error(`${label} is missing`);
    const size = {
        x: finiteInteger(value.x, `${label}.x`),
        y: finiteInteger(value.y, `${label}.y`),
        z: finiteInteger(value.z, `${label}.z`),
    };
    if (size.x < 1 || size.y < 1 || size.z < 1) {
        throw new Error(`${label} must be positive`);
    }
    return size;
}

function integerPoint(value, label) {
    if (!value) throw new Error(`${label} is missing`);
    return {
        x: finiteInteger(value.x, `${label}.x`),
        y: finiteInteger(value.y, `${label}.y`),
        z: finiteInteger(value.z, `${label}.z`),
    };
}

export function sourcePartsSceneryPlacementBounds(placement) {
    const origin = integerPoint(placement?.origin, "placement.origin");
    const size = positiveSize(placement?.size ?? placement?.variant?.size, "placement.size");
    return {
        minX: origin.x,
        minY: origin.y,
        minZ: origin.z,
        maxX: origin.x + size.x - 1,
        maxY: origin.y + size.y - 1,
        maxZ: origin.z + size.z - 1,
    };
}

export function aggregateSourcePartsSceneryBounds(placements) {
    if (!Array.isArray(placements) || placements.length === 0) {
        throw new Error("cannot aggregate empty placement bounds");
    }
    const result = {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        minZ: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        maxZ: Number.NEGATIVE_INFINITY,
    };
    for (const placement of placements) {
        const bounds = sourcePartsSceneryPlacementBounds(placement);
        result.minX = Math.min(result.minX, bounds.minX);
        result.minY = Math.min(result.minY, bounds.minY);
        result.minZ = Math.min(result.minZ, bounds.minZ);
        result.maxX = Math.max(result.maxX, bounds.maxX);
        result.maxY = Math.max(result.maxY, bounds.maxY);
        result.maxZ = Math.max(result.maxZ, bounds.maxZ);
    }
    return result;
}

export function sourcePartsSceneryBoundsIntersect(left, right) {
    return left.minX <= right.maxX && right.minX <= left.maxX
        && left.minY <= right.maxY && right.minY <= left.maxY
        && left.minZ <= right.maxZ && right.minZ <= left.maxZ;
}

// Bedrock-facing helpers use BlockVolume-shaped { from, to } bounds.  Keep the
// min/max helpers above for planner arithmetic and expose these aliases for the
// placement/state layer without coupling that layer to the catalog internals.
export function placementBounds(placement) {
    const bounds = sourcePartsSceneryPlacementBounds(placement);
    return {
        from: { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
        to: { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ },
    };
}

export function sourcePartsAggregateBounds(planOrPlacements) {
    const placements = Array.isArray(planOrPlacements)
        ? planOrPlacements
        : planOrPlacements?.placements;
    const bounds = aggregateSourcePartsSceneryBounds(placements);
    return {
        from: { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
        to: { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ },
    };
}

export function boundsIntersect(left, right) {
    return left.from.x <= right.to.x && right.from.x <= left.to.x
        && left.from.y <= right.to.y && right.from.y <= left.to.y
        && left.from.z <= right.to.z && right.from.z <= left.to.z;
}

export function expandBounds(bounds, margin) {
    const amount = Math.max(0, finiteInteger(margin, "bounds margin"));
    return {
        from: {
            x: bounds.from.x - amount,
            y: bounds.from.y - amount,
            z: bounds.from.z - amount,
        },
        to: {
            x: bounds.to.x + amount,
            y: bounds.to.y + amount,
            z: bounds.to.z + amount,
        },
    };
}

function emptyAxisGap(leftMin, leftMax, rightMin, rightMax) {
    if (leftMax < rightMin) return Math.max(0, rightMin - leftMax - 1);
    if (rightMax < leftMin) return Math.max(0, leftMin - rightMax - 1);
    return 0;
}

/** Returns the shortest number of empty blocks between two inclusive AABBs. */
export function sourcePartsSceneryBoundsDistance(left, right) {
    const dx = emptyAxisGap(left.minX, left.maxX, right.minX, right.maxX);
    const dy = emptyAxisGap(left.minY, left.maxY, right.minY, right.maxY);
    const dz = emptyAxisGap(left.minZ, left.maxZ, right.minZ, right.maxZ);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function cloneBounds(bounds) {
    return {
        minX: bounds.minX,
        minY: bounds.minY,
        minZ: bounds.minZ,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
        maxZ: bounds.maxZ,
    };
}

function normalizeDensity(value) {
    const density = value ?? SOURCE_PARTS_SCENERY_DENSITY.DEFAULT;
    if (!Object.values(SOURCE_PARTS_SCENERY_DENSITY).includes(density)) {
        throw new Error(`unsupported source-parts scenery density: ${density}`);
    }
    return density;
}

function normalizeHeightRange(value) {
    const range = value ?? { min: -64, max: 320 };
    const min = finiteInteger(range.min, "heightRange.min");
    const max = finiteInteger(range.max, "heightRange.max");
    if (max <= min) throw new Error(`invalid height range ${min}..${max}`);
    return { min, max };
}

function normalizeGap(value) {
    const gap = finiteInteger(value ?? SCENERY_INITIAL_GAP, "initialGap");
    if (gap < SCENERY_SAFE_MINIMUM_GAP) {
        throw new Error(
            `source-parts scenery gap ${gap} is below safe minimum ${SCENERY_SAFE_MINIMUM_GAP}`
        );
    }
    return gap;
}

function mix32(value) {
    let result = value >>> 0;
    result ^= result >>> 16;
    result = Math.imul(result, 0x7feb352d);
    result ^= result >>> 15;
    result = Math.imul(result, 0x846ca68b);
    result ^= result >>> 16;
    return result >>> 0;
}

function stringHash(value) {
    let result = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 0x01000193);
    }
    return result >>> 0;
}

function deterministicScore(seed, salt) {
    return mix32((seed >>> 0) ^ stringHash(salt));
}

function seededShuffle(items, seed, salt) {
    const result = items.slice();
    let state = deterministicScore(seed, salt) || 0x6d2b79f5;
    for (let index = result.length - 1; index > 0; index -= 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const swapIndex = (state >>> 0) % (index + 1);
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function rotate(items, amount) {
    const offset = ((amount % items.length) + items.length) % items.length;
    return items.map((_, index) => items[(index + offset) % items.length]);
}

function buildSideSlots(seed) {
    const slots = [];
    for (let tierIndex = 0; tierIndex < TIERS.length; tierIndex += 1) {
        const tier = TIERS[tierIndex];
        for (let shell = 0; shell < 3; shell += 1) {
            const rotation = deterministicScore(seed, `side-category:${tier}:${shell}`) % SIDES.length;
            const categories = rotate(SIDE_CATEGORY_PATTERN[shell], rotation);
            for (let sideIndex = 0; sideIndex < SIDES.length; sideIndex += 1) {
                const side = SIDES[sideIndex];
                slots.push({
                    slotId: `side.${tier}.s${shell}.${side}`,
                    slotType: "side",
                    tier,
                    shell,
                    side,
                    category: categories[sideIndex],
                });
            }
        }
    }
    return slots;
}

function buildDefaultClusterSlots() {
    const slots = [];
    for (let clusterIndex = 0; clusterIndex < DEFAULT_CLUSTER_LAYOUT.length; clusterIndex += 1) {
        const cluster = DEFAULT_CLUSTER_LAYOUT[clusterIndex];
        const shared = {
            slotType: "cluster",
            clusterIndex,
            clusterId: `scenery.cluster.${clusterIndex}`,
            tier: cluster.tier,
            side: cluster.side,
            shell: 0,
        };
        for (const [role, category] of [
            ["anchor", "crossroads"],
            ["room_mass", "room"],
            ["bridge_cap", "bridge"],
            ["stair_a", "stairs"],
            ["stair_b", "stairs"],
            ["extra_mass", cluster.extraCategory],
        ]) {
            slots.push({
                ...shared,
                role,
                category,
                slotId: `cluster.${clusterIndex}.${role}`,
            });
        }
    }
    return slots;
}

function buildDenseClusterSlots() {
    const slots = buildDefaultClusterSlots();
    for (let clusterIndex = 0; clusterIndex < SCENERY_CLUSTER_COUNT; clusterIndex += 1) {
        const cluster = DEFAULT_CLUSTER_LAYOUT[clusterIndex];
        const roles = clusterIndex < 4
            ? ["dense_stair_a"]
            : ["dense_stair_a", "dense_stair_b"];
        for (const role of roles) {
            slots.push({
                slotType: "cluster",
                clusterIndex,
                clusterId: `scenery.cluster.${clusterIndex}`,
                tier: cluster.tier,
                side: cluster.side,
                shell: 0,
                role,
                category: "stairs",
                slotId: `cluster.${clusterIndex}.${role}`,
            });
        }
    }
    return slots;
}

function buildDenseCornerSlots(seed) {
    const first = seededShuffle(VALID_CATEGORIES, seed, "dense-categories-a");
    const second = seededShuffle(VALID_CATEGORIES, seed, "dense-categories-b");
    const categories = [...first, ...second];
    return DENSE_CORNER_LAYOUT.map((slot, index) => ({
        slotId: `corner.${slot.tier}.s${slot.shell}.${slot.corner}`,
        slotType: "corner",
        tier: slot.tier,
        shell: slot.shell,
        corner: slot.corner,
        category: categories[index],
    }));
}

function variantsByCategory(category) {
    return SOURCE_PARTS_SCENERY_VARIANTS.filter((variant) => variant.category === category);
}

function variantById(id) {
    const variant = SOURCE_PARTS_SCENERY_VARIANTS.find((item) => item.id === id);
    if (!variant) throw new Error(`unknown scenery variant ${id}`);
    return variant;
}

function assignDefaultClusterVariants(slots, seed) {
    const assigned = new Map();
    const denseClusters = slots.some((slot) => slot.role === "dense_stair_a");

    // Eight crossroads: every upright rotation appears twice.  Six are the
    // cluster anchors and two are extra masonry masses.
    const crossroads = seededShuffle([
        ...variantsByCategory("crossroads"),
        ...variantsByCategory("crossroads"),
    ], seed, "cluster-crossroads");
    const crossSlots = slots.filter((slot) => slot.category === "crossroads");
    crossSlots.forEach((slot, index) => assigned.set(slot.slotId, crossroads[index]));

    // Keep the default silhouette upright.  Two deliberately rejected room
    // orientations provide the impossible-castle accent, each exactly once;
    // the other six rooms use the authored upright variant.
    const baseRoomSlots = seededShuffle(
        slots.filter((slot) => slot.role === "room_mass"),
        seed,
        "cluster-special-room-slots"
    );
    const roomSpecials = seededShuffle([
        variantById("castle_part_002_south_r2"),
        variantById("castle_part_002_east_r2"),
    ], seed, "cluster-special-rooms");
    assigned.set(baseRoomSlots[0].slotId, roomSpecials[0]);
    assigned.set(baseRoomSlots[1].slotId, roomSpecials[1]);
    const uprightRoom = variantById("castle_part_002_up_r3");
    for (const slot of slots.filter((item) => item.category === "room")) {
        if (!assigned.has(slot.slotId)) assigned.set(slot.slotId, uprightRoom);
    }

    // A wide, shallow bridge caps both stair flights.  The two extra bridges
    // use the alternate upright rotation to break repetition without adding a
    // sideways structure.
    const bridgeCap = variantById("castle_part_003_up_r3");
    const bridgeExtra = variantById("castle_part_003_up_r2");
    for (const slot of slots.filter((item) => item.category === "bridge")) {
        assigned.set(
            slot.slotId,
            slot.role === "bridge_cap" || denseClusters ? bridgeCap : bridgeExtra
        );
    }

    // The narrow part_004 stair and one medium stair fit side by side across a
    // 48-block anchor face.  All default stairs stay upright; the three source
    // designs are repeated evenly across the six clusters.
    const narrowStair = variantById("castle_part_004_up_r3");
    const mediumStairs = seededShuffle([
        variantById("castle_part_005_up_r3"),
        variantById("castle_part_005_up_r3"),
        variantById("castle_part_005_up_r3"),
        variantById("castle_part_006_up_r3"),
        variantById("castle_part_006_up_r3"),
        variantById("castle_part_006_up_r3"),
    ], seed, "cluster-medium-stairs");
    for (let clusterIndex = 0; clusterIndex < SCENERY_CLUSTER_COUNT; clusterIndex += 1) {
        assigned.set(`cluster.${clusterIndex}.stair_a`, narrowStair);
        assigned.set(`cluster.${clusterIndex}.stair_b`, mediumStairs[clusterIndex]);
    }
    const denseMedium = seededShuffle([
        variantById("castle_part_005_up_r3"),
        variantById("castle_part_005_up_r3"),
        variantById("castle_part_005_up_r3"),
        variantById("castle_part_006_up_r3"),
        variantById("castle_part_006_up_r3"),
        variantById("castle_part_006_up_r3"),
    ], seed, "cluster-dense-medium-stairs");
    for (let clusterIndex = 0; clusterIndex < SCENERY_CLUSTER_COUNT; clusterIndex += 1) {
        const denseA = `cluster.${clusterIndex}.dense_stair_a`;
        if (slots.some((slot) => slot.slotId === denseA)) {
            assigned.set(denseA, clusterIndex < 4 ? denseMedium[clusterIndex] : narrowStair);
        }
        const denseB = `cluster.${clusterIndex}.dense_stair_b`;
        if (slots.some((slot) => slot.slotId === denseB)) {
            assigned.set(denseB, denseMedium[clusterIndex]);
        }
    }

    for (const slot of slots) {
        if (!assigned.has(slot.slotId)) {
            throw new Error(`default scenery slot ${slot.slotId} has no variant`);
        }
    }
    return assigned;
}

function selectedVariantsForCategory(category, count, seed) {
    const available = variantsByCategory(category);
    if (available.length === 0 || count < available.length) {
        throw new Error(`${category} quota ${count} cannot include all ${available.length} variants`);
    }
    const selected = seededShuffle(available, seed, `mandatory:${category}`);
    let cycle = 0;
    while (selected.length < count) {
        const additions = seededShuffle(available, seed, `repeat:${category}:${cycle}`);
        selected.push(...additions.slice(0, count - selected.length));
        cycle += 1;
    }
    return seededShuffle(selected, seed, `assignment:${category}`);
}

function preferredInwardSide(floorNormal) {
    return {
        north: "south",
        south: "north",
        west: "east",
        east: "west",
    }[floorNormal] ?? null;
}

function slotFacesSide(slot, side) {
    if (!side) return false;
    if (slot.side === side) return true;
    return typeof slot.corner === "string" && slot.corner.includes(side);
}

function assignVariantsToSlots(slots, density, seed) {
    if (slots.every((slot) => slot.slotType === "cluster")) {
        return assignDefaultClusterVariants(slots, seed);
    }
    const expected = SOURCE_PARTS_SCENERY_CATEGORY_COUNTS[density];
    const assigned = new Map();
    for (const category of VALID_CATEGORIES) {
        const categorySlots = slots.filter((slot) => slot.category === category);
        if (categorySlots.length !== expected[category]) {
            throw new Error(
                `${density} slot count ${category}.${categorySlots.length} != ${expected[category]}`
            );
        }
        const selected = selectedVariantsForCategory(category, expected[category], seed);
        const remainingSlots = categorySlots.slice();
        const orientedFirst = selected.slice().sort((left, right) => {
            const leftOriented = preferredInwardSide(left.floorNormal) ? 0 : 1;
            const rightOriented = preferredInwardSide(right.floorNormal) ? 0 : 1;
            return leftOriented - rightOriented
                || deterministicScore(seed, `variant:${left.id}`)
                    - deterministicScore(seed, `variant:${right.id}`);
        });
        for (let index = 0; index < orientedFirst.length; index += 1) {
            const variant = orientedFirst[index];
            const preferredSide = preferredInwardSide(variant.floorNormal);
            remainingSlots.sort((left, right) => {
                const leftPreference = slotFacesSide(left, preferredSide) ? 0 : 1;
                const rightPreference = slotFacesSide(right, preferredSide) ? 0 : 1;
                return leftPreference - rightPreference
                    || deterministicScore(seed, `${variant.id}:${left.slotId}:${index}`)
                        - deterministicScore(seed, `${variant.id}:${right.slotId}:${index}`);
            });
            const slot = remainingSlots.shift();
            assigned.set(slot.slotId, variant);
        }
    }
    return assigned;
}

function placementsForTier(corePlan, tier) {
    const placements = corePlan.placements.filter((placement) => placement.tier === tier);
    if (placements.length === 0) {
        throw new Error(`source-parts scenery core plan has no ${tier} tier placements`);
    }
    return placements;
}

function centeredOrigin(minimum, maximum, length) {
    return Math.floor((minimum + maximum + 1 - length) / 2);
}

function clampedOriginY(requested, sizeY, heightRange) {
    if (sizeY > heightRange.max - heightRange.min) {
        throw new Error(
            `scenery height ${sizeY} exceeds world height ${heightRange.min}..${heightRange.max}`
        );
    }
    return Math.max(heightRange.min, Math.min(requested, heightRange.max - sizeY));
}

function expandMinMaxBounds(bounds, margin) {
    return {
        minX: bounds.minX - margin,
        minY: bounds.minY - margin,
        minZ: bounds.minZ - margin,
        maxX: bounds.maxX + margin,
        maxY: bounds.maxY + margin,
        maxZ: bounds.maxZ + margin,
    };
}

function connectionReservationBounds(corePlan, margin) {
    const result = [];
    const scalarFields = ["from", "to"];
    const arrayFields = ["fromLanes", "toLanes", "fromCarve", "toCarve"];
    for (const connection of corePlan.connections ?? []) {
        const points = [];
        for (const field of scalarFields) {
            const point = connection?.[field];
            if (Number.isFinite(point?.x) && Number.isFinite(point?.y)
                && Number.isFinite(point?.z)) {
                points.push(integerPoint(point, `connection.${field}`));
            }
        }
        for (const field of arrayFields) {
            for (const point of connection?.[field] ?? []) {
                if (Number.isFinite(point?.x) && Number.isFinite(point?.y)
                    && Number.isFinite(point?.z)) {
                    points.push(integerPoint(point, `connection.${field}`));
                }
            }
        }
        if (points.length > 0) {
            const bounds = {
                minX: Math.min(...points.map((point) => point.x)),
                minY: Math.min(...points.map((point) => point.y)),
                minZ: Math.min(...points.map((point) => point.z)),
                maxX: Math.max(...points.map((point) => point.x)),
                maxY: Math.max(...points.map((point) => point.y)),
                maxZ: Math.max(...points.map((point) => point.z)),
            };
            result.push(expandMinMaxBounds(bounds, margin));
        }
    }
    return result;
}

/**
 * Individual reservations deliberately preserve the voids between buildings.
 * The aggregate AABB is still returned as plan metadata, but must not be used
 * as a collision volume: most of the desired infill lives inside that box.
 */
export function sourcePartsSceneryCoreReservations(corePlan, clearance = SCENERY_CORE_CLEARANCE) {
    const margin = Math.max(0, finiteInteger(clearance, "core clearance"));
    const placementReservations = corePlan.placements.map((placement) =>
        expandMinMaxBounds(sourcePartsSceneryPlacementBounds(placement), margin)
    );
    const openingReservations = connectionReservationBounds(corePlan, margin);
    return [...placementReservations, ...openingReservations];
}

function coreFootprintIntersects(bounds, coreBounds) {
    return bounds.minX <= coreBounds.maxX && coreBounds.minX <= bounds.maxX
        && bounds.minZ <= coreBounds.maxZ && coreBounds.minZ <= bounds.maxZ;
}

function minimumBoundsDistance(bounds, otherBounds) {
    let minimum = Number.POSITIVE_INFINITY;
    for (const other of otherBounds) {
        minimum = Math.min(minimum, sourcePartsSceneryBoundsDistance(bounds, other));
    }
    return minimum;
}

function facadeAnchor(slot, variant, tierBounds, initialGap, heightRange) {
    const depth = initialGap + slot.shell * SCENERY_SHELL_STEP;
    const ratio = SHELL_LONGITUDINAL_RATIOS[slot.shell] ?? 0.5;
    const centerX = tierBounds.minX + (tierBounds.maxX - tierBounds.minX) * ratio;
    const centerZ = tierBounds.minZ + (tierBounds.maxZ - tierBounds.minZ) * ratio;
    const origin = {
        x: Math.round(centerX - (variant.size.x - 1) / 2),
        y: clampedOriginY(
            centeredOrigin(tierBounds.minY, tierBounds.maxY, variant.size.y)
                + SHELL_VERTICAL_OFFSETS[slot.shell],
            variant.size.y,
            heightRange
        ),
        z: Math.round(centerZ - (variant.size.z - 1) / 2),
    };
    const north = slot.side === "north" || slot.corner?.includes("north");
    const south = slot.side === "south" || slot.corner?.includes("south");
    const west = slot.side === "west" || slot.corner?.includes("west");
    const east = slot.side === "east" || slot.corner?.includes("east");
    if (north) origin.z = tierBounds.minZ - depth - variant.size.z;
    if (south) origin.z = tierBounds.maxZ + depth + 1;
    if (west) origin.x = tierBounds.minX - depth - variant.size.x;
    if (east) origin.x = tierBounds.maxX + depth + 1;
    return origin;
}

function shiftedFacadeOrigin(anchor, slot, outward, along, vertical, variant, heightRange) {
    const result = {
        x: anchor.x,
        y: clampedOriginY(anchor.y + vertical, variant.size.y, heightRange),
        z: anchor.z,
    };
    if (slot.side === "north") {
        result.z -= outward;
        result.x += along;
    } else if (slot.side === "south") {
        result.z += outward;
        result.x += along;
    } else if (slot.side === "west") {
        result.x -= outward;
        result.z += along;
    } else if (slot.side === "east") {
        result.x += outward;
        result.z += along;
    } else {
        if (slot.corner?.includes("north")) result.z -= outward;
        if (slot.corner?.includes("south")) result.z += outward;
        if (slot.corner?.includes("west")) result.x -= outward;
        if (slot.corner?.includes("east")) result.x += outward;
        // Slide corner pieces tangentially instead of stacking every retry on
        // the same diagonal.
        result.x += along;
        result.z -= along;
    }
    return result;
}

function addCandidate(result, seen, origin, layoutMode) {
    const key = `${origin.x},${origin.y},${origin.z}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ origin, layoutMode });
}

function candidateOriginsForSlot(
    slot, variant, coreBounds, tierBounds, initialGap, heightRange, seed
) {
    const result = [];
    const seen = new Set();
    const anchor = facadeAnchor(slot, variant, tierBounds, initialGap, heightRange);
    const outwardOffsets = seededShuffle(
        OUTWARD_SEARCH_OFFSETS, seed, `outward:${slot.slotId}:${variant.id}`
    ).sort((left, right) => left - right);
    const alongOffsets = seededShuffle(
        ALONG_SEARCH_OFFSETS, seed, `along:${slot.slotId}:${variant.id}`
    );
    const verticalOffsets = seededShuffle(
        VERTICAL_SEARCH_OFFSETS, seed, `vertical:${slot.slotId}:${variant.id}`
    );
    for (const outward of outwardOffsets) {
        for (const vertical of verticalOffsets) {
            for (const along of alongOffsets) {
                addCandidate(
                    result,
                    seen,
                    shiftedFacadeOrigin(
                        anchor, slot, outward, along, vertical, variant, heightRange
                    ),
                    "facade_infill"
                );
            }
        }
    }

    // Also sample the aggregate envelope itself.  Individual collision volumes
    // reject playable buildings and seams, leaving only genuine three-
    // dimensional gaps between the staggered lower/middle/upper masses.
    const xSpan = Math.max(1, coreBounds.maxX - coreBounds.minX);
    const zSpan = Math.max(1, coreBounds.maxZ - coreBounds.minZ);
    const ratios = seededShuffle(
        [0.12, 0.24, 0.36, 0.5, 0.64, 0.76, 0.88],
        seed,
        `void-grid:${slot.slotId}:${variant.id}`
    );
    const voidVerticalOffsets = seededShuffle(
        [0, -16, 16, -32, 32],
        seed,
        `void-y:${slot.slotId}:${variant.id}`
    );
    for (const xRatio of ratios) {
        for (const zRatio of ratios) {
            for (const vertical of voidVerticalOffsets) {
                const centerX = coreBounds.minX + xSpan * xRatio;
                const centerZ = coreBounds.minZ + zSpan * zRatio;
                addCandidate(result, seen, {
                    x: Math.round(centerX - (variant.size.x - 1) / 2),
                    y: clampedOriginY(
                        centeredOrigin(tierBounds.minY, tierBounds.maxY, variant.size.y)
                            + vertical,
                        variant.size.y,
                        heightRange
                    ),
                    z: Math.round(centerZ - (variant.size.z - 1) / 2),
                }, "envelope_infill");
            }
        }
    }
    return { anchor, candidates: result };
}

function originDistance(left, right) {
    return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
        + Math.abs(left.z - right.z);
}

function selectOriginForSlot(
    slot,
    variant,
    coreBounds,
    corePlacementBounds,
    coreReservations,
    tierBounds,
    initialGap,
    heightRange,
    occupiedBounds,
    seed
) {
    const { anchor, candidates } = candidateOriginsForSlot(
        slot, variant, coreBounds, tierBounds, initialGap, heightRange, seed
    );
    let best = null;
    for (const candidate of candidates) {
        const placement = { origin: candidate.origin, size: variant.size };
        const bounds = sourcePartsSceneryPlacementBounds(placement);
        if (bounds.minY < heightRange.min || bounds.maxY >= heightRange.max) continue;
        if (coreReservations.some((reserved) =>
            sourcePartsSceneryBoundsIntersect(bounds, reserved))) continue;
        const paddedBounds = expandMinMaxBounds(bounds, SCENERY_PLACEMENT_CLEARANCE);
        if (occupiedBounds.some((occupied) =>
            sourcePartsSceneryBoundsIntersect(paddedBounds, occupied))) continue;

        const nearestCoreGap = minimumBoundsDistance(bounds, corePlacementBounds);
        const insideAggregate = sourcePartsSceneryBoundsIntersect(bounds, coreBounds);
        const insideFootprint = coreFootprintIntersects(bounds, coreBounds);
        const infillPenalty = insideAggregate ? 0 : (insideFootprint ? 15000 : 45000);
        const gapPenalty = Math.abs(nearestCoreGap - initialGap) * 1000;
        const anchorPenalty = originDistance(candidate.origin, anchor) * 4;
        const layoutBonus = candidate.layoutMode === "envelope_infill" ? -250 : 0;
        const tie = deterministicScore(
            seed,
            `${slot.slotId}:${variant.id}:${candidate.origin.x},${candidate.origin.y},${candidate.origin.z}`
        ) % 997;
        const evaluated = {
            ...candidate,
            bounds,
            nearestCoreGap,
            insideAggregate,
            insideFootprint,
            score: infillPenalty + gapPenalty + anchorPenalty + layoutBonus + tie,
        };
        if (!best || evaluated.score < best.score
            || (evaluated.score === best.score
                && (evaluated.origin.x < best.origin.x
                    || (evaluated.origin.x === best.origin.x
                        && (evaluated.origin.y < best.origin.y
                            || (evaluated.origin.y === best.origin.y
                                && evaluated.origin.z < best.origin.z)))))) {
            best = evaluated;
        }
    }
    if (!best) {
        throw new Error(`cannot find safe infill origin for ${slot.slotId}/${variant.id}`);
    }
    return best;
}

function originAgainstFace(anchorBounds, size, direction, gap) {
    const origin = {
        x: centeredOrigin(anchorBounds.minX, anchorBounds.maxX, size.x),
        y: centeredOrigin(anchorBounds.minY, anchorBounds.maxY, size.y),
        z: centeredOrigin(anchorBounds.minZ, anchorBounds.maxZ, size.z),
    };
    if (direction === "north") {
        origin.z = anchorBounds.minZ - gap - size.z;
    } else if (direction === "south") {
        origin.z = anchorBounds.maxZ + gap + 1;
    } else if (direction === "below") {
        origin.y = anchorBounds.minY - gap - size.y;
    } else if (direction === "above") {
        origin.y = anchorBounds.maxY + gap + 1;
    } else {
        throw new Error(`unsupported cluster face ${direction}`);
    }
    return origin;
}

function boundsFromOrigin(origin, variant) {
    return sourcePartsSceneryPlacementBounds({ origin, size: variant.size });
}

function defaultClusterLayout(entries, anchorOrigin, direction, mirror) {
    const byRole = new Map(entries.map((entry) => [entry.slot.role, entry]));
    const anchorEntry = byRole.get("anchor");
    const roomEntry = byRole.get("room_mass");
    const capEntry = byRole.get("bridge_cap");
    const stairAEntry = byRole.get("stair_a");
    const stairBEntry = byRole.get("stair_b");
    const extraEntry = byRole.get("extra_mass");
    const denseStairAEntry = byRole.get("dense_stair_a");
    const denseStairBEntry = byRole.get("dense_stair_b");
    if (!anchorEntry || !roomEntry || !capEntry || !stairAEntry
        || !stairBEntry || !extraEntry) {
        throw new Error("default cluster is missing a required role");
    }

    const gap = SCENERY_CLUSTER_ATTACHMENT_GAP;
    const anchorBounds = boundsFromOrigin(anchorOrigin, anchorEntry.variant);
    const nearZ = direction === "north"
        ? anchorBounds.minZ - gap - 1
        : anchorBounds.maxZ + gap + 1;
    const stairX = mirror
        ? {
            a: anchorBounds.minX + 37,
            b: anchorBounds.minX - 2,
        }
        : {
            a: anchorBounds.minX - 2,
            b: anchorBounds.minX + 13,
        };
    const stairAOrigin = {
        x: stairX.a,
        y: centeredOrigin(anchorBounds.minY, anchorBounds.maxY, stairAEntry.variant.size.y),
        z: direction === "north"
            ? nearZ - stairAEntry.variant.size.z + 1
            : nearZ,
    };
    const stairBOrigin = {
        x: stairX.b,
        y: centeredOrigin(anchorBounds.minY, anchorBounds.maxY, stairBEntry.variant.size.y),
        z: direction === "north"
            ? nearZ - stairBEntry.variant.size.z + 1
            : nearZ,
    };
    const stairABounds = boundsFromOrigin(stairAOrigin, stairAEntry.variant);
    const stairBBounds = boundsFromOrigin(stairBOrigin, stairBEntry.variant);

    const capOrigin = {
        x: centeredOrigin(
            Math.min(stairABounds.minX, stairBBounds.minX),
            Math.max(stairABounds.maxX, stairBBounds.maxX),
            capEntry.variant.size.x
        ),
        y: centeredOrigin(anchorBounds.minY, anchorBounds.maxY, capEntry.variant.size.y),
        z: direction === "north"
            ? Math.min(stairABounds.minZ, stairBBounds.minZ)
                - gap - capEntry.variant.size.z
            : Math.max(stairABounds.maxZ, stairBBounds.maxZ) + gap + 1,
    };
    const capBounds = boundsFromOrigin(capOrigin, capEntry.variant);

    // Upright rooms sit on the anchor roof.  The two deliberately sideways
    // rooms hang from its underside, making their impossible orientation read
    // as supported architecture rather than a free-floating wall.
    const specialRoom = roomEntry.variant.floorNormal !== "up";
    const roomOrigin = originAgainstFace(
        anchorBounds,
        roomEntry.variant.size,
        specialRoom ? "below" : "above",
        gap
    );

    let extraOrigin;
    const denseRaw = [];
    if (denseStairAEntry) {
        // Dense adds a second, opposite stair bank.  Its final large piece is a
        // true far-end cap, so even the comparison mode contains no orphaned
        // flight pointing into empty sky.
        const denseDirection = direction === "north" ? "south" : "north";
        const denseNearZ = denseDirection === "north"
            ? anchorBounds.minZ - gap - 1
            : anchorBounds.maxZ + gap + 1;
        const denseEntries = denseStairBEntry
            ? [denseStairAEntry, denseStairBEntry]
            : [denseStairAEntry];
        const denseOrigins = denseEntries.map((entry, index) => {
            let x = centeredOrigin(anchorBounds.minX, anchorBounds.maxX, entry.variant.size.x);
            if (denseEntries.length === 2) {
                if (mirror) x = index === 0 ? anchorBounds.minX - 2 : anchorBounds.minX + 13;
                else x = index === 0 ? anchorBounds.minX + 37 : anchorBounds.minX - 2;
            }
            return {
                x,
                y: centeredOrigin(anchorBounds.minY, anchorBounds.maxY, entry.variant.size.y),
                z: denseDirection === "north"
                    ? denseNearZ - entry.variant.size.z + 1
                    : denseNearZ,
            };
        });
        const denseBounds = denseOrigins.map((origin, index) =>
            boundsFromOrigin(origin, denseEntries[index].variant));
        const denseFar = denseDirection === "north"
            ? Math.min(...denseBounds.map((bounds) => bounds.minZ))
            : Math.max(...denseBounds.map((bounds) => bounds.maxZ));
        extraOrigin = {
            x: centeredOrigin(
                Math.min(...denseBounds.map((bounds) => bounds.minX)),
                Math.max(...denseBounds.map((bounds) => bounds.maxX)),
                extraEntry.variant.size.x
            ),
            y: centeredOrigin(anchorBounds.minY, anchorBounds.maxY, extraEntry.variant.size.y),
            z: denseDirection === "north"
                ? denseFar - gap - extraEntry.variant.size.z
                : denseFar + gap + 1,
        };
        denseEntries.forEach((entry, index) => denseRaw.push({
            entry,
            origin: denseOrigins[index],
            role: entry.slot.role,
            attachedToRole: "anchor",
        }));
    } else {
        // Default's final large mass rests just above the high stair/cap
        // envelope, thickening the far end without widening the group.
        const stairTop = Math.max(stairABounds.maxY, stairBBounds.maxY, capBounds.maxY);
        extraOrigin = {
            x: centeredOrigin(capBounds.minX, capBounds.maxX, extraEntry.variant.size.x),
            y: (extraEntry.variant.size.x <= 20 ? capBounds.maxY : stairTop) + gap + 1,
            z: centeredOrigin(capBounds.minZ, capBounds.maxZ, extraEntry.variant.size.z),
        };
    }

    const raw = [
        { entry: anchorEntry, origin: { ...anchorOrigin }, role: "anchor", attachedToRole: null },
        { entry: roomEntry, origin: roomOrigin, role: "room_mass", attachedToRole: "anchor" },
        { entry: capEntry, origin: capOrigin, role: "bridge_cap", attachedToRole: "stair_a" },
        { entry: stairAEntry, origin: stairAOrigin, role: "stair_a", attachedToRole: "anchor" },
        { entry: stairBEntry, origin: stairBOrigin, role: "stair_b", attachedToRole: "anchor" },
        {
            entry: extraEntry,
            origin: extraOrigin,
            role: "extra_mass",
            attachedToRole: denseStairAEntry ? "dense_stair_a" : "stair_a",
        },
        ...denseRaw,
    ];
    return raw.map((item) => ({
        ...item,
        bounds: boundsFromOrigin(item.origin, item.entry.variant),
        direction,
        specialFloorNormal: item.entry.variant.floorNormal !== "up",
    }));
}

function defaultClusterAnchorCandidates(
    clusterIndex, anchorVariant, tierPlacements, initialGap, heightRange, seed
) {
    const cluster = DEFAULT_CLUSTER_LAYOUT[clusterIndex];
    const result = [];
    const seen = new Set();
    const references = seededShuffle(tierPlacements, seed, `cluster-refs:${clusterIndex}`);
    const alongOffsets = seededShuffle(
        [0, -18, 18, -36, 36, -60, 60, -84, 84, -108, 108],
        seed,
        `cluster-along:${clusterIndex}`
    );
    const verticalOffsets = seededShuffle(
        [0, -16, 16, -32, 32, -52, 52, -72, 72],
        seed,
        `cluster-y:${clusterIndex}`
    );
    const outwardOffsets = [0, 8, 16, 24, 32];
    const mirror = deterministicScore(seed, `cluster-mirror:${clusterIndex}`) % 2 === 1;
    for (const referencePlacement of references) {
        const reference = sourcePartsSceneryPlacementBounds(referencePlacement);
        for (const outward of outwardOffsets) {
            for (const along of alongOffsets) {
                for (const vertical of verticalOffsets) {
                    const origin = {
                        x: cluster.side === "east"
                            ? reference.maxX + initialGap + 1 + outward
                            : reference.minX - initialGap - outward - anchorVariant.size.x,
                        y: centeredOrigin(
                            reference.minY,
                            reference.maxY,
                            anchorVariant.size.y
                        ) + vertical,
                        z: centeredOrigin(
                            reference.minZ,
                            reference.maxZ,
                            anchorVariant.size.z
                        ) + along,
                    };
                    if (origin.y < heightRange.min
                        || origin.y + anchorVariant.size.y > heightRange.max) continue;
                    for (const direction of ["north", "south"]) {
                        const key = `${origin.x},${origin.y},${origin.z}/${direction}/${mirror}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        result.push({ origin, direction, mirror, outward, along, vertical });
                    }
                }
            }
        }
    }
    return result;
}

function minDistanceToPlacementSet(bounds, placementBounds) {
    return Math.min(...placementBounds.map((item) =>
        sourcePartsSceneryBoundsDistance(bounds, item)));
}

function clusterCandidateUnsafeReason(
    layout,
    coreReservations,
    corePlacementBounds,
    occupiedClusters,
    initialGap,
    heightRange,
    coreGapMaximum
) {
    for (const item of layout) {
        if (item.bounds.minY < heightRange.min || item.bounds.maxY >= heightRange.max) return "height";
        if (coreReservations.some((reserved) =>
            sourcePartsSceneryBoundsIntersect(item.bounds, reserved))) return "core_reservation";
        const coreGap = minDistanceToPlacementSet(item.bounds, corePlacementBounds);
        if (coreGap < initialGap) return "core_near";
        if (coreGap > coreGapMaximum) return "core_far";
        const separated = expandMinMaxBounds(item.bounds, SCENERY_CLUSTER_SEPARATION);
        if (occupiedClusters.some((occupied) =>
            sourcePartsSceneryBoundsIntersect(separated, occupied))) return "other_cluster";
    }
    for (let left = 0; left < layout.length; left += 1) {
        for (let right = left + 1; right < layout.length; right += 1) {
            if (sourcePartsSceneryBoundsIntersect(
                expandMinMaxBounds(layout[left].bounds, SCENERY_PLACEMENT_CLEARANCE),
                layout[right].bounds
            )) return "internal_overlap";
        }
    }
    return null;
}

function scoreDefaultClusterCandidate(
    layout, candidate, corePlacementBounds, coreBounds, seed, clusterIndex
) {
    const gaps = layout.map((item) =>
        minDistanceToPlacementSet(item.bounds, corePlacementBounds));
    const maximumGap = Math.max(...gaps);
    const averageGap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    const tie = deterministicScore(
        seed,
        `cluster-choice:${clusterIndex}:${candidate.origin.x},${candidate.origin.y},${candidate.origin.z}`
            + `:${candidate.direction}:${candidate.mirror}`
    ) % 997;
    const targetRatios = [0.18, 0.82, 0.5, 0.5, 0.82, 0.18];
    const targetZ = coreBounds.minZ
        + (coreBounds.maxZ - coreBounds.minZ) * targetRatios[clusterIndex];
    const clusterCenterZ = (Math.min(...layout.map((item) => item.bounds.minZ))
        + Math.max(...layout.map((item) => item.bounds.maxZ))) / 2;
    return Math.abs(clusterCenterZ - targetZ) * 100000
        + maximumGap * 2000
        + averageGap * 1000
        + candidate.outward * 200
        + Math.abs(candidate.along) * 5
        + Math.abs(candidate.vertical) * 3
        + tie;
}

function selectDefaultClusterLayouts(
    entries,
    corePlan,
    corePlacementBounds,
    coreReservations,
    initialGap,
    heightRange,
    seed
) {
    const coreBounds = aggregateSourcePartsSceneryBounds(corePlan.placements);
    const coreGapMaximum = entries.length > 36
        ? SCENERY_NEAR_GAP_MAX
        : SCENERY_CLUSTER_CORE_GAP_MAX;
    const optionsByCluster = new Map();
    const diagnostics = [];
    for (let clusterIndex = 0; clusterIndex < SCENERY_CLUSTER_COUNT; clusterIndex += 1) {
        const clusterEntries = entries.filter(
            (entry) => entry.slot.clusterIndex === clusterIndex
        );
        const anchorEntry = clusterEntries.find((entry) => entry.slot.role === "anchor");
        const tierPlacements = placementsForTier(corePlan, anchorEntry.slot.tier);
        const candidates = defaultClusterAnchorCandidates(
            clusterIndex,
            anchorEntry.variant,
            tierPlacements,
            initialGap,
            heightRange,
            seed
        );
        const options = [];
        const rejected = {};
        for (const candidate of candidates) {
            const layout = defaultClusterLayout(
                clusterEntries,
                candidate.origin,
                candidate.direction,
                candidate.mirror
            );
            const unsafeReason = clusterCandidateUnsafeReason(
                layout,
                coreReservations,
                corePlacementBounds,
                [],
                initialGap,
                heightRange,
                coreGapMaximum
            );
            if (unsafeReason) {
                rejected[unsafeReason] = (rejected[unsafeReason] ?? 0) + 1;
                continue;
            }
            const score = scoreDefaultClusterCandidate(
                layout,
                candidate,
                corePlacementBounds,
                coreBounds,
                seed,
                clusterIndex
            );
            options.push({ layout, score });
        }
        options.sort((left, right) => left.score - right.score);
        if (options.length === 0) {
            throw new Error(
                `cannot find safe compact scenery cluster ${clusterIndex}`
                + ` candidates=${candidates.length} rejected=${JSON.stringify(rejected)}`
            );
        }
        optionsByCluster.set(clusterIndex, options);
        diagnostics.push(`${clusterIndex}:${options.length}`);
    }

    function conflictsWithSelected(layout, selectedItems) {
        return layout.some((item) => {
            const separated = expandMinMaxBounds(
                item.bounds,
                SCENERY_CLUSTER_SEPARATION
            );
            return selectedItems.some((selected) =>
                sourcePartsSceneryBoundsIntersect(separated, selected.bounds));
        });
    }

    // Height-edge tiers are the most constrained.  Place them first, then use
    // a small deterministic backtracking search instead of letting an early
    // greedy choice strand the final cluster.
    const searchOrder = [4, 5, 2, 3, 0, 1];
    const selectedLayouts = new Map();
    function search(orderIndex, selectedItems) {
        if (orderIndex >= searchOrder.length) return true;
        const clusterIndex = searchOrder[orderIndex];
        for (const option of optionsByCluster.get(clusterIndex)) {
            if (conflictsWithSelected(option.layout, selectedItems)) continue;
            selectedLayouts.set(clusterIndex, option.layout);
            if (search(orderIndex + 1, [...selectedItems, ...option.layout])) return true;
            selectedLayouts.delete(clusterIndex);
        }
        return false;
    }
    if (!search(0, [])) {
        throw new Error(
            `cannot combine six compact scenery clusters options=${diagnostics.join(",")}`
        );
    }

    const selectedBySlot = new Map();
    for (const layout of selectedLayouts.values()) {
        for (const item of layout) selectedBySlot.set(item.entry.slot.slotId, item);
    }
    return selectedBySlot;
}

function countCategories(placements) {
    const result = { crossroads: 0, room: 0, bridge: 0, stairs: 0 };
    for (const placement of placements) result[placement.category] += 1;
    return result;
}

function overlapAxisCount(left, right) {
    let count = 0;
    if (emptyAxisGap(left.minX, left.maxX, right.minX, right.maxX) === 0) count += 1;
    if (emptyAxisGap(left.minY, left.maxY, right.minY, right.maxY) === 0) count += 1;
    if (emptyAxisGap(left.minZ, left.maxZ, right.minZ, right.maxZ) === 0) count += 1;
    return count;
}

function strongClusterComponents(placementBounds) {
    const adjacency = placementBounds.map(() => []);
    for (let left = 0; left < placementBounds.length; left += 1) {
        for (let right = left + 1; right < placementBounds.length; right += 1) {
            const leftBounds = placementBounds[left].bounds;
            const rightBounds = placementBounds[right].bounds;
            if (sourcePartsSceneryBoundsDistance(leftBounds, rightBounds)
                    <= SCENERY_CLUSTER_STRONG_GAP
                && overlapAxisCount(leftBounds, rightBounds) >= 2) {
                adjacency[left].push(right);
                adjacency[right].push(left);
            }
        }
    }
    const components = [];
    const visited = new Set();
    for (let start = 0; start < placementBounds.length; start += 1) {
        if (visited.has(start)) continue;
        const queue = [start];
        const component = [];
        visited.add(start);
        while (queue.length > 0) {
            const current = queue.shift();
            component.push(current);
            for (const neighbor of adjacency[current]) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
        components.push(component);
    }
    return { adjacency, components };
}

function validateSceneryPlan(
    placements,
    density,
    coreBounds,
    corePlacementBounds,
    coreReservations,
    initialGap,
    heightRange
) {
    const expected = SOURCE_PARTS_SCENERY_CATEGORY_COUNTS[density];
    const expectedCount = Object.values(expected).reduce((sum, value) => sum + value, 0);
    if (placements.length !== expectedCount) {
        throw new Error(`${density} scenery count ${placements.length} != ${expectedCount}`);
    }
    const ids = new Set(placements.map((placement) => placement.placementId));
    if (ids.size !== placements.length) throw new Error("scenery placement ids must be unique");

    const categories = countCategories(placements);
    for (const category of VALID_CATEGORIES) {
        if (categories[category] !== expected[category]) {
            throw new Error(
                `${density} scenery category ${category}.${categories[category]} != ${expected[category]}`
            );
        }
    }
    const variantIds = new Set(placements.map((placement) => placement.variantId));

    let solidBlocks = 0;
    let aabbVolume = 0;
    let minimumCoreGap = Number.POSITIVE_INFINITY;
    let maximumCoreGap = 0;
    let summedCoreGap = 0;
    let nearCorePlacements = 0;
    let insideAggregatePlacements = 0;
    let insideCoreFootprintPlacements = 0;
    let infillPlacements = 0;
    const placementBounds = [];
    for (const placement of placements) {
        const bounds = sourcePartsSceneryPlacementBounds(placement);
        if (bounds.minY < heightRange.min || bounds.maxY >= heightRange.max) {
            throw new Error(
                `${placement.placementId} exceeds world height ${heightRange.min}..${heightRange.max}`
            );
        }
        if (coreReservations.some((reserved) =>
            sourcePartsSceneryBoundsIntersect(bounds, reserved))) {
            throw new Error(`${placement.placementId} intersects a playable-core reservation`);
        }
        const coreGap = minimumBoundsDistance(bounds, corePlacementBounds);
        if (coreGap + Number.EPSILON < initialGap) {
            throw new Error(
                `${placement.placementId} nearest core gap ${coreGap} is below ${initialGap}`
            );
        }
        minimumCoreGap = Math.min(minimumCoreGap, coreGap);
        maximumCoreGap = Math.max(maximumCoreGap, coreGap);
        summedCoreGap += coreGap;
        const insideAggregate = sourcePartsSceneryBoundsIntersect(bounds, coreBounds);
        const insideFootprint = coreFootprintIntersects(bounds, coreBounds);
        const nearCore = coreGap <= SCENERY_NEAR_GAP_MAX;
        if (nearCore) nearCorePlacements += 1;
        if (insideAggregate) insideAggregatePlacements += 1;
        if (insideFootprint) insideCoreFootprintPlacements += 1;
        if (nearCore && insideFootprint) infillPlacements += 1;
        solidBlocks += placement.solidBlockCount;
        aabbVolume += placement.aabbVolume;
        placementBounds.push({ placement, bounds });
    }
    for (let left = 0; left < placementBounds.length; left += 1) {
        for (let right = left + 1; right < placementBounds.length; right += 1) {
            if (sourcePartsSceneryBoundsIntersect(
                expandMinMaxBounds(
                    placementBounds[left].bounds,
                    SCENERY_PLACEMENT_CLEARANCE
                ),
                placementBounds[right].bounds
            )) {
                throw new Error(
                    `scenery AABB conflict ${placementBounds[left].placement.placementId}`
                    + ` / ${placementBounds[right].placement.placementId}`
                );
            }
        }
    }
    const clusterGraph = strongClusterComponents(placementBounds);
    const clusterSizes = clusterGraph.components.map((component) => component.length);
    const isolatedPlacements = clusterGraph.adjacency.filter((neighbors) =>
        neighbors.length === 0).length;
    const specialFloorNormalPlacements = placements.filter((placement) =>
        placement.floorNormal !== "up");
    const attachedSpecialPlacements = specialFloorNormalPlacements.filter((placement) =>
        Number.isFinite(placement.attachmentGap)
        && placement.attachmentGap >= SCENERY_CLUSTER_ATTACHMENT_GAP
        && placement.attachmentGap <= 4
        && placement.attachedToPlacementId === placement.anchorPlacementId
    ).length;
    const supportedStairs = placementBounds.filter(({ placement, bounds }, index) => {
        if (placement.category !== "stairs") return false;
        const adjacentLarge = clusterGraph.adjacency[index].filter((neighbor) =>
            placementBounds[neighbor].placement.category !== "stairs");
        return adjacentLarge.length >= 2;
    }).length;
    if (placements.every((placement) => placement.slotType === "cluster")) {
        const expectedClusterSizes = density === SOURCE_PARTS_SCENERY_DENSITY.DEFAULT
            ? [6, 6, 6, 6, 6, 6]
            : [7, 7, 7, 7, 8, 8];
        if (clusterGraph.components.length !== SCENERY_CLUSTER_COUNT
            || [...clusterSizes].sort((left, right) => left - right).join(",")
                !== [...expectedClusterSizes].sort((left, right) => left - right).join(",")) {
            throw new Error(
                `${density} scenery clusters ${clusterGraph.components.length}`
                + ` sizes=${clusterSizes.join(",")}`
            );
        }
        if (isolatedPlacements !== 0) {
            throw new Error(`${density} scenery has ${isolatedPlacements} isolated placements`);
        }
        if (specialFloorNormalPlacements.length < 2
            || specialFloorNormalPlacements.length > 3
            || attachedSpecialPlacements !== specialFloorNormalPlacements.length) {
            throw new Error(
                `${density} special orientations ${specialFloorNormalPlacements.length}`
                + ` attached=${attachedSpecialPlacements}`
            );
        }
        if (supportedStairs !== categories.stairs) {
            throw new Error(
                `${density} supported stairs ${supportedStairs}/${categories.stairs}`
            );
        }
        const allowedCoreGap = density === SOURCE_PARTS_SCENERY_DENSITY.DEFAULT
            ? SCENERY_CLUSTER_CORE_GAP_MAX
            : SCENERY_NEAR_GAP_MAX;
        if (maximumCoreGap > allowedCoreGap) {
            throw new Error(
                `${density} scenery core gap ${maximumCoreGap}/${allowedCoreGap}`
            );
        }
    }
    if (solidBlocks > SCENERY_MAX_SOLID_BLOCKS) {
        throw new Error(`scenery solid budget ${solidBlocks}/${SCENERY_MAX_SOLID_BLOCKS}`);
    }
    if (aabbVolume > SCENERY_MAX_AABB_VOLUME) {
        throw new Error(`scenery AABB budget ${aabbVolume}/${SCENERY_MAX_AABB_VOLUME}`);
    }
    return {
        placementCount: placements.length,
        categories,
        uniqueVariants: variantIds.size,
        solidBlocks,
        aabbVolume,
        minimumCoreGap,
        maximumCoreGap,
        averageCoreGap: summedCoreGap / placements.length,
        nearCorePlacements,
        insideAggregatePlacements,
        insideCoreFootprintPlacements,
        infillPlacements,
        sideSlots: placements.filter((placement) => placement.slotType === "side").length,
        cornerSlots: placements.filter((placement) => placement.slotType === "corner").length,
        clusterSlots: placements.filter((placement) => placement.slotType === "cluster").length,
        clusterCount: clusterGraph.components.length,
        clusterSizes,
        isolatedPlacements,
        specialFloorNormalPlacements: specialFloorNormalPlacements.length,
        attachedSpecialPlacements,
        supportedStairs,
    };
}

/**
 * Plans a decorative shell without changing or extending corePlan.placements.
 * heightRange.max follows the Bedrock API convention and is exclusive.
 */
export function createSourcePartsSceneryPlan(corePlan, options = {}) {
    if (!corePlan || !Array.isArray(corePlan.placements) || corePlan.placements.length === 0) {
        throw new Error("source-parts scenery requires a non-empty core plan");
    }
    const density = normalizeDensity(options.density);
    const seed = finiteInteger(options.seed ?? corePlan.seed ?? 0, "seed") >>> 0;
    const initialGap = normalizeGap(options.initialGap);
    const heightRange = normalizeHeightRange(options.heightRange);
    const coreBounds = aggregateSourcePartsSceneryBounds(corePlan.placements);
    const corePlacementBounds = corePlan.placements.map(
        (placement) => sourcePartsSceneryPlacementBounds(placement)
    );
    const coreReservations = sourcePartsSceneryCoreReservations(corePlan, initialGap);
    const tierBounds = {};
    for (const tier of TIERS) {
        tierBounds[tier] = aggregateSourcePartsSceneryBounds(
            placementsForTier(corePlan, tier)
        );
    }

    const slots = density === SOURCE_PARTS_SCENERY_DENSITY.DEFAULT
        ? buildDefaultClusterSlots()
        : buildDenseClusterSlots();
    const assignments = assignVariantsToSlots(slots, density, seed);
    const entries = slots.map((slot, index) => {
        const variant = assignments.get(slot.slotId);
        if (!variant) throw new Error(`scenery slot ${slot.slotId} has no variant`);
        return { slot, index, variant };
    });
    const placementsByIndex = new Map();
    if (slots.every((slot) => slot.slotType === "cluster")) {
        const selectedBySlot = selectDefaultClusterLayouts(
            entries,
            corePlan,
            corePlacementBounds,
            coreReservations,
            initialGap,
            heightRange,
            seed
        );
        for (const entry of entries) {
            const { slot, index, variant } = entry;
            const selected = selectedBySlot.get(slot.slotId);
            if (!selected) throw new Error(`cluster slot ${slot.slotId} was not placed`);
            const clusterEntries = entries.filter(
                (item) => item.slot.clusterIndex === slot.clusterIndex
            );
            const anchorEntry = clusterEntries.find((item) => item.slot.role === "anchor");
            const attachedEntry = selected.attachedToRole
                ? clusterEntries.find((item) => item.slot.role === selected.attachedToRole)
                : null;
            const attachedSelection = attachedEntry
                ? selectedBySlot.get(attachedEntry.slot.slotId)
                : null;
            const nearestCoreGap = minimumBoundsDistance(
                selected.bounds,
                corePlacementBounds
            );
            placementsByIndex.set(index, {
                placementId: `scenery.${String(index).padStart(2, "0")}.${slot.slotId}`,
                variantId: variant.id,
                structureId: variant.structureId,
                source: variant.source,
                displayName: variant.displayName,
                category: variant.category,
                floorNormal: variant.floorNormal,
                size: { ...variant.size },
                origin: selected.origin,
                layer: "scenery",
                purpose: "decorative",
                navigationValidated: false,
                tier: slot.tier,
                shell: 0,
                shellGap: initialGap,
                slotType: "cluster",
                side: slot.side,
                corner: null,
                clusterId: slot.clusterId,
                clusterIndex: slot.clusterIndex,
                clusterRole: slot.role,
                clusterDirection: selected.direction,
                isClusterAnchor: slot.role === "anchor",
                anchorPlacementId: `scenery.${String(anchorEntry.index).padStart(2, "0")}.${anchorEntry.slot.slotId}`,
                attachedToPlacementId: attachedEntry
                    ? `scenery.${String(attachedEntry.index).padStart(2, "0")}.${attachedEntry.slot.slotId}`
                    : null,
                attachmentGap: attachedSelection
                    ? sourcePartsSceneryBoundsDistance(
                        selected.bounds,
                        attachedSelection.bounds
                    )
                    : null,
                specialFloorNormal: variant.floorNormal !== "up",
                layoutMode: "compact_cluster",
                nearestCoreGap,
                insideAggregate: sourcePartsSceneryBoundsIntersect(selected.bounds, coreBounds),
                insideCoreFootprint: coreFootprintIntersects(selected.bounds, coreBounds),
                solidBlockCount: variant.solidBlockCount,
                aabbVolume: variant.aabbVolume,
            });
        }
    } else {
        // Dense remains an intentionally chaotic comparison mode.  Pack larger
        // volumes first so its small stair pieces can use the remaining voids.
        const occupiedBounds = [];
        const packingOrder = entries.slice().sort((left, right) =>
            right.variant.aabbVolume - left.variant.aabbVolume
            || deterministicScore(seed, `packing:${left.slot.slotId}:${left.variant.id}`)
                - deterministicScore(seed, `packing:${right.slot.slotId}:${right.variant.id}`)
        );
        for (const { slot, index, variant } of packingOrder) {
            const selected = selectOriginForSlot(
                slot,
                variant,
                coreBounds,
                corePlacementBounds,
                coreReservations,
                tierBounds[slot.tier],
                initialGap,
                heightRange,
                occupiedBounds,
                seed
            );
            occupiedBounds.push(selected.bounds);
            placementsByIndex.set(index, {
            placementId: `scenery.${String(index).padStart(2, "0")}.${slot.slotId}`,
            variantId: variant.id,
            structureId: variant.structureId,
            source: variant.source,
            displayName: variant.displayName,
            category: variant.category,
            floorNormal: variant.floorNormal,
            size: { ...variant.size },
            origin: selected.origin,
            layer: "scenery",
            purpose: "decorative",
            navigationValidated: false,
            tier: slot.tier,
            shell: slot.shell,
            shellGap: initialGap + slot.shell * SCENERY_SHELL_STEP,
            slotType: slot.slotType,
            side: slot.side ?? null,
            corner: slot.corner ?? null,
            layoutMode: selected.layoutMode,
            nearestCoreGap: selected.nearestCoreGap,
            insideAggregate: selected.insideAggregate,
            insideCoreFootprint: selected.insideFootprint,
            solidBlockCount: variant.solidBlockCount,
            aabbVolume: variant.aabbVolume,
            });
        }
    }
    const placements = entries.map(({ index }) => placementsByIndex.get(index));
    const stats = validateSceneryPlan(
        placements,
        density,
        coreBounds,
        corePlacementBounds,
        coreReservations,
        initialGap,
        heightRange
    );
    return {
        schemaVersion: SOURCE_PARTS_SCENERY_SCHEMA_VERSION,
        seed,
        density,
        initialGap,
        safeMinimumGap: SCENERY_SAFE_MINIMUM_GAP,
        coreClearance: SCENERY_CORE_CLEARANCE,
        placementClearance: SCENERY_PLACEMENT_CLEARANCE,
        clusterCount: stats.clusterCount,
        clusterAttachmentGap: SCENERY_CLUSTER_ATTACHMENT_GAP,
        clusterStrongGap: SCENERY_CLUSTER_STRONG_GAP,
        clusterSeparation: SCENERY_CLUSTER_SEPARATION,
        nearGapMaximum: SCENERY_NEAR_GAP_MAX,
        shellStep: SCENERY_SHELL_STEP,
        shellGaps: [0, 1, 2].map((shell) => initialGap + shell * SCENERY_SHELL_STEP),
        heightRange: { ...heightRange },
        coreBounds: cloneBounds(coreBounds),
        placements,
        stats,
        solidBlockCount: stats.solidBlocks,
        aabbVolume: stats.aabbVolume,
        nonNavigablePlacements: placements.length,
    };
}

export function createSourcePartsSceneryPlacements(corePlan, options = {}) {
    return createSourcePartsSceneryPlan(corePlan, options).placements;
}
