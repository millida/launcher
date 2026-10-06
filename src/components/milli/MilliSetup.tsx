import { useEffect, useState } from 'react'
import { useStagger } from './motion'
import { PxArt } from './px'
import type { MilliPack } from '../../lib/milli'
import '../../styles/pixel/milli-config.css'

/*
 * Событие в ленте «Настраиваю графику под твой ПК…»: строки `pack.setup.lines`
 * печатаются по одной, [Изменить] раскрывает вкладку «Настройки» карточки.
 * Сервер может прислать строки текстом или объектами — читаем оба вида.
 */

export interface MilliSetupLine {
  key: string
  /** «Дальность прорисовки». */
  ru: string
  /** «6», «выкл», «3 ГБ»; пусто — строка целиком в `ru`. */
  value: string
  px: string
}

const PX_BY_KEY: Record<string, string> = {
  renderDistance: 'spyglass',
  simulationDistance: 'clock',
  ramMb: 'redstone',
  jvm: 'comparator',
  shaders: 'glowstone',
  shaderPack: 'glowstone',
  shaderLevel: 'glowstone',
  graphicsMode: 'painting',
  entityShadows: 'torch',
  renderClouds: 'painting',
  particles: 'firework_star',
  maxFps: 'clock',
  lang: 'book_quill',
  profile: 'comparator',
  low: 'iron_ingot',
  balanced: 'gold_ingot',
  high: 'diamond',
}

/** По тексту строки — иконка, если сервер ключ не прислал. */
function guessKey(ru: string): string {
  const t = ru.toLowerCase()
  if (/памят|озу|гб/.test(t)) return 'ramMb'
  if (/шейдер/.test(t)) return 'shaders'
  if (/симуляц/.test(t)) return 'simulationDistance'
  if (/дальност|прорисов|чанк/.test(t)) return 'renderDistance'
  if (/fps|кадр/.test(t)) return 'maxFps'
  if (/язык|русск/.test(t)) return 'lang'
  if (/jvm|zgc|g1/.test(t)) return 'jvm'
  return ''
}

/** Строки события из `pack.setup` — пусто, если сервер его не прислал или прислал мусор. */
export function setupLines(pack: Pick<MilliPack, 'buildId'> & { setup?: unknown }): MilliSetupLine[] {
  const setup = pack.setup as { lines?: unknown } | null | undefined
  const raw = setup && Array.isArray(setup.lines) ? setup.lines : []
  const out: MilliSetupLine[] = []
  for (const l of raw.slice(0, 12)) {
    const o = l && typeof l === 'object' ? (l as Record<string, unknown>) : null
    const ru = typeof l === 'string' ? l : typeof o?.ru === 'string' ? o.ru : typeof o?.text === 'string' ? o.text : ''
    if (!ru.trim()) continue
    const key = typeof o?.key === 'string' ? o.key : guessKey(ru)
    const px = typeof o?.px === 'string' ? o.px : PX_BY_KEY[key] || 'comparator'
    const value = typeof o?.value === 'string' || typeof o?.value === 'number' ? String(o.value).trim().slice(0, 32) : ''
    out.push({ key, ru: ru.trim().slice(0, 80), value, px })
  }
  return out
}

/** Коротко (1–2 слова) для известных ключей; полный текст сервера — в title. */
const SHORT_RU: Record<string, string> = {
  renderDistance: 'Дальность',
  simulationDistance: 'Симуляция',
  ramMb: 'Память',
  jvm: 'JVM',
  shaders: 'Шейдеры',
  shaderPack: 'Шейдеры',
  shaderLevel: 'Шейдеры',
  graphicsMode: 'Графика',
  entityShadows: 'Тени',
  renderClouds: 'Облака',
  particles: 'Частицы',
  maxFps: 'Лимит FPS',
  lang: 'Язык',
  ao: 'Плавный свет',
}
const shortRu = (l: MilliSetupLine) => (l.value && SHORT_RU[l.key]) || l.ru

const STEP_MS = 280
/** Уже показанные события не печатаются заново (вернулись в чат, перерисовка, история). */
const played = new Set<string>()

/**
 * `compact` — свёрнуто в одну строку-чип «Графика под твой ПК ›»; клик раскрывает
 * строки (печатаются по одной уже при раскрытии).
 */
export function MilliSetup({ pack, onEdit, compact }: { pack: MilliPack; onEdit?: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(!compact)
  const lines = setupLines(pack as MilliPack & { setup?: unknown })
  if (!lines.length) return null
  const setup = (pack as { setup?: { titleRu?: unknown; profile?: unknown } }).setup
  const title = typeof setup?.titleRu === 'string' && setup.titleRu.trim() ? setup.titleRu : 'Графика под твой ПК'
  const prof = typeof setup?.profile === 'string' ? PX_BY_KEY[setup.profile] : undefined
  if (!open)
    return (
      <button type="button" className="mset-chip mlm-pop" aria-expanded={false} data-track="milli_setup_open" onClick={() => setOpen(true)}>
        <PxArt name={prof || 'comparator'} size={16} />
        <span>{title}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    )
  return <SetupBody pack={pack} lines={lines} title={title} prof={prof} onEdit={onEdit} />
}

function SetupBody({ pack, lines, title, prof, onEdit }: { pack: MilliPack; lines: MilliSetupLine[]; title: string; prof?: string; onEdit?: () => void }) {
  const id = pack.buildId
  const [fromHistory] = useState(() => played.has(id))
  const shown = useStagger(lines.length, STEP_MS, fromHistory)
  const done = shown >= lines.length
  useEffect(() => {
    if (done && lines.length) played.add(id)
  }, [done, lines.length, id])

  return (
    <div className={'mset' + (done ? ' done' : '')} data-done={done ? '1' : '0'} aria-live="polite">
      <div className="mset-head">
        <PxArt name={prof || 'comparator'} size={16} />
        <span>{title}</span>
      </div>
      <ul className="mset-lines">
        {lines.map((l, i) => (
          <li
            key={i}
            className={'mset-line' + (i < shown ? ' on' : '')}
            aria-hidden={i < shown ? undefined : true}
          >
            <PxArt name={l.px} size={16} className="mset-line-px" />
            <span className="mset-line-k" title={l.ru}>
              {shortRu(l)}
            </span>
            {l.value ? <b className="mset-line-v">{l.value}</b> : null}
          </li>
        ))}
      </ul>
      {onEdit ? (
        <div className="mset-foot">
          <button className="btn sm ghost" onClick={onEdit} disabled={!done}>
            Изменить
          </button>
        </div>
      ) : null}
    </div>
  )
}
