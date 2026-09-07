// プレースホルダー用の和風建築レンダラー。
// DungeonGraph/RoomRegistryには依存させず、RoomInstanceを実際のブロックへ変換するだけにする。
// 将来.mcstructureへ移行するときは、この公開関数2つをStructure配置へ差し替えればよい。
import { BlockVolume } from "@minecraft/server";
import { CELL_SIZE } from "./config.js";
import { cellWorldMin, cellWorldMax } from "./worldCoords.js";
import { Direction } from "./connector.js";
import { RoomCategory } from "./roomRegistry.js";
import { createSeededRng, deriveRoomSeed } from "./roomSeed.js";
import {
    buildOrikamiCofferedCeiling,
    buildRanmaBand,
    buildShoinSuite,
    buildMushaBashiri,
    buildAtriumGallery,
    buildCastleStairCore,
    buildLayeredCastleGate,
} from "./japaneseCastlePieces.js";
import { buildTemplateArchitecture } from "./roomTemplateArchitecture.js";

const BLOCK = Object.freeze({
    air: "minecraft:air",
    foundation: "minecraft:polished_deepslate",
    tatami: "minecraft:smooth_sandstone",
    tatamiAlt: "minecraft:cut_sandstone",
    pillar: "minecraft:stripped_dark_oak_wood",
    beam: "minecraft:dark_oak_planks",
    wall: "minecraft:calcite",
    ceilingTile: "minecraft:deepslate_tiles",
    shoji: "minecraft:white_stained_glass",
    rail: "minecraft:dark_oak_fence",
    vermilion: "minecraft:red_nether_brick",
    brass: "minecraft:gold_block",
    lamp: "minecraft:sea_lantern",
    deep: "minecraft:crying_obsidian",
    scaffold: "minecraft:scaffolding",
    chain: "minecraft:chain",
    chest: "minecraft:chest",
    carpet: "minecraft:red_carpet",
    garden: "minecraft:moss_block",
    water: "minecraft:water",
    stone: "minecraft:polished_blackstone_bricks",
    storage: "minecraft:barrel",
});

const DOOR_WIDTH = 3;
const DOOR_HEIGHT = 4;

export function createRoomVisualPlan(room) {
    const fallbackSeed = deriveRoomSeed(0, room, room.revision);
    const seed = Number.isInteger(room.roomSeed) ? room.roomSeed : fallbackSeed;
    const rng = createSeededRng(seed);
    const offsets = [-5, 0, 5];
    return Object.freeze({
        tatamiPhaseX: Math.floor(rng() * 3),
        tatamiPhaseZ: Math.floor(rng() * 3),
        corridorAlongX: rng() < 0.5,
        lampOffsetX: offsets[Math.floor(rng() * offsets.length)],
        lampOffsetZ: offsets[Math.floor(rng() * offsets.length)],
        hallCorner: Math.floor(rng() * 4),
        featureSide: ["north", "east", "south", "west"][Math.floor(rng() * 4)],
        battleRotation: Math.floor(rng() * 2),
        treasureOffsetX: rng() < 0.5 ? -2 : 2,
        treasureOffsetZ: rng() < 0.5 ? -2 : 2,
        atriumLampHeight: 5 + Math.floor(rng() * 4),
    });
}

function orderedBox(from, to) {
    return {
        from: {
            x: Math.min(from.x, to.x),
            y: Math.min(from.y, to.y),
            z: Math.min(from.z, to.z),
        },
        to: {
            x: Math.max(from.x, to.x),
            y: Math.max(from.y, to.y),
            z: Math.max(from.z, to.z),
        },
    };
}

function fill(dimension, from, to, blockTypeId) {
    const box = orderedBox(from, to);
    dimension.fillBlocks(new BlockVolume(box.from, box.to), blockTypeId);
}

function setBlock(dimension, location, blockTypeId) {
    try {
        dimension.setBlockType(location, blockTypeId);
    } catch {
        // 装飾1ブロックの失敗で部屋全体を中断しない。
    }
}

