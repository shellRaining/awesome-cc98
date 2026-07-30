import Phaser from 'phaser'
import './styles.css'
import { MuseumAudioController } from './audio'
import {
  assetAttribution,
  assetPublicUrl,
  formatLicense,
  loadMuseumData,
  resolveAuthorAsset,
  type DataLoadResult,
} from './data'
import { createFallbackWorld } from './fallback'
import { MuseumScene } from './game/MuseumScene'
import { resolvePortalDestination } from './game/geometry'
import { buildExhibitInteraction } from './interactions'
import { restoreMuseumStageFocus } from './ui-focus'
import {
  collectItem,
  discoverExhibit,
  loadMuseumState,
  resetMuseumState,
  saveMuseumState,
  setFlag,
  toggleFavorite,
  updateSettings,
  visitScene,
  type MuseumState,
  type StorageLike,
} from './state'
import type {
  AssetManifest,
  AssetRecord,
  Catalog,
  Exhibit,
  ExhibitPlacement,
  InteractionTarget,
  MuseumSceneDefinition,
  MuseumWorld,
} from './types'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('缺少 #app 容器')

root.innerHTML = `
  <main class="museum-shell" data-theme="a">
    <header class="museum-header">
      <div class="brand-block">
        <p class="eyebrow">AWESOME CC98 · DIGITAL MUSEUM</p>
        <h1>像素客户端博物馆</h1>
      </div>
      <div class="museum-toolbar" aria-label="博物馆工具">
        <button class="pixel-button primary" id="guide-button" type="button">导览</button>
        <button class="pixel-button" id="collection-button" type="button">收藏</button>
        <button class="pixel-button" id="artbook-button" type="button">画册</button>
        <button class="pixel-button" id="terminal-button" type="button">终端</button>
        <button class="pixel-button" id="settings-button" type="button">设置</button>
        <button class="pixel-button" id="help-button" type="button">帮助</button>
      </div>
    </header>

    <section class="museum-status" aria-label="当前参观状态">
      <span id="scene-label">准备入馆…</span>
      <span class="theme-chip" id="theme-label">A</span>
      <span class="fallback-chip" id="fallback-label" hidden>演示场景</span>
      <span class="progress-chip" id="progress-label">发现 0 / 0 · 碎片 0 / 0</span>
    </section>

    <section
      class="museum-stage is-loading"
      id="museum-stage"
      tabindex="0"
      aria-label="可交互的像素博物馆。使用 WASD 或方向键移动，E 或回车互动。"
    >
      <div id="phaser-game" aria-hidden="true"></div>
      <section class="boot-panel" id="boot-panel" aria-live="polite">
        <div class="boot-card">
          <div class="loader-pixels" id="loader-pixels" aria-hidden="true"><i></i><i></i><i></i></div>
          <p class="eyebrow" id="boot-kicker">LOADING EXHIBITS</p>
          <h2 id="boot-title">正在整理展厅</h2>
          <p id="boot-message">读取 catalog、assets 与 scenes 三份运行时数据…</p>
          <ul class="error-list" id="error-list" hidden></ul>
          <div class="boot-actions" id="boot-actions" hidden>
            <button class="pixel-button primary" id="retry-button" type="button">重新读取</button>
            <button class="pixel-button" id="demo-button" type="button">进入演示馆</button>
          </div>
        </div>
      </section>

      <div class="interaction-hint" id="interaction-hint" role="status" hidden></div>
      <div class="touch-controls" aria-label="触屏控制">
        <div class="direction-pad">
          <button type="button" data-direction="up" aria-label="向上移动">▲</button>
          <button type="button" data-direction="left" aria-label="向左移动">◀</button>
          <span aria-hidden="true"></span>
          <button type="button" data-direction="right" aria-label="向右移动">▶</button>
          <button type="button" data-direction="down" aria-label="向下移动">▼</button>
        </div>
        <button class="interact-button" id="interact-button" type="button" aria-label="与附近目标互动">E</button>
      </div>
    </section>

    <footer class="museum-footer">
      <span>WASD / 方向键 / 手柄移动 · E / Enter / A 互动</span>
      <span>展品资料与署名来自已生成清单</span>
    </footer>
  </main>

  <dialog class="pixel-dialog exhibit-dialog" id="exhibit-dialog" aria-labelledby="exhibit-dialog-title">
    <div class="dialog-frame">
      <header class="dialog-header">
        <p class="eyebrow">EXHIBIT FILE</p>
        <h2 id="exhibit-dialog-title">展品档案</h2>
        <button class="icon-button dialog-close" type="button" aria-label="关闭展品档案">×</button>
      </header>
      <div class="dialog-scroll" id="exhibit-dialog-content"></div>
    </div>
  </dialog>

  <dialog class="pixel-dialog guide-dialog" id="guide-dialog" aria-labelledby="guide-title">
    <div class="dialog-frame">
      <header class="dialog-header">
        <p class="eyebrow">CURATOR ROUTE</p>
        <h2 id="guide-title">馆内导览</h2>
        <button class="icon-button dialog-close" type="button" aria-label="关闭馆内导览">×</button>
      </header>
      <div class="dialog-scroll" id="guide-content"></div>
    </div>
  </dialog>

  <dialog class="pixel-dialog collection-dialog" id="collection-dialog" aria-labelledby="collection-title">
    <div class="dialog-frame">
      <header class="dialog-header">
        <p class="eyebrow">VISITOR NOTEBOOK</p>
        <h2 id="collection-title">收藏手册</h2>
        <button class="icon-button dialog-close" type="button" aria-label="关闭收藏手册">×</button>
      </header>
      <div class="dialog-scroll" id="collection-content"></div>
    </div>
  </dialog>

  <dialog class="pixel-dialog artbook-dialog" id="artbook-dialog" aria-labelledby="artbook-title">
    <div class="dialog-frame">
      <header class="dialog-header">
        <p class="eyebrow">VISUAL ARCHIVE</p>
        <h2 id="artbook-title">A / C 视觉档案</h2>
        <button class="icon-button dialog-close" type="button" aria-label="关闭视觉档案">×</button>
      </header>
      <div class="dialog-scroll" id="artbook-content"></div>
    </div>
  </dialog>

  <dialog class="pixel-dialog settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
    <div class="dialog-frame">
      <header class="dialog-header">
        <p class="eyebrow">LOCAL SETTINGS</p>
        <h2 id="settings-title">参观设置</h2>
        <button class="icon-button dialog-close" type="button" aria-label="关闭参观设置">×</button>
      </header>
      <div class="dialog-scroll settings-grid">
        <label><input id="setting-muted" type="checkbox" /> 静音</label>
        <label for="setting-volume">音量 <output id="setting-volume-output">65%</output></label>
        <input id="setting-volume" type="range" min="0" max="100" step="5" value="65" />
        <label><input id="setting-reduced-motion" type="checkbox" /> 减少动态效果</label>
        <label><input id="setting-high-contrast" type="checkbox" /> 高对比度</label>
        <label><input id="setting-performance" type="checkbox" /> 低性能模式</label>
        <p>设置和参观进度只保存在本机，不会上传访客身份。</p>
        <button class="pixel-button danger" id="reset-button" type="button">重置全部本地进度</button>
      </div>
    </div>
  </dialog>

  <dialog class="pixel-dialog terminal-dialog" id="terminal-dialog" aria-labelledby="terminal-title">
    <div class="dialog-frame">
      <header class="dialog-header">
        <p class="eyebrow">MUSEUM TERMINAL</p>
        <h2 id="terminal-title">馆内终端</h2>
        <button class="icon-button dialog-close" type="button" aria-label="关闭终端">×</button>
      </header>
      <div class="terminal-output" id="terminal-output" role="log" aria-live="polite"></div>
      <form class="terminal-form" id="terminal-form">
        <label for="terminal-input">访客指令</label>
        <div>
          <span aria-hidden="true">&gt;</span>
          <input id="terminal-input" name="command" autocomplete="off" spellcheck="false" />
          <button class="pixel-button primary" type="submit">运行</button>
        </div>
      </form>
    </div>
  </dialog>

  <dialog class="pixel-dialog help-dialog" id="help-dialog" aria-labelledby="help-title">
    <div class="dialog-frame">
      <header class="dialog-header">
        <p class="eyebrow">VISITOR GUIDE</p>
        <h2 id="help-title">参观指南</h2>
        <button class="icon-button dialog-close" type="button" aria-label="关闭参观指南">×</button>
      </header>
      <div class="dialog-scroll prose">
        <h3>移动与互动</h3>
        <p>使用 WASD、方向键或手柄左摇杆移动；靠近展台、传送门、收藏物或终端后，按 E / Enter 或手柄 A 键互动。触屏设备可使用画面下方的方向键与 E 键。</p>
        <h3>键盘与辅助功能</h3>
        <p>页面中的工具、详情与终端都是可聚焦的 DOM 控件。按 Escape 可关闭对话框；关闭后焦点会回到博物馆舞台，可直接继续使用 WASD 或方向键移动。</p>
        <h3>本地进度</h3>
        <p>到访展厅、发现展品、收藏、互动和彩蛋只保存在本机 localStorage。参观设置中可以随时清除这些数据。</p>
      </div>
    </div>
  </dialog>

  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
`

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id)
  if (!value) throw new Error(`缺少界面元素 #${id}`)
  return value as T
}

