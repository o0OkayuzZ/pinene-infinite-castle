// 部屋1つ分の「仮ブロック建築」を担当する。生成ロジック(dungeonGenerator等)には一切関与しない。
// 将来.mcstructureに差し替える際は、このファイルの実装だけを差し替えればよい設計にしている。
import { BlockVolume } from "@minecraft/server";
import { CELL_SIZE } from "./config.js";
import { cellWorldMin, cellWorldMax } from "./worldCoords.js";
import { Direction, applyOrientation } from "./connector.js";
import { RoomCategory } from "./roomRegistry.js";

// 和風/無限城風の最低限装飾。
const WALL_MATERIAL = "minecraft:deepslate_bricks";
const FLOOR_MATERIAL = "minecraft:dark_oak_planks";
const CEILING_MATERIAL = "minecraft:blue_glazed_terracotta"; // 瑠璃瓦風
const DOOR_FRAME_MATERIAL = "minecraft:stripped_dark_oak_wood"; // 障子の枠風
const DOOR_GLASS_MATERIAL = "minecraft:white_stained_glass_pane"; // 障子の紙風

const CATEGORY_ACCENT_BLOCK = Object.freeze({
    [RoomCategory.Entrance]: "minecraft:glowstone",
    [RoomCategory.Exit]: "minecraft:sea_lantern",
    [RoomCategory.Treasure]: "minecraft:gold_block",
    [RoomCategory.DeepEntrance]: "minecraft:crying_obsidian",
});

const DOOR_WIDTH = 3;
const DOOR_HEIGHT = 4;

function fillVolume(dimension, from, to, blockTypeId) {
    dimension.fillBlocks(new BlockVolume(from, to), blockTypeId);
}

function facePlane(direction, min, max) {
    switch (direction) {
        case Direction.North: return { from: { x: min.x, y: min.y, z: min.z }, to: { x: max.x, y: max.y, z: min.z } };
        case Direction.South: return { from: { x: min.x, y: min.y, z: max.z }, to: { x: max.x, y: max.y, z: max.z } };
        case Direction.East: return { from: { x: max.x, y: min.y, z: min.z }, to: { x: max.x, y: max.y, z: max.z } };
        case Direction.West: return { from: { x: min.x, y: min.y, z: min.z }, to: { x: min.x, y: max.y, z: max.z } };
        case Direction.Up: return { from: { x: min.x, y: max.y, z: min.z }, to: { x: max.x, y: max.y, z: max.z } };
        case Direction.Down: return { from: { x: min.x, y: min.y, z: min.z }, to: { x: max.x, y: min.y, z: max.z } };
        default: throw new Error(`unknown direction: ${direction}`);
    }
}

