import { useEffect, useState } from 'react'
import { renderMarkdown } from '../../lib/markdown'
import { cachedTranslation, translateProject, type TrBlock, type TrView } from '../../modals/projectTranslate'
import { weaveMarkdown } from './weave'

/*
 * Полное описание мода по-русски на странице каталога (владелец 10.10.2026: «картинки,
 * потом текст, потом картинки — и только на русском; английский — кнопкой»).
 * Блоки Millida Translate по порядку автора: картинки на месте, текст — переведённый,
 * ещё не переведённый — заглушкой, пока перевод доходит. Чужая реклама (хостинги,
 * донаты, значки, Discord) из описания вырезана.
 */

const AD = /bisecthosting|bisect\.|kinetichosting|shockbyte|apexhosting|apex\s?hosting|pebblehost|sparkedhost|berrybyte|nodecraft|aternos|godlike\.host|scalacube|serverminer|mcprohosting|hostinger|akliz|ko-?fi\.com|patreon\.com|paypal\.|buymeacoffee|boosty|donationalerts|discord\.(gg|com)|discordapp|curseforge\.com\/.*\/(donate|members)|img\.shields\.io|shields\.io|badge|modrinth\.com\/(user|organization)|youtube\.com\/@|twitch\.tv|twitter\.com|x\.com\/|use\s+code|promo\s?code|% off|partner(ed)? with/i

const isAd = (b: TrBlock) => AD.test(b.src) && (b.kind === 'image' || b.kind === 'html' || b.src.length < 400)

const hasLetters = (s: string) => /[\p{L}]/u.test(s.replace(/!\[[^\]]*\]\([^)]*\)|<[^>]+>|https?:\/\/\S+/g, ''))

/** Сколько ждём первый ответ перевода, прежде чем показать текст автора (перевод подменит его, когда придёт). */
const FIRST_WAIT_MS = 4500

export function RuDesc({ projectId, englishBody, shots, lead }: { projectId: string; englishBody: string; shots: string[]; /** Русская строка-суть из каталога — видна сразу. */ lead?: string }) {
  const [view, setView] = useState<TrView | null>(() => cachedTranslation(projectId))
  const [failed, setFailed] = useState(false)
  const [late, setLate] = useState(false)
  const [en, setEn] = useState(false)
  useEffect(() => {
    let alive = true
    setView(cachedTranslation(projectId))
    setFailed(false)
    setLate(false)
    const t = window.setTimeout(() => alive && setLate(true), FIRST_WAIT_MS)
    void translateProject(projectId, (v) => alive && setView(v), () => alive)
      .then((v) => alive && setView(v))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [projectId])

  const ruLead = lead && /[А-Яа-яЁё]/.test(lead) ? <p className="ci-ru-lead">{lead}</p> : null
  // Перевода нет (сбой, долго) — суть по-русски и текст автора; описание не висит заглушкой.
  if (en || ((failed || (late && !view)) && englishBody))
    return (
      <>
        {en ? (
          <button className="ci-lang" data-track="item_desc_ru" onClick={() => setEn(false)}>
            Показать по-русски
          </button>
        ) : (
          <>
            {ruLead}
            <div className="ci-orig-h">{failed ? 'От автора (на английском)' : 'От автора — перевод ещё готовится'}</div>
          </>
        )}
        {renderMarkdown(weaveMarkdown(stripAds(englishBody), shots))}
      </>
    )
  if (!view)
    return failed ? (
      ruLead || <p className="faint-note">Без описания</p>
    ) : (
      <>
        {ruLead}
        <DescWait />
      </>
    )
  const blocks = view.blocks.filter((b) => !isAd(b))
  return (
    <>
      <button className="ci-lang" data-track="item_desc_en" onClick={() => setEn(true)}>
        Оригинал на английском
      </button>
      {blocks.map((b, i) => {
        if (b.kind === 'image' || b.tier === 'same' || !hasLetters(b.src)) return <div key={b.id || i}>{renderMarkdown(b.src)}</div>
        if (b.ru) return <div key={b.id || i}>{renderMarkdown(b.ru)}</div>
        return (
          <div key={b.id || i} className="ci-tr-wait" aria-label="Переводим">
            {Array.from({ length: Math.min(4, Math.max(1, b.lines || 1)) }, (_, k) => (
              <span key={k} className="skel skel-line" style={{ width: 70 + ((i * 13 + k * 7) % 30) + '%' }} />
            ))}
          </div>
        )
      })}
    </>
  )
}

/** Реклама и значки из markdown-описания (запасной путь без перевода). */
export function stripAds(md: string): string {
  return md
    .split(/\n{2,}/)
    .filter((part) => !(AD.test(part) && (/!\[|<img|<a /i.test(part) || part.length < 400)))
    .join('\n\n')
}

function DescWait() {
  return (
    <div className="ci-tr-wait" aria-hidden="true">
      {[92, 100, 96, 70, 100, 84].map((w, i) => (
        <span key={i} className="skel skel-line" style={{ width: w + '%' }} />
      ))}
    </div>
  )
}
