import type { Plugin } from 'vite'

export const DEV_MODELS_PATH: string
export function modelFiles(id: string): string[]
export function devCosmeticModels(): Plugin
