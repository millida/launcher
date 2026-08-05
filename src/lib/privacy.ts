import { create } from 'zustand'
import { api, hasMillidaAccount } from './api'

/// Приватность профиля — серверная настройка, общая с сайтом: переключатель в
/// лаунчере и на millida.net правят одни и те же поля у текущего пользователя.
/// Договор с группой сайта: GET/PATCH /users/me/privacy, PATCH принимает любой
/// поднабор полей и возвращает полный объект.
const PRIVACY_PATH = '/users/me/privacy'

export interface PrivacySettings {
  /// Посторонние видят, когда игрок заходил последний раз.
  showActivity: boolean
  /// Список друзей открыт в профиле.
  showFriends: boolean
  /// Наигранные часы и статистика по сборкам.
  showPlaytime: boolean
  /// Достижения.
  showAchievements: boolean
  /// Покупки и объявления на Маркете.
  showMarket: boolean
  /// Серверы, на которых игрок играет.
  showServers: boolean
}

export const PRIVACY_FIELDS: (keyof PrivacySettings)[] = [
  'showActivity',
  'showServers',
  'showPlaytime',
  'showFriends',
  'showAchievements',
  'showMarket',
]

/// Старые аккаунты приходят без полей: по умолчанию профиль открыт,
/// скрытие — осознанное действие пользователя.
const DEFAULTS: PrivacySettings = {
  showActivity: true,
  showFriends: true,
  showPlaytime: true,
  showAchievements: true,
  showMarket: true,
  showServers: true,
}

function normalize(raw: unknown): PrivacySettings {
  const o = (raw || {}) as Record<string, unknown>
  const out = { ...DEFAULTS }
  for (const k of PRIVACY_FIELDS) if (o[k] !== undefined) out[k] = o[k] !== false
  return out
}

/// Источник правды — сервер. localStorage только зеркало последнего ответа:
/// оно нужно, чтобы до первого GET (или без сети) отправка статистики уже
/// уважала выбор пользователя. Любой ответ сервера перезаписывает зеркало,
/// поэтому переустановка лаунчера настройку не теряет и не подменяет.
const MIRROR_KEY = 'm-privacy'
/// Наследие: до общей приватности часы прятались локальным ключом.
const LEGACY_STATS_KEY = 'm-share-stats'

function readMirror(): PrivacySettings {
  let raw: unknown = null
  try {
    raw = JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null')
  } catch {}
  const base = normalize(raw)
  if (!raw && localStorage.getItem(LEGACY_STATS_KEY) === '0') base.showPlaytime = false
  return base
}

function writeMirror(s: PrivacySettings) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(s))
    // Старый ключ держим синхронным: на него смотрит код, который читает
    // настройку до загрузки приватности.
    localStorage.setItem(LEGACY_STATS_KEY, s.showPlaytime ? '1' : '0')
  } catch {}
}

interface PrivacyState {
  settings: PrivacySettings
  /// true — значения пришли с сервера, а не из зеркала.
  loaded: boolean
  loading: boolean
  error: string
  saving: keyof PrivacySettings | null
  load: (force?: boolean) => Promise<void>
  patch: (part: Partial<PrivacySettings>) => Promise<void>
}

export const usePrivacy = create<PrivacyState>((set, get) => ({
  settings: readMirror(),
  loaded: false,
  loading: false,
  error: '',
  saving: null,
  load: async (force) => {
    if (!hasMillidaAccount()) return
    const st = get()
    if (st.loading || (st.loaded && !force)) return
    set({ loading: true, error: '' })
    try {
      const s = normalize(await api<unknown>(PRIVACY_PATH))
      writeMirror(s)
      set({ settings: s, loaded: true, loading: false })
    } catch {
      set({ loading: false, error: 'Не удалось загрузить настройки приватности' })
    }
  },
  /// Переключаем только по ответу сервера: при ошибке тумблер остаётся
  /// в прежнем положении и не «прыгает».
  patch: async (part) => {
    if (!hasMillidaAccount()) throw new Error('нужен аккаунт Millida')
    const field = (Object.keys(part)[0] || null) as keyof PrivacySettings | null
    set({ saving: field, error: '' })
    try {
      const s = normalize(await api<unknown>(PRIVACY_PATH, { method: 'PATCH', body: JSON.stringify(part) }))
      writeMirror(s)
      set({ settings: s, loaded: true, saving: null })
    } catch (e) {
      set({ saving: null, error: 'Не удалось сохранить — попробуй ещё раз' })
      throw e
    }
  },
}))

export const loadPrivacy = (force?: boolean) => usePrivacy.getState().load(force)
export const privacySettings = (): PrivacySettings => usePrivacy.getState().settings
