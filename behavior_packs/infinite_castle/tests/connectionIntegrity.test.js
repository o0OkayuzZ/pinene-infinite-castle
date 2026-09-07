import assert from "node:assert/strict";
import { buildJapaneseRoom, repairJapaneseRoomConnectors } from "../scripts/infinite_castle/japaneseRoomBuilder.js";
import { inspectRoomConnectors } from "../scripts/infinite_castle/connectionIntegrity.js";
import { Direction, localFaceCenter } from "../scripts/infinite_castle/connector.js";

function key(location) {
    return `${location.x},${location.y},${location.z}`;
}

const blocks = new Map();
const dimension = {
    fillBlocks(volume, blockTypeId) {
        for (let x = volume.from.x; x <= volume.to.x; x += 1) {
            for (let y = volume.from.y; y <= volume.to.y; y += 1) {
                for (let z = volume.from.z; z <= volume.to.z; z += 1) {
                    blocks.set(key({ x, y, z }), blockTypeId);
                }
            }
        }
    },
    setBlockType(location, blockTypeId) {
        blocks.set(key(location), blockTypeId);
    },
    getBlock(location) {
        return { typeId: blocks.get(key(location)) ?? "minecraft:air" };
    },
};

const directions = [Direction.North, Direction.East, Direction.Up, Direction.Down];
const room = {
    cell: { x: 0, y: 0, z: 0 },
    templateId: "corridor_t_junction",
    category: "corridor",
    orientation: "normal",
    rotation: 0,
    roomSeed: 12345,
    revision: 1,
    resolvedConnectors: directions.map((direction) => ({
        direction,
        localPosition: localFaceCenter(direction),
    })),
};

buildJapaneseRoom(dimension, room);
assert.deepEqual(inspectRoomConnectors(dimension, room), [], "freshly built connectors must be passable");

dimension.setBlockType({ x: 12, y: 2, z: 0 }, "minecraft:polished_deepslate");
assert.ok(inspectRoomConnectors(dimension, room).some((issue) => issue.direction === Direction.North));
repairJapaneseRoomConnectors(dimension, room);
assert.deepEqual(inspectRoomConnectors(dimension, room), [], "horizontal blockage must be repaired");

dimension.setBlockType({ x: 12, y: 15, z: 12 }, "minecraft:polished_deepslate");
assert.ok(inspectRoomConnectors(dimension, room).some((issue) => issue.direction === Direction.Up));
repairJapaneseRoomConnectors(dimension, room);
assert.deepEqual(inspectRoomConnectors(dimension, room), [], "vertical scaffold must be repaired");

console.log(JSON.stringify({ horizontalDetected: true, verticalDetected: true, repaired: true }));
