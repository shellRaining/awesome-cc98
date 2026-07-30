import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUDIO_VOLUME,
  MuseumAudioController,
  clampAudioVolume,
  resolveAudioContextConstructor,
  scheduleMuseumSound,
  type AudioContextConstructor,
  type MuseumSoundEvent,
} from './audio'

interface ParamEvent {
  method: 'set' | 'linear'
  value: number
  time: number
}

class FakeAudioParam {
  events: ParamEvent[] = []

  setValueAtTime(value: number, time: number) {
    this.events.push({ method: 'set', value, time })
    return this
  }

  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ method: 'linear', value, time })
    return this
  }
}

class FakeOscillator {
  type: OscillatorType = 'sine'
  frequency = new FakeAudioParam()
  connectedTo: unknown
  starts: number[] = []
  stops: number[] = []

  connect(target: unknown) {
    this.connectedTo = target
    return target
  }

  start(time: number) {
    this.starts.push(time)
  }

  stop(time: number) {
    this.stops.push(time)
  }
}

class FakeGain {
  gain = new FakeAudioParam()
  connectedTo: unknown

  connect(target: unknown) {
    this.connectedTo = target
    return target
  }
}

class FakeAudioContext {
  currentTime = 4
  state: AudioContextState = 'running'
  destination = { kind: 'destination' }
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  resumeCalls = 0

  createOscillator() {
    const oscillator = new FakeOscillator()
    this.oscillators.push(oscillator)
    return oscillator
  }

  createGain() {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }

  async resume() {
    this.resumeCalls += 1
    this.state = 'running'
  }
}

function asAudioContext(context: FakeAudioContext): AudioContext {
  return context as unknown as AudioContext
}

describe('programmatic museum audio', () => {
  it('builds deterministic note and envelope schedules for every event', () => {
    const events: MuseumSoundEvent[] = ['open', 'portal', 'collect', 'secret', 'terminal']
    for (const event of events) {
      const first = scheduleMuseumSound(event, 10, 0.5)
      const second = scheduleMuseumSound(event, 10, 0.5)
      expect(first).toEqual(second)
      expect(first.length).toBeGreaterThan(0)
      for (const tone of first) {
        expect(tone.startTime).toBeGreaterThanOrEqual(10)
        expect(tone.attackEndTime).toBeGreaterThanOrEqual(tone.startTime)
        expect(tone.releaseStartTime).toBeGreaterThanOrEqual(tone.attackEndTime)
        expect(tone.endTime).toBeGreaterThan(tone.releaseStartTime)
        expect(tone.startFrequency).toBeGreaterThan(0)
        expect(tone.endFrequency).toBeGreaterThan(0)
        expect(tone.peakGain).toBeGreaterThanOrEqual(0)
        expect(tone.peakGain).toBeLessThanOrEqual(0.5)
      }
    }
  })

  it('clamps master volume and invalid schedule origins', () => {
    expect(clampAudioVolume(-1)).toBe(0)
    expect(clampAudioVolume(0.4)).toBe(0.4)
    expect(clampAudioVolume(2)).toBe(1)
    expect(clampAudioVolume(Number.NaN)).toBe(0)
    expect(scheduleMuseumSound('open', 2, 4)).toEqual(scheduleMuseumSound('open', 2, 1))
    expect(scheduleMuseumSound('open', 2, -1).every((tone) => tone.peakGain === 0)).toBe(true)
    expect(scheduleMuseumSound('open', Number.NaN, 1)[0]?.startTime).toBe(0)
  })

  it('prefers AudioContext and falls back to webkitAudioContext', () => {
    const standard = class {} as unknown as AudioContextConstructor
    const webkit = class {} as unknown as AudioContextConstructor
    expect(resolveAudioContextConstructor({ AudioContext: standard, webkitAudioContext: webkit })).toBe(
      standard,
    )
    expect(resolveAudioContextConstructor({ webkitAudioContext: webkit })).toBe(webkit)
    expect(resolveAudioContextConstructor({})).toBeUndefined()
  })

  it('creates AudioContext lazily only for audible playback', async () => {
    const context = new FakeAudioContext()
    let factoryCalls = 0
    const audio = new MuseumAudioController({
      muted: true,
      volume: 1,
      contextFactory: () => {
        factoryCalls += 1
        return asAudioContext(context)
      },
    })

    expect(factoryCalls).toBe(0)
    await audio.play('open')
    expect(factoryCalls).toBe(0)
    audio.setMuted(false)
    audio.setVolume(0)
    await audio.play('portal')
    expect(factoryCalls).toBe(0)
    audio.setVolume(0.5)
    await audio.play('collect')
    expect(factoryCalls).toBe(1)
    await audio.play('terminal')
    expect(factoryCalls).toBe(1)
  })

  it('maps a pure schedule onto oscillators and gain envelopes', async () => {
    const context = new FakeAudioContext()
    context.currentTime = 8
    context.state = 'suspended'
    const audio = new MuseumAudioController({
      volume: 0.5,
      contextFactory: () => asAudioContext(context),
    })

    await audio.play('portal')
    const expected = scheduleMuseumSound('portal', 8.01, 0.5)
    expect(context.resumeCalls).toBe(1)
    expect(context.oscillators).toHaveLength(expected.length)
    expect(context.gains).toHaveLength(expected.length)

    expected.forEach((tone, index) => {
      const oscillator = context.oscillators[index]
      const gain = context.gains[index]
      expect(oscillator?.type).toBe(tone.waveform)
      expect(oscillator?.frequency.events).toEqual(
        tone.startFrequency === tone.endFrequency
          ? [{ method: 'set', value: tone.startFrequency, time: tone.startTime }]
          : [
              { method: 'set', value: tone.startFrequency, time: tone.startTime },
              { method: 'linear', value: tone.endFrequency, time: tone.endTime },
            ],
      )
      expect(gain?.gain.events).toEqual([
        { method: 'set', value: 0, time: tone.startTime },
        { method: 'linear', value: tone.peakGain, time: tone.attackEndTime },
        { method: 'set', value: tone.peakGain, time: tone.releaseStartTime },
        { method: 'linear', value: 0, time: tone.endTime },
      ])
      expect(oscillator?.connectedTo).toBe(gain)
      expect(gain?.connectedTo).toBe(context.destination)
      expect(oscillator?.starts).toEqual([tone.startTime])
      expect(oscillator?.stops).toEqual([tone.endTime])
    })
  })

  it('updates muted and volume settings with safe bounds', () => {
    expect(new MuseumAudioController().volume).toBe(DEFAULT_AUDIO_VOLUME)
    const audio = new MuseumAudioController({ muted: false, volume: 2 })
    expect(audio.muted).toBe(false)
    expect(audio.volume).toBe(1)
    audio.setMuted(true)
    audio.setVolume(-0.2)
    expect(audio.muted).toBe(true)
    expect(audio.volume).toBe(0)
    audio.setVolume(Number.NaN)
    expect(audio.volume).toBe(0)
  })

  it('silently degrades when Web Audio creation fails', async () => {
    let factoryCalls = 0
    const audio = new MuseumAudioController({
      contextFactory: () => {
        factoryCalls += 1
        throw new Error('Web Audio unavailable')
      },
    })

    await expect(audio.play('open')).resolves.toBeUndefined()
    await expect(audio.play('secret')).resolves.toBeUndefined()
    expect(factoryCalls).toBe(1)
  })
})
