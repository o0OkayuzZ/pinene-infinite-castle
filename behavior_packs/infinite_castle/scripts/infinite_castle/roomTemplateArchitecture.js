// 21個のRoom Template固有の建築骨格。
// DungeonGraphや抽選処理から独立させ、将来.mcstructureへ置換しやすくする。
import { BlockVolume } from "@minecraft/server";
import { Direction } from "./connector.js";

function point(min, x, y, z) {
    return { x: min.x + x, y: min.y + y, z: min.z + z };
}

function fill(dimension, min, from, to, blockTypeId) {
    const a = point(min, from[0], from[1], from[2]);
    const b = point(min, to[0], to[1], to[2]);
    dimension.fillBlocks(new BlockVolume(
        { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
        { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) }
    ), blockTypeId);
}

function set(dimension, min, at, blockTypeId) {
    try {
        dimension.setBlockType(point(min, at[0], at[1], at[2]), blockTypeId);
    } catch {
        // 小装飾だけが置けない場合は主構造を維持する。
    }
}

function posts(dimension, min, coordinates, fromY, toY, block) {
    for (const [x, z] of coordinates) fill(dimension, min, [x, fromY, z], [x, toY, z], block);
}

function hangingLantern(dimension, min, x, z, chainTop, palette) {
    fill(dimension, min, [x, chainTop - 2, z], [x, chainTop, z], palette.chain);
    set(dimension, min, [x, chainTop - 3, z], palette.lamp);
}

const GALLERY_CENTER = 12;
const GALLERY_ARM_HALF_WIDTH = 1; // 実際に歩く床は3ブロック幅。

function footprintKey(x, z) {
    return `${x},${z}`;
}

function addFootprintRect(footprint, fromX, toX, fromZ, toZ) {
    for (let x = Math.max(0, fromX); x <= Math.min(23, toX); x += 1) {
        for (let z = Math.max(0, fromZ); z <= Math.min(23, toZ); z += 1) {
            footprint.add(footprintKey(x, z));
        }
    }
}

function createGalleryFootprint(room, deckRadius, viewingBay) {
    const footprint = new Set();
    addFootprintRect(
        footprint,
        GALLERY_CENTER - deckRadius,
        GALLERY_CENTER + deckRadius,
        GALLERY_CENTER - deckRadius,
        GALLERY_CENTER + deckRadius
    );
    const directions = new Set((room.resolvedConnectors ?? []).map((connector) => connector.direction));
    if (directions.has(Direction.North)) {
        addFootprintRect(footprint, GALLERY_CENTER - GALLERY_ARM_HALF_WIDTH, GALLERY_CENTER + GALLERY_ARM_HALF_WIDTH, 0, GALLERY_CENTER);
    }
    if (directions.has(Direction.South)) {
        addFootprintRect(footprint, GALLERY_CENTER - GALLERY_ARM_HALF_WIDTH, GALLERY_CENTER + GALLERY_ARM_HALF_WIDTH, GALLERY_CENTER, 23);
    }
    if (directions.has(Direction.West)) {
        addFootprintRect(footprint, 0, GALLERY_CENTER, GALLERY_CENTER - GALLERY_ARM_HALF_WIDTH, GALLERY_CENTER + GALLERY_ARM_HALF_WIDTH);
    }
    if (directions.has(Direction.East)) {
        addFootprintRect(footprint, GALLERY_CENTER, 23, GALLERY_CENTER - GALLERY_ARM_HALF_WIDTH, GALLERY_CENTER + GALLERY_ARM_HALF_WIDTH);
    }
    if (viewingBay) {
        const bayX = GALLERY_CENTER + viewingBay.x;
        const bayZ = GALLERY_CENTER + viewingBay.z;
        // 3ブロック幅のL字支路で展望張り出しを主回廊へ必ず接続する。
        addFootprintRect(
            footprint,
            Math.min(GALLERY_CENTER, bayX),
            Math.max(GALLERY_CENTER, bayX),
            GALLERY_CENTER - 1,
            GALLERY_CENTER + 1
        );
        addFootprintRect(
            footprint,
            bayX - 1,
            bayX + 1,
            Math.min(GALLERY_CENTER, bayZ),
            Math.max(GALLERY_CENTER, bayZ)
        );
        addFootprintRect(
            footprint,
            bayX - 1,
            bayX + 1,
            bayZ - 1,
            bayZ + 1
        );
    }
    return { footprint, directions };
}

