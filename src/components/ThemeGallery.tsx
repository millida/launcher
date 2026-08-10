import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Select } from './Select'
import { Slider } from './Slider'
import { ColorPicker } from './ColorPicker'
import { showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { hasTauri } from '../ipc/tauri'
import { deleteTheme, exportTheme, importTheme, openThemesFolder } from '../ipc/commands'
import type { InstalledThemeFile } from '../ipc/commands'
import { ThemeCatalog } from './ThemeCatalog'
import { ThemeEditor } from './ThemeEditor'
import { emptyDraft, parseDraft } from '../lib/theme-draft'
import type { ThemeDraft } from '../lib/theme-draft'
import {
  BUILTIN_THEMES,
  DENSITIES,
  applyDensity,
  applyOptions,
  applyThemePack,
  availableThemes,
  optionValues,
  rawPackCss,
  saveOptionValues,
  storedDensity,
  storedPackId,
} from '../lib/themes'
import type { Density, ThemeOption, ThemePack } from '../lib/themes'

/// The card for the stock look must keep showing the stock colours even while a
/// pack is active, so it cannot read the live tokens.
const DEFAULT_SWATCHES = ['#161718', '#1E1F20', '#5EC64D']

const BASE_NOTE: Record<string, string> = {
  dark: 'Тема нарисована под тёмную палитру — переключатель темы на ней не действует',
  light: 'Тема нарисована под светлую палитру — переключатель темы на ней не действует',
}

function Swatches({ colors }: { colors?: string[] }) {
  const list = colors && colors.length ? colors.slice(0, 3) : DEFAULT_SWATCHES
  return (
    <div className="th-swatches">
      {list.map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </div>
  )
}

function OptionRow({
  option,
  value,
  onChange,
}: {
  option: ThemeOption
  value: string
  onChange: (v: string) => void
}) {
  const [picker, setPicker] = useState(false)

  return (
    <div className="set-row">
      <span className="lab">
        {option.label}
        {option.hint ? <small>{option.hint}</small> : null}
      </span>
      {option.kind === 'toggle' ? (
        <span
          className={'tgl' + (value === '1' ? ' on' : '')}
          onClick={() => onChange(value === '1' ? '0' : '1')}
        />
      ) : null}
      {option.kind === 'select' ? (
        <Select
          value={value}
          width={220}
          align="right"
          options={(option.items || []).map((i) => ({ value: i.value, label: i.label }))}
          onChange={onChange}
        />
      ) : null}
      {option.kind === 'slider' ? (
        <>
          <Slider
            value={Number(value) || 0}
            min={option.min ?? 0}
            max={option.max ?? 100}
            step={option.step ?? 1}
            width={180}
            onChange={(v) => onChange(String(v))}
          />
          <span className="set-val" style={{ minWidth: '44px', textAlign: 'right' }}>
            {value}
            {option.unit || ''}
          </span>
        </>
      ) : null}
      {option.kind === 'color' ? (
        <div style={{ position: 'relative' }}>
          <button
            className="th-color"
            style={{ background: value }}
            onClick={() => setPicker((o) => !o)}
            title={value}
          />
          {picker ? (
            <ColorPicker value={value} onClose={() => setPicker(false)} onChange={onChange} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ThemeGallery() {
  const [packs, setPacks] = useState<ThemePack[]>(BUILTIN_THEMES)
  const [activeId, setActiveId] = useState(storedPackId)
  const [values, setValues] = useState<Record<string, string>>({})
  const [density, setDensity] = useState<Density>(storedDensity)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<ThemeDraft | null>(null)
  const [savedId, setSavedId] = useState('')

  const active = packs.find((p) => p.id === activeId) || null

  useEffect(() => {
    let alive = true
    void availableThemes().then((list) => {
      if (!alive) return
      setPacks(list)
      const cur = list.find((p) => p.id === storedPackId())
      if (cur) setValues(optionValues(cur))
    })
    return () => {
      alive = false
    }
  }, [])

  async function pick(pack: ThemePack | null) {
    if (busy) return
    setBusy(true)
    try {
      await applyThemePack(pack)
      setActiveId(pack ? pack.id : '')
      setValues(pack ? optionValues(pack) : {})
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  function setOption(key: string, v: string) {
    if (!active) return
    const next = { ...values, [key]: v }
    setValues(next)
    saveOptionValues(active, next)
    applyOptions(active, next)
  }

  function resetOptions() {
    if (!active) return
    const next: Record<string, string> = {}
    for (const o of active.options || []) next[o.key] = o.default
    setValues(next)
    saveOptionValues(active, next)
    applyOptions(active, next)
  }

  async function onImport() {
    setBusy(true)
    try {
      const installed = await importTheme()
      if (!installed) return
      const list = await availableThemes()
      setPacks(list)
      const pack = list.find((p) => p.id === installed.id)
      if (pack) {
        await applyThemePack(pack)
        setActiveId(pack.id)
        setValues(optionValues(pack))
      }
      showToast('Тема «' + installed.name + '» установлена')
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  /// Редактор открывается либо на своей теме, либо копией чужой: встроенные
  /// паки трогать нельзя, а начинать с нуля хочется не всегда.
  async function openEditor(pack: ThemePack | null, copy: boolean) {
    try {
      if (!pack) {
        setDraft(emptyDraft())
        return
      }
      const next = parseDraft(pack, await rawPackCss(pack))
      if (copy) {
        next.basedOn = pack.id
        next.id = ''
        next.name = pack.name + ' — копия'
        next.version = '1.0.0'
        next.options = []
      }
      setDraft(next)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  /// Закрытие редактора возвращает лаунчер к настоящей теме: если что-то
  /// сохранили — к ней, иначе к той, что стояла до превью.
  async function closeEditor() {
    setDraft(null)
    if (!savedId) return
    const list = await availableThemes()
    setPacks(list)
    const pack = list.find((p) => p.id === savedId)
    setSavedId('')
    if (!pack) return
    await applyThemePack(pack)
    setActiveId(pack.id)
    setValues(optionValues(pack))
  }

  /// Файл темы — это и есть способ ей поделиться: тот же архив ставится
  /// кнопкой «Установить из файла» у любого другого игрока.
  async function onExport(pack: ThemePack) {
    try {
      const path = await exportTheme(pack.id)
      if (path) showToast('Тема сохранена: ' + path)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function onCatalogInstall(file: InstalledThemeFile) {
    const list = await availableThemes()
    setPacks(list)
    const pack = list.find((p) => p.id === file.id)
    if (!pack) return
    await applyThemePack(pack)
    setActiveId(pack.id)
    setValues(optionValues(pack))
  }

  async function onDelete(pack: ThemePack) {
    const ok = await uiConfirm('Файлы темы «' + pack.name + '» будут удалены с диска.', {
      title: 'Удалить тему?',
      confirmLabel: 'Удалить',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteTheme(pack.id)
      if (activeId === pack.id) await applyThemePack(null)
      setPacks(await availableThemes())
      if (activeId === pack.id) setActiveId('')
      showToast('Тема удалена')
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <>
      <div className="set-group">
        <div className="cap">Тема оформления</div>
        <div className="th-grid">
          <button
            className={'th-card' + (activeId === '' ? ' on' : '')}
            onClick={() => void pick(null)}
          >
            <Swatches />
            <b>Millida</b>
            <span>Стандартное оформление</span>
          </button>
          {packs.map((p) => (
            <button
              key={p.id}
              className={'th-card' + (activeId === p.id ? ' on' : '')}
              onClick={() => void pick(p)}
            >
              <Swatches colors={p.preview} />
              <b>{p.name}</b>
              <span>{p.description || p.author || ''}</span>
              <span className="th-card-acts">
                <span
                  className="th-act"
                  role="button"
                  title="Создать свою на основе этой"
                  onClick={(e) => {
                    e.stopPropagation()
                    void openEditor(p, true)
                  }}
                >
                  <Icon id="i-copy" />
                </span>
                {p.builtin ? null : (
                  <>
                    <span
                      className="th-act"
                      role="button"
                      title="Изменить тему"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openEditor(p, false)
                      }}
                    >
                      <Icon id="i-brush" />
                    </span>
                    <span
                      className="th-act"
                      role="button"
                      title="Сохранить файл темы"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onExport(p)
                      }}
                    >
                      <Icon id="i-upload" />
                    </span>
                    <span
                      className="th-act th-del"
                      role="button"
                      title="Удалить тему"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onDelete(p)
                      }}
                    >
                      <Icon id="i-trash" />
                    </span>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
        {active && BASE_NOTE[active.base] ? (
          <div className="faint-note">{BASE_NOTE[active.base]}</div>
        ) : null}
        {hasTauri() ? (
          <div className="th-actions">
            <button className="btn sm" onClick={() => void openEditor(null, false)}>
              <Icon id="i-plus" /> Создать тему
            </button>
            <button className="btn sm secondary" disabled={busy} onClick={() => void onImport()}>
              <Icon id="i-download" /> Установить из файла
            </button>
            <button className="btn sm ghost" onClick={() => void openThemesFolder()}>
              <Icon id="i-ext" /> Папка тем
            </button>
          </div>
        ) : null}
      </div>

      {hasTauri() ? (
        <ThemeCatalog installed={packs} onInstalled={(file) => void onCatalogInstall(file)} />
      ) : null}

      {draft ? (
        <ThemeEditor
          initial={draft}
          packs={packs}
          onClose={() => void closeEditor()}
          onSaved={(theme) => setSavedId(theme.id)}
        />
      ) : null}

      {active && (active.options || []).length ? (
        <div className="set-group">
          <div className="cap">
            Настройки темы «{active.name}»
            <button className="th-reset" onClick={resetOptions}>
              Сбросить
            </button>
          </div>
          {(active.options || []).map((o) => (
            <OptionRow
              key={o.key}
              option={o}
              value={values[o.key] ?? o.default}
              onChange={(v) => setOption(o.key, v)}
            />
          ))}
        </div>
      ) : null}

      <div className="set-group">
        <div className="cap">Плотность интерфейса</div>
        <div className="set-row">
          <span className="lab">
            Размер элементов
            <small>{DENSITIES.find((d) => d.id === density)?.hint}</small>
          </span>
          <div className="segs">
            {DENSITIES.map((d) => (
              <button
                key={d.id || 'normal'}
                className={'seg' + (density === d.id ? ' on' : '')}
                style={{ height: '32px', fontSize: '12.5px' }}
                onClick={() => {
                  setDensity(d.id)
                  applyDensity(d.id)
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
