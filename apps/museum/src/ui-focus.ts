export interface FocusableMuseumStage {
  focus(options?: FocusOptions): void
}

export function restoreMuseumStageFocus(stage: FocusableMuseumStage): void {
  stage.focus({ preventScroll: true })
}