function buildTatamiFloor(dimension, min, max, visualPlan) {
    fill(dimension, { x: min.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: max.z }, BLOCK.foundation);
    fill(
        dimension,
        { x: min.x + 1, y: min.y, z: min.z + 1 },
        { x: max.x - 1, y: min.y, z: max.z - 1 },
        BLOCK.tatami
    );

    // 6x3程度の畳割りを濃色の縁で表現する。
    for (let x = min.x + 6; x < max.x; x += 6) {
        fill(dimension, { x, y: min.y, z: min.z + 1 }, { x, y: min.y, z: max.z - 1 }, BLOCK.beam);
    }
    for (let z = min.z + 6; z < max.z; z += 6) {
        fill(dimension, { x: min.x + 1, y: min.y, z }, { x: max.x - 1, y: min.y, z }, BLOCK.beam);
    }
    // 畳の向き違いを薄い市松で示す。
    for (let x = min.x + 2 + visualPlan.tatamiPhaseX; x + 2 <= max.x - 1; x += 6) {
        for (let z = min.z + 2 + visualPlan.tatamiPhaseZ; z + 2 <= max.z - 1; z += 6) {
            fill(dimension, { x, y: min.y, z }, { x: x + 2, y: min.y, z: z + 2 }, BLOCK.tatamiAlt);
        }
    }
}

function buildWallsAndCeiling(dimension, min, max) {
    // 白壁4面。
    fill(dimension, { x: min.x, y: min.y + 1, z: min.z }, { x: max.x, y: max.y - 1, z: min.z }, BLOCK.wall);
    fill(dimension, { x: min.x, y: min.y + 1, z: max.z }, { x: max.x, y: max.y - 1, z: max.z }, BLOCK.wall);
    fill(dimension, { x: min.x, y: min.y + 1, z: min.z }, { x: min.x, y: max.y - 1, z: max.z }, BLOCK.wall);
    fill(dimension, { x: max.x, y: min.y + 1, z: min.z }, { x: max.x, y: max.y - 1, z: max.z }, BLOCK.wall);
    fill(dimension, { x: min.x, y: max.y, z: min.z }, { x: max.x, y: max.y, z: max.z }, BLOCK.ceilingTile);

    // 柱・長押・天井梁。外殻を単色の箱にせず、木造軸組が読める形にする。
    const xPosts = [min.x, min.x + 6, min.x + 12, min.x + 18, max.x];
    const zPosts = [min.z, min.z + 6, min.z + 12, min.z + 18, max.z];
    for (const x of xPosts) {
        fill(dimension, { x, y: min.y, z: min.z }, { x, y: max.y, z: min.z }, BLOCK.pillar);
        fill(dimension, { x, y: min.y, z: max.z }, { x, y: max.y, z: max.z }, BLOCK.pillar);
        fill(dimension, { x, y: max.y - 1, z: min.z }, { x, y: max.y - 1, z: max.z }, BLOCK.beam);
    }
    for (const z of zPosts) {
        fill(dimension, { x: min.x, y: min.y, z }, { x: min.x, y: max.y, z }, BLOCK.pillar);
        fill(dimension, { x: max.x, y: min.y, z }, { x: max.x, y: max.y, z }, BLOCK.pillar);
        fill(dimension, { x: min.x, y: max.y - 1, z }, { x: max.x, y: max.y - 1, z }, BLOCK.beam);
    }
    for (const y of [min.y + 5, max.y - 3]) {
        fill(dimension, { x: min.x, y, z: min.z }, { x: max.x, y, z: min.z }, BLOCK.beam);
        fill(dimension, { x: min.x, y, z: max.z }, { x: max.x, y, z: max.z }, BLOCK.beam);
        fill(dimension, { x: min.x, y, z: min.z }, { x: min.x, y, z: max.z }, BLOCK.beam);
        fill(dimension, { x: max.x, y, z: min.z }, { x: max.x, y, z: max.z }, BLOCK.beam);
    }
}

