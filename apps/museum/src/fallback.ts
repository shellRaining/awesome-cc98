import type { Catalog, MuseumSceneDefinition, MuseumWorld, Rect } from './types'

const TILE_SIZE = 32
const ROOM_WIDTH_TILES = 26
const ROOM_HEIGHT_TILES = 19
const PER_ROOM = 12

function wallBoundaries(width: number, height: number): Rect[] {
  return [
    { x: 0, y: 0, width, height: TILE_SIZE },
    { x: 0, y: height - TILE_SIZE, width, height: TILE_SIZE },
    { x: 0, y: 0, width: TILE_SIZE, height },
    { x: width - TILE_SIZE, y: 0, width: TILE_SIZE, height },
  ]
}

function createRoom(
  index: number,
  exhibitIds: string[],
  roomCount: number,
): MuseumSceneDefinition {
  const width = ROOM_WIDTH_TILES * TILE_SIZE
  const height = ROOM_HEIGHT_TILES * TILE_SIZE
  const id = `demo-${String.fromCharCode(97 + index)}`
  const nextIndex = (index + 1) % roomCount
  const previousIndex = (index - 1 + roomCount) % roomCount
  const exhibits = exhibitIds.map((exhibitId, placementIndex) => {
    const column = placementIndex % 4
    const row = Math.floor(placementIndex / 4)
    return {
      id: `${id}:exhibit:${placementIndex}`,
      exhibitId,
      x: (4 + column * 5.5) * TILE_SIZE,
      y: (4 + row * 4.5) * TILE_SIZE,
      width: 2 * TILE_SIZE,
      height: 1.5 * TILE_SIZE,
      display: 'pedestal' as const,
      facing: row === 0 ? ('down' as const) : ('up' as const),
    }
  })

  return {
    id,
    title: `演示馆 ${index + 1}`,
    theme: index % 2 === 0 ? 'A' : 'C',
    width,
    height,
    tileSize: TILE_SIZE,
    spawn: { x: 3 * TILE_SIZE, y: 9 * TILE_SIZE },
    boundaries: wallBoundaries(width, height),
    portals:
      roomCount > 1
        ? [
            {
              id: `${id}:portal:previous`,
              label: '上一展厅',
              x: TILE_SIZE,
              y: 8 * TILE_SIZE,
              width: TILE_SIZE,
              height: 3 * TILE_SIZE,
              targetSceneId: `demo-${String.fromCharCode(97 + previousIndex)}`,
              targetPortalId: `demo-${String.fromCharCode(97 + previousIndex)}:portal:next`,
              hidden: false,
            },
            {
              id: `${id}:portal:next`,
              label: '下一展厅',
              x: width - 2 * TILE_SIZE,
              y: 8 * TILE_SIZE,
              width: TILE_SIZE,
              height: 3 * TILE_SIZE,
              targetSceneId: `demo-${String.fromCharCode(97 + nextIndex)}`,
              targetPortalId: `demo-${String.fromCharCode(97 + nextIndex)}:portal:previous`,
              hidden: false,
            },
          ]
        : [],
    exhibits,
    collectibles: [
      {
        id: `${id}:memory-fragment`,
        label: `记忆碎片 ${index + 1}`,
        kind: 'memory-fragment',
        assetId: 'museum-memory-shard',
        x: 22 * TILE_SIZE,
        y: 15 * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
      },
    ],
    decorations: [
      {
        id: `${id}:terminal`,
        label: '馆内终端',
        kind: 'terminal',
        interactive: true,
        blocking: true,
        assetId: 'museum-memory-shard',
        x: 3 * TILE_SIZE,
        y: 14 * TILE_SIZE,
        width: 2 * TILE_SIZE,
        height: 1.5 * TILE_SIZE,
      },
    ],
  }
}

export function createFallbackWorld(catalog: Pick<Catalog, 'exhibits'>): MuseumWorld {
  const ids = catalog.exhibits.map((exhibit) => exhibit.id)
  const roomCount = Math.max(1, Math.ceil(ids.length / PER_ROOM))
  const scenes = Array.from({ length: roomCount }, (_, index) =>
    createRoom(index, ids.slice(index * PER_ROOM, (index + 1) * PER_ROOM), roomCount),
  )
  return {
    schemaVersion: 1,
    startScene: scenes[0]!.id,
    scenes,
    isFallback: true,
  }
}