function buildGalleryFloorAndRails(d, min, p, footprint, floorAccentPhase) {
    const railCells = new Set();
    for (const key of footprint) {
        const [x, z] = key.split(",").map(Number);
        const floorBlock = (x + z + floorAccentPhase) % 5 === 0 ? p.tatamiAlt : p.beam;
        set(d, min, [x, 0, z], floorBlock);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rx = x + dx;
            const rz = z + dz;
            if (rx < 0 || rx > 23 || rz < 0 || rz > 23) continue;
            const railKey = footprintKey(rx, rz);
            if (!footprint.has(railKey)) railCells.add(railKey);
        }
    }
    for (const key of railCells) {
        const [x, z] = key.split(",").map(Number);
        set(d, min, [x, 1, z], p.rail);
    }
}

function buildNorthSouthFrame(d, min, p, z, accentBlock) {
    posts(d, min, [[10, z], [14, z]], 1, 6, p.pillar);
    fill(d, min, [10, 6, z], [14, 6, z], accentBlock);
    fill(d, min, [9, 7, z], [15, 7, z], p.ceilingTile);
}

function buildEastWestFrame(d, min, p, x, accentBlock) {
    posts(d, min, [[x, 10], [x, 14]], 1, 6, p.pillar);
    fill(d, min, [x, 6, 10], [x, 6, 14], accentBlock);
    fill(d, min, [x, 7, 9], [x, 7, 15], p.ceilingTile);
}

function buildOpenGalleryCorridor(d, min, p, room, style) {
    const { footprint, directions } = createGalleryFootprint(room, style.deckRadius, style.viewingBay);
    const seededFloorPhase = (style.floorAccentPhase + ((room.roomSeed ?? 0) >>> 0)) % 5;
    buildGalleryFloorAndRails(d, min, p, footprint, seededFloorPhase);

    const accentBlock = style.vermilionFrame ? p.vermilion : p.beam;
    if (directions.has(Direction.North)) buildNorthSouthFrame(d, min, p, 4, accentBlock);
    if (directions.has(Direction.South)) buildNorthSouthFrame(d, min, p, 20, accentBlock);
    if (directions.has(Direction.West)) buildEastWestFrame(d, min, p, 4, accentBlock);
    if (directions.has(Direction.East)) buildEastWestFrame(d, min, p, 20, accentBlock);

    // 中央の細い櫓門フレームだけを残し、連続屋根や壁は作らない。
    if (style.centerFrameAxis === "ns") buildNorthSouthFrame(d, min, p, GALLERY_CENTER, accentBlock);
    else buildEastWestFrame(d, min, p, GALLERY_CENTER, accentBlock);
    set(d, min, [GALLERY_CENTER, 5, GALLERY_CENTER], p.lamp);

    if (style.viewingBay) {
        const bx = GALLERY_CENTER + style.viewingBay.x;
        const bz = GALLERY_CENTER + style.viewingBay.z;
        set(d, min, [bx, 0, bz], style.vermilionFrame ? p.brass : p.tatami);
        set(d, min, [bx, 2, bz], p.chain);
        set(d, min, [bx, 3, bz], p.lamp);
    }
}

function buildCorridorStraightNs(d, min, p, room) {
    buildOpenGalleryCorridor(d, min, p, room, { deckRadius: 2, floorAccentPhase: 0, centerFrameAxis: "ns", vermilionFrame: false });
}

function buildCorridorStraightEw(d, min, p, room) {
    buildOpenGalleryCorridor(d, min, p, room, { deckRadius: 2, floorAccentPhase: 1, centerFrameAxis: "ew", vermilionFrame: true });
}

function buildCorridorTurnNe(d, min, p, room) {
    buildOpenGalleryCorridor(d, min, p, room, { deckRadius: 2, floorAccentPhase: 2, centerFrameAxis: "ns", vermilionFrame: true, viewingBay: { x: -4, z: 4 } });
}

function buildCorridorTurnSw(d, min, p, room) {
    buildOpenGalleryCorridor(d, min, p, room, { deckRadius: 2, floorAccentPhase: 3, centerFrameAxis: "ew", vermilionFrame: false, viewingBay: { x: 4, z: -4 } });
}

function buildCorridorTJunction(d, min, p, room) {
    buildOpenGalleryCorridor(d, min, p, room, { deckRadius: 3, floorAccentPhase: 4, centerFrameAxis: "ns", vermilionFrame: true, viewingBay: { x: 0, z: 5 } });
}

function buildCorridorCrossroads(d, min, p, room) {
    buildOpenGalleryCorridor(d, min, p, room, { deckRadius: 3, floorAccentPhase: 5, centerFrameAxis: "ew", vermilionFrame: false, viewingBay: { x: -5, z: -5 } });
}

function buildStairsStraight(d, min, p) {
    posts(d, min, [[7, 3], [16, 3], [7, 20], [16, 20]], 1, 14, p.pillar);
    for (let step = 0; step < 10; step += 1) {
        const z = 3 + step * 2;
        fill(d, min, [8, 1 + step, z], [15, 1 + step, z + 1], p.beam);
    }
    fill(d, min, [7, 11, 20], [16, 11, 22], p.vermilion);
}

