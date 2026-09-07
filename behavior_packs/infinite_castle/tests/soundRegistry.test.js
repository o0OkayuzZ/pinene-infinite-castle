import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
    CASTLE_KOTO_SOUND_ID,
    RECONSTRUCTION_SOUND_ID,
    TRANSFER_CONFIG,
} from "../scripts/infinite_castle/config.js";

const resourcePackUrl = new URL("../../../development_resource_packs/無限城/", import.meta.url);
const definitions = JSON.parse(readFileSync(new URL("sounds/sound_definitions.json", resourcePackUrl), "utf8"));
const event = definitions.sound_definitions[CASTLE_KOTO_SOUND_ID];

assert.equal(CASTLE_KOTO_SOUND_ID, "infinite_castle.koto");
assert.equal(TRANSFER_CONFIG.entranceSoundId, CASTLE_KOTO_SOUND_ID);
assert.equal(TRANSFER_CONFIG.exitSoundId, CASTLE_KOTO_SOUND_ID);
assert.equal(RECONSTRUCTION_SOUND_ID, CASTLE_KOTO_SOUND_ID);
assert.equal(event.sounds.length, 2);
assert.deepEqual(event.sounds.map((sound) => sound.name), [
    "sounds/infinite_castle/koto_a",
    "sounds/infinite_castle/koto_b",
]);

for (const filename of ["koto_a.ogg", "koto_b.ogg"]) {
    const url = new URL(`sounds/infinite_castle/${filename}`, resourcePackUrl);
    assert.equal(existsSync(url), true, `${filename} is missing`);
    assert.ok(statSync(url).size > 1000, `${filename} is unexpectedly empty`);
}

console.log(JSON.stringify({ event: CASTLE_KOTO_SOUND_ID, variants: 2, defaultEqualRandom: true, allCastleSoundsUnified: true }));
