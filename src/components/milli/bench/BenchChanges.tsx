import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { PxArt } from '../px'
import { milliCue } from '../Milli'
import { MilliSafe } from '../MilliStage'
import type { MilliChangeset, MilliPack, MilliTab } from '../../../lib/milli'
import { changeCount, firstChange, useBench } from '../../../state/milliBench'
import { showToast } from '../../../state/ui'

/*
 * Маленькое событие в ленте под ответом Милли: «Шейдеры полегче · +1 −1 ~1 ·
 * Показать · Отменить». Ручные правки игрока после этого ответа сворачиваются
 * во второе событие «Ваши правки · N». «Показать» раскрывает нужную вкладку в
 * карточке сборки и подсвечивает строку (стор: show → ui.tab/ui.open/reveal).
 * Отмена — серверная (`revert`), UI рисует её сразу.
 *
 * Здесь же — клавиши карточки (FE-list): Ctrl+Z / Ctrl+Shift+Z / Ctrl+F.
 */

const head = () => document.querySelector('.ml-panel .mlh')

/** «Отменить» с тостом «Отменено · Вернуть» (Вернуть = revert {to} на сервере). */
export async function benchUndo(): Promise<void> {
  const ok = await useBench.getState().revert()
  if (!ok) return
  milliCue('wake', head())
  showToast('Отменено', 'ok', false, {
    label: 'Вернуть',
    run: () => void useBench.getState().redo().then((back) => back && milliCue('hop', head())),
  })
}

function Counts({ c }: { c: MilliChangeset }) {
  const changed = c.changed.length + (c.config?.length ?? 0)
  return (
    <span className="mlx-n" aria-label={'Добавлено ' + c.added.length + ', убрано ' + c.removed.length + ', изменено ' + changed}>
      {c.added.length ? <b className="mlx-add">+{c.added.length}</b> : null}
      {c.removed.length ? <b className="mlx-rm">−{c.removed.length}</b> : null}
      {changed ? <b className="mlx-ch">~{changed}</b> : null}
    </span>
  )
}

const TAB_PX: Record<MilliTab, string> = { mods: 'crafting_table', resourcepacks: 'painting', shaders: 'glowstone', config: 'comparator' }

/** Иконка события — вкладка первой правки. */
const iconOf = (c: MilliChangeset) => TAB_PX[firstChange(c)?.tab ?? 'mods']

