import { useState } from 'react'
import { Icon } from '../Icon'
import { RemoteScreen } from '../RemoteScreen'
import { RatingRow, RatingRowSkel } from '../RatingRow'
import { useRatingFeed } from '../../state/ratingFeed'
import { openExt } from '../../lib/api'
import { remoteUiEnabled } from '../../lib/remoteUi'
import { makeRemoteBridge } from '../../lib/remoteUiBridge'
import { RATING_ADD_URL, RATING_BOOST_URL, joinFromRating, openServerPage } from '../../screens/Servers'
import { useT } from '../../i18n'

const STEP = 10

/**
 * Блок «Серверы» на экране «Играть» — карточки сайта (экран rating-top из сборки сайта): вид и данные меняются вместе
 * с millida.net без релиза. Нет сборки или она старше экрана — свой список тех же мест. Экран сайта живёт один на окно,
 * поэтому вне вкладки блок его снимает.
 */
export function HubServers({ on }: { on: boolean }) {
  const [remoteFailed, setRemoteFailed] = useState(false)
  if (remoteUiEnabled() && !remoteFailed)
    return on ? (
      <RemoteScreen
        screen="rating-top"
        onFail={() => setRemoteFailed(true)}
        bridge={() => makeRemoteBridge({ join: joinFromRating, navigate: openServerPage })}
      />
    ) : null
  return <NativeHubServers on={on} />
}

/** Место под сервер зрителя: те же две кнопки, что в карточках сайта. */
export function OwnerSlot({ src }: { src: string }) {
  const t = useT()
  return (
    <div className="srv-row rt-row rt-slot" data-src={src}>
      <span className="rt-slot-ic">
        <Icon id="i-plus" />
      </span>
      <b className="rt-slot-t">{t('Размести свой сервер здесь')}</b>
      <button className="btn sm secondary" data-sound="open" data-track="rating_add_server" onClick={() => openExt(RATING_ADD_URL)}>
        <Icon id="i-plus" /> {t('Добавить сервер')}
      </button>
      <button className="btn sm primary" data-sound="open" data-track="rating_boost_server" onClick={() => openExt(RATING_BOOST_URL)}>
        <Icon id="i-rocket" /> {t('Раскрутить сервер')}
      </button>
    </div>
  )
}

/** Запасной вид: топ-10 рейтинга строками, «Показать ещё» добавляет по 10. */
function NativeHubServers({ on }: { on: boolean }) {
  const t = useT()
  const feed = useRatingFeed({ step: STEP, on })
  if (feed.state === 'error')
    return (
      <div className="ph-noans">
        <Icon id="i-alert" />
        <b>{t('Не загрузилось')}</b>
        <button className="btn sm secondary" data-track="retry" onClick={feed.retry}>
          <Icon id="i-restart" /> {t('Повторить')}
        </button>
      </div>
    )
  return (
    <>
      <div className="rt-list" data-section="servers" data-src="hub_servers">
        <OwnerSlot src="hub_servers" />
        {feed.state === 'loading' ? <RatingRowSkel n={STEP} /> : feed.list.map((sv, i) => <RatingRow key={sv.slug + ':' + i} sv={sv} place={i + 1} src="hub_servers" />)}
      </div>
      {feed.state === 'ok' && feed.hasMore ? (
        <div className="rt-foot">
          <button className={'btn md secondary' + (feed.busy ? ' cat-busy' : '')} disabled={feed.busy} data-track="hub_servers_more" onClick={feed.more}>
            {t('Показать ещё {n}', { n: Math.min(STEP, feed.total - feed.list.length) })}
          </button>
        </div>
      ) : null}
    </>
  )
}
