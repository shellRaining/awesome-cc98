import type { Exhibit } from './types'

export const EXHIBIT_INTERACTION_TYPES = [
  'device',
  'interface',
  'compare',
  'terminal',
  'code',
  'timeline',
  'filter',
] as const

export type ExhibitInteractionType = (typeof EXHIBIT_INTERACTION_TYPES)[number]

export const EXHIBIT_INTERACTION_TITLES = {
  device: '设备体验台',
  interface: '界面探索器',
  compare: '设计对照台',
  terminal: '命令终端',
  code: '代码观察窗',
  timeline: '时间档案轴',
  filter: '特征筛选器',
} as const satisfies Record<ExhibitInteractionType, string>

export type InteractionControlKind = 'button' | 'range' | 'select' | 'input'

export interface InteractionViewModel {
  type: ExhibitInteractionType
  title: string
  exhibitName: string
  intro: string
  facts: readonly string[]
  controlKinds: readonly InteractionControlKind[]
}

export interface TerminalModelState {
  readonly lines: readonly string[]
  readonly shouldComplete: boolean
}

const CONTROL_KINDS: Record<ExhibitInteractionType, readonly InteractionControlKind[]> = {
  device: ['button', 'range'],
  interface: ['button', 'select'],
  compare: ['button', 'range', 'select'],
  terminal: ['button', 'input'],
  code: ['button', 'select'],
  timeline: ['button', 'range'],
  filter: ['button', 'range', 'select', 'input'],
}

let interactionSequence = 0

function compactStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
}

function exhibitFacts(exhibit: Exhibit): string[] {
  const platforms = [
    ...(exhibit.platforms?.released ?? []),
    ...(exhibit.platforms?.claimed ?? []),
  ].map((platform) => platform.id)
  return compactStrings([
    exhibit.tagline,
    ...(exhibit.features ?? []).map((feature) => feature.title),
    ...platforms.map((platform) => `平台：${platform}`),
    exhibit.lifecycle?.stage ? `阶段：${exhibit.lifecycle.stage}` : undefined,
    exhibit.lifecycle?.maintenance ? `维护：${exhibit.lifecycle.maintenance}` : undefined,
  ])
}

export function createInteractionViewModel(
  exhibit: Exhibit,
  type: ExhibitInteractionType,
): InteractionViewModel {
  const facts = exhibitFacts(exhibit)
  return {
    type,
    title: EXHIBIT_INTERACTION_TITLES[type],
    exhibitName: exhibit.name,
    intro:
      exhibit.tagline ??
      `这是一个围绕「${exhibit.name}」生成的本地模拟互动，不会加载或执行第三方代码。`,
    facts: facts.length > 0 ? facts : ['目录暂未记录更多可展示信息。'],
    controlKinds: CONTROL_KINDS[type],
  }
}

export function reduceTerminalCommand(
  state: TerminalModelState,
  commandInput: string,
  model: InteractionViewModel,
): TerminalModelState {
  const command = commandInput.trim().toLowerCase()
  if (!command) return state
  if (command === 'help') {
    return { ...state, lines: [...state.lines, 'help · name · facts · complete'] }
  }
  if (command === 'name') {
    return { ...state, lines: [...state.lines, model.exhibitName] }
  }
  if (command === 'facts') {
    return { ...state, lines: [...state.lines, ...model.facts] }
  }
  if (command === 'complete') {
    return {
      lines: [...state.lines, '互动记录已完成。'],
      shouldComplete: true,
    }
  }
  return {
    ...state,
    lines: [...state.lines, `未知指令：${command}`],
  }
}

export function createOnceCallback(onComplete: () => void): () => boolean {
  let completed = false
  return () => {
    if (completed) return false
    completed = true
    onComplete()
    return true
  }
}

function node<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
}

function labeledControl<T extends HTMLElement>(
  id: string,
  labelText: string,
  control: T,
): HTMLDivElement {
  const wrapper = node('div', undefined, 'interaction-field')
  const label = node('label', labelText)
  label.htmlFor = id
  control.id = id
  wrapper.append(label, control)
  return wrapper
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const control = node('button', label, 'pixel-button')
  control.type = 'button'
  control.addEventListener('click', onClick)
  return control
}

function option(value: string, label = value): HTMLOptionElement {
  const item = node('option', label)
  item.value = value
  return item
}

function replaceStatus(status: HTMLElement, text: string): void {
  status.textContent = text
}

