import assert from "node:assert/strict";
import { parseSourcePartsRebuildOptions } from "../scripts/infinite_castle/sourcePartsRebuildOptions.js";

assert.deepEqual(parseSourcePartsRebuildOptions(""), {
    style: "castle",
    seed: undefined,
    stairSmoothingStyle: "oak_stairs",
});
assert.deepEqual(parseSourcePartsRebuildOptions("floating 4294967295 authored"), {
    style: "floating",
    seed: 4294967295,
    stairSmoothingStyle: "authored",
});
assert.deepEqual(parseSourcePartsRebuildOptions("style castle seed 42 stair smooth"), {
    style: "castle",
    seed: 42,
    stairSmoothingStyle: "oak_stairs",
});
assert.deepEqual(parseSourcePartsRebuildOptions("style=floating,seed=7,stairs=oak_stairs"), {
    style: "floating",
    seed: 7,
    stairSmoothingStyle: "oak_stairs",
});
assert.deepEqual(parseSourcePartsRebuildOptions({
    style: "floating", seed: "9", stairSmoothingStyle: "smooth",
}), {
    style: "floating",
    seed: 9,
    stairSmoothingStyle: "oak_stairs",
});
assert.throws(() => parseSourcePartsRebuildOptions("style dense"), /unsupported/);
assert.throws(() => parseSourcePartsRebuildOptions("seed -1"), /invalid/);
assert.throws(() => parseSourcePartsRebuildOptions("seed 4294967296"), /outside uint32/);
assert.throws(() => parseSourcePartsRebuildOptions("mystery"), /unknown/);

console.log("sourcePartsRebuildOptions: compact, labelled, key=value, and invalid inputs passed");