function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  name: K,
  text: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name)
  node.textContent = text
  if (className) node.className = className
  return node
}

function externalLink(url: string, label: string): HTMLAnchorElement | HTMLSpanElement {
  const safeUrl = safeExternalUrl(url)
  if (!safeUrl) return textElement('span', label)
  const link = textElement('a', label)
  link.href = safeUrl
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

function availableStorage(): StorageLike | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

class MuseumApplication {
  private readonly shell = document.querySelector<HTMLElement>('.museum-shell')!
  private readonly stage = element<HTMLElement>('museum-stage')
  private readonly bootPanel = element<HTMLElement>('boot-panel')
  private readonly bootKicker = element<HTMLElement>('boot-kicker')
  private readonly bootTitle = element<HTMLElement>('boot-title')
  private readonly bootMessage = element<HTMLElement>('boot-message')
  private readonly loader = element<HTMLElement>('loader-pixels')
  private readonly errorList = element<HTMLUListElement>('error-list')
  private readonly bootActions = element<HTMLElement>('boot-actions')
  private readonly sceneLabel = element<HTMLElement>('scene-label')
  private readonly themeLabel = element<HTMLElement>('theme-label')
  private readonly fallbackLabel = element<HTMLElement>('fallback-label')
  private readonly progressLabel = element<HTMLElement>('progress-label')
  private readonly hint = element<HTMLElement>('interaction-hint')
  private readonly exhibitDialog = element<HTMLDialogElement>('exhibit-dialog')
  private readonly exhibitContent = element<HTMLElement>('exhibit-dialog-content')
  private readonly guideDialog = element<HTMLDialogElement>('guide-dialog')
  private readonly guideContent = element<HTMLElement>('guide-content')
  private readonly collectionDialog = element<HTMLDialogElement>('collection-dialog')
  private readonly collectionContent = element<HTMLElement>('collection-content')
  private readonly artbookDialog = element<HTMLDialogElement>('artbook-dialog')
  private readonly artbookContent = element<HTMLElement>('artbook-content')
  private readonly settingsDialog = element<HTMLDialogElement>('settings-dialog')
  private readonly terminalDialog = element<HTMLDialogElement>('terminal-dialog')
  private readonly terminalOutput = element<HTMLElement>('terminal-output')
  private readonly terminalInput = element<HTMLInputElement>('terminal-input')
  private readonly helpDialog = element<HTMLDialogElement>('help-dialog')
  private readonly toastNode = element<HTMLElement>('toast')
  private readonly storage = availableStorage()
  private state: MuseumState = loadMuseumState(this.storage)
  private readonly audio = new MuseumAudioController({
    muted: this.state.settings.muted,
    volume: this.state.settings.volume,
  })
  private collected = new Set(this.state.collected)
  private loadResult?: DataLoadResult
  private loadGeneration = 0
  private catalog: Catalog = { schema_version: 1, exhibits: [] }
  private assets: AssetManifest = { schema_version: 1, assets: [] }
  private world?: MuseumWorld
  private currentScene?: MuseumSceneDefinition
  private scene?: MuseumScene
  private game?: Phaser.Game
  private toastTimer?: number
  private terminalStarted = false
  private openedExhibit?: Exhibit
  private openedPlacement?: ExhibitPlacement

  constructor() {
    element<HTMLButtonElement>('retry-button').addEventListener('click', () => void this.load())
    element<HTMLButtonElement>('demo-button').addEventListener('click', () => this.launchDemo())
    element<HTMLButtonElement>('help-button').addEventListener('click', () => this.openDialog(this.helpDialog))
    element<HTMLButtonElement>('guide-button').addEventListener('click', () => {
      this.renderGuide()
      this.openDialog(this.guideDialog)
    })
    element<HTMLButtonElement>('collection-button').addEventListener('click', () => {
      this.renderCollection()
      this.openDialog(this.collectionDialog)
    })
    element<HTMLButtonElement>('artbook-button').addEventListener('click', () => {
      this.renderArtbook()
      this.openDialog(this.artbookDialog)
    })
    element<HTMLButtonElement>('settings-button').addEventListener('click', () => {
      this.syncSettingsControls()
      this.openDialog(this.settingsDialog)
    })
    element<HTMLButtonElement>('terminal-button').addEventListener('click', () => this.openTerminal())
    element<HTMLButtonElement>('reset-button').addEventListener('click', () => this.resetProgress())
    element<HTMLButtonElement>('interact-button').addEventListener('click', () => this.scene?.interact())
    this.stage.addEventListener('pointerdown', (event) => {
      if (event.target instanceof HTMLCanvasElement) this.stage.focus({ preventScroll: true })
    })
    this.stage.addEventListener('keydown', (event) => {
      if (
        !this.anyDialogOpen() &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'e', 'E', 'Enter'].includes(event.key)
      ) {
        event.preventDefault()
      }
    })

    for (const dialog of this.dialogs()) {
      dialog.querySelector<HTMLButtonElement>('.dialog-close')?.addEventListener('click', () => dialog.close())
      dialog.addEventListener('close', () => this.onDialogClosed())
    }
    this.installTouchControls()
    this.installTerminal()
    this.installSettings()
    this.applyPersistentState()
  }

  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    this.showLoading()
    const result = await loadMuseumData()
    if (generation !== this.loadGeneration) return
    this.loadResult = result

    if (!result.catalog || !result.assets) {
      this.showDataError(result)
      return
    }
    this.catalog = result.catalog
    this.assets = result.assets
    const world = result.world ?? createFallbackWorld(this.catalog)
    this.launch(world)
    if (!result.world) {
      this.toast('场景数据不可用，已进入按目录动态生成的演示馆。', 5500)
    }
  }

  private showLoading(): void {
    this.stage.classList.add('is-loading')
    this.bootPanel.hidden = false
    this.loader.hidden = false
    this.bootKicker.textContent = 'LOADING EXHIBITS'
    this.bootTitle.textContent = '正在整理展厅'
    this.bootMessage.textContent = '读取 catalog、assets 与 scenes 三份运行时数据…'
    this.errorList.hidden = true
    this.errorList.replaceChildren()
    this.bootActions.hidden = true
  }

  private showDataError(result: DataLoadResult): void {
    this.stage.classList.add('is-loading')
    this.bootPanel.hidden = false
    this.loader.hidden = true
    this.bootKicker.textContent = 'DATA LOAD ERROR'
    this.bootTitle.textContent = '展厅资料没有准备完整'
    this.bootMessage.textContent =
      '正常参观需要 catalog.json 与 assets.json。你可以重新读取，或进入不包含硬编码展品事实的演示馆。'
    this.errorList.replaceChildren(
      ...result.errors.map((error) => textElement('li', `${error.resource}: ${error.message}`)),
    )
    this.errorList.hidden = result.errors.length === 0
    this.bootActions.hidden = false
  }

  private launchDemo(): void {
    const catalog = this.loadResult?.catalog ?? { schema_version: 1, exhibits: [] }
    this.catalog = catalog
    this.assets = this.loadResult?.assets ?? { schema_version: 1, assets: [] }
    this.launch(createFallbackWorld(catalog))
    if (catalog.exhibits.length === 0) {
      this.toast('目录尚不可用：演示馆仅提供移动、收藏与终端体验。', 6000)
    }
  }

  private launch(world: MuseumWorld): void {
    this.game?.destroy(true)
    element<HTMLElement>('phaser-game').replaceChildren()
    this.world = world
    const sceneIds = new Set(world.scenes.map((scene) => scene.id))
    const exhibitIds = new Set(this.catalog.exhibits.map((exhibit) => exhibit.id))
    const collectibleIds = new Set(
      world.scenes.flatMap((scene) => scene.collectibles.map((collectible) => collectible.id)),
    )
    this.state = {
      ...this.state,
      visitedScenes: this.state.visitedScenes.filter((id) => sceneIds.has(id)),
      discoveredExhibits: this.state.discoveredExhibits.filter((id) => exhibitIds.has(id)),
      favorites: this.state.favorites.filter((id) => exhibitIds.has(id)),
      collected: this.state.collected.filter((id) => collectibleIds.has(id)),
    }
    this.collected = new Set(this.state.collected)
    saveMuseumState(this.storage, this.state)
    this.bootPanel.hidden = true
    this.stage.classList.remove('is-loading')
    this.fallbackLabel.hidden = !world.isFallback

    this.scene = new MuseumScene(world, {
      getCollected: () => this.collected,
      getExhibitName: (id) => this.catalog.exhibits.find((item) => item.id === id)?.name ?? id,
      getExhibitBadge: (id) => this.exhibitBadge(id),
      getAssetUrl: (id) => {
        const asset = this.assets.assets.find((item) => item.key === id || item.id === id)
        return asset ? assetPublicUrl(asset) : undefined
      },
      getVisualSettings: () => ({
        reducedMotion:
          this.state.settings.reducedMotion ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        highContrast: this.state.settings.highContrast,
        performanceMode: this.state.settings.performanceMode,
      }),
      isFlagSet: (flag) => this.state.flags[flag] === true,
      isKeyboardTarget: () => document.activeElement === this.stage,
      onInteraction: (target) => this.handleInteraction(target),
      onNearbyTarget: (target) => this.showInteractionHint(target),
      onSceneChanged: (scene) => this.showSceneStatus(scene),
    })
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'phaser-game',
      backgroundColor: '#17111d',
      render: { pixelArt: true, roundPixels: true, antialias: false },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 960,
        height: 600,
      },
      physics: {
        default: 'arcade',
        arcade: { debug: false },
      },
      input: { gamepad: true },
      scene: [this.scene],
    })
    this.game.sound.mute = this.state.settings.muted
    requestAnimationFrame(() => {
      const canvas = this.stage.querySelector('canvas')
      canvas?.setAttribute('aria-hidden', 'true')
      this.stage.focus({ preventScroll: true })
    })
    this.updateProgress()
  }

  private showSceneStatus(scene: MuseumSceneDefinition): void {
    this.currentScene = scene
    const normalizedTheme = scene.theme.trim().toLowerCase()
    const theme = normalizedTheme === 'c' ? 'c' : normalizedTheme === 'ac' ? 'ac' : 'a'
    this.shell.dataset.theme = theme
    this.sceneLabel.textContent = scene.title
    this.themeLabel.textContent = `${theme.toUpperCase()} 主题`
    this.hint.hidden = true
    const previous = this.state
    const vaultWasNew = scene.id === 'memory-vault' && !this.state.flags['easter:memory-vault']
    this.state = visitScene(this.state, scene.id)
    if (scene.id === 'memory-vault') this.state = setFlag(this.state, 'easter:memory-vault')
    if (this.state !== previous) saveMuseumState(this.storage, this.state)
    if (vaultWasNew) void this.audio.play('secret')
    this.updateProgress()
  }

  private showInteractionHint(target: InteractionTarget | undefined): void {
    if (!target) {
      this.hint.hidden = true
      return
    }
    let action: string
    if (target.type === 'exhibit') {
      const exhibit = this.catalog.exhibits.find((item) => item.id === target.value.exhibitId)
      action = `查看「${exhibit?.name ?? target.value.exhibitId}」`
    } else if (target.type === 'portal') {
      const locked = Boolean(
        target.value.requiresFlag && this.state.flags[target.value.requiresFlag] !== true,
      )
      action = locked
        ? '调查一面有回声的墙'
        : `前往${target.value.label ? `「${target.value.label}」` : '下一展厅'}`
    } else if (target.type === 'collectible') {
      action = `收藏${target.value.label ? `「${target.value.label}」` : '记忆碎片'}`
    } else {
      action = `使用${target.value.label ? `「${target.value.label}」` : '馆内终端'}`
    }
    this.hint.textContent = `E / Enter / 手柄 A · ${action}`
    this.hint.hidden = false
  }

  private handleInteraction(target: InteractionTarget): void {
    if (target.type === 'exhibit') {
      const exhibit = this.catalog.exhibits.find((item) => item.id === target.value.exhibitId)
      if (exhibit) {
        void this.audio.play('open')
        this.showExhibit(exhibit, target.value)
      }
      else this.toast(`目录中找不到展品 ${target.value.exhibitId}`)
      return
    }
    if (target.type === 'portal') {
      if (target.value.requiresFlag && this.state.flags[target.value.requiresFlag] !== true) {
        this.toast('墙后传来轻微回声。也许集齐五枚记忆碎片后，它会回应。', 5200)
        return
      }
      const destination = this.world && resolvePortalDestination(this.world.scenes, target.value)
      if (!destination) {
        this.toast('传送门目标不存在。')
        return
      }
      void this.audio.play('portal')
      this.scene?.showScene(destination.sceneId, destination.spawn)
      return
    }
    if (target.type === 'collectible') {
      const collectionWasComplete = this.state.flags['collection:complete'] === true
      this.state = collectItem(this.state, target.value.id)
      this.collected = new Set(this.state.collected)
      if (target.value.kind?.toLowerCase().includes('easter') || target.value.id.includes('secret')) {
        this.state = setFlag(this.state, `easter:${target.value.id}`)
      }
      saveMuseumState(this.storage, this.state)
      void this.audio.play('collect')
      this.scene?.refreshCollected(target.value.id)
      this.updateProgress()
      this.toast(
        !collectionWasComplete && this.state.flags['collection:complete']
          ? `已收藏：${target.value.label ?? '记忆碎片'}。五枚碎片同时亮起，历史馆里传来一声轻响。`
          : `已收藏：${target.value.label ?? '记忆碎片'}`,
        5200,
      )
      return
    }
    if (target.value.kind.toLowerCase() === 'terminal') this.openTerminal()
    else {
      this.renderArtbook(target.value.assetId)
      this.openDialog(this.artbookDialog)
    }
  }

  private showExhibit(exhibit: Exhibit, placement: ExhibitPlacement): void {
    this.openedExhibit = exhibit
    this.openedPlacement = placement
    this.state = discoverExhibit(this.state, exhibit.id)
    saveMuseumState(this.storage, this.state)
    this.updateProgress()
    const fragment = document.createDocumentFragment()
    const heading = textElement('h3', exhibit.name, 'exhibit-title')
    heading.id = 'exhibit-name'
    fragment.append(heading)
    if (exhibit.tagline) fragment.append(textElement('p', exhibit.tagline, 'exhibit-tagline'))

    const meta = document.createElement('div')
    meta.className = 'chip-row'
    const chips = [
      exhibit.classification?.kind,
      exhibit.classification?.era,
      exhibit.lifecycle?.stage,
      ...(exhibit.platforms?.released ?? exhibit.platforms?.claimed ?? []).map((item) => item.id),
    ].filter((value): value is string => Boolean(value))
    meta.append(...chips.map((value) => textElement('span', value)))
    if (chips.length > 0) fragment.append(meta)

    const favoriteButton = textElement(
      'button',
      this.state.favorites.includes(exhibit.id) ? '★ 已收藏展品' : '☆ 收藏这件展品',
      'pixel-button favorite-button',
    )
    favoriteButton.type = 'button'
    favoriteButton.setAttribute(
      'aria-pressed',
      String(this.state.favorites.includes(exhibit.id)),
    )
    favoriteButton.addEventListener('click', () => {
      this.state = toggleFavorite(this.state, exhibit.id)
      saveMuseumState(this.storage, this.state)
      const favorite = this.state.favorites.includes(exhibit.id)
      favoriteButton.textContent = favorite ? '★ 已收藏展品' : '☆ 收藏这件展品'
      favoriteButton.setAttribute('aria-pressed', String(favorite))
      this.toast(favorite ? `已加入收藏：${exhibit.name}` : `已移出收藏：${exhibit.name}`)
    })
    fragment.append(favoriteButton)

    if (exhibit.authors?.length) {
      fragment.append(textElement('h4', '作者与头像署名'))
      const authors = document.createElement('div')
      authors.className = 'author-grid'
      for (const author of exhibit.authors) {
        const card = document.createElement('article')
        card.className = 'author-card'
        const asset = resolveAuthorAsset(author, this.assets)
        if (asset) {
          const figure = document.createElement('figure')
          const image = document.createElement('img')
          image.src = assetPublicUrl(asset)
          image.alt = asset.alt ?? `${author.name} 的头像`
          image.width = 64
          image.height = 64
          image.loading = 'lazy'
          figure.append(image, textElement('figcaption', assetAttribution(asset)))
          card.append(figure)
        }
        const authorUrl = safeExternalUrl(author.url)
        card.append(
          authorUrl ? externalLink(authorUrl, author.name) : textElement('strong', author.name),
        )
        if (author.role) card.append(textElement('span', author.role, 'author-role'))
        authors.append(card)
      }
      fragment.append(authors)
    }

    if (exhibit.summary) {
      fragment.append(textElement('h4', '简介'), textElement('p', exhibit.summary))
    }
    if (exhibit.features?.length) {
      fragment.append(textElement('h4', '功能亮点'))
      const list = document.createElement('ul')
      list.append(...exhibit.features.map((feature) => textElement('li', feature.title)))
      fragment.append(list)
    }

    if (placement.interaction) {
      const interaction = buildExhibitInteraction(exhibit, placement.interaction.type, () => {
        const flag = `interaction:${exhibit.id}`
        const firstCompletion = this.state.flags[flag] !== true
        this.state = setFlag(this.state, flag)
        const interactionIds = this.world?.scenes.flatMap((scene) =>
          scene.exhibits.filter((item) => item.interaction).map((item) => item.exhibitId),
        ) ?? []
        if (
          interactionIds.length > 0 &&
          interactionIds.every((id) => id === exhibit.id || this.state.flags[`interaction:${id}`])
        ) {
          this.state = setFlag(this.state, 'interactions:complete')
        }
        saveMuseumState(this.storage, this.state)
        if (firstCompletion) this.toast(`互动记录完成：${exhibit.name}`)
      })
      fragment.append(interaction)
    }

    fragment.append(textElement('h4', '许可证'))
    const license = textElement('p', formatLicense(exhibit), 'license-line')
    if (!exhibit.license?.spdx) {
      license.append(' · 在复用源码或素材前请自行确认授权。')
    }
    fragment.append(license)

    const links = (exhibit.links ?? []).filter((link) => safeExternalUrl(link.url))
    if (links.length) {
      fragment.append(textElement('h4', '公开链接'))
      const list = document.createElement('ul')
      list.className = 'external-links'
      for (const link of links) {
        const item = document.createElement('li')
        item.append(externalLink(link.url, `${link.label ?? link.kind ?? '打开链接'} ↗`))
        list.append(item)
      }
      fragment.append(list)
    }

    this.exhibitContent.replaceChildren(fragment)
    this.openDialog(this.exhibitDialog)
  }

  private renderGuide(): void {
    const fragment = document.createDocumentFragment()
    const world = this.world
    if (!world) {
      fragment.append(textElement('p', '展厅尚未加载。'))
      this.guideContent.replaceChildren(fragment)
      return
    }
    const discovered = new Set(this.state.discoveredExhibits)
    const total = this.catalog.exhibits.length
    fragment.append(
      textElement('p', `已发现 ${discovered.size} / ${total} 件展品，到访 ${this.state.visitedScenes.length} / ${world.scenes.length} 个空间。`, 'guide-summary'),
    )
    const list = document.createElement('ol')
    list.className = 'guide-route'
    for (const scene of world.scenes) {
      const unlocked =
        scene.id !== 'memory-vault' ||
        this.state.flags['collection:complete'] === true ||
        this.state.visitedScenes.includes(scene.id)
      const item = document.createElement('li')
      if (scene.id === this.currentScene?.id) item.classList.add('is-current')
      if (this.state.visitedScenes.includes(scene.id)) item.classList.add('is-visited')
      const sceneExhibitIds = scene.exhibits.map((placement) => placement.exhibitId)
      const sceneDiscovered = sceneExhibitIds.filter((id) => discovered.has(id)).length
      item.append(
        textElement('strong', unlocked ? scene.title : '？？？隐藏空间'),
        textElement(
          'span',
          unlocked
            ? `展品 ${sceneDiscovered}/${sceneExhibitIds.length}${scene.collectibles.length ? ` · 记忆碎片 ${scene.collectibles.filter((collectible) => this.collected.has(collectible.id)).length}/${scene.collectibles.length}` : ''}`
            : '集齐五枚记忆碎片后再来调查历史档案馆。',
        ),
      )
      list.append(item)
    }
    fragment.append(list)

    if (discovered.size >= total && total > 0) {
      this.state = setFlag(this.state, 'tour:complete')
      saveMuseumState(this.storage, this.state)
      fragment.append(
        textElement(
          'p',
          '你已经读完全部展牌。回到入口大厅时，匿名访客仍然匿名，但背包里多了二十四段社区记忆。馆员说这很正常。',
          'completion-note',
        ),
      )
    } else {
      const nextScene = world.scenes.find(
        (scene) =>
          scene.id !== 'memory-vault' &&
          scene.exhibits.some((placement) => !discovered.has(placement.exhibitId)),
      )
      if (nextScene) {
        fragment.append(textElement('p', `推荐下一站：${nextScene.title}。导览只给方向，不会替你瞬移。`))
      }
    }
    this.guideContent.replaceChildren(fragment)
  }

  private renderCollection(): void {
    const fragment = document.createDocumentFragment()
    const collectibles =
      this.world?.scenes.flatMap((scene) =>
        scene.collectibles.map((collectible) => ({ collectible, scene })),
      ) ?? []
    fragment.append(textElement('h3', '记忆碎片'))
    const shards = document.createElement('ul')
    shards.className = 'collection-list'
    for (const { collectible, scene } of collectibles) {
      const found = this.collected.has(collectible.id)
      shards.append(
        textElement(
          'li',
          `${found ? '◆' : '◇'} ${found ? collectible.label ?? '记忆碎片' : '尚未发现'} · ${scene.title}`,
          found ? 'is-found' : 'is-missing',
        ),
      )
    }
    fragment.append(shards)
    if (this.state.flags['collection:complete']) {
      fragment.append(
        textElement('p', '五枚碎片已经共鸣：历史档案馆里那面奇怪的墙应该有变化了。', 'completion-note'),
      )
    }

    fragment.append(textElement('h3', `收藏的展品（${this.state.favorites.length}）`))
    if (this.state.favorites.length === 0) {
      fragment.append(textElement('p', '打开任意展牌，使用“收藏这件展品”即可记在这里。'))
    } else {
      const favorites = document.createElement('ul')
      for (const id of this.state.favorites) {
        const exhibit = this.catalog.exhibits.find((item) => item.id === id)
        if (exhibit) favorites.append(textElement('li', exhibit.name))
      }
      fragment.append(favorites)
    }

    const easterEggs = [
      ['terminal:spark', '终端微光'],
      ['easter:memory-vault', '记忆密室'],
      ['interactions:complete', '互动观察家'],
    ] as const
    fragment.append(textElement('h3', '彩蛋记录'))
    const eggs = document.createElement('ul')
    for (const [flag, label] of easterEggs) {
      eggs.append(textElement('li', `${this.state.flags[flag] ? '✓' : '·'} ${this.state.flags[flag] ? label : '尚未发现'}`))
    }
    fragment.append(eggs)
    this.collectionContent.replaceChildren(fragment)
  }

  private renderArtbook(focusAssetId?: string): void {
    const preferred = ['museum-concept-ac', 'museum-concept-c', 'museum-concept-a', 'museum-memory-shard']
    const records = preferred
      .map((id) => this.assets.assets.find((asset) => asset.key === id || asset.id === id))
      .filter((asset): asset is AssetRecord => Boolean(asset))
    const visible = focusAssetId
      ? records.filter((asset) => asset.key === focusAssetId || asset.id === focusAssetId)
      : records
    const fragment = document.createDocumentFragment()
    fragment.append(
      textElement(
        'p',
        'A 是温暖怀旧，C 是明亮校园，AC 负责让两者在同一屋檐下相处。概念图不是不可碰撞的地图背景，而是场景色板、家具和光照的设计依据。',
      ),
    )
    const gallery = document.createElement('div')
    gallery.className = 'artbook-grid'
    for (const asset of visible) {
      const figure = document.createElement('figure')
      const image = document.createElement('img')
      image.src = assetPublicUrl(asset)
      image.alt = asset.alt ?? '博物馆视觉档案'
      image.loading = 'lazy'
      const caption = textElement('figcaption', `${asset.alt ?? asset.key} · ${assetAttribution(asset)}`)
      figure.append(image, caption)
      gallery.append(figure)
    }
    fragment.append(gallery)

    const credits = document.createElement('details')
    const summary = textElement('summary', `完整运行时素材署名（${this.assets.assets.length} 项）`)
    const list = document.createElement('ul')
    for (const asset of this.assets.assets) {
      list.append(textElement('li', `${asset.alt ?? asset.key} — ${assetAttribution(asset)}`))
    }
    credits.append(summary, list)
    fragment.append(credits)
    this.artbookContent.replaceChildren(fragment)
  }

  private dialogs(): HTMLDialogElement[] {
    return [
      this.exhibitDialog,
      this.guideDialog,
      this.collectionDialog,
      this.artbookDialog,
      this.settingsDialog,
      this.terminalDialog,
      this.helpDialog,
    ]
  }

  private anyDialogOpen(): boolean {
    return this.dialogs().some((dialog) => dialog.open)
  }

  private openDialog(dialog: HTMLDialogElement): void {
    if (dialog.open) return
    this.scene?.setInputEnabled(false)
    dialog.showModal()
    requestAnimationFrame(() => {
      const focusTarget =
        dialog === this.terminalDialog
          ? this.terminalInput
          : dialog.querySelector<HTMLElement>('.dialog-close, button, a, input')
      focusTarget?.focus()
    })
  }

  private onDialogClosed(): void {
    if (!this.anyDialogOpen()) {
      this.scene?.setInputEnabled(true)
      restoreMuseumStageFocus(this.stage)
    }
  }

  private openTerminal(): void {
    if (!this.terminalStarted) {
      this.writeTerminal('AWESOME CC98 MUSEUM TERMINAL / M3')
      this.writeTerminal('输入 help 查看可用指令。')
      this.terminalStarted = true
    }
    void this.audio.play('terminal')
    this.openDialog(this.terminalDialog)
  }

  private installTerminal(): void {
    const form = element<HTMLFormElement>('terminal-form')
    this.terminalInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        form.requestSubmit()
      }
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const command = this.terminalInput.value.trim().toLowerCase()
      this.terminalInput.value = ''
      if (!command) return
      this.writeTerminal(`> ${command}`, 'command')
      if (command === 'help') {
        this.writeTerminal('help · status · whoami · route · spark · clear · close')
      } else if (command === 'status') {
        this.writeTerminal(
          `场景：${this.currentScene?.title ?? '尚未入馆'} / 收藏：${this.collected.size}/${this.totalCollectibles()}`,
        )
      } else if (command === 'whoami') {
        this.writeTerminal('anonymous-visitor / 本地访客 / 不绑定 CC98 身份')
      } else if (command === 'route') {
        const next = this.world?.scenes.find(
          (scene) =>
            scene.id !== 'memory-vault' &&
            scene.exhibits.some(
              (placement) => !this.state.discoveredExhibits.includes(placement.exhibitId),
            ),
        )
        this.writeTerminal(next ? `推荐下一站：${next.title}` : '常规展牌已经全部读完。')
      } else if (command === 'spark') {
        const wasUnlocked = this.state.flags['terminal:spark'] === true
        this.state = setFlag(this.state, 'terminal:spark')
        saveMuseumState(this.storage, this.state)
        document.documentElement.dataset.easter = 'spark'
        void this.audio.play('secret')
        this.writeTerminal(wasUnlocked ? '微光已经在展厅里。' : '彩蛋信标已点亮。留意展厅边缘的微光。')
      } else if (command === 'clear') {
        this.terminalOutput.replaceChildren()
      } else if (command === 'close' || command === 'exit') {
        this.terminalDialog.close()
      } else {
        this.writeTerminal(`未知指令：${command}。输入 help 查看提示。`, 'error')
      }
    })
  }

  private writeTerminal(text: string, kind?: string): void {
    const line = textElement('p', text)
    if (kind) line.dataset.kind = kind
    this.terminalOutput.append(line)
    this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight
  }

  private installTouchControls(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('[data-direction]')
    for (const button of buttons) {
      const direction = button.dataset.direction as 'up' | 'down' | 'left' | 'right'
      const release = () => this.scene?.setVirtualDirection(direction, false)
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        button.setPointerCapture(event.pointerId)
        this.scene?.setVirtualDirection(direction, true)
      })
      button.addEventListener('pointerup', release)
      button.addEventListener('pointercancel', release)
      button.addEventListener('lostpointercapture', release)
      button.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') this.scene?.setVirtualDirection(direction, true)
      })
      button.addEventListener('keyup', release)
    }
  }

  private installSettings(): void {
    const muted = element<HTMLInputElement>('setting-muted')
    const volume = element<HTMLInputElement>('setting-volume')
    const reducedMotion = element<HTMLInputElement>('setting-reduced-motion')
    const highContrast = element<HTMLInputElement>('setting-high-contrast')
    const performanceMode = element<HTMLInputElement>('setting-performance')
    muted.addEventListener('change', () => this.changeSettings({ muted: muted.checked }))
    volume.addEventListener('input', () =>
      this.changeSettings({ volume: Number(volume.value) / 100 }, false),
    )
    reducedMotion.addEventListener('change', () =>
      this.changeSettings({ reducedMotion: reducedMotion.checked }),
    )
    highContrast.addEventListener('change', () =>
      this.changeSettings({ highContrast: highContrast.checked }),
    )
    performanceMode.addEventListener('change', () =>
      this.changeSettings({ performanceMode: performanceMode.checked }),
    )
  }

  private changeSettings(
    patch: Parameters<typeof updateSettings>[1],
    refreshScene = true,
  ): void {
    this.state = updateSettings(this.state, patch)
    saveMuseumState(this.storage, this.state)
    this.applyPersistentState()
    if (refreshScene && ('reducedMotion' in patch || 'highContrast' in patch || 'performanceMode' in patch)) {
      this.scene?.refreshVisuals()
    }
  }

  private syncSettingsControls(): void {
    element<HTMLInputElement>('setting-muted').checked = this.state.settings.muted
    const volume = element<HTMLInputElement>('setting-volume')
    volume.value = String(Math.round(this.state.settings.volume * 100))
    element<HTMLOutputElement>('setting-volume-output').value = `${volume.value}%`
    element<HTMLInputElement>('setting-reduced-motion').checked = this.state.settings.reducedMotion
    element<HTMLInputElement>('setting-high-contrast').checked = this.state.settings.highContrast
    element<HTMLInputElement>('setting-performance').checked = this.state.settings.performanceMode
  }

  private applyPersistentState(): void {
    if (this.game) this.game.sound.mute = this.state.settings.muted
    this.audio.setMuted(this.state.settings.muted)
    this.audio.setVolume(this.state.settings.volume)
    document.documentElement.toggleAttribute('data-reduced-motion', this.state.settings.reducedMotion)
    document.documentElement.toggleAttribute('data-high-contrast', this.state.settings.highContrast)
    document.documentElement.toggleAttribute('data-performance', this.state.settings.performanceMode)
    this.syncSettingsControls()
    if (this.state.flags['terminal:spark']) document.documentElement.dataset.easter = 'spark'
  }

  private resetProgress(): void {
    const confirmed = window.confirm('清除本机保存的参观、收藏、彩蛋和设置？此操作无法撤销。')
    if (!confirmed) return
    this.state = resetMuseumState(this.storage)
    this.collected = new Set()
    delete document.documentElement.dataset.easter
    this.applyPersistentState()
    this.updateProgress()
    if (this.currentScene) this.scene?.showScene(this.currentScene.id, this.currentScene.spawn)
    this.toast('本地参观进度已清除。')
  }

  private exhibitBadge(exhibitId: string): string {
    const exhibit = this.catalog.exhibits.find((item) => item.id === exhibitId)
    const platform = (
      exhibit?.platforms?.released?.[0]?.id ??
      exhibit?.platforms?.claimed?.[0]?.id ??
      ''
    ).toLowerCase()
    if (platform.includes('harmony')) return 'HM'
    if (platform.includes('android')) return 'AND'
    if (platform.includes('ios')) return 'iOS'
    if (platform.includes('windows')) return 'WIN'
    if (platform.includes('terminal') || exhibitId.includes('cli')) return 'CLI'
    if (platform.includes('chrome') || platform.includes('edge') || platform.includes('firefox')) return 'EXT'
    if (platform.includes('pwa')) return 'PWA'
    return 'WEB'
  }

  private totalCollectibles(): number {
    return new Set(this.world?.scenes.flatMap((scene) => scene.collectibles.map((item) => item.id)) ?? [])
      .size
  }

  private updateProgress(): void {
    const ids = new Set(this.world?.scenes.flatMap((scene) => scene.collectibles.map((item) => item.id)) ?? [])
    const collectedCount = [...ids].filter((id) => this.collected.has(id)).length
    const exhibitIds = new Set(this.catalog.exhibits.map((exhibit) => exhibit.id))
    const discoveredCount = this.state.discoveredExhibits.filter((id) => exhibitIds.has(id)).length
    this.progressLabel.textContent = `发现 ${discoveredCount} / ${exhibitIds.size} · 碎片 ${collectedCount} / ${ids.size}`
    if (ids.size > 0 && collectedCount === ids.size && !this.state.flags['collection:complete']) {
      this.state = setFlag(this.state, 'collection:complete')
      saveMuseumState(this.storage, this.state)
      void this.audio.play('secret')
      this.scene?.refreshVisuals()
    }
  }

  private toast(message: string, duration = 3200): void {
    if (this.toastTimer) window.clearTimeout(this.toastTimer)
    this.toastNode.textContent = message
    this.toastNode.hidden = false
    this.toastTimer = window.setTimeout(() => {
      this.toastNode.hidden = true
    }, duration)
  }
}

const application = new MuseumApplication()
void application.load()