function horizontalDoorGeometry(direction, min, max) {
    const centerX = min.x + Math.floor(CELL_SIZE.x / 2);
    const centerZ = min.z + Math.floor(CELL_SIZE.z / 2);
    const half = Math.floor(DOOR_WIDTH / 2);
    const bottom = min.y + 1;
    const top = min.y + DOOR_HEIGHT;
    if (direction === Direction.North || direction === Direction.South) {
        const z = direction === Direction.North ? min.z : max.z;
        return {
            frameFrom: { x: centerX - half - 1, y: min.y, z },
            frameTo: { x: centerX + half + 1, y: top + 1, z },
            openFrom: { x: centerX - half, y: bottom, z },
            openTo: { x: centerX + half, y: top, z },
            wings: [
                [{ x: centerX - 5, y: bottom, z }, { x: centerX - 3, y: top, z }],
                [{ x: centerX + 3, y: bottom, z }, { x: centerX + 5, y: top, z }],
            ],
        };
    }
    const x = direction === Direction.West ? min.x : max.x;
    return {
        frameFrom: { x, y: min.y, z: centerZ - half - 1 },
        frameTo: { x, y: top + 1, z: centerZ + half + 1 },
        openFrom: { x, y: bottom, z: centerZ - half },
        openTo: { x, y: top, z: centerZ + half },
        wings: [
            [{ x, y: bottom, z: centerZ - 5 }, { x, y: top, z: centerZ - 3 }],
            [{ x, y: bottom, z: centerZ + 3 }, { x, y: top, z: centerZ + 5 }],
        ],
    };
}

function openHorizontalShoji(dimension, direction, min, max) {
    const geometry = horizontalDoorGeometry(direction, min, max);
    fill(dimension, geometry.frameFrom, geometry.frameTo, BLOCK.pillar);
    for (const [from, to] of geometry.wings) fill(dimension, from, to, BLOCK.shoji);
    fill(dimension, geometry.openFrom, geometry.openTo, BLOCK.air);
}

function openSafeHorizontalRoute(dimension, direction, min, max) {
    const centerX = min.x + Math.floor(CELL_SIZE.x / 2);
    const centerZ = min.z + Math.floor(CELL_SIZE.z / 2);
    const bottom = min.y + 1;
    const top = min.y + DOOR_HEIGHT;
    let from;
    let to;
    if (direction === Direction.North) {
        from = { x: centerX - 1, y: bottom, z: min.z };
        to = { x: centerX + 1, y: top, z: centerZ };
    } else if (direction === Direction.South) {
        from = { x: centerX - 1, y: bottom, z: centerZ };
        to = { x: centerX + 1, y: top, z: max.z };
    } else if (direction === Direction.West) {
        from = { x: min.x, y: bottom, z: centerZ - 1 };
        to = { x: centerX, y: top, z: centerZ + 1 };
    } else {
        from = { x: centerX, y: bottom, z: centerZ - 1 };
        to = { x: max.x, y: top, z: centerZ + 1 };
    }
    fill(dimension, from, to, BLOCK.air);
    fill(
        dimension,
        { x: from.x, y: min.y, z: from.z },
        { x: to.x, y: min.y, z: to.z },
        BLOCK.beam
    );
}