// connectorの開口部(実際に通れる穴)と、その周囲の額縁の座標範囲を返す。
// 姿勢(orientation)による向き変換は行わず、常にワールド方向で固定する
// (どの部屋の姿勢でも接続口の位置が確実に一致するようにするため)。
function doorGeometry(direction, min, max) {
    const centerX = min.x + Math.floor(CELL_SIZE.x / 2);
    const centerZ = min.z + Math.floor(CELL_SIZE.z / 2);
    const halfW = Math.floor(DOOR_WIDTH / 2);
    const frameHalfW = halfW + 1;
    const openBottomY = min.y + 1;
    const openTopY = min.y + DOOR_HEIGHT;
    const frameBottomY = openBottomY - 1;
    const frameTopY = openTopY + 1;

    switch (direction) {
        case Direction.North:
            return {
                frame: { from: { x: centerX - frameHalfW, y: frameBottomY, z: min.z }, to: { x: centerX + frameHalfW, y: frameTopY, z: min.z } },
                open: { from: { x: centerX - halfW, y: openBottomY, z: min.z }, to: { x: centerX + halfW, y: openTopY, z: min.z } },
            };
        case Direction.South:
            return {
                frame: { from: { x: centerX - frameHalfW, y: frameBottomY, z: max.z }, to: { x: centerX + frameHalfW, y: frameTopY, z: max.z } },
                open: { from: { x: centerX - halfW, y: openBottomY, z: max.z }, to: { x: centerX + halfW, y: openTopY, z: max.z } },
            };
        case Direction.East:
            return {
                frame: { from: { x: max.x, y: frameBottomY, z: centerZ - frameHalfW }, to: { x: max.x, y: frameTopY, z: centerZ + frameHalfW } },
                open: { from: { x: max.x, y: openBottomY, z: centerZ - halfW }, to: { x: max.x, y: openTopY, z: centerZ + halfW } },
            };
        case Direction.West:
            return {
                frame: { from: { x: min.x, y: frameBottomY, z: centerZ - frameHalfW }, to: { x: min.x, y: frameTopY, z: centerZ + frameHalfW } },
                open: { from: { x: min.x, y: openBottomY, z: centerZ - halfW }, to: { x: min.x, y: openTopY, z: centerZ + halfW } },
            };
        case Direction.Up:
            return {
                frame: { from: { x: centerX - frameHalfW, y: max.y, z: centerZ - frameHalfW }, to: { x: centerX + frameHalfW, y: max.y, z: centerZ + frameHalfW } },
                open: { from: { x: centerX - halfW, y: max.y, z: centerZ - halfW }, to: { x: centerX + halfW, y: max.y, z: centerZ + halfW } },
            };
        case Direction.Down:
            return {
                frame: { from: { x: centerX - frameHalfW, y: min.y, z: centerZ - frameHalfW }, to: { x: centerX + frameHalfW, y: min.y, z: centerZ + frameHalfW } },
                open: { from: { x: centerX - halfW, y: min.y, z: centerZ - halfW }, to: { x: centerX + halfW, y: min.y, z: centerZ + halfW } },
            };
        default:
            throw new Error(`unknown direction: ${direction}`);
    }
}

/**
 * 部屋1つ分のプレースホルダー建築を配置する。
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {object} room RoomInstance(cell, category, orientation, resolvedConnectorsを使用)
 */
export function buildRoomPlaceholder(dimension, room) {
    const min = cellWorldMin(room.cell);
    const max = cellWorldMax(room.cell);

    // 外殻(壁)を作ってから内部を空洞化する。
    fillVolume(dimension, min, max, WALL_MATERIAL);
    fillVolume(
        dimension,
        { x: min.x + 1, y: min.y + 1, z: min.z + 1 },
        { x: max.x - 1, y: max.y - 1, z: max.z - 1 },
        "minecraft:air"
    );

    // 姿勢に応じて「床」「天井」に相当する面を塗り分ける(Down/Upの向き先を流用)。
    const floorDirection = applyOrientation(Direction.Down, room.orientation);
    const ceilingDirection = applyOrientation(Direction.Up, room.orientation);
    const floorFace = facePlane(floorDirection, min, max);
    const ceilingFace = facePlane(ceilingDirection, min, max);
    fillVolume(dimension, floorFace.from, floorFace.to, FLOOR_MATERIAL);
    fillVolume(dimension, ceilingFace.from, ceilingFace.to, CEILING_MATERIAL);

    // connectorごとに接続口(障子風の額縁+開口部)を作る。位置はワールド方向固定。
    for (const connector of room.resolvedConnectors) {
        const geometry = doorGeometry(connector.direction, min, max);
        fillVolume(dimension, geometry.frame.from, geometry.frame.to, DOOR_FRAME_MATERIAL);
        fillVolume(dimension, geometry.open.from, geometry.open.to, DOOR_GLASS_MATERIAL);
        fillVolume(dimension, geometry.open.from, geometry.open.to, "minecraft:air");
    }

    // カテゴリー別のアクセントブロック(部屋中央の床上)。
    const accentBlock = CATEGORY_ACCENT_BLOCK[room.category];
    if (accentBlock) {
        const centerX = min.x + Math.floor(CELL_SIZE.x / 2);
        const centerZ = min.z + Math.floor(CELL_SIZE.z / 2);
        try {
            dimension.setBlockType({ x: centerX, y: min.y + 1, z: centerZ }, accentBlock);
        } catch {
            /* noop */
        }
    }
}

/** 部屋1つ分を完全に空気へ戻す(再構築で撤去する部屋に使う)。 */
export function clearRoomPlaceholder(dimension, room) {
    const min = cellWorldMin(room.cell);
    const max = cellWorldMax(room.cell);
    fillVolume(dimension, min, max, "minecraft:air");
}
