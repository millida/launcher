import { useState } from 'react'
import { Icon } from '../Icon'
import { hasTauri } from '../../ipc/tauri'
import { openUrl } from '../../ipc/commands'
import { RADIO } from '../../state/music'
import { Row } from '../SetKit'
import { useT } from '../../i18n'

const open = (url: string) => (hasTauri() ? openUrl(url) : window.open(url, '_blank'))

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/deed.ru'

const authors = [...new Set(RADIO.map((t) => t.author))].join(', ')

/**
 * «Авторы музыки» для Настроек → Звук. Треки радио под CC BY 4.0 и CC0:
 * CC BY требует назвать автора и лицензию там, где трек звучит, — это здесь.
 */
export function RadioCredits() {
  const t = useT()
  const [shown, setShown] = useState(false)
  return (
    <>
      <Row title={t('Авторы музыки')} hint={authors} keys="музыка авторы лицензия cc by треки радио">
        <button className="btn sm ghost" aria-expanded={shown} onClick={() => setShown(!shown)}>
          {shown ? t('Скрыть') : t('Треки')}
        </button>
      </Row>
      {shown
        ? RADIO.map((track) => (
            <Row key={track.src} title={track.title} hint={track.author + ' · ' + track.license} keys="музыка авторы лицензия">
              {track.url ? (
                <button className="btn sm ghost" aria-label={t('Страница трека {title}', { title: track.title })} onClick={() => open(track.url!)}>
                  <Icon id="i-ext" />
                </button>
              ) : null}
            </Row>
          ))
        : null}
      {shown ? (
        <Row title="CC BY 4.0" hint={t('Текст лицензии')} keys="музыка лицензия">
          <button className="btn sm ghost" aria-label={t('Текст лицензии CC BY 4.0')} onClick={() => open(CC_BY)}>
            <Icon id="i-ext" />
          </button>
        </Row>
      ) : null}
    </>
  )
}
