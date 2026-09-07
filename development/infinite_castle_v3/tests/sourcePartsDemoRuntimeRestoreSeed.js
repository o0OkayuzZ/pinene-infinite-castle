import { world } from "@minecraft/server";
import { createSourcePartsDemoProgression } from "../scripts/infinite_castle/sourcePartsDemoProgression.js";
import { createSourcePartsDemoProgressionState } from "../scripts/infinite_castle/sourcePartsDemoProgressionState.js";
import {
    createSourcePartsDemoRuntimeRecord,
    serializeSourcePartsDemoRuntimeRecord,
} from "../scripts/infinite_castle/sourcePartsDemoRuntimePure.js";
import { createRuntimePlan } from "./sourcePartsDemoRuntime.test.js";

export const restoreTestPlan = createRuntimePlan(0x55667788);
export const restoreTestProgression = createSourcePartsDemoProgression(
    restoreTestPlan.seed,
    restoreTestPlan
);
const state = createSourcePartsDemoProgressionState(restoreTestProgression);
const record = createSourcePartsDemoRuntimeRecord(restoreTestPlan, restoreTestProgression, state);
world.setDynamicProperty(
    "infinite_castle:source_parts_demo_v1",
    serializeSourcePartsDemoRuntimeRecord(record)
);
