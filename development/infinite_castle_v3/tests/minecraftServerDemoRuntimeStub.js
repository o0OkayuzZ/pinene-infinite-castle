const dynamicProperties = new Map();
const dimensions = new Map();
const intervals = new Map();
const scheduled = [];
const scriptEventSubscribers = [];
let nextRunId = 1;

export const system = {
    afterEvents: {
        scriptEventReceive: {
            subscribe(callback) {
                scriptEventSubscribers.push(callback);
            },
        },
    },
    run(callback) {
        const id = nextRunId;
        nextRunId += 1;
        scheduled.push(callback);
        return id;
    },
    runInterval(callback) {
        const id = nextRunId;
        nextRunId += 1;
        intervals.set(id, callback);
        return id;
    },
    clearRun(id) {
        intervals.delete(id);
    },
};

export const world = {
    getDynamicProperty(key) {
        return dynamicProperties.get(key);
    },
    setDynamicProperty(key, value) {
        if (value === undefined) dynamicProperties.delete(key);
        else dynamicProperties.set(key, value);
    },
    getDimension(id) {
        if (!dimensions.has(id)) {
            const players = [];
            dimensions.set(id, {
                id,
                players,
                getPlayers() {
                    return this.players.slice();
                },
            });
        }
        return dimensions.get(id);
    },
};

export const __mock = {
    createPlayer(id, dimensionId, location) {
        const dimension = world.getDimension(dimensionId);
        return {
            id,
            name: id,
            typeId: "minecraft:player",
            dimension,
            location: { ...location },
            messages: [],
            sendMessage(message) {
                this.messages.push(String(message));
            },
        };
    },
    setPlayers(dimensionId, players) {
        const dimension = world.getDimension(dimensionId);
        dimension.players = players;
        for (const player of players) player.dimension = dimension;
    },
    fireScriptEvent(id, sourceEntity, message = "") {
        const event = { id, sourceEntity, message };
        for (const callback of scriptEventSubscribers) callback(event);
    },
    runIntervals() {
        for (const callback of [...intervals.values()]) callback();
    },
    runScheduled() {
        while (scheduled.length > 0) scheduled.shift()();
    },
    getDynamicProperty(key) {
        return dynamicProperties.get(key);
    },
    intervalCount() {
        return intervals.size;
    },
};
