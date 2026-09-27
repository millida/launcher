import { create } from 'zustand'
import type { AiPreset } from '../lib/aiBuilder'

interface AiBuilderLaunch {
  open: boolean
  preset: AiPreset | null
  /** Bumped on every outside open so the panel starts a fresh plan for the new preset. */
  seq: number
}

export const useAiBuilder = create<AiBuilderLaunch>(() => ({ open: false, preset: null, seq: 0 }))

export function openAiBuilder(preset: AiPreset | null = null) {
  useAiBuilder.setState((s) => ({ open: true, preset, seq: s.seq + 1 }))
}

export function closeAiBuilder() {
  useAiBuilder.setState({ open: false, preset: null })
}
