// 配置済み部屋1件分のデータ構造。役割はデータ保持のみ(建築・生成ロジックは持たない)。
export function createRoomInstance({
    cell,
    templateId,
    category,
    orientation,
    rotation,
    resolvedConnectors,
    roomSeed = null,
    revision = 1,
}) {
    return {
        cell,
        templateId,
        category,
        orientation,
        rotation,
        resolvedConnectors,
        roomSeed,
        revision,
        isProtected: false,
        isDeepEntrance: false,
    };
}
