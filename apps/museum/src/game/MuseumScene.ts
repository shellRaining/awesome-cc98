import Phaser from 'phaser'
import { findNearestInteraction } from './geometry'
import type {
  InteractionTarget,
  MuseumSceneDefinition,
  MuseumWorld,
  Point,
  Rect,
} from '../types'

interface Palette {
  floor: number
  floorAlt: number
  grid: number
  wall: number
  wallEdge: number
  stand: number
  standTop: number
  accent: number
  accentSoft: number
  ink: string
  player: number
  playerEdge: number
}

export interface MuseumSceneCallbacks {
  getCollected(): ReadonlySet<string>
  getExhibitName(exhibitId: string): string
  getAssetUrl(assetId: string): string | undefined
  getExhibitBadge(exhibitId: string): string
  getVisualSettings(): {
    reducedMotion: boolean
    highContrast: boolean
    performanceMode: boolean
  }
  isFlagSet(flag: string): boolean
  isKeyboardTarget(): boolean
  onInteraction(target: InteractionTarget): void
  onNearbyTarget(target: InteractionTarget | undefined): void
  onSceneChanged(scene: MuseumSceneDefinition): void
}

const PALETTE_A: Palette = {
  floor: 0xc99255,
  floorAlt: 0xd9aa70,
  grid: 0xad7041,
  wall: 0xf3e7ca,
  wallEdge: 0x8a5938,
  stand: 0x477a78,
  standTop: 0xe4bc70,
  accent: 0xd98a48,
  accentSoft: 0x6e9890,
  ink: '#243f43',
  player: 0xffe9b5,
  playerEdge: 0x315965,
}

const PALETTE_C: Palette = {
  floor: 0xeee8d9,
  floorAlt: 0xddece5,
  grid: 0xb4d6d8,
  wall: 0xc79b6c,
  wallEdge: 0x78bac8,
  stand: 0x84c6b4,
  standTop: 0x5ba9c4,
  accent: 0x4ca6c6,
  accentSoft: 0xa5d9c8,
  ink: '#173f4a',
  player: 0xfff9e9,
  playerEdge: 0x418ca2,
}

const PALETTE_AC: Palette = {
  floor: 0xd3a064,
  floorAlt: 0xe3b77d,
  grid: 0xbb8052,
  wall: 0xf6ead0,
  wallEdge: 0x46818a,
  stand: 0x63a89d,
  standTop: 0xf0c66f,
  accent: 0x4f9ba6,
  accentSoft: 0xe48f76,
  ink: '#25484d',
  player: 0xffedbc,
  playerEdge: 0x3d7782,
}

export function paletteForTheme(theme: string): Palette {
  const normalized = theme.trim().toLowerCase()
  if (normalized === 'ac' || normalized.includes('hybrid')) return PALETTE_AC
  return normalized === 'c' || normalized.includes('cyan') || normalized.includes('campus')
    ? PALETTE_C
    : PALETTE_A
}

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function interactionIdentity(target: InteractionTarget | undefined): string {
  return target ? `${target.type}:${target.value.id}` : ''
}

function isEditingText(): boolean {
  const active = document.activeElement
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement &&
      (active.isContentEditable || Boolean(active.closest('button, a, dialog, [role="button"]'))))
  )
}

function assetTextureKey(assetId: string): string {
  return `museum-asset-${assetId.replace(/[^a-z0-9-]/gi, '-')}`
}

function exhibitColor(id: string): number {
  let hash = 2166136261
  for (const character of id) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  const colors = [0x397d8c, 0xd77759, 0xd2a443, 0x5c9277, 0x7f75ac, 0xb5687a, 0x557fb4]
  return colors[Math.abs(hash) % colors.length]!
}

export class MuseumScene extends Phaser.Scene {
  private readonly world: MuseumWorld
  private readonly callbacks: MuseumSceneCallbacks
  private currentSceneId: string
  private pendingSpawn?: Point
  private currentDefinition!: MuseumSceneDefinition
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
  private movementKeys!: Record<
    'up' | 'down' | 'left' | 'right' | 'arrowUp' | 'arrowDown' | 'arrowLeft' | 'arrowRight',
    Phaser.Input.Keyboard.Key
  >
  private interactKeys!: Phaser.Input.Keyboard.Key[]
  private blockers!: Phaser.Physics.Arcade.StaticGroup
  private collectibleObjects = new Map<string, Phaser.GameObjects.GameObject>()
  private nearby?: InteractionTarget
  private inputEnabled = true
  private gamepadInteractPressed = false
  private virtualDirections = { up: false, down: false, left: false, right: false }