function openVerticalShaft(dimension, room, min, max) {
    const directions = new Set(room.resolvedConnectors.map((connector) => connector.direction));
    if (!directions.has(Direction.Up) && !directions.has(Direction.Down)) return;
    const centerX = min.x + Math.floor(CELL_SIZE.x / 2);
    const centerZ = min.z + Math.floor(CELL_SIZE.z / 2);

    // 格天井・上層回廊・姿勢装飾より後に、5x5の通行空間をセル内で貫通させる。
    // これにより装飾が縦socketを塞ぐことを構造的に防ぐ。
    const shaftStartY = directions.has(Direction.Down) ? min.y : min.y + 1;
    const shaftEndY = directions.has(Direction.Up) ? max.y : max.y - 1;
    fill(
        dimension,
        { x: centerX - 2, y: shaftStartY, z: centerZ - 2 },
        { x: centerX + 2, y: shaftEndY, z: centerZ + 2 },
        BLOCK.air
    );

    if (directions.has(Direction.Down)) {
        fill(
            dimension,
            { x: centerX - 2, y: min.y, z: centerZ - 2 },
            { x: centerX + 2, y: min.y, z: centerZ + 2 },
            BLOCK.pillar
        );
        setBlock(dimension, { x: centerX, y: min.y, z: centerZ }, BLOCK.air);
    }
    if (directions.has(Direction.Up)) {
        fill(
            dimension,
            { x: centerX - 2, y: max.y, z: centerZ - 2 },
            { x: centerX + 2, y: max.y, z: centerZ + 2 },
            BLOCK.pillar
        );
        setBlock(dimension, { x: centerX, y: max.y, z: centerZ }, BLOCK.air);
    }

    // v0.1では確実に登れることを優先して足場を採用。下層から先に建てることで支持も保つ。
    const startY = directions.has(Direction.Down) ? min.y : min.y + 1;
    const endY = directions.has(Direction.Up) ? max.y : Math.min(max.y - 1, min.y + 5);
    fill(dimension, { x: centerX, y: startY, z: centerZ }, { x: centerX, y: endY, z: centerZ }, BLOCK.scaffold);

    // 吹き抜けの縁を視認しやすくする四隅の灯り。
    for (const dx of [-2, 2]) {
        for (const dz of [-2, 2]) {
            setBlock(dimension, { x: centerX + dx, y: min.y + 1, z: centerZ + dz }, BLOCK.lamp);
        }
    }
}

function buildHangingLamp(dimension, x, minY, maxY, z) {
    fill(dimension, { x, y: maxY - 3, z }, { x, y: maxY - 2, z }, BLOCK.chain);
    setBlock(dimension, { x, y: maxY - 4, z }, BLOCK.lamp);
}

function buildTorii(dimension, min, max, material, rotation) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    const y = min.y + 1;
    const alongX = rotation % 180 === 0;
    if (alongX) {
        fill(dimension, { x: cx - 4, y, z: cz }, { x: cx - 4, y: y + 6, z: cz }, material);
        fill(dimension, { x: cx + 4, y, z: cz }, { x: cx + 4, y: y + 6, z: cz }, material);
        fill(dimension, { x: cx - 5, y: y + 6, z: cz }, { x: cx + 5, y: y + 6, z: cz }, material);
        fill(dimension, { x: cx - 4, y: y + 4, z: cz }, { x: cx + 4, y: y + 4, z: cz }, material);
    } else {
        fill(dimension, { x: cx, y, z: cz - 4 }, { x: cx, y: y + 6, z: cz - 4 }, material);
        fill(dimension, { x: cx, y, z: cz + 4 }, { x: cx, y: y + 6, z: cz + 4 }, material);
        fill(dimension, { x: cx, y: y + 6, z: cz - 5 }, { x: cx, y: y + 6, z: cz + 5 }, material);
        fill(dimension, { x: cx, y: y + 4, z: cz - 4 }, { x: cx, y: y + 4, z: cz + 4 }, material);
    }
}

function decorateCorridor(dimension, min, max, visualPlan) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    if (visualPlan.corridorAlongX) {
        fill(dimension, { x: min.x + 2, y: min.y + 1, z: cz - 1 }, { x: max.x - 2, y: min.y + 1, z: cz + 1 }, BLOCK.carpet);
    } else {
        fill(dimension, { x: cx - 1, y: min.y + 1, z: min.z + 2 }, { x: cx + 1, y: min.y + 1, z: max.z - 2 }, BLOCK.carpet);
    }
    buildHangingLamp(
        dimension,
        cx + visualPlan.lampOffsetX,
        min.y,
        max.y,
        cz + visualPlan.lampOffsetZ
    );
}

function decorateHall(dimension, min, max, visualPlan) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    buildHangingLamp(dimension, cx, min.y, max.y, cz);
}

