import { useCallback, useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Select } from './Select'
import { showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import {
  catalogInstallTheme,
  catalogLikeTheme,
  catalogMyThemes,
  catalogPublishTheme,
  catalogThemeInstalled,
  catalogThemes,
  catalogUnpublishTheme,
} from '../ipc/commands'
import type { CatalogTheme, InstalledThemeFile, OwnCatalogTheme } from '../ipc/commands'
import { hasMillidaAccount } from '../lib/api'
import { installId } from '../lib/telemetry'
import type { ThemePack } from '../lib/themes'

const PAGE = 24

const SORTS: { id: 'popular' | 'new' | 'liked'; label: string }[] = [
  { id: 'popular', label: 'Популярные' },
  { id: 'new', label: 'Новые' },
  { id: 'liked', label: 'С лайками' },
]

const STATUS: Record<OwnCatalogTheme['status'], string> = {
  PENDING: 'На проверке',
  ACTIVE: 'В каталоге',
  REJECTED: 'Отклонена',
}

function size(bytes: number): string {
  if (!bytes) return ''
  const kb = bytes / 1024
  return kb < 1024 ? Math.round(kb) + ' КБ' : (kb / 1024).toFixed(1) + ' МБ'
}

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('unauthorized') || msg.includes('401')) {
    return 'Нужен вход в аккаунт Millida'
  }
  return msg
}

