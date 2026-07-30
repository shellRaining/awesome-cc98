import type {
  InteractionTarget,
  MuseumSceneDefinition,
  Point,
  PortalDestination,
  Rect,
} from '../types'

export function distanceToRect(point: Point, rect: Rect): number {
  const nearestX = Math.max(rect.x, Math.min(point.x, rect.x + rect.width))
  const nearestY = Math.max(rect.y, Math.min(point.y, rect.y + rect.height))
  return Math.hypot(point.x - nearestX, point.y - nearestY)
}

export function findNearestInteraction(
  point: Point,
  scene: MuseumSceneDefinition,
  collected: ReadonlySet<string>,
  maxDistance: number,
): InteractionTarget | undefined {
  const targets: InteractionTarget[] = [
    ...scene.exhibits.map(
      (value): InteractionTarget => ({ type: 'exhibit', distance: distanceToRect(point, value), value }),
    ),
    ...scene.portals.map(
      (value): InteractionTarget => ({ type: 'portal', distance: distanceToRect(point, value), value }),
    ),
    ...scene.collectibles
      .filter((value) => !collected.has(value.id))
      .map(
        (value): InteractionTarget => ({
          type: 'collectible',
          distance: distanceToRect(point, value),
          value,
        }),
      ),
    ...scene.decorations
      .filter((value) => value.interactive || value.kind.toLowerCase() === 'terminal')
      .map(
        (value): InteractionTarget => ({
          type: 'decoration',
          distance: distanceToRect(point, value),
          value,
        }),
      ),
  ]
  return targets
    .filter((target) => target.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]
}

export function resolvePortalDestination(
  worldScenes: readonly MuseumSceneDefinition[],
  portal: MuseumSceneDefinition['portals'][number],
): PortalDestination | undefined {
  const targetScene = worldScenes.find((scene) => scene.id === portal.targetSceneId)
  if (!targetScene) return undefined
  if (portal.targetSpawn) return { sceneId: targetScene.id, spawn: { ...portal.targetSpawn } }
  const pairedPortal = portal.targetPortalId
    ? targetScene.portals.find((candidate) => candidate.id === portal.targetPortalId)
    : undefined
  if (pairedPortal) {
    const centerX = pairedPortal.x + pairedPortal.width / 2
    const centerY = pairedPortal.y + pairedPortal.height / 2
    const offset = targetScene.tileSize * 1.25
    const isSidePortal = pairedPortal.height > pairedPortal.width
    return {
      sceneId: targetScene.id,
      spawn: isSidePortal
        ? {
            x: centerX < targetScene.width / 2 ? centerX + offset : centerX - offset,
            y: centerY,
          }
        : {
            x: centerX,
            y: centerY < targetScene.height / 2 ? centerY + offset : centerY - offset,
          },
    }
  }
  return { sceneId: targetScene.id, spawn: { ...targetScene.spawn } }
}