  constructor(world: MuseumWorld, callbacks: MuseumSceneCallbacks) {
    super({ key: 'MuseumScene' })
    this.world = world
    this.callbacks = callbacks
    this.currentSceneId = world.startScene
  }

  preload(): void {
    const assetIds = new Set(
      this.world.scenes.flatMap((scene) => [
        ...scene.collectibles.map((item) => item.assetId),
        ...scene.decorations.map((item) => item.assetId),
      ]),
    )
    for (const assetId of assetIds) {
      if (!assetId) continue
      const url = this.callbacks.getAssetUrl(assetId)
      const key = assetTextureKey(assetId)
      if (url && !this.textures.exists(key)) this.load.image(key, url)
    }
  }

  create(): void {
    this.currentDefinition =
      this.world.scenes.find((scene) => scene.id === this.currentSceneId) ?? this.world.scenes[0]!
    this.currentSceneId = this.currentDefinition.id
    const definition = this.currentDefinition
    const palette = paletteForTheme(definition.theme)

    this.physics.world.setBounds(0, 0, definition.width, definition.height)
    this.cameras.main.setBounds(0, 0, definition.width, definition.height)
    this.cameras.main.setBackgroundColor(palette.floor)
    this.cameras.main.roundPixels = true
    this.drawFloor(definition, palette)

    this.blockers = this.physics.add.staticGroup()
    definition.boundaries.forEach((boundary) => this.drawBoundary(boundary, palette))
    definition.exhibits.forEach((placement) => this.drawExhibit(placement, palette))
    definition.portals.forEach((portal) => this.drawPortal(portal, palette))
    definition.decorations.forEach((decoration) => this.drawDecoration(decoration, palette))
    definition.collectibles.forEach((collectible) => this.drawCollectible(collectible, palette))

    const [textureKey, alternateTextureKey] = this.ensurePlayerTextures(definition.theme, palette)
    const spawn = this.pendingSpawn ?? definition.spawn
    this.pendingSpawn = undefined
    this.player = this.physics.add.sprite(spawn.x, spawn.y, textureKey)
    this.player.setDepth(20).setCollideWorldBounds(true)
    this.player.body.setSize(14, 14).setOffset(1, 8)
    this.physics.add.collider(this.player, this.blockers)

    this.cameras.main.startFollow(this.player, true, 0.14, 0.14)
    this.cameras.main.setDeadzone(90, 70)
    this.layoutCamera()
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layoutCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layoutCamera, this)
    })

    this.movementKeys = this.input.keyboard!.addKeys(
      {
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
        arrowUp: Phaser.Input.Keyboard.KeyCodes.UP,
        arrowDown: Phaser.Input.Keyboard.KeyCodes.DOWN,
        arrowLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
        arrowRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      },
      false,
    ) as typeof this.movementKeys
    this.interactKeys = [
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E, false),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER, false),
    ]
    const animationKey = `museum-walk-${definition.theme.toLowerCase()}`
    if (!this.anims.exists(animationKey)) {
      this.anims.create({
        key: animationKey,
        frames: [{ key: textureKey }, { key: alternateTextureKey }],
        frameRate: 6,
        repeat: -1,
      })
    }

    this.callbacks.onSceneChanged(definition)
    this.nearby = undefined
    this.callbacks.onNearbyTarget(undefined)
  }

  update(): void {
    if (!this.player?.body) return
    const acceptKeyboard =
      this.inputEnabled && this.callbacks.isKeyboardTarget() && !isEditingText()
    const gamepad = this.inputEnabled ? this.input.gamepad?.getPad(0) : undefined
    const gamepadX = Math.abs(gamepad?.axes[0]?.getValue() ?? 0) > 0.2
      ? (gamepad?.axes[0]?.getValue() ?? 0)
      : 0
    const gamepadY = Math.abs(gamepad?.axes[1]?.getValue() ?? 0) > 0.2
      ? (gamepad?.axes[1]?.getValue() ?? 0)
      : 0
    const left =
      this.virtualDirections.left ||
      Boolean(gamepad?.left) ||
      (acceptKeyboard && (this.movementKeys.arrowLeft.isDown || this.movementKeys.left.isDown))
    const right =
      this.virtualDirections.right ||
      Boolean(gamepad?.right) ||
      (acceptKeyboard && (this.movementKeys.arrowRight.isDown || this.movementKeys.right.isDown))
    const up =
      this.virtualDirections.up ||
      Boolean(gamepad?.up) ||
      (acceptKeyboard && (this.movementKeys.arrowUp.isDown || this.movementKeys.up.isDown))
    const down =
      this.virtualDirections.down ||
      Boolean(gamepad?.down) ||
      (acceptKeyboard && (this.movementKeys.arrowDown.isDown || this.movementKeys.down.isDown))

    const direction = new Phaser.Math.Vector2(
      Number(right) - Number(left) + gamepadX,
      Number(down) - Number(up) + gamepadY,
    )
    if (direction.lengthSq() > 0) direction.normalize().scale(150)
    this.player.setVelocity(direction.x, direction.y)
    if (direction.x !== 0) this.player.setFlipX(direction.x < 0)
    const animationKey = `museum-walk-${this.currentDefinition.theme.toLowerCase()}`
    if (direction.lengthSq() > 0) this.player.play(animationKey, true)
    else {
      this.player.stop()
      this.player.setTexture(`museum-player-${this.currentDefinition.theme.toLowerCase()}-0`)
    }

    const nearest = findNearestInteraction(
      { x: this.player.x, y: this.player.y },
      this.currentDefinition,
      this.callbacks.getCollected(),
      this.currentDefinition.tileSize * 1.7,
    )
    if (interactionIdentity(nearest) !== interactionIdentity(this.nearby)) {
      this.nearby = nearest
      this.callbacks.onNearbyTarget(nearest)
    }
    if (acceptKeyboard && this.interactKeys.some((key) => Phaser.Input.Keyboard.JustDown(key))) {
      this.interact()
    }
    const gamepadInteract = Boolean(gamepad?.buttons[0]?.pressed || gamepad?.buttons[2]?.pressed)
    if (this.inputEnabled && gamepadInteract && !this.gamepadInteractPressed) this.interact()
    this.gamepadInteractPressed = gamepadInteract
  }

  interact(): void {
    if (this.inputEnabled && this.nearby) this.callbacks.onInteraction(this.nearby)
  }

  showScene(sceneId: string, spawn?: Point): void {
    if (!this.world.scenes.some((scene) => scene.id === sceneId)) return
    this.currentSceneId = sceneId
    this.pendingSpawn = spawn
    this.scene.restart()
  }

  setVirtualDirection(direction: keyof typeof this.virtualDirections, pressed: boolean): void {
    this.virtualDirections[direction] = pressed
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled
    if (!enabled && this.player?.body) this.player.setVelocity(0, 0)
    if (!enabled) {
      this.gamepadInteractPressed = false
      for (const key of Object.keys(this.virtualDirections) as Array<keyof typeof this.virtualDirections>) {
        this.virtualDirections[key] = false
      }
    }
  }

  refreshVisuals(): void {
    if (!this.currentDefinition || !this.player) return
    this.showScene(this.currentDefinition.id, { x: this.player.x, y: this.player.y })
  }

  refreshCollected(id?: string): void {
    if (id) {
      const object = this.collectibleObjects.get(id)
      object?.destroy()
      this.collectibleObjects.delete(id)
    } else {
      for (const [itemId, object] of this.collectibleObjects) {
        if (this.callbacks.getCollected().has(itemId)) {
          object.destroy()
          this.collectibleObjects.delete(itemId)
        }
      }
    }
  }

  private drawFloor(definition: MuseumSceneDefinition, palette: Palette): void {
    const graphics = this.add.graphics().setDepth(-10)
    graphics.fillStyle(palette.floor, 1).fillRect(0, 0, definition.width, definition.height)
    const tile = definition.tileSize
    const { performanceMode, highContrast } = this.callbacks.getVisualSettings()
    for (let y = 0; y < definition.height; y += tile) {
      for (let x = 0; x < definition.width; x += tile) {
        if ((x / tile + y / tile) % 2 === 0) {
          graphics.fillStyle(palette.floorAlt, 0.42).fillRect(x, y, tile, tile)
        }
      }
    }
    if (performanceMode) return
    graphics.lineStyle(highContrast ? 2 : 1, palette.grid, highContrast ? 0.68 : 0.42)
    for (let x = 0; x <= definition.width; x += tile) {
      graphics.lineBetween(x, 0, x, definition.height)
    }
    for (let y = 0; y <= definition.height; y += tile) {
      graphics.lineBetween(0, y, definition.width, y)
    }
  }

  private drawBoundary(boundary: Rect, palette: Palette): void {
    const object = this.add
      .rectangle(
        boundary.x + boundary.width / 2,
        boundary.y + boundary.height / 2,
        boundary.width,
        boundary.height,
        palette.wall,
      )
      .setStrokeStyle(3, palette.wallEdge, 0.9)
      .setDepth(4)
    this.blockers.add(object)
  }

  private drawExhibit(
    placement: MuseumSceneDefinition['exhibits'][number],
    palette: Palette,
  ): void {
    const position = center(placement)
    const baseColor = exhibitColor(placement.exhibitId)
    const depth = placement.display === 'wall' ? 7 : 6
    this.add
      .rectangle(position.x + 3, position.y + 5, placement.width, placement.height, 0x000000, 0.3)
      .setDepth(5)
    const object = this.add
      .rectangle(
        position.x,
        position.y,
        placement.width,
        placement.height,
        placement.display === 'wall' ? palette.wallEdge : palette.stand,
      )
      .setStrokeStyle(3, palette.standTop, 1)
      .setDepth(depth)
    this.blockers.add(object)

    const insetWidth = Math.max(12, placement.width - 10)
    const insetHeight = Math.max(10, placement.height - 10)
    this.add
      .rectangle(position.x, position.y - (placement.display === 'pedestal' ? 3 : 0), insetWidth, insetHeight, baseColor)
      .setStrokeStyle(1, 0xffffff, 0.78)
      .setDepth(depth + 1)
    const badge = this.callbacks.getExhibitBadge(placement.exhibitId)
    this.add
      .text(position.x, position.y - (placement.display === 'pedestal' ? 3 : 0), badge, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: placement.display === 'kiosk' ? '9px' : '10px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(depth + 2)

    if (placement.interaction) {
      this.add
        .text(position.x + placement.width / 2 - 3, position.y - placement.height / 2 + 1, '✦', {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '11px',
          color: '#fff0a6',
        })
        .setOrigin(1, 0)
        .setDepth(depth + 3)
    }

    const name = this.callbacks.getExhibitName(placement.exhibitId)
    const compactName = name.length > 18 ? `${name.slice(0, 17)}…` : name
    const labelBelow = placement.facing === 'up'
    this.add
      .text(position.x, labelBelow ? placement.y + placement.height + 8 : placement.y - 8, compactName, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color: palette.ink,
        backgroundColor: '#fff9e9e8',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, labelBelow ? 0 : 1)
      .setResolution(2)
      .setDepth(8)
  }

  private drawPortal(portal: MuseumSceneDefinition['portals'][number], palette: Palette): void {
    const position = center(portal)
    const locked = Boolean(portal.requiresFlag && !this.callbacks.isFlagSet(portal.requiresFlag))
    const glow = this.add
      .rectangle(
        position.x,
        position.y,
        portal.width,
        portal.height,
        locked && portal.hidden ? palette.wall : palette.accent,
        locked && portal.hidden ? 0.08 : 0.2,
      )
      .setStrokeStyle(locked && portal.hidden ? 1 : 3, locked ? palette.wallEdge : palette.accent, locked ? 0.4 : 1)
      .setDepth(3)
    const settings = this.callbacks.getVisualSettings()
    if (!locked && !settings.reducedMotion && !settings.performanceMode) {
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.55, to: 1 },
        duration: 850,
        yoyo: true,
        repeat: -1,
        ease: 'Stepped',
      })
    }
  }

  private drawCollectible(
    collectible: MuseumSceneDefinition['collectibles'][number],
    palette: Palette,
  ): void {
    if (this.callbacks.getCollected().has(collectible.id)) return
    const position = center(collectible)
    const textureKey = collectible.assetId ? assetTextureKey(collectible.assetId) : undefined
    const object: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform =
      textureKey && this.textures.exists(textureKey)
        ? this.add
            .image(position.x, position.y, textureKey)
            .setDisplaySize(
              Math.min(48, collectible.width * 0.92),
              Math.min(48, collectible.height * 0.92),
            )
            .setDepth(9)
        : this.add
            .rectangle(
              position.x,
              position.y,
              collectible.width * 0.62,
              collectible.height * 0.62,
              palette.accent,
            )
            .setStrokeStyle(2, 0xffffff, 0.9)
            .setRotation(Math.PI / 4)
            .setDepth(9)
    const settings = this.callbacks.getVisualSettings()
    if (!settings.reducedMotion && !settings.performanceMode) {
      this.tweens.add({
        targets: object,
        y: position.y - 7,
        alpha: { from: 0.72, to: 1 },
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }
    this.collectibleObjects.set(collectible.id, object)
  }

  private drawDecoration(
    decoration: MuseumSceneDefinition['decorations'][number],
    palette: Palette,
  ): void {
    const position = center(decoration)
    const terminal = decoration.kind.toLowerCase() === 'terminal'
    const artwork = ['artwork', 'poster', 'concept'].includes(decoration.kind.toLowerCase())
    const textureKey = decoration.assetId ? assetTextureKey(decoration.assetId) : undefined
    const frame = this.add
      .rectangle(position.x, position.y, decoration.width, decoration.height, terminal ? 0x132126 : palette.accentSoft)
      .setStrokeStyle(terminal || artwork ? 3 : 1, terminal ? palette.accent : palette.wallEdge, 0.9)
      .setDepth(6)
    if (artwork && textureKey && this.textures.exists(textureKey)) {
      const image = this.add.image(position.x, position.y, textureKey).setDepth(7)
      const scale = Math.min(
        (decoration.width - 8) / image.width,
        (decoration.height - 8) / image.height,
      )
      image.setScale(scale)
    }
    if (terminal) {
      this.add
        .text(position.x, position.y, '>_', {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '14px',
          color: palette.ink,
        })
        .setOrigin(0.5)
        .setDepth(7)
    }
    if (decoration.label && !this.callbacks.getVisualSettings().performanceMode) {
      this.add
        .text(position.x, decoration.y - 4, decoration.label, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '9px',
          color: palette.ink,
          backgroundColor: '#fff9e9d9',
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(8)
    }
    if (decoration.blocking) this.blockers.add(frame)
  }

  private ensurePlayerTextures(theme: string, palette: Palette): [string, string] {
    const normalized = theme.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const keys: [string, string] = [`museum-player-${normalized}-0`, `museum-player-${normalized}-1`]
    keys.forEach((key, frame) => {
      if (this.textures.exists(key)) return
      const graphics = this.make.graphics({ x: 0, y: 0 })
      graphics.fillStyle(palette.playerEdge, 1).fillRect(2, 0, 12, 4)
      graphics.fillStyle(palette.player, 1).fillRect(1, 4, 14, 11)
      graphics.fillStyle(palette.playerEdge, 1).fillRect(0, 8, 2, 6).fillRect(14, 8, 2, 6)
      graphics.fillStyle(0x17111d, 1).fillRect(4, 7, 2, 2).fillRect(10, 7, 2, 2)
      graphics
        .fillStyle(palette.playerEdge, 1)
        .fillRect(frame === 0 ? 3 : 2, 15, 4, 7)
        .fillRect(frame === 0 ? 9 : 10, 15, 4, 7)
      graphics.generateTexture(key, 16, 22)
      graphics.destroy()
    })
    return keys
  }

  private layoutCamera(): void {
    if (!this.currentDefinition) return
    const viewport = this.scale.gameSize
    const zoom = Phaser.Math.Clamp(
      Math.max(
        viewport.width / this.currentDefinition.width,
        viewport.height / this.currentDefinition.height,
      ),
      1,
      2,
    )
    this.cameras.main.setZoom(zoom)
  }
}
