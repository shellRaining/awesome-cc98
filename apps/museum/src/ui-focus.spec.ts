import { describe, expect, it, vi } from 'vitest'
import { restoreMuseumStageFocus, type FocusableMuseumStage } from './ui-focus'

describe('dialog focus restoration', () => {
  it('returns focus to the museum stage without scrolling', () => {
    const focus = vi.fn()
    const stage: FocusableMuseumStage = { focus }

    restoreMuseumStageFocus(stage)

    expect(focus).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