function buildStairsSpiral(d, min, p) {
    posts(d, min, [[8, 8], [15, 8], [8, 15], [15, 15]], 1, 14, p.pillar);
    const spiral = [[12, 8], [15, 10], [15, 14], [13, 16], [9, 16], [7, 13], [7, 9], [10, 7]];
    spiral.forEach(([x, z], index) => fill(d, min, [x - 1, 1 + index, z - 1], [x + 1, 1 + index, z + 1], p.beam));
    fill(d, min, [6, 10, 6], [17, 10, 17], p.vermilion);
    fill(d, min, [9, 10, 9], [14, 10, 14], p.air);
}

function buildStairsSwitchback(d, min, p) {
    for (let step = 0; step < 7; step += 1) fill(d, min, [3 + step, 1 + step, 5], [3 + step, 1 + step, 9], p.beam);
    fill(d, min, [9, 8, 4], [15, 8, 10], p.vermilion);
    for (let step = 0; step < 6; step += 1) fill(d, min, [15 - step, 9 + step, 13], [15 - step, 9 + step, 17], p.beam);
    posts(d, min, [[2, 4], [16, 4], [2, 18], [16, 18]], 1, 14, p.pillar);
}

function buildHallA(d, min, p) {
    fill(d, min, [3, 1, 3], [20, 1, 8], p.beam);
    fill(d, min, [4, 2, 4], [19, 8, 4], p.wall);
    fill(d, min, [3, 2, 3], [3, 10, 9], p.pillar);
    fill(d, min, [20, 2, 3], [20, 10, 9], p.pillar);
    fill(d, min, [5, 4, 5], [10, 4, 5], p.brass);
    fill(d, min, [12, 6, 5], [18, 6, 5], p.beam);
    hangingLantern(d, min, 12, 15, 13, p);
}

function buildHallB(d, min, p) {
    for (const x of [6, 12, 18]) {
        fill(d, min, [x, 1, 2], [x, 8, 21], p.shoji);
        for (const z of [4, 10, 16, 21]) fill(d, min, [x, 1, z], [x, 9, z], p.pillar);
    }
    fill(d, min, [1, 0, 10], [22, 0, 13], p.vermilion);
    for (const x of [3, 9, 15, 21]) hangingLantern(d, min, x, 12, 12, p);
}

function buildHallC(d, min, p) {
    fill(d, min, [4, 1, 4], [19, 2, 19], p.beam);
    fill(d, min, [6, 2, 6], [17, 2, 17], p.tatami);
    posts(d, min, [[4, 4], [19, 4], [4, 19], [19, 19]], 1, 13, p.pillar);
    fill(d, min, [2, 1, 9], [4, 7, 14], p.shoji);
    fill(d, min, [19, 1, 9], [21, 7, 14], p.shoji);
    fill(d, min, [8, 10, 8], [15, 11, 15], p.beam);
    set(d, min, [12, 9, 12], p.lamp);
}

function buildBattleA(d, min, p) {
    fill(d, min, [3, 0, 3], [20, 0, 20], p.vermilion);
    fill(d, min, [5, 0, 5], [18, 0, 18], p.tatami);
    posts(d, min, [[3, 3], [20, 3], [3, 20], [20, 20]], 1, 13, p.pillar);
    for (const offset of [7, 12, 17]) {
        fill(d, min, [offset, 11, 3], [offset, 11, 20], p.beam);
        fill(d, min, [3, 11, offset], [20, 11, offset], p.beam);
    }
}

function buildBattleB(d, min, p) {
    const forest = [[5, 5], [10, 4], [16, 6], [19, 11], [15, 15], [7, 17], [11, 20], [4, 12]];
    forest.forEach(([x, z], index) => {
        fill(d, min, [x, 1, z], [x, 7 + (index % 4), z], index % 2 ? p.vermilion : p.pillar);
        set(d, min, [x, 8 + (index % 4), z], p.brass);
    });
    fill(d, min, [2, 0, 2], [21, 0, 21], p.stone);
    fill(d, min, [8, 0, 8], [15, 0, 15], p.tatami);
}

function buildTreasureA(d, min, p) {
    for (const x of [4, 8, 15, 19]) {
        fill(d, min, [x, 1, 4], [x, 8, 19], p.storage);
        fill(d, min, [x, 4, 3], [x, 4, 20], p.beam);
    }
    fill(d, min, [9, 1, 7], [14, 2, 16], p.stone);
    set(d, min, [12, 3, 12], p.brass);
    hangingLantern(d, min, 12, 12, 13, p);
}

