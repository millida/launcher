export const NATIVE_GAME_VERSION = 'native'
export const NATIVE_LOADER = 'custom'

export const NATIVE_NEEDS_MILLIDA = 'Эта игра запускается только с аккаунтом Millida: войди в Millida и нажми «Играть» ещё раз'

type Build = { version?: string | null; loader?: string | null }

/** A catalogue game that is not Minecraft: no Minecraft version, loader, servers or mods apply to it. */
export const isNativeGame = (p: Build | null | undefined): boolean =>
  !!p && p.version === NATIVE_GAME_VERSION && p.loader === NATIVE_LOADER
