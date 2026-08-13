import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { ColorPicker } from './ColorPicker'
import { Slider } from './Slider'
import { Select } from './Select'
import { showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { backdropClose } from '../lib/dismiss'
import { addThemeAsset, saveTheme } from '../ipc/commands'
import type { InstalledThemeFile } from '../ipc/commands'
import { previewDraftCss, stopDraftPreview } from '../lib/themes'
import type { ThemeBase, ThemePack } from '../lib/themes'
import {
  ALL_TOKENS,
  TOKEN_GROUPS,
  draftCss,
  draftFingerprint,
  draftManifest,
  draftProblem,
  emptyDraft,
  rebaseCss,
} from '../lib/theme-draft'
import type { ThemeDraft, TokenDef } from '../lib/theme-draft'

const BASES: { value: ThemeBase; label: string }[] = [
  { value: 'any', label: 'Любая палитра' },
  { value: 'dark', label: 'Только тёмная' },
  { value: 'light', label: 'Только светлая' },
]

const SNIPPET = [
  '/* Ниже — обычный CSS. Он применяется поверх токенов и может всё:',
  '   :root[data-theme-pack="ID"] .card{ border-width:2px }',
  '   :root[data-theme-pack="ID"] .btn.primary{ text-transform:uppercase }',
  '   Картинки берутся из папки темы: url(bg.png) */',
].join('\n')

function sizeValue(raw: string, fallback: string): number {
  const n = Number.parseFloat(raw || fallback)
  return Number.isFinite(n) ? n : 0
}

function TokenRow({
  def,
  value,
  onChange,
}: {
  def: TokenDef
  value: string
  onChange: (v: string) => void
}) {
  const [picker, setPicker] = useState(false)
  const set = value.trim()

  return (
    <div className="set-row">
      <span className="lab">
        {def.label}
        {def.hint ? <small>{def.hint}</small> : null}
      </span>

      {def.kind === 'color' ? (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="th-color"
            style={{ background: set || def.fallback, opacity: set ? 1 : 0.45 }}
            title={set || 'по умолчанию ' + def.fallback}
            onClick={() => setPicker((o) => !o)}
          />
          {picker ? (
            <ColorPicker
              value={set || def.fallback}
              onClose={() => setPicker(false)}
              onChange={onChange}
            />
          ) : null}
        </div>
      ) : null}

      {def.kind === 'size' ? (
        <>
          <Slider
            value={sizeValue(set, def.fallback)}
            min={def.min ?? 0}
            max={def.max ?? 32}
            step={1}
            width={170}
            onChange={(v) => onChange(v + 'px')}
          />
          <span className="set-val" style={{ minWidth: '46px', textAlign: 'right' }}>
            {sizeValue(set, def.fallback)}px
          </span>
        </>
      ) : null}

      {def.kind === 'text' ? (
        <div className="input sm" style={{ width: '240px' }}>
          <input
            value={set}
            placeholder={def.fallback}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      ) : null}

      <button
        className="th-clear"
        title="Вернуть значение лаунчера"
        disabled={!set}
        onClick={() => onChange('')}
      >
        <Icon id="i-x" />
      </button>
    </div>
  )
}

/**
 * Редактор темы: конструктор токенов и ручной CSS — две вкладки одного файла, а
 * не два режима. Конструктор пересобирает только свой блок, ручной хвост
 * остаётся дословно, поэтому тему можно начать мышкой и дописать руками.
 *
 * Всё, что набрано, сразу видно на самом лаунчере: превью — это и есть
 * приложение, отдельного окна с примерами нет и быть не может, тема правит
 * реальные экраны.
 */
export function ThemeEditor({
  initial,
  packs,
  onClose,
  onSaved,
}: {
  initial: ThemeDraft
  packs: ThemePack[]
  onClose: () => void
  onSaved: (theme: InstalledThemeFile) => void
}) {
  const [draft, setDraft] = useState<ThemeDraft>(initial)
  const [tab, setTab] = useState<'tokens' | 'css'>('tokens')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string>(initial.id)
  const [savedMark, setSavedMark] = useState(() => draftFingerprint(initial))
  const dirRef = useRef<string | undefined>(packs.find((p) => p.id === initial.id)?.dir)
  const dirty = draftFingerprint(draft) !== savedMark

  const taken = useMemo(
    () => packs.filter((p) => p.id !== initial.id).map((p) => p.id),
    [packs, initial.id],
  )
  const problem = draftProblem(draft, taken)
  const css = useMemo(() => draftCss(draft), [draft])

  useEffect(() => {
    if (!draft.id) return
    previewDraftCss(draft.id, draft.base, css, dirRef.current)
  }, [css, draft.id, draft.base])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  async function close() {
    await stopDraftPreview()
    onClose()
  }

  function patch(next: Partial<ThemeDraft>) {
    setDraft((d) => ({ ...d, ...next }))
  }

  function setToken(key: string, value: string) {
    setDraft((d) => ({ ...d, tokens: { ...d.tokens, [key]: value } }))
  }

  async function save(): Promise<InstalledThemeFile | null> {
    if (problem) {
      showToast(problem, 'error')
      return null
    }
    setBusy(true)
    try {
      const theme = await saveTheme({ manifest: draftManifest(draft), css })
      dirRef.current = theme.dir
      setSaved(theme.id)
      setSavedMark(draftFingerprint(draft))
      onSaved(theme)
      return theme
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function onSaveAndClose() {
    if (!dirty) {
      await close()
      return
    }
    const theme = await save()
    if (!theme) return
    showToast('Тема «' + theme.name + '» сохранена')
    await close()
  }

  async function onAddAsset() {
    if (saved !== draft.id) {
      showToast('Сначала сохраните тему — файл кладётся в её папку', 'error')
      return
    }
    try {
      const name = await addThemeAsset(draft.id)
      if (!name) return
      await navigator.clipboard.writeText('url(' + name + ')').catch(() => {})
      showToast('Файл добавлен: ' + name + ' — «url(' + name + ')» скопировано в буфер')
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  /// Терять нечего — незачем и спрашивать: окно закрывается сразу, если с
  /// момента открытия (или последнего сохранения) в черновике ничего не менялось.
  async function onCancel() {
    if (!dirty) {
      void close()
      return
    }
    if (
      !(await uiConfirm('Несохранённые изменения темы пропадут.', {
        title: 'Закрыть редактор?',
        confirmLabel: 'Закрыть',
        danger: true,
      }))
    ) {
      return
    }
    void close()
  }

  return (
    <div className="modal-bg open vis" style={{ zIndex: 600 }} {...backdropClose(() => void onCancel())}>
      <div className="modal th-editor">
        <h3>{initial.id ? 'Тема «' + initial.name + '»' : 'Новая тема'}</h3>
        <div className="sub">
          Изменения видно сразу на самом лаунчере. Пока редактор открыт, тема не сохранена.
        </div>

        <div className="th-ed-head">
          <div className="input sm" style={{ width: '190px' }}>
            <input
              value={draft.name}
              placeholder="Название"
              maxLength={64}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div className="input sm" style={{ width: '150px' }}>
            <input
              value={draft.id}
              placeholder="идентификатор"
              maxLength={32}
              disabled={!!initial.id}
              title={initial.id ? 'Идентификатор темы менять нельзя — по нему её узнают' : ''}
              onChange={(e) => {
                const id = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                // Скопированный CSS написан под селектор исходной темы: без
                // переименования он не применился бы ни к чему.
                setDraft((d) => ({ ...d, id, css: rebaseCss(d.css, d.id || d.basedOn || '', id) }))
              }}
            />
          </div>
          <Select
            value={draft.base}
            width={170}
            options={BASES.map((b) => ({ value: b.value, label: b.label }))}
            onChange={(v) => patch({ base: v as ThemeBase })}
          />
        </div>

        <div className="th-ed-head">
          <div className="input sm" style={{ flex: 1, minWidth: '200px' }}>
            <input
              value={draft.description}
              placeholder="Описание — одна строка на карточке"
              maxLength={300}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>
          <div className="input sm" style={{ width: '130px' }}>
            <input
              value={draft.author}
              placeholder="Автор"
              maxLength={64}
              onChange={(e) => patch({ author: e.target.value })}
            />
          </div>
          <div className="input sm" style={{ width: '90px' }}>
            <input
              value={draft.version}
              placeholder="1.0.0"
              maxLength={24}
              onChange={(e) => patch({ version: e.target.value })}
            />
          </div>
        </div>

        <div className="segs th-ed-tabs">
          <button className={'seg' + (tab === 'tokens' ? ' on' : '')} onClick={() => setTab('tokens')}>
            Конструктор
          </button>
          <button className={'seg' + (tab === 'css' ? ' on' : '')} onClick={() => setTab('css')}>
            CSS
          </button>
        </div>

        <div className="th-ed-body">
          {tab === 'tokens' ? (
            TOKEN_GROUPS.map((g) => (
              <div className="set-group" key={g.id}>
                <div className="cap">{g.label}</div>
                {g.tokens.map((def) => (
                  <TokenRow
                    key={def.key}
                    def={def}
                    value={draft.tokens[def.key] ?? ''}
                    onChange={(v) => setToken(def.key, v)}
                  />
                ))}
              </div>
            ))
          ) : (
            <>
              <textarea
                className="th-ed-css"
                spellCheck={false}
                value={draft.css}
                placeholder={SNIPPET.split('ID').join(draft.id || 'my-theme')}
                onChange={(e) => patch({ css: e.target.value })}
              />
              <div className="th-actions">
                <button className="btn sm ghost" onClick={() => void onAddAsset()}>
                  <Icon id="i-image" /> Добавить картинку или шрифт
                </button>
              </div>
              <div className="faint-note">
                Запрещены `@import` и любой внешний `url()` — тема не должна ходить в сеть.
                Файлы кладите в папку темы и подключайте относительным путём.
              </div>
            </>
          )}
        </div>

        {problem ? <div className="faint-note th-ed-problem">{problem}</div> : null}

        <div className="th-ed-foot">
          <span className="th-ed-count">
            {ALL_TOKENS.filter((t) => (draft.tokens[t.key] ?? '').trim()).length} из{' '}
            {ALL_TOKENS.length} токенов задано
          </span>
          <button className="btn sm ghost" onClick={() => void onCancel()}>
            Отмена
          </button>
          <button
            className="btn sm secondary"
            disabled={busy || !!problem || !dirty}
            onClick={() => void save()}
          >
            Сохранить
          </button>
          <button className="btn sm" disabled={busy || !!problem} onClick={() => void onSaveAndClose()}>
            <Icon id="i-check" /> Готово
          </button>
        </div>
      </div>
    </div>
  )
}

export { emptyDraft }
