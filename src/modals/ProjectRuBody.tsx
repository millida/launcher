import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { PxIcon } from '../components/PxIcon'
import { Guard } from '../components/Guard'
import { RU_LOADER } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import { loaderLabel } from '../components/catalog/site'
import { useProject } from '../state/project'
import { useMilli } from '../state/milli'
import type { MilliItem } from '../lib/milli'
import { kindLabel, tidyBody } from './projectView'
import {
  blockKind,
  blockLines,
  blockSuggestions,
  skelBlocks,
  suggestEdit,
  galleryText,
  ruOrPending,
  suggestErrorText,
  translateChangelog,
  voteSuggestion,
} from './projectTranslate'
import type { SkelBlock, TrBlock, TrChangelog, TrSuggestion, TrSummary, TrText, TrView } from './projectTranslate'
import '../styles/pixel/project-translate.css'

/*
 * Описание мода по-русски (перевод Millida, контракт v2 от 04.10.2026).
 *
 * Английский текст сюда не попадает, пока игрок сам не нажмёт «Оригинал»: сверху
 * сразу стоит короткая русская сводка (с сервера, а до его ответа — из того, что
 * лаунчер уже знает), ниже — заглушки по форме оригинала, и переведённые абзацы
 * проявляются на их месте. Абзац можно поправить: правка уходит на голосование.
 */

const LOADER_RU = (id: string): string => (loaderLabel(id) === id ? RU_LOADER(id) : loaderLabel(id))

const andList = (xs: string[]): string => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' и ' + xs[xs.length - 1])

/// Короткое русское описание, если оно уже пришло лаунчеру со сборкой Милли.
function milliDescription(slug: string): string {
  try {
    const msgs = useMilli.getState().messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      const p = msgs[i].pack
      if (!p) continue
      const all: (MilliItem | null)[] = [...(p.mods || []), ...(p.resourcepacks || []), ...(p.shaders || []), ...(p.optional || []), p.shaderLoader]
      const hit = all.find((m) => m && (m.slug === slug || m.projectId === slug))
      if (hit && typeof hit.descriptionRu === 'string' && hit.descriptionRu.trim()) return hit.descriptionRu.trim()
    }
  } catch {}
  return ''
}

/** Сводка до ответа сервера: русское описание из данных лаунчера, иначе строка из категорий. */
export function clientSummary(p: { slug: string; title: string; kind: string; loaders: string[]; tags: string[] }): TrSummary {
  const loaders = p.loaders.filter((l) => l !== 'minecraft' && l !== 'datapack').map(LOADER_RU)
  const cats = p.tags.filter((c) => !p.loaders.includes(c)).map(RU_LOADER).filter((c) => /[а-яё]/i.test(c))
  const ru = milliDescription(p.slug)
  const text =
    ru ||
    kindLabel(p.kind) +
      (loaders.length ? ' для ' + andList(loaders.slice(0, 4)) : ' для Minecraft') +
      (cats.length ? ': ' + cats.slice(0, 3).join(', ').toLowerCase() : '') +
      '.'
  return { title: p.title, text, loaders, categories: cats.slice(0, 5), adds: [], source: 'template' }
}

/* ── Заглушки по форме оригинала ── */

const WIDTHS = [100, 96, 98, 92, 100, 94]

function Skel({ b, i }: { b: SkelBlock; i: number }) {
  const lines = Math.min(b.lines, 24)
  const delay = { animationDelay: Math.min(i, 12) * 60 + 'ms' } as CSSProperties
  if (b.kind === 'heading') {
    return (
      <div className="pjt-sk h" style={delay} aria-hidden="true">
        <span className="skel" style={{ width: 28 + ((i * 13) % 22) + '%' }} />
      </div>
    )
  }
  if (b.kind === 'image') {
    return (
      <div className="pjt-sk img" style={delay} aria-hidden="true">
        <span className="skel">
          <PxIcon name="image" size={18} />
        </span>
      </div>
    )
  }
  if (b.kind === 'code') {
    return (
      <div className="pjt-sk code" style={{ ...delay, height: 16 + lines * 19 + 'px' }} aria-hidden="true">
        <span className="skel" />
      </div>
    )
  }
  if (b.kind === 'hr') return <hr className="pjt-sk-hr" aria-hidden="true" />
  const list = b.kind === 'list'
  return (
    <div className={'pjt-sk ' + (list ? 'li' : b.kind === 'table' ? 'tbl' : 'p')} style={delay} aria-hidden="true">
      {Array.from({ length: lines }, (_, k) => (
        <span key={k} className="pjt-sk-row">
          {list ? <i className="pjt-sk-dot" /> : null}
          <span className="skel" style={{ width: (k === lines - 1 && lines > 1 ? 45 + ((i * 17 + k * 7) % 40) : WIDTHS[(i + k) % WIDTHS.length]) + '%' }} />
        </span>
      ))}
    </div>
  )
}

