import { create } from 'zustand'
import { t } from '../i18n'
import { uiConfirm } from './confirm'

const FILTER_KEY = 'm-chat-filter'
const RULES_KEY = 'm-chat-rules-v1'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

interface ChatSafetyState {
  /// Swear words in other people's messages are masked unless the player turned it off.
  filter: boolean
  setFilter: (on: boolean) => void
}

export const useChatSafety = create<ChatSafetyState>((set) => ({
  filter: read(FILTER_KEY) !== '0',
  setFilter: (on) => {
    write(FILTER_KEY, on ? '1' : '0')
    set({ filter: on })
  },
}))

/// The chat rules are accepted once before the first message; a refusal keeps the message unsent.
export async function ensureChatRules(): Promise<boolean> {
  if (read(RULES_KEY) === '1') return true
  const accepted = await uiConfirm(
    [
      t('Без оскорблений, угроз и травли.'),
      t('Без рекламы чужих серверов и ссылок на обман.'),
      t('Не проси пароли, коды и деньги — администрация их не спрашивает.'),
      t('Нарушителя можно заблокировать и пожаловаться — за нарушения закрываем доступ к чатам.'),
    ].join('\n'),
    { title: t('Правила чатов'), confirmLabel: t('Принимаю'), danger: false },
  )
  if (!accepted) return false
  write(RULES_KEY, '1')
  return true
}

const BAN_PREFIXES = ['Аккаунт заблокирован', 'Доступ к чатам ограничен']

/// A refusal because of a ban carries its term and reason from the server; it is shown as is instead of «try again».
export function banReason(e: unknown): string | null {
  const text = String((e as { message?: string } | null)?.message ?? '')
  const at = BAN_PREFIXES.map((p) => text.indexOf(p)).find((i) => i >= 0)
  return at === undefined ? null : text.slice(at)
}