function renderDevice(
  body: HTMLElement,
  model: InteractionViewModel,
  id: string,
  status: HTMLElement,
): void {
  const preview = node('div', model.exhibitName, 'interaction-device-preview')
  preview.dataset.orientation = 'portrait'
  const width = node('input')
  width.type = 'range'
  width.min = '320'
  width.max = '1024'
  width.step = '16'
  width.value = '480'
  width.addEventListener('input', () => {
    preview.style.setProperty('--preview-width', `${width.value}px`)
    replaceStatus(status, `模拟视口：${width.value} px`)
  })
  const rotate = button('切换横竖屏', () => {
    const next = preview.dataset.orientation === 'portrait' ? 'landscape' : 'portrait'
    preview.dataset.orientation = next
    replaceStatus(status, next === 'portrait' ? '已切换为竖屏模拟。' : '已切换为横屏模拟。')
  })
  body.append(preview, labeledControl(`${id}-width`, '模拟视口宽度', width), rotate)
}

function renderInterface(
  body: HTMLElement,
  model: InteractionViewModel,
  id: string,
  status: HTMLElement,
): void {
  const panel = node('p', model.facts[0], 'interaction-preview-copy')
  const view = node('select')
  view.append(option('overview', '概览'), option('details', '详情'), option('settings', '设置'))
  const apply = button('打开所选界面', () => {
    const index = view.selectedIndex % model.facts.length
    panel.textContent = model.facts[index] ?? ''
    replaceStatus(status, `已打开${view.selectedOptions[0]?.textContent ?? '界面'}模拟。`)
  })
  body.append(panel, labeledControl(`${id}-view`, '界面区域', view), apply)
}

function renderCompare(
  body: HTMLElement,
  model: InteractionViewModel,
  id: string,
  status: HTMLElement,
): void {
  const criterion = node('select')
  criterion.append(
    option('density', '信息密度'),
    option('path', '交互路径'),
    option('accessibility', '可访问性'),
  )
  const split = node('input')
  split.type = 'range'
  split.min = '0'
  split.max = '100'
  split.value = '50'
  split.addEventListener('input', () => replaceStatus(status, `对照分割：${split.value}%`))
  const compare = button('生成本地对照', () => {
    const label = criterion.selectedOptions[0]?.textContent ?? '当前维度'
    replaceStatus(status, `${label}模拟已生成；结果仅用于界面体验，不代表项目评价。`)
  })
  body.append(
    labeledControl(`${id}-criterion`, '对照维度', criterion),
    labeledControl(`${id}-split`, '对照分割位置', split),
    node('p', model.facts[0]),
    compare,
  )
}

function renderTerminal(
  body: HTMLElement,
  model: InteractionViewModel,
  id: string,
  status: HTMLElement,
  complete: () => boolean,
): void {
  let terminalState: TerminalModelState = {
    lines: ['本地只读终端。输入 help 查看指令。'],
    shouldComplete: false,
  }
  const output = node('div', terminalState.lines[0], 'interaction-terminal-output')
  output.setAttribute('role', 'log')
  output.setAttribute('aria-live', 'polite')
  const form = node('form', undefined, 'interaction-terminal-form')
  const input = node('input')
  input.type = 'text'
  input.autocomplete = 'off'
  input.spellcheck = false
  const submit = node('button', '运行', 'pixel-button')
  submit.type = 'submit'
  form.append(labeledControl(`${id}-command`, '终端指令', input), submit)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      form.requestSubmit()
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    terminalState = reduceTerminalCommand(terminalState, input.value, model)
    output.replaceChildren(...terminalState.lines.map((line) => node('p', line)))
    input.value = ''
    replaceStatus(status, terminalState.lines.at(-1) ?? '')
    if (terminalState.shouldComplete) complete()
  })
  body.append(output, form)
}

function renderCode(
  body: HTMLElement,
  model: InteractionViewModel,
  id: string,
  status: HTMLElement,
): void {
  const snippets = {
    data: `museum.open({ exhibit: ${JSON.stringify(model.exhibitName)} })`,
    flow: `loadCatalog()\n  -> selectExhibit()\n  -> renderSafePreview()`,
    state: `state = { selected: ${JSON.stringify(model.type)}, executed: false }`,
  }
  const mode = node('select')
  mode.append(option('data', '数据调用'), option('flow', '渲染流程'), option('state', '状态快照'))
  const code = node('code', snippets.data)
  const pre = node('pre')
  pre.append(code)
  const show = button('查看静态片段', () => {
    code.textContent = snippets[mode.value as keyof typeof snippets] ?? snippets.data
    replaceStatus(status, '已更新静态伪代码；不会执行其中内容。')
  })
  body.append(labeledControl(`${id}-code-mode`, '片段类型', mode), pre, show)
}

