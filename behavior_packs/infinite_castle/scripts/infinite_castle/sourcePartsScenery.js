import { BlockVolume, StructureAnimationMode, system, world } from "@minecraft/server";
import {
    DEFAULT_SCENERY_DENSITY,
    SCENERY_CORE_CLEARANCE,
    SOURCE_PARTS_SCENERY_SCHEMA_VERSION,
    boundsIntersect,
    createSourcePartsSceneryPlan,
    placementBounds,
    sourcePartsSceneryCoreReservations,
} from "./sourcePartsSceneryPlanner.js";
import { clipBoundsToHeight, splitBoundsForFill } from "./sourcePartsVolumes.js";

const SCENERY_STATE_KEY = "infinite_castle:source_parts_scenery_v1";
const STATE_SCHEMA_VERSION = 1;
const DYNAMIC_PROPERTY_STRING_LIMIT = 32767;
const LOAD_MARGIN = 2;
const LOAD_TIMEOUT_TICKS = 400;
const SETTLE_TICKS = 4;
let sceneryInProgress = false;

function waitTicks(ticks) {
    return system.waitTicks(ticks);
}

function safeSendMessage(player, message) {
    try {
        player?.sendMessage(message);
    } catch {
        // A long scenery build may outlive its requesting player.
    }
}

function integerVector(value) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)
        || !Number.isFinite(value.z)) return null;
    return { x: Math.trunc(value.x), y: Math.trunc(value.y), z: Math.trunc(value.z) };
}

function positiveSize(value) {
    const result = integerVector(value);
    if (!result || result.x < 1 || result.y < 1 || result.z < 1) return null;
    return result;
}

function compactPlacement(placement) {
    const origin = integerVector(placement?.origin);
    const size = positiveSize(placement?.size);
    if (!origin || !size || typeof placement?.variantId !== "string"
        || typeof placement?.structureId !== "string") return null;
    return {
        placementId: String(placement.placementId ?? "scenery"),
        variantId: placement.variantId,
        structureId: placement.structureId,
        category: String(placement.category ?? "scenery"),
        navigationValidated: placement.navigationValidated === true,
        solidBlockCount: Math.max(0, Math.trunc(placement.solidBlockCount ?? 0)),
        origin,
        size,
    };
}

function compactPlan(plan) {
    const dimensionId = typeof plan?.dimensionId === "string"
        ? plan.dimensionId : plan?.dimension?.id;
    if (plan?.density !== "default" && plan?.density !== "dense") return null;
    const placements = (Array.isArray(plan?.placements) ? plan.placements : [])
        .map(compactPlacement)
        .filter(Boolean);
    const expectedCount = plan.density === "dense" ? 44 : 36;
    if (!dimensionId || placements.length !== expectedCount
        || new Set(placements.map((placement) => placement.placementId)).size !== placements.length) {
        return null;
    }
    return {
        dimensionId,
        layoutVersion: Number.isFinite(plan.layoutVersion)
            ? Math.max(0, Math.trunc(plan.layoutVersion))
            : (Number.isFinite(plan.schemaVersion)
                ? Math.max(0, Math.trunc(plan.schemaVersion)) : 0),
        seed: Number.isFinite(plan.seed) ? plan.seed >>> 0 : 0,
        density: plan.density,
        coreSignature: String(plan.coreSignature ?? "unknown"),
        solidBlockCount: placements.reduce(
            (total, placement) => total + placement.solidBlockCount, 0
        ),
        placements,
    };
}

function serializeState(status, plan) {
    const compact = plan ? compactPlan(plan) : null;
    const serialized = JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
        status,
        plan: compact,
    });
    if (serialized.length > DYNAMIC_PROPERTY_STRING_LIMIT) {
        throw new Error(
            `scenery state is too large: ${serialized.length}/${DYNAMIC_PROPERTY_STRING_LIMIT}`
        );
    }
    return serialized;
}

function saveState(status, plan) {
    world.setDynamicProperty(SCENERY_STATE_KEY, serializeState(status, plan));
}