/* ── Сводка ── */

function SummaryCard({ s, live, noText }: { s: TrSummary; live: boolean; noText?: boolean }) {
  const chips = [...s.loaders.map((t) => ({ t, k: 'ld' })), ...s.categories.map((t) => ({ t, k: 'cat' }))].slice(0, 8)
  return (
    <section className={'pjt-sum' + (live ? ' live' : '')} aria-label="Коротко о моде">
      {noText ? null : <p className="pjt-sum-t">{s.text}</p>}
      {chips.length ? (
        <div className="pjt-sum-chips">
          {chips.map((c) => (
            <span key={c.k + c.t} className={'pjt-chip ' + c.k}>
              {c.t}
            </span>
          ))}
        </div>
      ) : null}
      {s.adds.length ? (
        <div className="pjt-adds">
          <span className="pjt-adds-k">Добавляет:</span>
          {s.adds.map((a) => (
            <span key={a} className="pjt-item">
              {a}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/* ── Правка абзаца ── */

const CYR = /[а-яё]/i

function SuggestBox({ projectId, block, onClose, onAccepted }: { projectId: string; block: TrBlock; onClose: () => void; onAccepted: (ru: string) => void }) {
  const start = block.ru || ''
  const [text, setText] = useState(start)
  const [st, setSt] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: '', ok: false })
  const [items, setItems] = useState<TrSuggestion[] | null>(null)
  const [voted, setVoted] = useState<Record<string, boolean>>({})
  const ta = useRef<HTMLTextAreaElement>(null)
  const blockId = block.id || ''

  const load = () => {
    blockSuggestions(projectId, blockId)
      .then((xs) => setItems(xs.sort((a, b) => b.votes - a.votes).slice(0, 5)))
      .catch(() => setItems([]))
  }
  useEffect(() => {
    load()
    const el = ta.current
    if (el) {
      el.focus()
      el.style.height = Math.min(320, el.scrollHeight + 2) + 'px'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, blockId])

  const send = () => {
    const ru = text.trim()
    if (st.busy) return
    if (!ru || ru === start.trim()) return setSt({ busy: false, msg: 'Сначала поправь текст', ok: false })
    if (!CYR.test(ru)) return setSt({ busy: false, msg: 'Нужен текст по-русски', ok: false })
    if (ru.length > Math.max(block.src.length * 4, 40)) return setSt({ busy: false, msg: 'Слишком длинно для этого абзаца', ok: false })
    setSt({ busy: true, msg: '', ok: false })
    suggestEdit(projectId, blockId, ru)
      .then((r) => {
        if (r && r.accepted) onAccepted(ru)
        setSt({ busy: false, ok: true, msg: r && r.accepted ? 'Принято — спасибо!' : 'Отправлено. Правка встанет, когда её поддержат' })
        setVoted((v) => (r && r.id ? { ...v, [r.id]: true } : v))
        load()
      })
      .catch((e) => setSt({ busy: false, msg: suggestErrorText(e), ok: false }))
  }

  const vote = (s: TrSuggestion, up: boolean) => {
    if (voted[s.id]) return
    setVoted((v) => ({ ...v, [s.id]: true }))
    setItems((xs) => (xs ? xs.map((x) => (x.id === s.id ? { ...x, votes: x.votes + (up ? 1 : -1) } : x)) : xs))
    voteSuggestion(s.id, up)
      .then((r) => {
        if (r && typeof r.votes === 'number') setItems((xs) => (xs ? xs.map((x) => (x.id === s.id ? { ...x, votes: r.votes } : x)) : xs))
        if (r && r.accepted) {
          onAccepted(s.ru)
          setSt({ busy: false, ok: true, msg: 'Правка принята' })
        }
      })
      .catch((e) => {
        setVoted((v) => ({ ...v, [s.id]: false }))
        setItems((xs) => (xs ? xs.map((x) => (x.id === s.id ? { ...x, votes: x.votes - (up ? 1 : -1) } : x)) : xs))
        setSt({ busy: false, msg: suggestErrorText(e), ok: false })
      })
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="pjt-box" onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ta}
        className="pjt-ta"
        value={text}
        spellCheck
        lang="ru"
        aria-label="Твой вариант перевода"
        onChange={(e) => {
          setText(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = Math.min(320, e.target.scrollHeight + 2) + 'px'
        }}
      />
      <details className="pjt-orig">
        <summary>Оригинал абзаца</summary>
        <div className="pjt-orig-t" lang="en">
          {block.src}
        </div>
      </details>
      {items && items.length ? (
        <div className="pjt-sugs" aria-label="Правки игроков">
          <span className="pjt-sugs-h">Правки игроков</span>
          {items.map((s) => (
            <div className="pjt-sug" key={s.id}>
              <span className="pjt-sug-t">{s.ru}</span>
              <span className="pjt-vote">
                <button className="pjt-vb up" aria-label="За" title="За" disabled={!!voted[s.id]} data-track="pj_tr_vote_up" onClick={() => vote(s, true)}>
                  <PxIcon name="chev-r" size={9} />
                </button>
                <b className={s.votes > 0 ? 'pos' : s.votes < 0 ? 'neg' : ''}>{s.votes > 0 ? '+' + s.votes : s.votes}</b>
                <button className="pjt-vb down" aria-label="Против" title="Против" disabled={!!voted[s.id]} data-track="pj_tr_vote_down" onClick={() => vote(s, false)}>
                  <PxIcon name="chev-r" size={9} />
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pjt-box-row">
        {st.msg ? (
          <span className={'pjt-box-msg' + (st.ok ? ' ok' : ' bad')} role="status">
            {st.msg}
          </span>
        ) : (
          <span className="pjt-box-hint">Правку увидят все, когда её поддержат игроки</span>
        )}
        <button className="btn sm ghost" data-track="pj_tr_suggest_cancel" onClick={onClose}>
          {st.ok ? 'Закрыть' : 'Отмена'}
        </button>
        {st.ok ? null : (
          <button className="btn sm primary" data-track="pj_tr_suggest_send" disabled={st.busy} onClick={send}>
            {st.busy ? 'Отправляем…' : 'Предложить'}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Тело ── */

interface Props {
  view: TrView | null
  busy: boolean
  err: string
  onRetry: () => void
  onOriginal: () => void
}

const EDITABLE = (b: TrBlock) => !!b.id && b.tier !== 'same' && b.kind !== 'code' && b.kind !== 'image' && b.kind !== 'hr'

function RuBody({ view, busy, err, onRetry, onOriginal }: Props) {
  const pj = useProject()
  const skel = useMemo(() => skelBlocks(pj.body || ''), [pj.body])
  const fallback = useMemo(
    () => clientSummary({ slug: pj.slug, title: pj.title, kind: pj.kind, loaders: pj.loaders, tags: pj.tags }),
    [pj.slug, pj.title, pj.kind, pj.loaders, pj.tags],
  )
  const server = view && view.summary && view.summary.text ? view.summary : null
  const summary = server ? { ...server, loaders: server.loaders.length ? server.loaders : fallback.loaders } : fallback
  const [accepted, setAccepted] = useState<Record<string, string>>({})
  const [edit, setEdit] = useState('')

  const blocks = useMemo(() => {
    if (!view) return null
    return view.blocks.map((b, i) => {
      const key = b.id || 'i' + i
      const ru = accepted[key] !== undefined ? accepted[key] : b.ru
      const tier = accepted[key] !== undefined ? 'community' : b.tier
      const kind = b.kind || blockKind(b.src)
      return {
        key,
        b: { ...b, ru, tier, kind },
        lines: b.lines || blockLines(b.src, kind),
        nodes: ru !== null ? renderMarkdown(tidyBody(ru)) : null,
      }
    })
  }, [view, accepted])

  const waiting = !view || !view.done || busy
  const projectId = (view && view.projectId) || ''

  return (
    <div className="pjt" lang="ru">
      <SummaryCard
        s={summary}
        live={!!server}
        noText={!!(server && view && (view.description ? view.description.ru && view.description.ru.trim() === server.text.trim() : pj.summary))}
      />
      {err ? (
        <div className="pjx-tr-err pjt-err" role="status">
          <PxIcon name="alert" size={11} />
          <span>{err}</span>
          <button className="pjx-tr-retry" data-track="pj_lang_retry" onClick={onRetry}>
            Ещё раз
          </button>
          {pj.body ? (
            <button className="pjx-tr-retry" data-track="pj_tr_err_orig" onClick={onOriginal}>
              Оригинал
            </button>
          ) : null}
        </div>
      ) : null}
      {err ? null : blocks ? (
        blocks.map(({ key, b, lines, nodes }, i) => {
          if (nodes) {
            const canEdit = !!projectId && EDITABLE(b)
            const draft = b.tier === 'draft'
            return (
              <div
                key={key + ':ru'}
                className={'pjt-b' + (draft ? ' draft' : '') + (b.tier === 'community' ? ' comm' : '') + (edit === key ? ' editing' : '')}
                data-kind={b.kind}
                title={draft ? 'Черновой перевод, скоро улучшится' : undefined}
                style={{ animationDelay: Math.min(i, 8) * 40 + 'ms' } as CSSProperties}
              >
                {nodes}
                {canEdit && edit !== key ? (
                  <button
                    className="pjt-edit"
                    data-track="pj_tr_suggest_open"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEdit(key)
                    }}
                  >
                    <PxIcon name="edit" size={10} />
                    Предложить правку
                  </button>
                ) : null}
                {edit === key ? (
                  <SuggestBox
                    projectId={projectId}
                    block={b}
                    onClose={() => setEdit('')}
                    onAccepted={(ru) => setAccepted((a) => ({ ...a, [key]: ru }))}
                  />
                ) : null}
              </div>
            )
          }
          // Сервер закончил, а абзаца нет (лимит переводчика): вечная заглушка хуже оригинала —
          // показываем текст автора приглушённым, перевод подменит его при следующем открытии.
          if (!waiting && b.src && b.src.trim()) {
            return (
              <div key={key + ':en'} className="pjt-b pjt-en" data-kind={b.kind} lang="en">
                {renderMarkdown(tidyBody(b.src))}
              </div>
            )
          }
          // Нет перевода — на месте абзаца его форма, пока сервер ещё работает.
          return (
            <div key={key + ':sk'} className={'pjt-hold' + (waiting ? '' : ' late')}>
              <Skel b={{ kind: b.kind, lines }} i={i} />
              {waiting ? null : (
                <span className="pjt-hold-t">
                  <PxIcon name="clock" size={10} />
                  переводим…
                </span>
              )}
            </div>
          )
        })
      ) : (
        skel.map((b, i) => <Skel key={'c' + i} b={b} i={i} />)
      )}
      {view && view.truncated && !err ? (
        <p className="pjt-trunc">
          Описание длинное — перевели начало.{' '}
          <button className="pjt-peek-b" data-track="pj_tr_trunc_orig" onClick={onOriginal}>
            Оригинал целиком
          </button>
        </p>
      ) : null}
    </div>
  )
}

/** Русское описание мода; сбой внутри не роняет окно мода. */
export function ProjectRuBody(props: Props) {
  return (
    <Guard what="Перевод описания">
      <RuBody {...props} />
    </Guard>
  )
}

/** Знак «Перевод Millida» у переключателя языка. */
export function TrMark({ view, busy }: { view: TrView | null; busy: boolean }) {
  const blocks = view ? view.blocks : []
  const ready = blocks.filter((b) => b.ru !== null).length
  const community = blocks.some((b) => b.tier === 'community')
  const draft = blocks.some((b) => b.tier === 'draft')
  return (
    <Guard what="Знак перевода" silent>
      <span
        className="pjt-mark"
        title={draft ? 'Часть абзацев — черновой перевод, скоро улучшится' : 'Перевод Millida: словари Minecraft, память переводов и правки игроков'}
      >
        {busy && blocks.length && ready < blocks.length ? (
          <span className="pjt-mark-n" aria-live="polite">
            {ready}/{blocks.length}
          </span>
        ) : null}
        <PxIcon name="sparkle" size={10} />
        <span className="pjt-mark-t">Перевод Millida</span>
        {community ? <em className="pjt-mark-c">· проверено сообществом</em> : null}
      </span>
    </Guard>
  )
}

/**
 * Короткий текст в режиме RU (описание под названием, подпись картинки, имя
 * версии): перевод — текстом, ещё нет — полоска-заглушка его длины на месте.
 */
export function RuLine({ t, src, className, block }: { t: TrText | null | undefined; src: string; className?: string; block?: boolean }): ReactNode {
  const ru = ruOrPending(t, src)
  if (ru !== null) return ru
  const ch = Math.min(src.length, 160)
  const rows = Math.max(1, Math.ceil(ch / 72))
  return (
    <span className={'pjt-line' + (block ? ' block' : '') + (className ? ' ' + className : '')} aria-label="переводим…" role="img">
      {Array.from({ length: block ? rows : 1 }, (_, k) => (
        <span
          key={k}
          className="skel"
          style={{ width: block ? (k === rows - 1 ? Math.max(20, ((ch % 72) / 72) * 100) : 100) + '%' : Math.max(3, Math.min(ch, 48)) * 0.55 + 'em' }}
        />
      ))}
    </span>
  )
}

/**
 * Имена версий по-русски для вкладки «Версии» (GET …/translate/changelog,
 * лениво: только пока вкладка открыта). Карта id версии → её перевод; null —
 * ответа ещё нет; 'off' — сервер не умеет или упал (тогда номера версий).
 */
export function useRuVersions(slug: string, on: boolean): Map<string, TrText | null> | null | 'off' {
  const [st, setSt] = useState<{ slug: string; log: TrChangelog | null; off: boolean }>({ slug: '', log: null, off: false })
  useEffect(() => {
    if (!on || !slug) return
    let live = true
    setSt((s) => (s.slug === slug ? s : { slug, log: null, off: false }))
    translateChangelog(
      slug,
      (log) => {
        if (live) setSt({ slug, log, off: false })
      },
      () => live,
    ).catch(() => {
      if (live) setSt((s) => (s.slug === slug && s.log ? s : { slug, log: null, off: true }))
    })
    return () => {
      live = false
    }
  }, [slug, on])
  return useMemo(() => {
    if (st.slug !== slug) return null
    if (st.off) return 'off'
    if (!st.log) return null
    return new Map(st.log.versions.map((v) => [v.id, v.name]))
  }, [st, slug])
}

/**
 * Имя версии в режиме RU. Перевод есть — он; ждём ответа — заглушка; версию
 * сервер не прислал (старше 20 последних) или он недоступен — номер версии,
 * в котором нет английских слов.
 */
export function ruVersionName(names: ReturnType<typeof useRuVersions>, v: { id: string; name: string; number?: string }): ReactNode {
  const fallback = v.number || v.name
  if (!/[A-Za-z]{3,}/.test(v.name)) return v.name
  if (names === 'off') return fallback
  if (names === null) return <RuLine t={null} src={v.name} />
  if (!names.has(v.id)) return fallback
  return <RuLine t={names.get(v.id)} src={v.name} />
}

/** Строка под названием мода в режиме RU: перевод описания Modrinth или его заглушка. */
export function ruDescription(view: TrView | null, err: string, src: string): ReactNode {
  if (!src || err) return null
  let t: TrText | null | undefined = view ? view.description : null
  // Старый сервер без поля description: русская сводка вместо английской строки.
  if (!t && view && view.done && view.summary && view.summary.text) t = { src, ru: view.summary.text, tier: null }
  return <RuLine t={t} src={src} />
}

/** Подпись картинки галереи в режиме RU. */
export function ruGallery(view: TrView | null, err: string, src: string, field: 'title' | 'description'): ReactNode {
  if (!src || err) return null
  if (view && view.done && !(view.gallery && view.gallery.length)) return null
  return <RuLine t={galleryText(view, src, field)} src={src} />
}