function renderTimeline(
  body: HTMLElement,
  model: InteractionViewModel,
  id: string,
  status: HTMLElement,
): void {
  const entries = ['目录收录', ...model.facts, '当前档案']
  const selected = node('p', entries[0], 'interaction-preview-copy')
  const range = node('input')
  range.type = 'range'
  range.min = '0'
  range.max = String(entries.length - 1)
  range.step = '1'
  range.value = '0'
  const showEntry = () => {
    selected.textContent = entries[Number(range.value)] ?? entries[0] ?? ''
    replaceStatus(status, `时间轴节点 ${Number(range.value) + 1} / ${entries.length}`)
  }
  range.addEventListener('input', showEntry)
  const next = button('下一节点', () => {
    range.value = String((Number(range.value) + 1) % entries.length)
    showEntry()
  })
  body.append(selected, labeledControl(`${id}-timeline`, '档案时间轴', range), next)
}

function renderFilter(
  body: HTMLElement,
  model: InteractionViewModel,
  id: string,
  status: HTMLElement,
): void {
  const query = node('input')
  query.type = 'search'
  const scope = node('select')
  scope.append(option('all', '全部资料'), option('feature', '功能'), option('meta', '平台与状态'))
  const limit = node('input')
  limit.type = 'range'
  limit.min = '1'
  limit.max = String(Math.max(1, model.facts.length))
  limit.value = String(Math.min(3, model.facts.length))
  const results = node('ul', undefined, 'interaction-filter-results')
  const apply = () => {
    const normalized = query.value.trim().toLocaleLowerCase()
    const matches = model.facts
      .filter((fact) => !normalized || fact.toLocaleLowerCase().includes(normalized))
      .slice(0, Number(limit.value))
    results.replaceChildren(
      ...(matches.length > 0 ? matches.map((fact) => node('li', fact)) : [node('li', '没有匹配项。')]),
    )
    replaceStatus(status, `已显示 ${matches.length} 项本地目录信息（${scope.selectedOptions[0]?.textContent}）。`)
  }
  query.addEventListener('input', apply)
  limit.addEventListener('input', apply)
  const applyButton = button('应用筛选', apply)
  body.append(
    labeledControl(`${id}-query`, '搜索目录信息', query),
    labeledControl(`${id}-scope`, '筛选范围', scope),
    labeledControl(`${id}-limit`, '最多显示条数', limit),
    results,
    applyButton,
  )
  apply()
}

export function buildExhibitInteraction(
  exhibit: Exhibit,
  type: ExhibitInteractionType,
  onComplete: () => void,
): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('buildExhibitInteraction 需要浏览器 DOM；纯逻辑请使用 createInteractionViewModel。')
  }
  const model = createInteractionViewModel(exhibit, type)
  const id = `exhibit-interaction-${++interactionSequence}`
  const root = node('section', undefined, `exhibit-interaction exhibit-interaction--${type}`)
  const title = node('h3', model.title)
  title.id = `${id}-title`
  root.setAttribute('aria-labelledby', title.id)
  root.dataset.interactionType = type
  const intro = node('p', model.intro, 'interaction-intro')
  const body = node('div', undefined, 'interaction-body')
  const status = node('p', '等待互动。', 'interaction-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const completeOnce = createOnceCallback(onComplete)
  let completeButton: HTMLButtonElement
  const complete = () => {
    const fired = completeOnce()
    if (fired) {
      completeButton.disabled = true
      completeButton.textContent = '互动已完成'
      replaceStatus(status, '互动已记录。')
    }
    return fired
  }

  if (type === 'device') renderDevice(body, model, id, status)
  else if (type === 'interface') renderInterface(body, model, id, status)
  else if (type === 'compare') renderCompare(body, model, id, status)
  else if (type === 'terminal') renderTerminal(body, model, id, status, complete)
  else if (type === 'code') renderCode(body, model, id, status)
  else if (type === 'timeline') renderTimeline(body, model, id, status)
  else renderFilter(body, model, id, status)

  completeButton = button('完成互动', complete)
  completeButton.classList.add('interaction-complete')
  root.append(title, intro, body, status, completeButton)
  return root
}

export const createExhibitInteraction = buildExhibitInteraction