function decorateBattle(dimension, min, max, visualPlan) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    fill(dimension, { x: cx - 4, y: min.y, z: cz - 4 }, { x: cx + 4, y: min.y, z: cz + 4 }, BLOCK.beam);
    fill(dimension, { x: cx - 3, y: min.y, z: cz - 3 }, { x: cx + 3, y: min.y, z: cz + 3 }, BLOCK.tatami);
    const pillarOffsets = visualPlan.battleRotation === 0
        ? [[-7, -7], [7, -7], [-7, 7], [7, 7]]
        : [[-8, 0], [8, 0], [0, -8], [0, 8]];
    for (const [dx, dz] of pillarOffsets) {
        fill(dimension, { x: cx + dx, y: min.y + 1, z: cz + dz }, { x: cx + dx, y: min.y + 5, z: cz + dz }, BLOCK.vermilion);
    }
}

function decorateTreasure(dimension, min, max, visualPlan) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    fill(dimension, { x: cx - 2, y: min.y, z: cz - 2 }, { x: cx + 2, y: min.y, z: cz + 2 }, BLOCK.brass);
    fill(dimension, { x: cx - 1, y: min.y, z: cz - 1 }, { x: cx + 1, y: min.y, z: cz + 1 }, BLOCK.beam);
    setBlock(
        dimension,
        { x: cx + visualPlan.treasureOffsetX, y: min.y + 1, z: cz + visualPlan.treasureOffsetZ },
        BLOCK.chest
    );
    buildHangingLamp(dimension, cx, min.y, max.y, cz);
}

function decorateAtrium(dimension, min, max, visualPlan) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
        fill(dimension, { x: cx + dx, y: min.y + 1, z: cz + dz }, { x: cx + dx, y: max.y - 1, z: cz + dz }, BLOCK.pillar);
        setBlock(dimension, { x: cx + dx, y: min.y + visualPlan.atriumLampHeight, z: cz + dz }, BLOCK.lamp);
    }
}

function decorateEntrance(dimension, room, min, max) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    setBlock(dimension, { x: cx, y: min.y, z: cz }, "minecraft:glowstone");
}

function decorateExit(dimension, room, min, max) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    fill(dimension, { x: cx - 3, y: min.y, z: cz - 3 }, { x: cx + 3, y: min.y, z: cz + 3 }, BLOCK.lamp);
    fill(dimension, { x: cx - 2, y: min.y, z: cz - 2 }, { x: cx + 2, y: min.y, z: cz + 2 }, BLOCK.tatami);
    setBlock(dimension, { x: cx, y: min.y + 1, z: cz }, BLOCK.lamp);
}

function decorateDeepEntrance(dimension, room, min, max) {
    const cx = min.x + Math.floor(CELL_SIZE.x / 2);
    const cz = min.z + Math.floor(CELL_SIZE.z / 2);
    buildTorii(dimension, min, max, BLOCK.deep, room.rotation);
    fill(dimension, { x: cx - 2, y: min.y, z: cz - 2 }, { x: cx + 2, y: min.y, z: cz + 2 }, BLOCK.deep);
}

function decoratePose(dimension, room, min, max) {
    if (room.orientation === "upsidedown") {
        // 攻略床は残したまま、天井に畳と家具の影を置いて逆さ感だけを出す。
        fill(
            dimension,
            { x: min.x + 3, y: max.y - 1, z: min.z + 3 },
            { x: max.x - 3, y: max.y - 1, z: max.z - 3 },
            BLOCK.tatami
        );
        fill(
            dimension,
            { x: min.x + 8, y: max.y - 3, z: min.z + 8 },
            { x: max.x - 8, y: max.y - 2, z: max.z - 8 },
            BLOCK.beam
        );
    } else if (room.orientation === "sideways") {
        // 壁面に畳・梁を貼り、横倒しの別室が刺さっているように見せる。
        const useEastWall = room.rotation % 180 === 0;
        if (useEastWall) {
            fill(
                dimension,
                { x: max.x - 1, y: min.y + 3, z: min.z + 4 },
                { x: max.x - 1, y: max.y - 3, z: max.z - 4 },
                BLOCK.tatami
            );
            fill(dimension, { x: max.x - 2, y: min.y + 7, z: min.z + 4 }, { x: max.x - 2, y: min.y + 7, z: max.z - 4 }, BLOCK.beam);
        } else {
            fill(
                dimension,
                { x: min.x + 4, y: min.y + 3, z: max.z - 1 },
                { x: max.x - 4, y: max.y - 3, z: max.z - 1 },
                BLOCK.tatami
            );
            fill(dimension, { x: min.x + 4, y: min.y + 7, z: max.z - 2 }, { x: max.x - 4, y: min.y + 7, z: max.z - 2 }, BLOCK.beam);
        }
    }
}

