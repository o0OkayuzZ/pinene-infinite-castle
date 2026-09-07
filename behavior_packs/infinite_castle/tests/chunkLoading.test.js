import assert from "node:assert/strict";
import {
    acquireLoadedRoomChunks,
    releaseRoomTickingArea,
    roomChunkProbeLocations,
} from "../scripts/infinite_castle/chunkLoading.js";

const room = { cell: { x: 2, y: 0, z: 0 } };
assert.equal(roomChunkProbeLocations(room).length, 4, "a 24x24 room must probe all four touched chunks");

const managerCalls = [];
let activeArea = null;
const dimension = {
    getBlock() {
        return { typeId: "minecraft:air" };
    },
};
const tickingAreaManager = {
    hasTickingArea(identifier) {
        return activeArea === identifier;
    },
    hasCapacity(options) {
        managerCalls.push(["capacity", options]);
        return true;
    },
    createTickingArea(identifier, options) {
        managerCalls.push(["create", identifier, options]);
        activeArea = identifier;
        return Promise.resolve();
    },
    removeTickingArea(identifier) {
        managerCalls.push(["remove", identifier]);
        activeArea = null;
    },
};

const loadResult = await acquireLoadedRoomChunks(dimension, room, "ic_test", tickingAreaManager);
assert.equal(loadResult.ok, true);
const createCall = managerCalls.find(([operation]) => operation === "create");
assert.equal(createCall[1], "ic_test");
assert.equal(createCall[2].dimension, dimension);
assert.deepEqual(createCall[2].from, { x: 48, y: 0, z: 0 });
assert.deepEqual(createCall[2].to, { x: 71, y: 15, z: 23 });

releaseRoomTickingArea("ic_test", tickingAreaManager);
assert.deepEqual(managerCalls.at(-1), ["remove", "ic_test"]);

console.log(JSON.stringify({ probes: 4, awaitedPromise: true, scriptTickingArea: true }));
