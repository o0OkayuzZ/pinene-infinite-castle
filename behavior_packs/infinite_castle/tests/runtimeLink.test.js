import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRANSFER_CONFIG } from "../scripts/infinite_castle/config.js";

await import("../scripts/main.js");

assert.ok(Number.isInteger(TRANSFER_CONFIG.exitTeleportDelayTicks));
assert.ok(TRANSFER_CONFIG.exitTeleportDelayTicks >= 0);
const managerSource = readFileSync(new URL(
    "../scripts/infinite_castle/infiniteCastleManager.js",
    import.meta.url
), "utf8");
assert.match(managerSource, /TRANSFER_CONFIG\.exitTeleportDelayTicks/);
assert.doesNotMatch(managerSource, /ARRIVAL_TELEPORT_DELAY_TICKS/);

console.log("RUNTIME_MODULE_LINK_OK");
