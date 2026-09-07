import assert from "node:assert/strict";
import {
    buildJapaneseRoom,
    clearJapaneseRoom,
    clearJapaneseRoomPhased,
    createRoomVisualPlan,
} from "../scripts/infinite_castle/japaneseRoomBuilder.js";
import { getAllTemplates } from "../scripts/infinite_castle/roomRegistry.js";
import { getTemplateArchitectureIds } from "../scripts/infinite_castle/roomTemplateArchitecture.js";

let fillCalls = 0;
let setCalls = 0;
const dimension = {
    fillBlocks(volume, blockTypeId) {
        assert.ok(volume?.from && volume?.to);
        assert.match(blockTypeId, /^minecraft:/);
        fillCalls += 1;
    },
    setBlockType(location, blockTypeId) {
        assert.ok(Number.isFinite(location.x) && Number.isFinite(location.y) && Number.isFinite(location.z));
        assert.match(blockTypeId, /^minecraft:/);
        setCalls += 1;
    },
};

for (const [index, template] of getAllTemplates().entries()) {
    const room = {
        cell: { x: index % 5, y: index % 4, z: Math.floor(index / 5) },
        templateId: template.id,
        category: template.category,
        orientation: template.allowedOrientations.includes("sideways") ? "sideways" : "normal",
        rotation: (index % 4) * 90,
        resolvedConnectors: template.sockets,
        roomSeed: (0x12345678 + index * 7919) >>> 0,
        revision: 1,
    };
    assert.deepEqual(createRoomVisualPlan(room), createRoomVisualPlan({ ...room }));
    buildJapaneseRoom(dimension, room);
    clearJapaneseRoom(dimension, room);
}

assert.ok(fillCalls > 500);
assert.ok(setCalls > 0);
assert.deepEqual(
    new Set(getTemplateArchitectureIds()),
    new Set(getAllTemplates().map((template) => template.id)),
    "all 21 registered templates must have a dedicated architecture builder"
);

function captureBuild(room) {
    const calls = [];
    const captureDimension = {
        fillBlocks(volume, blockTypeId) {
            calls.push(["fill", volume.from, volume.to, blockTypeId]);
        },
        setBlockType(location, blockTypeId) {
            calls.push(["set", location, blockTypeId]);
        },
    };
    buildJapaneseRoom(captureDimension, room);
    return calls;
}

const templateSignatures = getAllTemplates().map((template, index) => JSON.stringify(captureBuild({
    cell: { x: 0, y: 0, z: 0 },
    templateId: template.id,
    category: template.category,
    orientation: "normal",
    rotation: 0,
    resolvedConnectors: template.connectors,
    roomSeed: 0x2468ace0,
    revision: index + 1,
})));
assert.equal(
    new Set(templateSignatures).size,
    21,
    "all 21 templates must produce genuinely distinct block-operation plans"
);

const corridorTemplate = getAllTemplates().find((template) => template.id === "corridor_straight_ns");
const seededRoom = {
    cell: { x: 1, y: 0, z: 1 },
    templateId: corridorTemplate.id,
    category: corridorTemplate.category,
    orientation: "normal",
    rotation: 0,
    resolvedConnectors: corridorTemplate.sockets,
    roomSeed: 1,
    revision: 1,
};
const firstBuild = captureBuild(seededRoom);
assert.deepEqual(captureBuild({ ...seededRoom }), firstBuild, "same roomSeed must reproduce identical blocks");
let differentSeed = 2;
while (
    differentSeed < 1000
    && JSON.stringify(createRoomVisualPlan({ ...seededRoom, roomSeed: differentSeed }))
        === JSON.stringify(createRoomVisualPlan(seededRoom))
) {
    differentSeed += 1;
}
assert.ok(differentSeed < 1000, "could not find a different visual plan");
assert.notDeepEqual(
    captureBuild({ ...seededRoom, roomSeed: differentSeed }),
    firstBuild,
    "a different visual plan must affect rendered blocks"
);

function captureVoxelBuild(room) {
    const blocks = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    const voxelDimension = {
        fillBlocks(volume, blockTypeId) {
            for (let x = volume.from.x; x <= volume.to.x; x += 1) {
                for (let y = volume.from.y; y <= volume.to.y; y += 1) {
                    for (let z = volume.from.z; z <= volume.to.z; z += 1) {
                        blocks.set(key(x, y, z), blockTypeId);
                    }
                }
            }
        },
        setBlockType(location, blockTypeId) {
            blocks.set(key(location.x, location.y, location.z), blockTypeId);
        },
    };
    buildJapaneseRoom(voxelDimension, room);
    return {
        get(x, y, z) {
            return blocks.get(key(x, y, z)) ?? "minecraft:air";
        },
    };
}

const gallery = captureVoxelBuild({ ...seededRoom, cell: { x: 0, y: 0, z: 0 } });
assert.notEqual(gallery.get(12, 0, 0), "minecraft:air", "north connector needs continuous gallery flooring");
assert.notEqual(gallery.get(12, 0, 6), "minecraft:air", "three-wide gallery must reach the center");
assert.equal(gallery.get(9, 0, 6), "minecraft:air", "gallery walking floor must stay narrow");
assert.equal(gallery.get(10, 1, 6), "minecraft:dark_oak_fence", "open edge needs a fall-prevention rail");
assert.equal(gallery.get(0, 5, 12), "minecraft:air", "corridor must not retain the old full-height outer wall");
assert.equal(gallery.get(0, 15, 0), "minecraft:air", "corridor must not retain the old full-cell ceiling");
assert.equal(gallery.get(3, 1, 3), "minecraft:air", "outer cell space must remain open for reconstruction views");

const clearedLayers = [];
const clearDimension = {
    fillBlocks(volume, blockTypeId) {
        clearedLayers.push({ from: volume.from, to: volume.to, blockTypeId });
    },
};
const phasedClear = clearJapaneseRoomPhased(clearDimension, seededRoom, { layersPerStep: 2 });
let clearYields = 0;
let clearStep = phasedClear.next();
while (!clearStep.done) {
    clearYields += 1;
    clearStep = phasedClear.next();
}
assert.equal(clearStep.value.completed, true);
assert.equal(clearYields, 8, "a 16-block room must dismantle in eight 2-layer animation steps");
assert.deepEqual([clearedLayers[0].from.y, clearedLayers[0].to.y], [14, 15]);
assert.deepEqual([clearedLayers.at(-1).from.y, clearedLayers.at(-1).to.y], [0, 1]);
assert.ok(clearedLayers.every((layer) => layer.blockTypeId === "minecraft:air"));
console.log(JSON.stringify({ templates: 21, distinctArchitectures: 21, fillCalls, setCalls }));
