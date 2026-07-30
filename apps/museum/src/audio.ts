export type MuseumSoundEvent = 'open' | 'portal' | 'collect' | 'secret' | 'terminal'
export const DEFAULT_AUDIO_VOLUME = 0.65

export interface ScheduledMuseumTone {
  waveform: OscillatorType
  startFrequency: number
  endFrequency: number
  startTime: number
  attackEndTime: number
  releaseStartTime: number
  endTime: number
  peakGain: number
}

export interface MuseumAudioOptions {
  muted?: boolean
  volume?: number
  contextFactory?: AudioContextFactory
}

export type AudioContextFactory = () => AudioContext | null
export type AudioContextConstructor = new () => AudioContext

export interface AudioContextScope {
  AudioContext?: AudioContextConstructor
  webkitAudioContext?: AudioContextConstructor
}

interface TonePattern {
  waveform: OscillatorType
  frequency: number
  endFrequency?: number
  offset: number
  duration: number
  attack: number
  release: number
  gain: number
}

const patterns: Record<MuseumSoundEvent, readonly TonePattern[]> = {
  open: [
    { waveform: 'sine', frequency: 261.63, offset: 0, duration: 0.5, attack: 0.03, release: 0.28, gain: 0.16 },
    { waveform: 'sine', frequency: 392, offset: 0.08, duration: 0.54, attack: 0.03, release: 0.3, gain: 0.13 },
    { waveform: 'sine', frequency: 523.25, offset: 0.16, duration: 0.58, attack: 0.03, release: 0.34, gain: 0.11 },
  ],
  portal: [
    { waveform: 'sine', frequency: 220, endFrequency: 660, offset: 0, duration: 0.34, attack: 0.02, release: 0.2, gain: 0.15 },
    { waveform: 'triangle', frequency: 330, endFrequency: 990, offset: 0.05, duration: 0.32, attack: 0.015, release: 0.18, gain: 0.08 },
  ],
  collect: [
    { waveform: 'triangle', frequency: 659.25, offset: 0, duration: 0.18, attack: 0.008, release: 0.11, gain: 0.16 },
    { waveform: 'triangle', frequency: 783.99, offset: 0.08, duration: 0.2, attack: 0.008, release: 0.12, gain: 0.14 },
    { waveform: 'sine', frequency: 1046.5, offset: 0.16, duration: 0.28, attack: 0.01, release: 0.2, gain: 0.13 },
  ],
  secret: [
    { waveform: 'sine', frequency: 174.61, offset: 0, duration: 0.72, attack: 0.08, release: 0.42, gain: 0.12 },
    { waveform: 'sine', frequency: 207.65, offset: 0.08, duration: 0.7, attack: 0.08, release: 0.4, gain: 0.1 },
    { waveform: 'sine', frequency: 311.13, offset: 0.16, duration: 0.68, attack: 0.08, release: 0.38, gain: 0.08 },
  ],
  terminal: [
    { waveform: 'square', frequency: 440, offset: 0, duration: 0.1, attack: 0.004, release: 0.055, gain: 0.07 },
    { waveform: 'square', frequency: 554.37, offset: 0.1, duration: 0.1, attack: 0.004, release: 0.055, gain: 0.065 },
    { waveform: 'square', frequency: 659.25, offset: 0.2, duration: 0.1, attack: 0.004, release: 0.055, gain: 0.06 },
    { waveform: 'sine', frequency: 880, offset: 0.3, duration: 0.24, attack: 0.01, release: 0.17, gain: 0.1 },
  ],
}

export function clampAudioVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function scheduleMuseumSound(
  event: MuseumSoundEvent,
  startTime: number,
  volume: number,
): ScheduledMuseumTone[] {
  const origin = Number.isFinite(startTime) ? Math.max(0, startTime) : 0
  const masterGain = clampAudioVolume(volume)
  return patterns[event].map((tone) => {
    const toneStart = origin + tone.offset
    const toneEnd = toneStart + tone.duration
    const attackEnd = Math.min(toneEnd, toneStart + tone.attack)
    const releaseStart = Math.max(attackEnd, toneEnd - tone.release)
    return {
      waveform: tone.waveform,
      startFrequency: tone.frequency,
      endFrequency: tone.endFrequency ?? tone.frequency,
      startTime: toneStart,
      attackEndTime: attackEnd,
      releaseStartTime: releaseStart,
      endTime: toneEnd,
      peakGain: clampAudioVolume(tone.gain * masterGain),
    }
  })
}

export function resolveAudioContextConstructor(
  scope: AudioContextScope = globalThis as unknown as AudioContextScope,
): AudioContextConstructor | undefined {
  return scope.AudioContext ?? scope.webkitAudioContext
}

export function createBrowserAudioContext(): AudioContext | null {
  const AudioContextClass = resolveAudioContextConstructor()
  if (!AudioContextClass) return null
  try {
    return new AudioContextClass()
  } catch {
    return null
  }
}

function applyTone(context: AudioContext, tone: ScheduledMuseumTone): void {
  const oscillator = context.createOscillator()
  const envelope = context.createGain()
  oscillator.type = tone.waveform
  oscillator.frequency.setValueAtTime(tone.startFrequency, tone.startTime)
  if (tone.endFrequency !== tone.startFrequency) {
    oscillator.frequency.linearRampToValueAtTime(tone.endFrequency, tone.endTime)
  }
  envelope.gain.setValueAtTime(0, tone.startTime)
  envelope.gain.linearRampToValueAtTime(tone.peakGain, tone.attackEndTime)
  envelope.gain.setValueAtTime(tone.peakGain, tone.releaseStartTime)
  envelope.gain.linearRampToValueAtTime(0, tone.endTime)
  oscillator.connect(envelope)
  envelope.connect(context.destination)
  oscillator.start(tone.startTime)
  oscillator.stop(tone.endTime)
}

export class MuseumAudioController {
  private context: AudioContext | null | undefined
  private readonly contextFactory: AudioContextFactory
  private mutedValue: boolean
  private volumeValue: number

  constructor(options: MuseumAudioOptions = {}) {
    this.mutedValue = options.muted === true
    this.volumeValue = clampAudioVolume(options.volume ?? DEFAULT_AUDIO_VOLUME)
    this.contextFactory = options.contextFactory ?? createBrowserAudioContext
  }

  get muted(): boolean {
    return this.mutedValue
  }

  get volume(): number {
    return this.volumeValue
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted
  }

  setVolume(volume: number): void {
    this.volumeValue = clampAudioVolume(volume)
  }

  async play(event: MuseumSoundEvent): Promise<void> {
    if (this.mutedValue || this.volumeValue === 0) return
    const context = this.getOrCreateContext()
    if (!context || context.state === 'closed') return

    try {
      if (context.state !== 'running') await context.resume()
      const tones = scheduleMuseumSound(event, context.currentTime + 0.01, this.volumeValue)
      for (const tone of tones) applyTone(context, tone)
    } catch {
      // Audio may be blocked by the browser; museum interaction must continue silently.
    }
  }

  private getOrCreateContext(): AudioContext | null {
    if (this.context !== undefined) return this.context
    try {
      this.context = this.contextFactory()
    } catch {
      this.context = null
    }
    return this.context
  }
}
