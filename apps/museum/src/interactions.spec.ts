import { describe, expect, it, vi } from 'vitest'
import {
  EXHIBIT_INTERACTION_TITLES,
  EXHIBIT_INTERACTION_TYPES,
  createInteractionViewModel,
  createOnceCallback,
  reduceTerminalCommand,
  type InteractionControlKind,
  type TerminalModelState,
} from './interactions'
import type { Exhibit } from './types'

const exhibit: Exhibit = {
  id: 'local-sample',
  name: 'Local Sample',
  tagline: '用于测试的本地展品描述',
  features: [{ title: '键盘导航' }, { title: '本地渲染' }],
  platforms: {
    claimed: [{ id: 'web' }],
    released: [],
  },
  lifecycle: {
    stage: 'active',
    maintenance: 'maintained',
  },
}

describe('exhibit interaction view models', () => {
  it.each(EXHIBIT_INTERACTION_TYPES)('creates the %s interaction without a browser DOM', (type) => {
    expect(typeof document).toBe('undefined')
    const model = createInteractionViewModel(exhibit, type)
    expect(model).toMatchObject({
      type,
      title: EXHIBIT_INTERACTION_TITLES[type],
      exhibitName: exhibit.name,
    })
    expect(model.facts).toContain('键盘导航')
    expect(model.controlKinds).toContain('button')
  })

  it('declares native keyboard-operable controls for all seven variants', () => {
    const usedControls = new Set<InteractionControlKind>()
    for (const type of EXHIBIT_INTERACTION_TYPES) {
      const model = createInteractionViewModel(exhibit, type)
      expect(model.controlKinds.length).toBeGreaterThan(0)
      model.controlKinds.forEach((control) => usedControls.add(control))
    }
    expect(usedControls).toEqual(new Set(['button', 'range', 'select', 'input']))
  })

  it('falls back to a neutral local description when catalog details are sparse', () => {
    const model = createInteractionViewModel({ id: 'empty', name: 'Empty' }, 'device')
    expect(model.intro).toContain('不会加载或执行第三方代码')
    expect(model.facts).toEqual(['目录暂未记录更多可展示信息。'])
  })
})

describe('interaction reducers', () => {
  it('reduces terminal commands without evaluating arbitrary input', () => {
    const model = createInteractionViewModel(exhibit, 'terminal')
    const initial: TerminalModelState = { lines: [], shouldComplete: false }
    const unknown = reduceTerminalCommand(initial, 'globalThis.hacked = true', model)
    expect(unknown.lines.at(-1)).toBe('未知指令：globalthis.hacked = true')
    expect(unknown.shouldComplete).toBe(false)

    const facts = reduceTerminalCommand(unknown, 'facts', model)
    expect(facts.lines).toContain('本地渲染')
    const completed = reduceTerminalCommand(facts, 'complete', model)
    expect(completed.shouldComplete).toBe(true)
  })

  it('fires completion callbacks only once', () => {
    const callback = vi.fn()
    const complete = createOnceCallback(callback)
    expect(complete()).toBe(true)
    expect(complete()).toBe(false)
    expect(complete()).toBe(false)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
