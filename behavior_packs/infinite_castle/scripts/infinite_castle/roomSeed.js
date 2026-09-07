// 部屋ごとの決定的な見た目を作るためのseedユーティリティ。
// Minecraft APIには依存しないため、生成・保存移行・描画テストから共用できる。

export const INITIAL_ROOM_REVISION = 1;

function mix32(value) {
    let mixed = value >>> 0;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x7feb352d);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x846ca68b);
    mixed ^= mixed >>> 16;
    return mixed >>> 0;
}

export function hashString32(value, seed = 0x811c9dc5) {
    let hash = seed >>> 0;
    const text = String(value ?? "");
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return mix32(hash);
}

export function normalizeSeed(value, fallback = 0) {
    return Number.isFinite(value) ? (Math.trunc(value) >>> 0) : (fallback >>> 0);
}

export function deriveRoomSeed(generationSeed, room, revision = INITIAL_ROOM_REVISION) {
    const cell = room?.cell ?? { x: 0, y: 0, z: 0 };
    const identity = [
        normalizeSeed(generationSeed),
        Math.trunc(cell.x ?? 0),
        Math.trunc(cell.y ?? 0),
        Math.trunc(cell.z ?? 0),
        room?.templateId ?? "",
        room?.category ?? "",
        room?.orientation ?? "normal",
        Math.trunc(room?.rotation ?? 0),
        Math.max(INITIAL_ROOM_REVISION, Math.trunc(revision ?? INITIAL_ROOM_REVISION)),
    ].join("|");
    return hashString32(identity);
}

export function createSeededRng(seed) {
    let state = normalizeSeed(seed);
    return function rng() {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function ensureRoomSeed(room, fallbackGenerationSeed) {
    let changed = false;
    if (!Number.isInteger(room.revision) || room.revision < INITIAL_ROOM_REVISION) {
        room.revision = INITIAL_ROOM_REVISION;
        changed = true;
    }
    if (!Number.isInteger(room.roomSeed) || room.roomSeed < 0 || room.roomSeed > 0xffffffff) {
        room.roomSeed = deriveRoomSeed(fallbackGenerationSeed, room, room.revision);
        changed = true;
    } else {
        room.roomSeed >>>= 0;
    }
    return changed;
}

export function ensureGraphRoomSeeds(graph, fallbackGenerationSeed) {
    let changedCount = 0;
    for (const room of graph?.rooms?.values?.() ?? []) {
        if (ensureRoomSeed(room, fallbackGenerationSeed)) changedCount += 1;
    }
    return changedCount;
}