function decorateCategory(dimension, room, min, max, visualPlan) {
    switch (room.category) {
        case RoomCategory.Corridor:
            decorateCorridor(dimension, min, max, visualPlan);
            break;
        case RoomCategory.Stairs:
            decorateCorridor(dimension, min, max, visualPlan);
            break;
        case RoomCategory.Hall:
            decorateHall(dimension, min, max, visualPlan);
            break;
        case RoomCategory.Battle:
            decorateBattle(dimension, min, max, visualPlan);
            break;
        case RoomCategory.Treasure:
            decorateTreasure(dimension, min, max, visualPlan);
            break;
        case RoomCategory.Atrium:
            decorateAtrium(dimension, min, max, visualPlan);
            break;
        case RoomCategory.Entrance:
            decorateEntrance(dimension, room, min, max);
            break;
        case RoomCategory.Exit:
            decorateExit(dimension, room, min, max);
            break;
        case RoomCategory.DeepEntrance:
            decorateDeepEntrance(dimension, room, min, max);
            break;
        default:
            break;
    }
}

function* decorateCastleArchitecture(dimension, room, min, max, visualPlan) {
    const formal = room.category === RoomCategory.Hall
        || room.category === RoomCategory.Treasure
        || room.category === RoomCategory.Exit;
    buildOrikamiCofferedCeiling(dimension, min, max, BLOCK, formal);
    yield;

    switch (room.category) {
        case RoomCategory.Corridor:
            buildMushaBashiri(dimension, min, max, BLOCK, visualPlan.battleRotation);
            buildRanmaBand(dimension, min, max, BLOCK, visualPlan.featureSide, false);
            break;
        case RoomCategory.Stairs:
            buildCastleStairCore(dimension, min, max, BLOCK);
            buildRanmaBand(dimension, min, max, BLOCK, visualPlan.featureSide, false);
            break;
        case RoomCategory.Hall:
            buildShoinSuite(dimension, min, max, BLOCK, visualPlan.hallCorner, true);
            buildRanmaBand(dimension, min, max, BLOCK, visualPlan.featureSide, true);
            break;
        case RoomCategory.Battle:
            buildMushaBashiri(dimension, min, max, BLOCK, visualPlan.battleRotation);
            buildRanmaBand(dimension, min, max, BLOCK, visualPlan.featureSide, false);
            break;
        case RoomCategory.Treasure:
            buildShoinSuite(dimension, min, max, BLOCK, visualPlan.hallCorner, true);
            buildRanmaBand(dimension, min, max, BLOCK, visualPlan.featureSide, true);
            break;
        case RoomCategory.Atrium:
            buildAtriumGallery(dimension, min, max, BLOCK, visualPlan.atriumLampHeight);
            break;
        case RoomCategory.Entrance:
            buildLayeredCastleGate(dimension, min, max, BLOCK, room.rotation, false);
            buildRanmaBand(dimension, min, max, BLOCK, visualPlan.featureSide, false);
            break;
        case RoomCategory.Exit:
            buildLayeredCastleGate(dimension, min, max, BLOCK, room.rotation, true);
            buildShoinSuite(dimension, min, max, BLOCK, visualPlan.hallCorner, true);
            break;
        case RoomCategory.DeepEntrance:
            buildMushaBashiri(dimension, min, max, BLOCK, visualPlan.battleRotation);
            break;
        default:
            break;
    }
    yield;
}

