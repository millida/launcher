import { Icon } from '../Icon'
import { PlayTogether } from './PlayTogether'

/**
 * Пустой список. Поиск стоит в шапке экрана — пустое состояние только ставит
 * в него курсор. Под ним — свой сервер: с него друзья обычно и начинаются.
 */
export function FriendsEmpty({ myNick, onFind }: { myNick: string; onFind: () => void }) {
  return (
    <>
      <div className="fr-blank">
        <Icon id="i-users" />
        <b>Добавь первого друга</b>
        <button className="btn sm primary" data-track="friends_find" onClick={onFind}>
          <Icon id="i-search" />
          Ввести ник
        </button>
        {myNick ? <p className="faint-note">Тебя найдут по нику {myNick}</p> : null}
      </div>
      <PlayTogether />
    </>
  )
}
