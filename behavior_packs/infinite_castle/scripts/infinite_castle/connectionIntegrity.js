// DungeonGraph上のconnectorが、実ブロック上でも通行可能かを検査する。
import { CELL_SIZE } from "./config.js";
import { Direction } from "./connector.js";
import { cellWorldMin, cellWorldMax } from "./worldCoords.js";

const PASSABLE_BLOCKS = new Set([
    "minecraft:air",
    "minecraft:cave_air",
    "minecraft:void_air",
    "minecraft:scaffolding",
]);
const UNSUPPORTED_FLOOR_BLOCKS = new Set([
    "minecraft:air",
    "minecraft:cave_air",
    "minecraft:void_air",
    "minecraft:water",
    "minecraft:flowing_water",
    "minecraft:lava",
    "minecraft:flowing_lava",
]);

function horizontalRouteColumns(direction, min, max) {
    const centerX = min.x + Math.floor(CELL_SIZE.x / 2);
    const centerZ = min.z + Math.floor(CELL_SIZE.z / 2);
    const columns = [];
    if (direction === Direction.North || direction === Direction.South) {
        const start = direction === Direction.North ? min.z : centerZ;
        const end = direction === Direction.North ? centerZ : max.z;
        for (let z = start; z <= end; z += 1) {
            for (let x = centerX - 1; x <= centerX + 1; x += 1) columns.push({ x, z });
        }
    } else {
        const start = direction === Direction.West ? min.x : centerX;
        const end = direction === Direction.West ? centerX : max.x;
        for (let x = start; x <= end; x += 1) {
            for (let z = centerZ - 1; z <= centerZ + 1; z += 1) columns.push({ x, z });
        }
    }
    return columns;
}

function inspectHorizontalConnector(dimension, direction, min, max) {
    let blocked = 0;
    let unsupported = 0;
    for (const column of horizontalRouteColumns(direction, min, max)) {
        try {
            const floor = dimension.getBlock({ x: column.x, y: min.y, z: column.z });
            if (!floor || UNSUPPORTED_FLOOR_BLOCKS.has(floor.typeId)) {
                unsupported += 1;
            }
            for (let y = min.y + 1; y <= min.y + 4; y += 1) {
                const block = dimension.getBlock({ x: column.x, y, z: column.z });
                if (!block || !PASSABLE_BLOCKS.has(block.typeId)) blocked += 1;
            }
        } catch {
            blocked += 1;
        }
    }
    return { blocked, unsupported };
}

function inspectVerticalConnector(dimension, direction, min, max) {
    const centerX = min.x + Math.floor(CELL_SIZE.x / 2);
    const centerZ = min.z + Math.floor(CELL_SIZE.z / 2);
    const boundaryY = direction === Direction.Up ? max.y : min.y;
    let scaffoldMissing = false;
    try {
        scaffoldMissing = dimension.getBlock({ x: centerX, y: boundaryY, z: centerZ })?.typeId
            !== "minecraft:scaffolding";
    } catch {
        scaffoldMissing = true;
    }
    return { blocked: scaffoldMissing ? 1 : 0, scaffoldMissing };
}

export function inspectRoomConnectors(dimension, room) {
    const min = cellWorldMin(room.cell);
    const max = cellWorldMax(room.cell);
    const issues = [];
    for (const connector of room.resolvedConnectors ?? []) {
        const direction = connector.direction;
        if (direction === Direction.Up || direction === Direction.Down) {
            const result = inspectVerticalConnector(dimension, direction, min, max);
            if (result.blocked > 0 || result.scaffoldMissing) {
                issues.push({ direction, kind: "vertical", ...result });
            }
        } else {
            const result = inspectHorizontalConnector(dimension, direction, min, max);
            if (result.blocked > 0 || result.unsupported > 0) {
                issues.push({ direction, kind: "horizontal", ...result });
            }
        }
    }
    return issues;
}
