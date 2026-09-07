// 無限城への入場演出だけを担当する。
// ダンジョン生成や帰還地点保存から分離し、演出APIが失敗しても転送自体は継続する。
import { system } from "@minecraft/server";
import { ENTRANCE_TRANSITION } from "./config.js";

function safeCall(operation) {
    try {
        operation();
        return true;
    } catch {
        return false;
    }
}

export function getEntranceTransitionTimeline(settings = ENTRANCE_TRANSITION) {
    if (!settings.enabled) {
        return Object.freeze({ fadeTick: 0, cameraClearTick: 0, teleportTick: 0, finishTick: 1 });
    }
    const fadeTick = Math.max(0, Math.floor(settings.fadeDelayTicks));
    const cameraClearTick = Math.max(fadeTick, Math.floor(settings.cameraClearDelayTicks));
    const teleportTick = Math.max(cameraClearTick, Math.floor(settings.teleportDelayTicks));
    const finishTick = Math.max(teleportTick + 1, Math.floor(settings.finishDelayTicks));
    return Object.freeze({ fadeTick, cameraClearTick, teleportTick, finishTick });
}

function playPluck(player, soundId, volume, pitch) {
    if (!soundId) return;
    safeCall(() => player.playSound(soundId, { volume, pitch }));
}

function beginBlackFade(player, settings) {
    safeCall(() => player.camera.fade({
        fadeColor: settings.fadeColor,
        fadeTime: settings.fadeTime,
    }));
}

function sourceEffectCenter(player) {
    return {
        x: Math.floor(player.location.x) + 0.5,
        y: player.location.y + 0.035,
        z: Math.floor(player.location.z) + 0.5,
    };
}

function spawnShojiFloor(player, center, settings) {
    if (!settings.groundParticleId) return;
    safeCall(() => player.dimension.spawnParticle(settings.groundParticleId, center));
}

function setSourceCamera(player, center, settings) {
    const cameraLocation = {
        x: center.x + settings.cameraOffset.x,
        y: center.y + settings.cameraOffset.y,
        z: center.z + settings.cameraOffset.z,
    };
    return safeCall(() => player.camera.setCamera("minecraft:free", {
        location: cameraLocation,
        facingLocation: {
            x: center.x,
            y: center.y,
            z: center.z,
        },
    }));
}

/**
 * 琵琶を弾いた瞬間に足元の障子を開き、斜め上から見せてから短い暗転中に転送する。
 * onFinished は成功・失敗を問わず一度だけ呼ばれる。
 */
export function startEntranceTransition({
    player,
    dungeonDimension,
    landingLocation,
    soundId,
    onFinished,
    settings = ENTRANCE_TRANSITION,
    schedule = (callback, delayTicks) => system.runTimeout(callback, delayTicks),
}) {
    const timeline = getEntranceTransitionTimeline(settings);
    let finished = false;
    let cameraWasSet = false;
    const effectCenter = sourceEffectCenter(player);

    const clearArrivalCamera = () => {
        if (!cameraWasSet) return;
        safeCall(() => player.camera.clear());
        cameraWasSet = false;
    };

    const finish = (teleported, error = null) => {
        if (finished) return;
        finished = true;
        clearArrivalCamera();
        try {
            onFinished?.({ teleported, error });
        } catch {
            // 呼出元の後処理失敗で演出タイマーを止めない。
        }
    };

    if (!settings.enabled) {
        try {
            player.teleport(landingLocation, { dimension: dungeonDimension });
            finish(true);
        } catch (error) {
            finish(false, error);
        }
        return timeline;
    }

    spawnShojiFloor(player, effectCenter, settings);
    cameraWasSet = setSourceCamera(player, effectCenter, settings);
    playPluck(player, soundId, settings.primarySound.volume, settings.primarySound.pitch);

    // 暗転は主役ではなく、ディメンション切替の瞬間だけを隠す短いブリッジ。
    schedule(() => {
        if (finished) return;
        beginBlackFade(player, settings);
    }, timeline.fadeTick);

    schedule(clearArrivalCamera, timeline.cameraClearTick);

    schedule(() => {
        if (finished) return;
        try {
            player.teleport(landingLocation, { dimension: dungeonDimension });
        } catch (error) {
            finish(false, error);
        }
    }, timeline.teleportTick);

    schedule(() => finish(true), timeline.finishTick);
    return timeline;
}
