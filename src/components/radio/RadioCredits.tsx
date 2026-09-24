import { useState } from 'react'
import { Icon } from '../Icon'
import { hasTauri } from '../../ipc/tauri'
import { openUrl } from '../../ipc/commands'
import { RADIO } from '../../state/music'
import { Row } from '../SetKit'

const open = (url: string) => (hasTauri() ? openUrl(url) : window.open(url, '_blank'))

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/deed.ru'

const authors = [...new Set(RADIO.map((t) => t.author))].join(', ')

/**
 * «Авторы музыки» для Настроек → Звук. Треки радио под CC BY 4.0 и CC0:
 * CC BY требует назвать автора и лицензию там, где трек звучит, — это здесь.
 */
export function RadioCredits() {
  const [shown, setShown] = useState(false)
  return (
    <>
      <Row title="Авторы музыки" hint={authors} keys="музыка авторы лицензия cc by треки радио">
        <button className="btn sm ghost" aria-expanded={shown} onClick={() => setShown(!shown)}>
          {shown ? 'Скрыть' : 'Треки'}
        </button>
      </Row>
      {shown
        ? RADIO.map((t) => (
            <Row key={t.src} title={t.title} hint={t.author + ' · ' + t.license} keys="музыка авторы лицензия">
              {t.url ? (
                <button className="btn sm ghost" aria-label={'Страница трека ' + t.title} onClick={() => open(t.url!)}>
                  <Icon id="i-ext" />
                </button>
              ) : null}
            </Row>
          ))
        : null}
      {shown ? (
        <Row title="CC BY 4.0" hint="Текст лицензии" keys="музыка лицензия">
          <button className="btn sm ghost" aria-label="Текст лицензии CC BY 4.0" onClick={() => open(CC_BY)}>
            <Icon id="i-ext" />
          </button>
        </Row>
      ) : null}
    </>
  )
}