export function* buildJapaneseRoomPhased(dimension, room) {
    const min = cellWorldMin(room.cell);
    const max = cellWorldMax(room.cell);
    const visualPlan = createRoomVisualPlan(room);

    // 毎回セルを初期化してから、床→壁・軸組→接続口→装飾の順に構築する。
    fill(dimension, min, max, BLOCK.air);
    yield;

    // 廊下だけは24x24の箱を建てず、実connectorに沿う幅3の空中回廊として描画する。
    // 外周を空気のまま残すことで、隣接する部屋と再構築の変化を見渡せる。
    if (room.category === RoomCategory.Corridor) {
        buildTemplateArchitecture(dimension, room, min, max, BLOCK);
        yield;
        for (const connector of room.resolvedConnectors) {
            if (
                connector.direction === Direction.North
                || connector.direction === Direction.South
                || connector.direction === Direction.East
                || connector.direction === Direction.West
            ) {
                openHorizontalShoji(dimension, connector.direction, min, max);
                openSafeHorizontalRoute(dimension, connector.direction, min, max);
                yield;
            }
        }
        openVerticalShaft(dimension, room, min, max);
        yield;
        return;
    }

    buildTatamiFloor(dimension, min, max, visualPlan);
    yield;
    buildWallsAndCeiling(dimension, min, max);
    yield;
    decoratePose(dimension, room, min, max);
    yield* decorateCastleArchitecture(dimension, room, min, max, visualPlan);
    decorateCategory(dimension, room, min, max, visualPlan);
    yield;
    buildTemplateArchitecture(dimension, room, min, max, BLOCK);
    yield;

    // 最後に接続口を開け、装飾が通路や縦足場を上書きしないようにする。
    for (const connector of room.resolvedConnectors) {
        if (
            connector.direction === Direction.North
            || connector.direction === Direction.South
            || connector.direction === Direction.East
            || connector.direction === Direction.West
        ) {
            openHorizontalShoji(dimension, connector.direction, min, max);
            openSafeHorizontalRoute(dimension, connector.direction, min, max);
            yield;
        }
    }
    openVerticalShaft(dimension, room, min, max);
    yield;
}

// 単体テスト・小規模な即時配置向け。通常の城生成では上のphased版を使う。
export function buildJapaneseRoom(dimension, room) {
    const job = buildJapaneseRoomPhased(dimension, room);
    while (!job.next().done) {
        // 意図的に同期完了させる。
    }
}

export function clearJapaneseRoom(dimension, room) {
    fill(dimension, cellWorldMin(room.cell), cellWorldMax(room.cell), BLOCK.air);
}

export function repairJapaneseRoomConnectors(dimension, room) {
    const min = cellWorldMin(room.cell);
    const max = cellWorldMax(room.cell);
    for (const connector of room.resolvedConnectors ?? []) {
        if (
            connector.direction === Direction.North
            || connector.direction === Direction.South
            || connector.direction === Direction.East
            || connector.direction === Direction.West
        ) {
            openHorizontalShoji(dimension, connector.direction, min, max);
            openSafeHorizontalRoute(dimension, connector.direction, min, max);
        }
    }
    openVerticalShaft(dimension, room, min, max);
}

export function* clearJapaneseRoomPhased(
    dimension,
    room,
    { layersPerStep = 2, shouldContinue = null } = {}
) {
    const min = cellWorldMin(room.cell);
    const max = cellWorldMax(room.cell);
    const layerCount = Math.max(1, Math.floor(layersPerStep));
    for (let top = max.y; top >= min.y; top -= layerCount) {
        if (shouldContinue && !shouldContinue()) return { completed: false };
        const bottom = Math.max(min.y, top - layerCount + 1);
        fill(
            dimension,
            { x: min.x, y: bottom, z: min.z },
            { x: max.x, y: top, z: max.z },
            BLOCK.air
        );
        yield;
    }
    return { completed: true };
}
