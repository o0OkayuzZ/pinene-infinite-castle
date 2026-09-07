const STATE_SCHEMA_VERSION = 4;
const DYNAMIC_PROPERTY_STRING_LIMIT = 32767;

function integerVector(value) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
        return null;
    }
    return {
        x: Math.trunc(value.x),
        y: Math.trunc(value.y),
        z: Math.trunc(value.z),
    };
}

function positiveSize(value) {
    const size = integerVector(value);
    if (!size || size.x < 1 || size.y < 1 || size.z < 1) return null;
    return size;
}

function compactPlacement(placement) {
    const origin = integerVector(placement?.origin);
    const size = positiveSize(placement?.size ?? placement?.variant?.size);
    if (!origin || !size) return null;
    return { origin, size };
}

function compactConnection(connection) {
    const from = integerVector(connection?.from);
    const to = integerVector(connection?.to);
    if (!from || !to) return null;
    const rawWidth = connection?.opening?.width;
    const width = Number.isFinite(rawWidth) ? Math.max(1, Math.trunc(rawWidth)) : 1;
    return { from, to, opening: { width } };
}

export function compactSourcePartsPlan(plan) {
    const dimensionId = typeof plan?.dimensionId === "string"
        ? plan.dimensionId
        : plan?.dimension?.id;
    if (typeof dimensionId !== "string" || dimensionId.length === 0) return null;

    const placements = (Array.isArray(plan?.placements) ? plan.placements : [])
        .map(compactPlacement)
        .filter(Boolean);
    const connections = (Array.isArray(plan?.connections) ? plan.connections : [])
        .map(compactConnection)
        .filter(Boolean);
    if (placements.length === 0 && connections.length === 0) return null;
    return { dimensionId, placements, connections };
}

export function parseSourcePartsPlans(raw) {
    if (typeof raw !== "string") return [];
    try {
        const state = JSON.parse(raw);
        const candidates = Array.isArray(state?.plans)
            ? state.plans
            : (Array.isArray(state?.placements) ? [state] : []);
        return candidates.map(compactSourcePartsPlan).filter(Boolean);
    } catch {
        return [];
    }
}

export function serializeSourcePartsState(status, plans) {
    const compactPlans = (Array.isArray(plans) ? plans : [])
        .map(compactSourcePartsPlan)
        .filter(Boolean);
    const serialized = JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
        status,
        plans: compactPlans,
    });
    if (serialized.length > DYNAMIC_PROPERTY_STRING_LIMIT) {
        throw new Error(
            `source-parts state is too large after compaction: ${serialized.length}/${DYNAMIC_PROPERTY_STRING_LIMIT}`
        );
    }
    return serialized;
}
