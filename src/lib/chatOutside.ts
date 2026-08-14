/**
 * Клик «мимо» боковой переписки — ОДНА реализация на лаунчер.
 *
 * Панель закрывается по клику снаружи, но карточка уведомления, док звонка и
 * строки списка друзей сами открывают переписку. Их клик доходит до документа
 * уже ПОСЛЕ того, как панель открылась, и закрывал её обратно: нажатие на
 * уведомление выглядело как «ничего не произошло».
 */
const OWNS_CLICK = ['chat-notify', 'fr-msg', 'fr-row', 'lightbox', 'call-dock', 'call-ring', 'msg-menu']

export function keepsChatOpen(path: readonly (EventTarget | undefined)[]): boolean {
  return path.some(
    (n) => n instanceof HTMLElement && (n.id === 'chat' || OWNS_CLICK.some((c) => n.classList.contains(c))),
  )
}