function loadState() {
    const raw = world.getDynamicProperty(SCENERY_STATE_KEY);
    if (raw === undefined) {
        return { known: true, present: false, status: "absent", plan: null };
    }
    if (typeof raw !== "string") {
        return { known: false, present: true, status: "invalid", plan: null };
    }
    try {
        const state = JSON.parse(raw);
        if (state?.schemaVersion !== STATE_SCHEMA_VERSION) {
            return { known: false, present: true, status: "unsupported", plan: null };
        }
        if (state.plan === null) {
            return { known: true, present: false, status: state.status ?? "empty", plan: null };
        }
        const plan = compactPlan(state.plan);
        if (!plan || plan.placements.length !== state.plan.placements?.length) {
            return { known: false, present: true, status: "invalid", plan: null };
        }
        return { known: true, present: true, status: state.status ?? "unknown", plan };
    } catch {
        return { known: false, present: true, status: "invalid", plan: null };
    }
}

function fnv1a32(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function coreSignature(corePlan) {
    const dimensionId = String(corePlan?.dimensionId ?? "unknown");
    const records = (Array.isArray(corePlan?.placements) ? corePlan.placements : [])
        .map((placement) => {
            const origin = integerVector(placement?.origin) ?? { x: 0, y: 0, z: 0 };
            const size = positiveSize(placement?.size) ?? { x: 0, y: 0, z: 0 };
            return [
                String(placement?.placementId ?? ""),
                String(placement?.variantId ?? placement?.structureId ?? ""),
                origin.x, origin.y, origin.z,
                size.x, size.y, size.z,
            ].join("|");
        })
        .sort();
    const material = [`dimension=${dimensionId}`, ...records].join("\n");
    return `core-v2-fnv1a32:${fnv1a32(material).toString(16).padStart(8, "0")}`
        + `:${records.length}`;
}

function sceneryPlanCompatibleWithCore(sceneryPlan, corePlan) {
    if (!sceneryPlan || !corePlan || sceneryPlan.dimensionId !== corePlan.dimensionId) return false;
    if (sceneryPlan.layoutVersion !== SOURCE_PARTS_SCENERY_SCHEMA_VERSION) return false;
    // Old aggregate-AABB signatures and scenery tied to another exact topology
    // remain clearable, but must not be reused around a newly anchored core.
    if (sceneryPlan.coreSignature !== coreSignature(corePlan)) return false;
    const protectedCorePlacements = sourcePartsSceneryCoreReservations(
        corePlan,
        SCENERY_CORE_CLEARANCE
    ).map((bounds) => ({
        from: { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
        to: { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ },
    }));
    return sceneryPlan.placements.every((sceneryPlacement) =>
        protectedCorePlacements.every((coreBounds) =>
            !boundsIntersect(coreBounds, placementBounds(sceneryPlacement))
        )
    );
}

function pointInsideBounds(location, bounds, margin = 2) {
    return location.x >= bounds.from.x - margin && location.x <= bounds.to.x + margin
        && location.y >= bounds.from.y - margin && location.y <= bounds.to.y + margin
        && location.z >= bounds.from.z - margin && location.z <= bounds.to.z + margin;
}

function playersInsidePlacements(dimension, placements) {
    const bounds = placements.map(placementBounds);
    return dimension.getPlayers().filter((player) =>
        bounds.some((current) => pointInsideBounds(player.location, current))
    );
}

function dimensionForPlan(plan, fallback) {
    if (fallback?.id === plan?.dimensionId) return fallback;
    return world.getDimension(plan.dimensionId);
}

function expandedLoadBounds(bounds) {
    return {
        from: {
            x: bounds.from.x - LOAD_MARGIN,
            y: bounds.from.y - LOAD_MARGIN,
            z: bounds.from.z - LOAD_MARGIN,
        },
        to: {
            x: bounds.to.x + LOAD_MARGIN,
            y: bounds.to.y + LOAD_MARGIN,
            z: bounds.to.z + LOAD_MARGIN,
        },
    };
}

function releaseArea(manager, name) {
    try {
        if (manager?.hasTickingArea(name)) manager.removeTickingArea(name);
    } catch {
        // Removal is intentionally idempotent after interrupted builds.
    }
}

async function waitForArea(manager, name, options) {
    let resolved = false;
    let failure = null;
    const creation = manager.createTickingArea(name, options);
    void creation.then(() => { resolved = true; }, (error) => { failure = error; });
    for (let elapsed = 0; elapsed < LOAD_TIMEOUT_TICKS; elapsed += 1) {
        if (failure) throw failure;
        const area = manager.getTickingArea(name);
        if (resolved || area?.isFullyLoaded === true) return;
        await waitTicks(1);
    }
    throw new Error(`scenery ticking area timed out: ${name}`);
}

async function withLoadedBounds(dimension, bounds, name, callback) {
    const manager = world.tickingAreaManager;
    if (!manager) throw new Error("world.tickingAreaManager is unavailable");
    const clipped = clipBoundsToHeight(expandedLoadBounds(bounds), dimension.heightRange);
    if (!clipped) throw new Error(`scenery bounds are outside dimension height: ${name}`);
    const options = { dimension, from: clipped.from, to: clipped.to };
    releaseArea(manager, name);
    if (!manager.hasCapacity(options)) {
        throw new Error(`insufficient ticking area capacity for scenery: ${name}`);
    }
    try {
        await waitForArea(manager, name, options);
        return await callback();
    } finally {
        releaseArea(manager, name);
        await waitTicks(1);
    }
}

async function clearPlanBlocks(plan, dimension, player) {
    if (!plan?.placements?.length) return 0;
    const occupants = playersInsidePlacements(dimension, plan.placements);
    if (occupants.length > 0) {
        throw new Error(
            `cannot clear scenery while players are inside it: `
            + occupants.map((occupant) => occupant.name).join(", ")
        );
    }
    saveState("clearing", plan);
    let clearedSections = 0;
    for (let index = 0; index < plan.placements.length; index += 1) {
        const bounds = placementBounds(plan.placements[index]);
        await withLoadedBounds(dimension, bounds, `ic_scene_clear_${index}`, async () => {
            for (const section of splitBoundsForFill(bounds)) {
                dimension.fillBlocks(
                    new BlockVolume(section.from, section.to),
                    "minecraft:air"
                );
                clearedSections += 1;
                await waitTicks(1);
            }
        });
        if ((index + 1) % 6 === 0 || index + 1 === plan.placements.length) {
            safeSendMessage(
                player,
                `[ic-scenery] clear ${index + 1}/${plan.placements.length}`
            );
        }
    }
    return clearedSections;
}

function resolveStructureId(placement, packIds) {
    if (packIds.includes(placement.structureId)) return placement.structureId;
    return packIds.find((id) =>
        id.endsWith(`:generated_variants/${placement.variantId}`)
        || id.endsWith(`/generated_variants/${placement.variantId}`)
        || id.endsWith(`:${placement.variantId}`)
        || id.endsWith(`/${placement.variantId}`)
    ) ?? null;
}

async function placePlanBlocks(plan, dimension, player) {
    const packIds = world.structureManager.getPackStructureIds();
    const missing = plan.placements.filter((placement) =>
        !resolveStructureId(placement, packIds)
    );
    if (missing.length > 0) {
        throw new Error(
            `missing scenery variants: ${missing.map((item) => item.variantId).join(", ")}`
        );
    }
    saveState("building", plan);
    for (let index = 0; index < plan.placements.length; index += 1) {
        const placement = plan.placements[index];
        const structureId = resolveStructureId(placement, packIds);
        await withLoadedBounds(
            dimension,
            placementBounds(placement),
            `ic_scene_build_${index}`,
            async () => {
                world.structureManager.place(structureId, dimension, placement.origin, {
                    animationMode: StructureAnimationMode.None,
                    includeBlocks: true,
                    includeEntities: false,
                });
                await waitTicks(SETTLE_TICKS);
            }
        );
        if ((index + 1) % 4 === 0 || index + 1 === plan.placements.length) {
            safeSendMessage(
                player,
                `[ic-scenery] build ${index + 1}/${plan.placements.length}`
            );
        }
    }
    saveState("complete", plan);
}

export function isSourcePartsSceneryInProgress() {
    return sceneryInProgress;
}

export function getSourcePartsSceneryGuard(dimensionId) {
    const state = loadState();
    if (!state.known) {
        return { known: false, present: state.present, status: state.status, bounds: [] };
    }
    if (!state.plan || state.plan.dimensionId !== dimensionId) {
        return { known: true, present: false, status: state.status, bounds: [] };
    }
    return {
        known: true,
        present: true,
        status: state.status,
        density: state.plan.density,
        placements: state.plan.placements.length,
        bounds: state.plan.placements.map((placement) => ({
            placementId: placement.placementId,
            ...placementBounds(placement),
        })),
    };
}

export function getSourcePartsSceneryStatus() {
    const state = loadState();
    return {
        known: state.known,
        present: state.present,
        status: state.status,
        density: state.plan?.density ?? "none",
        placements: state.plan?.placements?.length ?? 0,
        inProgress: sceneryInProgress,
    };
}

export async function prepareSourcePartsSceneryForCore(corePlan, dimension, player) {
    const state = loadState();
    if (!state.known) {
        throw new Error("stored scenery state is invalid; clear scenery before rebuilding the core");
    }
    if (!state.plan || sceneryPlanCompatibleWithCore(state.plan, corePlan)) {
        return { ok: true, cleared: false, placements: state.plan?.placements.length ?? 0 };
    }
    if (sceneryInProgress) return { ok: false, reason: "busy" };
    sceneryInProgress = true;
    try {
        const sceneryDimension = dimensionForPlan(state.plan, dimension);
        const clearedSections = await clearPlanBlocks(state.plan, sceneryDimension, player);
        saveState("empty", null);
        return { ok: true, cleared: true, clearedSections };
    } finally {
        sceneryInProgress = false;
    }
}

export async function ensureSourcePartsScenery(
    corePlan,
    dimension,
    player,
    options = {}
) {
    if (sceneryInProgress) return { ok: false, reason: "busy" };
    const state = loadState();
    if (!state.known) return { ok: false, reason: "invalid_state" };
    const density = options.density === "dense" || options.density === "default"
        ? options.density
        : (state.plan?.density ?? DEFAULT_SCENERY_DENSITY);
    if (!options.force && state.status === "complete"
        && state.plan && state.plan.density === density
        && sceneryPlanCompatibleWithCore(state.plan, corePlan)) {
        state.plan.coreSignature = coreSignature(corePlan);
        saveState("complete", state.plan);
        return {
            ok: true,
            reused: true,
            placements: state.plan.placements.length,
            density: state.plan.density,
        };
    }

    sceneryInProgress = true;
    try {
        if (state.plan) {
            await clearPlanBlocks(
                state.plan,
                dimensionForPlan(state.plan, dimension),
                player
            );
        }
        const seed = Number.isFinite(options.seed)
            ? options.seed >>> 0
            : ((corePlan.seed ?? 0) ^ 0x51ce4e7) >>> 0;
        const plan = createSourcePartsSceneryPlan(corePlan, {
            seed,
            density,
            heightRange: dimension.heightRange,
        });
        plan.dimensionId = dimension.id;
        plan.coreSignature = coreSignature(corePlan);
        await placePlanBlocks(plan, dimension, player);
        safeSendMessage(
            player,
            `[infinite_castle] 装飾城郭完成 buildings=${plan.placements.length} `
            + `density=${density} nonNavigable=${plan.nonNavigablePlacements} `
            + `solid=${plan.solidBlockCount}`
        );
        return {
            ok: true,
            reused: false,
            placements: plan.placements.length,
            density,
            nonNavigablePlacements: plan.nonNavigablePlacements,
            solidBlockCount: plan.solidBlockCount,
        };
    } catch (error) {
        console.warn(`[infinite_castle] scenery build failed: ${error?.stack ?? error}`);
        safeSendMessage(player, `[infinite_castle] 装飾城郭の建築失敗: ${error}`);
        return { ok: false, reason: "error", error: String(error) };
    } finally {
        sceneryInProgress = false;
    }
}

export async function clearSourcePartsScenery(player, dimensionOverride = undefined) {
    if (sceneryInProgress) return { ok: false, reason: "busy" };
    const state = loadState();
    if (!state.known) return { ok: false, reason: "invalid_state" };
    if (!state.plan) {
        saveState("empty", null);
        return { ok: true, placements: 0, clearedSections: 0 };
    }
    let dimension;
    try {
        dimension = dimensionForPlan(state.plan, dimensionOverride);
    } catch {
        return { ok: false, reason: "missing_dimension" };
    }
    sceneryInProgress = true;
    try {
        const clearedSections = await clearPlanBlocks(state.plan, dimension, player);
        saveState("empty", null);
        safeSendMessage(
            player,
            `[infinite_castle] 装飾城郭を消去しました buildings=${state.plan.placements.length}`
        );
        return {
            ok: true,
            placements: state.plan.placements.length,
            clearedSections,
        };
    } catch (error) {
        console.warn(`[infinite_castle] scenery clear failed: ${error?.stack ?? error}`);
        safeSendMessage(player, `[infinite_castle] 装飾城郭の消去失敗: ${error}`);
        return { ok: false, reason: "error", error: String(error) };
    } finally {
        sceneryInProgress = false;
    }
}
