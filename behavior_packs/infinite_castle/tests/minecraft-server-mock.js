export class BlockVolume {
    constructor(from, to) {
        this.from = from;
        this.to = to;
    }
}

const inertSignal = Object.freeze({
    subscribe() {
        return undefined;
    },
});

export const system = Object.freeze({
    currentTick: 0,
    beforeEvents: Object.freeze({ startup: inertSignal }),
    afterEvents: Object.freeze({ scriptEventReceive: inertSignal }),
    run() {
        return 0;
    },
    runInterval() {
        return 0;
    },
    runTimeout() {
        return 0;
    },
    runJob() {
        return 0;
    },
});

const dynamicProperties = new Map();
const emptyDimension = Object.freeze({
    id: "infinite_castle:dungeon",
    getPlayers() {
        return [];
    },
    runCommand() {
        return { successCount: 1 };
    },
    fillBlocks() {
        return undefined;
    },
    setBlockType() {
        return undefined;
    },
    getBlock() {
        return undefined;
    },
});

export const world = Object.freeze({
    getDynamicProperty(key) {
        return dynamicProperties.get(key);
    },
    setDynamicProperty(key, value) {
        if (value === undefined) dynamicProperties.delete(key);
        else dynamicProperties.set(key, value);
    },
    getAbsoluteTime() {
        return 0;
    },
    getDimension() {
        return emptyDimension;
    },
    getDefaultSpawnLocation() {
        return { x: 0, y: 64, z: 0 };
    },
});