function Chip({ title, c, kind, undo, undone, redo }: { title: string; c: MilliChangeset; kind: 'milli' | 'user'; undo: boolean; undone: boolean; redo: boolean }) {
  const busy = useBench((s) => s.busy)
  const [open, setOpen] = useState(false)
  // «Отменить» — класс сразу, не дожидаясь сервера: счётчики сдуваются (моушн).
  const [undoing, setUndoing] = useState(false)
  const show = () => {
    const f = firstChange(c)
    useBench.getState().show(f?.tab ?? 'mods', f?.projectId || undefined)
  }
  const list = kind === 'user' ? [...c.added.map((r) => '+ ' + r.title), ...c.removed.map((r) => '− ' + r.title), ...c.changed.map((r) => '~ ' + r.title)] : []
  return (
    <>
      <div className={'mlx' + (kind === 'user' ? ' is-user' : '') + (undone || undoing ? ' is-undone' : '')} data-section="milli_changes" role="status">
        {list.length ? (
          // Правило 11: у ручных правок без слов — иконка, цифры, кнопки; клик по иконке — список.
          <button type="button" className="mlx-t mlx-ic" aria-expanded={open} aria-label={title} title={title} onClick={() => setOpen((v) => !v)}>
            <PxArt name={iconOf(c)} size={14} className="mci" />
          </button>
        ) : (
          <>
            <PxArt name={iconOf(c)} size={14} className="mci" />
            <span className="mlx-t" title={title}>
              {title}
            </span>
          </>
        )}
        <Counts c={c} />
        <span className="mlx-acts">
          <button type="button" className="mlx-btn" data-track="milli_changes_show" onClick={show}>
            Показать
          </button>
          {undone ? (
            redo ? (
              <button type="button" className="mlx-btn mlx-undo" data-track="milli_changes_redo" disabled={busy} onClick={() => void useBench.getState().redo()}>
                Вернуть
              </button>
            ) : null
          ) : undo ? (
            <button
              type="button"
              className="mlx-btn mlx-undo"
              data-track="milli_changes_undo"
              disabled={busy || undoing}
              onClick={() => {
                setUndoing(true)
                void benchUndo().finally(() => setUndoing(false))
              }}
            >
              Отменить
            </button>
          ) : null}
        </span>
      </div>
      {open && list.length ? (
        <ul className="mlx-list">
          {list.slice(0, 40).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
          {list.length > 40 ? <li>и ещё {list.length - 40}</li> : null}
        </ul>
      ) : null}
    </>
  )
}

/** Сумма ручных правок по ревизиям: один чип вместо десяти. */
function sumChanges(list: MilliChangeset[]): MilliChangeset {
  return {
    titleRu: 'Ваши правки',
    by: 'user',
    added: list.flatMap((c) => c.added),
    removed: list.flatMap((c) => c.removed),
    changed: list.flatMap((c) => c.changed),
    config: list.flatMap((c) => c.config ?? []),
  }
}

const UNDO_T = 'Отмена'
const REDO_T = new Set(['Вернула', 'Вернула версию'])

/**
 * Что из истории после ответа сейчас в силе: ручные правки стопкой, «Отмена»
 * снимает верхнюю (или сам ответ Милли, если правок нет), «Вернула» — возвращает.
 */
export function benchEdits(after: { changes?: MilliChangeset | null }[]) {
  let live: MilliChangeset[] = []
  let undone: MilliChangeset[] = []
  let ownUndone = false
  for (const r of after) {
    const c = r.changes
    if (!c) continue
    if (c.titleRu === UNDO_T) {
      const top = live.pop()
      if (top) undone.push(top)
      else ownUndone = true
    } else if (REDO_T.has(c.titleRu)) {
      const back = undone.pop()
      if (back) live.push(back)
      else ownUndone = false
    } else if (c.by === 'user' && changeCount(c) > 0) {
      live.push(c)
      undone = []
    }
  }
  return { live, undone, ownUndone }
}

function Changes({ pack }: { pack: MilliPack }) {
  const revs = useBench((s) => s.revs)
  const head = useBench((s) => s.head)
  const canRedo = useBench((s) => s.canRedo)
  const own = pack.changes && changeCount(pack.changes) > 0 ? pack.changes : null
  // Ревизии после этого ответа, если все они — клики игрока: этот ответ последний.
  const at = revs.findIndex((r) => r.buildId === pack.buildId)
  const after = at >= 0 ? revs.slice(at + 1) : []
  const latest = at >= 0 && after.every((r) => r.changes?.by !== 'milli')
  const { live, undone, ownUndone } = latest ? benchEdits(after) : { live: [], undone: [], ownUndone: false }
  const atHead = head?.buildId === pack.buildId
  const canUndo = latest && !!head?.parent
  // Правок в силе нет, но последнюю отменили — она остаётся зачёркнутой с «Вернуть».
  const shownUser = live.length ? sumChanges(live) : undone.length ? undone[undone.length - 1]! : null
  const userUndone = !live.length && undone.length > 0
  if (!own && !shownUser) return null
  return (
    <div className="mlx-wrap">
      {own ? (
        <Chip
          title={own.titleRu || 'Изменения'}
          c={own}
          kind="milli"
          undo={canUndo && !live.length && !ownUndone && (atHead || !shownUser)}
          undone={latest && ownUndone}
          redo={latest && ownUndone && canRedo && !undone.length}
        />
      ) : null}
      {shownUser ? (
        <Chip
          title={'Ваши правки · ' + changeCount(shownUser)}
          c={shownUser}
          kind="user"
          undo={canUndo && live.length > 0}
          undone={userUndone}
          redo={userUndone && canRedo}
        />
      ) : null}
    </div>
  )
}

/** Чип изменений для квитанции в ленте. Падение — без чипа, лента живёт. */
export function BenchChanges({ pack }: { pack: MilliPack | null | undefined }) {
  if (!pack || pack.stub) return null
  return (
    <MilliSafe>
      <Changes pack={pack} />
    </MilliSafe>
  )
}

// ─── Общее для карточки сборки ──────────────────────────────────────────────

/**
 * Ctrl+Z / Ctrl+Shift+Z — отмена и «Вернуть», Ctrl+F — поиск модов
 * (`[data-bench-search]`). Работают, когда фокус внутри `root` (карточка) или
 * на body, и не мешают вводу текста.
 */
export function useBenchKeys(root: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const el = root.current
      if (!el || !(e.ctrlKey || e.metaKey) || e.altKey) return
      const t = e.target as HTMLElement | null
      const inside = !!t && el.contains(t)
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const k = e.key.toLowerCase()
      if (k === 'z' && !typing && (inside || t === document.body)) {
        const s = useBench.getState()
        if (!s.head || (e.shiftKey && !s.canRedo)) return
        e.preventDefault()
        if (e.shiftKey) void s.redo().then((ok) => ok && milliCue('hop', head()))
        else void benchUndo()
      } else if (k === 'f' && inside) {
        const s = useBench.getState()
        if (s.ui.tab !== 'mods' || !s.ui.open) s.openBench('mods')
        requestAnimationFrame(() => {
          const input = el.querySelector<HTMLInputElement>('[data-bench-search]')
          input?.focus()
          input?.select()
        })
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [root, active])
}
