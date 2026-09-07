import { createSourcePartsPlan } from "../scripts/infinite_castle/sourcePartsPlanner.js";
import { createSourcePartsDemoProgression } from "../scripts/infinite_castle/sourcePartsDemoProgression.js";
import { createSourcePartsDemoProgressionState } from "../scripts/infinite_castle/sourcePartsDemoProgressionState.js";
import {
    createSourcePartsDemoRuntimeRecord,
    parseSourcePartsDemoRuntimeRecord,
    serializeSourcePartsDemoRuntimeRecord,
} from "../scripts/infinite_castle/sourcePartsDemoRuntimePure.js";

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

export function runSourcePartsDemoRuntimePlannerTests() {
    let maxSerializedLength = 0;
    let minReversals = Number.POSITIVE_INFINITY;
    const routePatterns = new Set();
    const styles = ["castle", "floating"];

    for (const style of styles) {
        for (let seed = 0; seed < 256; seed += 1) {
            const plan = createSourcePartsPlan(seed, { x: 2048, y: 80, z: 2048 }, { style });
            plan.dimensionId = "infinite_castle:dungeon";
            const progression = createSourcePartsDemoProgression(seed, plan);
            const state = createSourcePartsDemoProgressionState(progression);
            const record = createSourcePartsDemoRuntimeRecord(plan, progression, state);
            const serialized = serializeSourcePartsDemoRuntimeRecord(record);
            const restored = parseSourcePartsDemoRuntimeRecord(serialized);
            assert(restored, `${style} seed=${seed}: restore failed`);
            assert(
                JSON.stringify(restored.progression) === JSON.stringify(progression),
                `${style} seed=${seed}: full progression changed after restore`
            );
            assert(restored.rooms.length === 15, `${style} seed=${seed}: room count`);
            assert(
                restored.progression.requiredRoute.verticalDirectionChanges >= 2,
                `${style} seed=${seed}: non-monotonic route`
            );
            maxSerializedLength = Math.max(maxSerializedLength, serialized.length);
            minReversals = Math.min(
                minReversals,
                restored.progression.requiredRoute.verticalDirectionChanges
            );
            routePatterns.add(restored.progression.requiredRoute.objectiveRoomIds.join(","));
        }
    }
    // Both visual styles intentionally keep the same placement ids/topology, so the same
    // progression seed must produce the same objective order across those presentations.
    assert(routePatterns.size >= 250, `insufficient route variation: ${routePatterns.size}`);
    return {
        ok: true,
        styles,
        seedsPerStyle: 256,
        plans: styles.length * 256,
        maxSerializedLength,
        minReversals,
        routePatterns: routePatterns.size,
    };
}
