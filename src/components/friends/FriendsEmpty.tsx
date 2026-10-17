import { Icon } from '../Icon'
import { PlayTogether } from './PlayTogether'
import { useT } from '../../i18n'

/**
 * Пустой список. Поиск стоит в шапке экрана — пустое состояние только ставит
 * в него курсор. Под ним — свой сервер: с него друзья обычно и начинаются.
 */
export function FriendsEmpty({ myNick, onFind }: { myNick: string; onFind: () => void }) {
  const t = useT()
  return (
    <>
      <div className="fr-blank">
        <Icon id="i-users" />
        <b>{t('Добавь первого друга')}</b>
        <button className="btn sm primary" data-track="friends_find" onClick={onFind}>
          <Icon id="i-search" />
          {t('Ввести ник')}
        </button>
        {myNick ? <p className="faint-note">{t('Тебя найдут по нику {nick}', { nick: myNick })}</p> : null}
      </div>
      <PlayTogether />
    </>
  )
}