function buildTreasureB(d, min, p) {
    fill(d, min, [5, 1, 5], [18, 2, 18], p.vermilion);
    fill(d, min, [7, 2, 7], [16, 3, 16], p.beam);
    fill(d, min, [9, 3, 9], [14, 4, 14], p.brass);
    posts(d, min, [[5, 5], [18, 5], [5, 18], [18, 18]], 1, 13, p.vermilion);
    fill(d, min, [3, 11, 3], [20, 12, 20], p.beam);
    fill(d, min, [7, 11, 7], [16, 12, 16], p.air);
    set(d, min, [12, 5, 12], p.storage);
}

function buildAtriumA(d, min, p) {
    for (const box of [[[2, 7, 2], [21, 8, 5]], [[2, 7, 18], [21, 8, 21]], [[2, 7, 6], [5, 8, 17]], [[18, 7, 6], [21, 8, 17]]]) fill(d, min, box[0], box[1], p.beam);
    posts(d, min, [[5, 5], [18, 5], [5, 18], [18, 18]], 1, 14, p.pillar);
    for (const [x, z] of [[7, 7], [16, 7], [7, 16], [16, 16]]) set(d, min, [x, 8, z], p.lamp);
}

function buildAtriumB(d, min, p) {
    fill(d, min, [2, 6, 10], [21, 8, 13], p.beam);
    fill(d, min, [10, 10, 2], [13, 12, 21], p.vermilion);
    fill(d, min, [9, 5, 9], [14, 13, 14], p.air);
    posts(d, min, [[3, 9], [20, 9], [9, 3], [9, 20], [14, 3], [14, 20]], 1, 14, p.pillar);
    hangingLantern(d, min, 12, 12, 14, p);
}

function buildEntrance(d, min, p) {
    fill(d, min, [3, 0, 3], [20, 0, 20], p.stone);
    fill(d, min, [5, 0, 5], [18, 0, 18], p.tatami);
    posts(d, min, [[5, 7], [18, 7], [5, 16], [18, 16]], 1, 14, p.vermilion);
    fill(d, min, [3, 10, 6], [20, 12, 8], p.beam);
    fill(d, min, [3, 10, 15], [20, 12, 17], p.beam);
    for (const x of [7, 12, 17]) hangingLantern(d, min, x, 12, 14, p);
}

function buildExit(d, min, p) {
    fill(d, min, [4, 0, 4], [19, 1, 19], p.brass);
    fill(d, min, [6, 1, 6], [17, 1, 17], p.tatami);
    posts(d, min, [[4, 4], [19, 4], [4, 19], [19, 19]], 1, 14, p.vermilion);
    fill(d, min, [2, 11, 2], [21, 13, 21], p.beam);
    fill(d, min, [7, 11, 7], [16, 13, 16], p.air);
    hangingLantern(d, min, 12, 12, 14, p);
}

function buildDeepEntrance(d, min, p) {
    fill(d, min, [3, 0, 3], [20, 0, 20], p.deep);
    fill(d, min, [7, 0, 7], [16, 1, 16], p.stone);
    posts(d, min, [[4, 4], [19, 4], [4, 19], [19, 19], [8, 8], [15, 8], [8, 15], [15, 15]], 1, 14, p.deep);
    for (const y of [5, 9, 13]) fill(d, min, [6, y, 6], [17, y, 17], p.vermilion);
    fill(d, min, [9, 4, 9], [14, 14, 14], p.air);
    set(d, min, [12, 3, 12], p.lamp);
}

const BUILDERS = Object.freeze({
    corridor_straight_ns: buildCorridorStraightNs,
    corridor_straight_ew: buildCorridorStraightEw,
    corridor_turn_ne: buildCorridorTurnNe,
    corridor_turn_sw: buildCorridorTurnSw,
    corridor_t_junction: buildCorridorTJunction,
    corridor_crossroads: buildCorridorCrossroads,
    stairs_straight: buildStairsStraight,
    stairs_spiral: buildStairsSpiral,
    stairs_switchback: buildStairsSwitchback,
    hall_a: buildHallA,
    hall_b: buildHallB,
    hall_c: buildHallC,
    battle_a: buildBattleA,
    battle_b: buildBattleB,
    treasure_a: buildTreasureA,
    treasure_b: buildTreasureB,
    atrium_a: buildAtriumA,
    atrium_b: buildAtriumB,
    entrance_main: buildEntrance,
    exit_main: buildExit,
    deep_entrance_marker: buildDeepEntrance,
});

export function getTemplateArchitectureIds() {
    return Object.freeze(Object.keys(BUILDERS));
}

export function buildTemplateArchitecture(dimension, room, min, max, palette) {
    const builder = BUILDERS[room.templateId];
    if (!builder) throw new Error(`missing architecture builder for template: ${room.templateId}`);
    builder(dimension, min, palette, room, max);
}
