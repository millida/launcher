import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { IconGrid } from './IconGrid'
import { backdropClose } from '../lib/dismiss'
import {
  ICON_BACKGROUNDS,
  composeIcon,
  defaultIconRecipe,
  randomIconRecipe,
  swatchBackground,
} from '../lib/iconArt'
import type { IconRecipe } from '../lib/iconArt'

export function IconEditor({
  title,
  current,
  onCancel,
  onSave,
}: {
  title?: string
  current?: IconRecipe | null
  onCancel: () => void
  onSave: (icon: string, recipe: IconRecipe) => void
}) {
  const [recipe, setRecipe] = useState<IconRecipe>(() => current || defaultIconRecipe())
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const ready = useRef<{ key: string; icon: string } | null>(null)
  const key = recipe.bg + '|' + recipe.symbol

  useEffect(() => {
    let alive = true
    composeIcon(recipe)
      .then((icon) => {
        if (!alive) return
        ready.current = { key: recipe.bg + '|' + recipe.symbol, icon }
        setPreview(icon)
        setError(null)
      })
      .catch((e) => {
        if (!alive) return
        setPreview(null)
        setError('Не удалось собрать иконку: ' + e + '. Выбери другой символ')
      })
    return () => {
      alive = false
    }
  }, [recipe])

  // Escape belongs to the editor while it is open: the app-wide handler would
  // close the build window underneath instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const save = () => {
    const hit = ready.current
    if (hit && hit.key === key) {
      onSave(hit.icon, recipe)
      return
    }
    setSaving(true)
    composeIcon(recipe)
      .then((icon) => onSave(icon, recipe))
      .catch((e) => {
        setSaving(false)
        setError('Не удалось собрать иконку: ' + e + '. Выбери другой символ')
      })
  }

  return (
    <div className="modal-bg open vis" style={{ zIndex: 620 }} {...backdropClose(onCancel)}>
      <div className="modal mw-lg ic-ed">
        <div className="ic-ed-head">
          <div>
            <h3 style={{ margin: 0 }}>Редактор иконки</h3>
            <div className="sub" style={{ margin: '2px 0 0' }}>
              {title ? 'Сборка «' + title + '»' : 'Смешай фон и символ — иконка соберётся сама'}
            </div>
          </div>
          <button className="icon-btn" title="Закрыть" data-sound="close" onClick={onCancel}>
            <Icon id="i-x" />
          </button>
        </div>

        <div className="ic-ed-body">
          <aside className="ic-ed-side">
            <div className="ic-ed-stage">
              <div className="ic-ed-big" style={{ background: swatchBackground(recipe.bg) }}>
                {preview ? <img src={preview} alt="" /> : null}
              </div>
              <div className="ic-ed-sizes">
                {[34, 26, 20].map((s) => (
                  <div
                    key={s}
                    className="ic-ed-mini"
                    style={{ width: s + 'px', height: s + 'px', background: swatchBackground(recipe.bg) }}
                  >
                    {preview ? <img src={preview} alt="" /> : null}
                  </div>
                ))}
              </div>
            </div>
            <button
              className="btn sm secondary ic-ed-roll"
              onClick={() => setRecipe((cur) => randomIconRecipe(cur))}
            >
              <Icon id="i-restart" />
              Случайная
            </button>
            {error ? <p className="ic-ed-err">{error}</p> : null}
          </aside>

          <div className="ic-ed-panes">
            <div className="ic-ed-cap">Фон</div>
            <div className="ic-bg-row">
              {ICON_BACKGROUNDS.map((c) => (
                <button
                  key={c}
                  className={'ic-bg' + (c === recipe.bg ? ' on' : '')}
                  style={{ background: swatchBackground(c) }}
                  title="Выбрать фон"
                  aria-pressed={c === recipe.bg}
                  onClick={() => setRecipe((cur) => ({ ...cur, bg: c }))}
                >
                  {c === recipe.bg ? (
                    <span className="ic-bg-tick">
                      <Icon id="i-check" />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="ic-ed-cap">Символ</div>
            <IconGrid
              id="icEdSymbols"
              flat
              current={recipe.symbol}
              style={{ gridTemplateColumns: 'repeat(6,1fr)', maxHeight: '244px' }}
              onPick={(v) => setRecipe((cur) => ({ ...cur, symbol: v }))}
            />
          </div>
        </div>

        <div className="ic-ed-foot">
          <span className="faint-note">Иконка сохраняется в сборке — картинка не нужна.</span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn md secondary" data-sound="close" onClick={onCancel}>
              Отмена
            </button>
            <button className="btn md primary" disabled={saving || (!preview && !!error)} onClick={save}>
              Сохранить иконку
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
