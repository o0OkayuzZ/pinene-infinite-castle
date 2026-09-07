import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startEntranceTransition, getEntranceTransitionTimeline } from "../scripts/infinite_castle/entranceTransition.js";

const SETTINGS = Object.freeze({
    enabled: true,
    groundParticleId: "infinite_castle:shoji_floor_open",
    fadeColor: Object.freeze({ red: 0, green: 0, blue: 0 }),
    fadeTime: Object.freeze({ fadeInTime: 0.08, holdTime: 0.06, fadeOutTime: 0.18 }),
    primarySound: Object.freeze({ volume: 1, pitch: 1 }),
    fadeDelayTicks: 9,
    cameraClearDelayTicks: 11,
    teleportDelayTicks: 12,
    finishDelayTicks: 16,
    cameraOffset: Object.freeze({ x: 4.2, y: 8.5, z: 4.2 }),
});

function createHarness({ failTeleport = false } = {}) {
    const events = [];
    const queue = [];
    const completions = [];
    const player = {
        location: { x: 10.1, y: 64, z: 20.9 },
        dimension: {
            spawnParticle(particleId, location) {
                events.push(["particle", particleId, location]);
            },
        },
        playSound(soundId, options) {
            events.push(["sound", soundId, options]);
        },
        teleport(location, options) {
            events.push(["teleport", location, options]);
            if (failTeleport) throw new Error("teleport failed");
        },
        camera: {
            fade(options) {
                events.push(["fade", options]);
            },
            setCamera(preset, options) {
                events.push(["camera", preset, options]);
            },
            clear() {
                events.push(["clear"]);
            },
        },
    };
    const schedule = (callback, tick) => queue.push({ callback, tick });
    const run = () => {
        queue.sort((a, b) => a.tick - b.tick);
        for (const entry of queue) entry.callback();
    };
    return { player, events, completions, schedule, run };
}

const timeline = getEntranceTransitionTimeline(SETTINGS);
assert.deepEqual(timeline, {
    fadeTick: 9,
    cameraClearTick: 11,
    teleportTick: 12,
    finishTick: 16,
});

const success = createHarness();
startEntranceTransition({
    player: success.player,
    dungeonDimension: { id: "infinite_castle:dungeon" },
    landingLocation: { x: 60, y: 1, z: 12 },
    soundId: "infinite_castle.koto",
    settings: SETTINGS,
    schedule: success.schedule,
    onFinished: (result) => success.completions.push(result),
});
success.run();
assert.deepEqual(success.events.map(([kind]) => kind), ["particle", "camera", "sound", "fade", "clear", "teleport"]);
assert.equal(success.events.filter(([kind]) => kind === "sound").length, 1, "one transition must play one random event only");
assert.equal(success.completions.length, 1);
assert.equal(success.completions[0].teleported, true);
assert.deepEqual(success.events[0][2], { x: 10.5, y: 64.035, z: 20.5 });
assert.deepEqual(success.events[1][2].location, { x: 14.7, y: 72.535, z: 24.7 });
assert.deepEqual(success.events[1][2].facingLocation, { x: 10.5, y: 64.035, z: 20.5 });

const failure = createHarness({ failTeleport: true });
startEntranceTransition({
    player: failure.player,
    dungeonDimension: { id: "infinite_castle:dungeon" },
    landingLocation: { x: 60, y: 1, z: 12 },
    soundId: "infinite_castle.koto",
    settings: SETTINGS,
    schedule: failure.schedule,
    onFinished: (result) => failure.completions.push(result),
});
failure.run();
assert.equal(failure.completions.length, 1, "failure callback must run exactly once");
assert.equal(failure.completions[0].teleported, false);
assert.equal(failure.events.filter(([kind]) => kind === "camera").length, 1);
assert.equal(failure.events.filter(([kind]) => kind === "clear").length, 1, "source camera must always be restored");

const particleJson = JSON.parse(readFileSync(new URL(
    "../../../development_resource_packs/無限城/particles/shoji_floor_open.particle.json",
    import.meta.url
), "utf8"));
assert.equal(particleJson.particle_effect.description.identifier, "infinite_castle:shoji_floor_open");
assert.equal(
    particleJson.particle_effect.components["minecraft:particle_appearance_billboard"].facing_camera_mode,
    "emitter_transform_xz"
);
assert.equal(
    particleJson.particle_effect.components["minecraft:particle_appearance_billboard"].uv.flipbook.max_frame,
    9
);
assert.equal(
    particleJson.particle_effect.components["minecraft:particle_appearance_billboard"].uv.flipbook.frames_per_second,
    18
);

console.log(JSON.stringify({ timeline, groundShojiFrames: 9, shojiFps: 18, successFallbackSafe: true, failureCameraRestored: true }));