function Swatches({ colors }: { colors: string[] }) {
  const list = colors.length ? colors.slice(0, 3) : ['#161718', '#1E1F20', '#5EC64D']
  return (
    <div className="th-swatches">
      {list.map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </div>
  )
}

/**
 * Каталог тем: чужие темы ставятся отсюда, свои — уезжают в него. Ядро само
 * собирает адрес по slug и сверяет sha256, поэтому здесь остаются только выбор
 * и состояние карточки.
 */
export function ThemeCatalog({
  installed,
  onInstalled,
}: {
  installed: ThemePack[]
  onInstalled: (theme: InstalledThemeFile) => void
}) {
  const [tab, setTab] = useState<'catalog' | 'mine'>('catalog')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'popular' | 'new' | 'liked'>('popular')
  const [items, setItems] = useState<CatalogTheme[]>([])
  const [total, setTotal] = useState(0)
  const [mine, setMine] = useState<OwnCatalogTheme[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState('')
  const [publishId, setPublishId] = useState('')
  const [changelog, setChangelog] = useState('')

  const own = installed.filter((p) => !p.builtin)

  const load = useCallback(
    async (offset: number) => {
      setLoading(true)
      setFailed('')
      try {
        const page = await catalogThemes({ q: q.trim(), sort, limit: PAGE, offset })
        setItems((prev) => (offset ? [...prev, ...page.items] : page.items))
        setTotal(page.total)
      } catch (e) {
        setFailed(errText(e))
      } finally {
        setLoading(false)
      }
    },
    [q, sort],
  )

  const loadMine = useCallback(async () => {
    setLoading(true)
    setFailed('')
    try {
      setMine(await catalogMyThemes())
    } catch (e) {
      setFailed(errText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab !== 'catalog') return
    // Поиск набирается по букве, а каждая буква — запрос к каталогу.
    const timer = setTimeout(() => void load(0), 350)
    return () => clearTimeout(timer)
  }, [tab, load])

  useEffect(() => {
    if (tab === 'mine') void loadMine()
  }, [tab, loadMine])

  useEffect(() => {
    if (!publishId && own.length) setPublishId(own[0].id)
  }, [own, publishId])

  const installedVersion = (slug: string): string | null => {
    const found = installed.find((p) => p.id === slug && !p.builtin)
    return found ? found.version || '' : null
  }

  async function install(theme: CatalogTheme) {
    setBusy(theme.slug)
    try {
      const file = await catalogInstallTheme(theme.slug)
      onInstalled(file)
      showToast('Тема «' + file.name + '» установлена')
      // Счётчик считает лаунчеры, а не нажатия: повторная установка после
      // удаления вернёт прежнее число, поэтому оно берётся из ответа каталога.
      const counted = await catalogThemeInstalled(theme.slug, installId()).catch(() => null)
      if (counted) {
        setItems((prev) =>
          prev.map((t) => (t.slug === theme.slug ? { ...t, downloads: counted.downloads } : t)),
        )
      }
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  async function like(theme: CatalogTheme) {
    if (!hasMillidaAccount()) {
      showToast('Войдите в аккаунт Millida, чтобы отмечать темы', 'error')
      return
    }
    try {
      const res = await catalogLikeTheme(theme.slug)
      setItems((prev) =>
        prev.map((t) => (t.slug === theme.slug ? { ...t, liked: res.liked, likes: res.likes } : t)),
      )
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  async function publish() {
    if (!publishId) return
    if (!hasMillidaAccount()) {
      showToast('Войдите в аккаунт Millida, чтобы публиковать темы', 'error')
      return
    }
    setBusy(publishId)
    try {
      const published = await catalogPublishTheme(publishId, changelog.trim() || undefined)
      setChangelog('')
      await loadMine()
      showToast(
        published.status === 'ACTIVE'
          ? 'Тема обновлена в каталоге'
          : 'Тема отправлена на проверку — появится в каталоге после модерации',
      )
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy('')
    }
  }

  async function unpublish(theme: OwnCatalogTheme) {
    const ok = await uiConfirm(
      'Тема «' + theme.name + '» пропадёт из каталога. У тех, кто её уже поставил, она останется.',
      { title: 'Снять с каталога?', confirmLabel: 'Снять', danger: true },
    )
    if (!ok) return
    try {
      await catalogUnpublishTheme(theme.slug)
      await loadMine()
      showToast('Тема снята с каталога')
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  return (
    <div className="set-group">
      <div className="cap">Каталог тем</div>

      <div className="th-cat-head">
        <div className="segs">
          <button
            className={'seg' + (tab === 'catalog' ? ' on' : '')}
            onClick={() => setTab('catalog')}
          >
            Все темы
          </button>
          <button className={'seg' + (tab === 'mine' ? ' on' : '')} onClick={() => setTab('mine')}>
            Мои публикации
          </button>
        </div>
        {tab === 'catalog' ? (
          <>
            <div className="input sm th-cat-search">
              <Icon id="i-search" />
              <input
                placeholder="Поиск по каталогу…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select
              value={sort}
              width={150}
              align="right"
              options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
              onChange={(v) => setSort(v as 'popular' | 'new' | 'liked')}
            />
          </>
        ) : null}
      </div>

      {failed ? <div className="faint-note">Каталог недоступен: {failed}</div> : null}

      {tab === 'catalog' ? (
        <>
          <div className="th-grid">
            {items.map((t) => {
              const local = installedVersion(t.slug)
              const fresh = local !== null && local === t.version
              return (
                <div key={t.slug} className={'th-card th-cat' + (fresh ? ' on' : '')}>
                  <Swatches colors={t.preview} />
                  <b>{t.name}</b>
                  <span>{t.description || t.author}</span>
                  <div className="th-cat-meta">
                    <span title="Установок">
                      <Icon id="i-download" /> {t.downloads}
                    </span>
                    <button
                      className={'th-like' + (t.liked ? ' on' : '')}
                      onClick={() => void like(t)}
                      title={t.liked ? 'Убрать отметку' : 'Нравится'}
                    >
                      <Icon id="i-thumb" /> {t.likes}
                    </button>
                    <span className="th-cat-size">{size(t.sizeBytes)}</span>
                  </div>
                  <button
                    className={'btn sm ' + (fresh ? 'ghost' : 'secondary')}
                    disabled={busy === t.slug || fresh}
                    onClick={() => void install(t)}
                  >
                    {fresh ? (
                      <>
                        <Icon id="i-check" /> Установлена
                      </>
                    ) : local !== null ? (
                      <>
                        <Icon id="i-download" /> Обновить до {t.version}
                      </>
                    ) : (
                      <>
                        <Icon id="i-download" /> Установить
                      </>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
          {!items.length && !loading && !failed ? (
            <div className="faint-note">
              {q.trim() ? 'По запросу ничего не нашлось' : 'В каталоге пока пусто'}
            </div>
          ) : null}
          {items.length < total ? (
            <div className="th-actions">
              <button
                className="btn sm ghost"
                disabled={loading}
                onClick={() => void load(items.length)}
              >
                Показать ещё
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {mine.map((t) => (
            <div key={t.slug} className="set-row">
              <span className="lab">
                {t.name}
                <small>
                  {STATUS[t.status]}
                  {t.version ? ' · ' + t.version : ''}
                  {t.pendingVersion ? ' · на проверке ' + t.pendingVersion : ''}
                  {t.status === 'ACTIVE' ? ' · установок: ' + t.downloads : ''}
                  {t.moderationNote ? ' · ' + t.moderationNote : ''}
                </small>
              </span>
              <button className="btn sm ghost" onClick={() => void unpublish(t)}>
                <Icon id="i-trash" /> Снять
              </button>
            </div>
          ))}
          {!mine.length && !loading && !failed ? (
            <div className="faint-note">Вы ещё ничего не публиковали</div>
          ) : null}

          {own.length ? (
            <div className="set-row th-publish">
              <span className="lab">
                Опубликовать тему
                <small>
                  Файл темы уедет в каталог и станет доступен всем после проверки модератором
                </small>
              </span>
              <Select
                value={publishId}
                width={180}
                align="right"
                options={own.map((p) => ({ value: p.id, label: p.name }))}
                onChange={setPublishId}
              />
              <div className="input sm th-cat-search">
                <input
                  placeholder="Что изменилось (необязательно)"
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  maxLength={300}
                />
              </div>
              <button
                className="btn sm secondary"
                disabled={!publishId || busy === publishId}
                onClick={() => void publish()}
              >
                <Icon id="i-upload" /> Опубликовать
              </button>
            </div>
          ) : (
            <div className="faint-note">
              Публиковать можно свои темы — те, что установлены из файла, а не встроенные
            </div>
          )}
        </>
      )}
    </div>
  )
}
