import { useEffect, useState } from 'react'
import { Row } from './SetKit'
import { hasTauri } from '../ipc/tauri'
import { openProfileFolder, type BuildUsage, type DiskUsage as Usage } from '../ipc/commands'
import { cleanOldLogs, diskUsage } from '../ipc/modTools'
import { apiErrorText } from '../lib/apiError'
import { showToast } from '../state/ui'
import { t, useT } from '../i18n'

/** Байты по-человечески: КБ, МБ, ГБ. */
export function bytesText(b: number): string {
  if (b >= 1024 ** 3) return t('{n} ГБ', { n: (b / 1024 ** 3).toFixed(b < 10 * 1024 ** 3 ? 1 : 0) })
  if (b >= 1024 ** 2) return t('{n} МБ', { n: Math.round(b / 1024 ** 2) })
  return t('{n} КБ', { n: Math.max(b ? 1 : 0, Math.round(b / 1024)) })
}

const parts = (): [keyof BuildUsage, string][] => [
  ['mods', t('Моды')],
  ['saves', t('Миры')],
  ['screenshots', t('Скриншоты')],
  ['resourcepacks', t('Ресурспаки')],
  ['shaderpacks', t('Шейдеры')],
  ['logs', t('Логи')],
  ['crashReports', t('Отчёты о вылетах')],
  ['other', t('Прочее')],
]

/// «Что съело 30 ГБ»: место каждой сборки по папкам. Подсчёт идёт в ядре в фоне, окно не ждёт его.
/// Удалять отсюда можно только старые логи и отчёты о вылетах; миры и скриншоты — только открыть папку.
export function DiskUsage() {
  const t = useT()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState('')

  const load = () => {
    if (!hasTauri()) return
    setBusy('scan')
    diskUsage()
      .then(setUsage)
      .catch((e) => showToast(apiErrorText(e, t('Не удалось посчитать место')), 'error'))
      .finally(() => setBusy(''))
  }
  useEffect(load, [])

  const clean = (profile: string | null) => {
    setBusy(profile ?? '*')
    cleanOldLogs(profile)
      .then((freed) => {
        showToast(freed ? t('Освобождено: {size}', { size: bytesText(freed) }) : t('Старых логов нет'), 'ok')
        load()
      })
      .catch((e) => {
        showToast(apiErrorText(e, t('Не удалось удалить логи')), 'error')
        setBusy('')
      })
  }

  const builds = usage?.builds ?? []
  const own = builds.reduce((s, b) => s + b.total, 0)
  const oldAll = builds.reduce((s, b) => s + b.oldLogs, 0)
  const top = builds[0]?.total || 1
  return (
    <>
      <Row
        title={t('Место на диске')}
        keys="место диск размер гигабайты сборки логи вылеты очистить"
        hint={
          !hasTauri()
            ? t('Доступно в приложении')
            : !usage
              ? t('Считаем…')
              : t('Сборки: {own} · общие файлы: {shared} · игра: {game}', { own: bytesText(own), shared: bytesText(usage.shared), game: bytesText(usage.game) })
        }
      >
        <button className="btn sm secondary" disabled={!!busy || !oldAll} onClick={() => clean(null)} data-tip={t('Логи и отчёты о вылетах старше 14 дней во всех сборках')}>
          {busy === '*' ? t('Чистим…') : oldAll ? t('Удалить старые логи · {size}', { size: bytesText(oldAll) }) : t('Старых логов нет')}
        </button>
        <button className="btn sm ghost" disabled={!!busy} onClick={load}>
          {busy === 'scan' ? t('Считаем…') : t('Пересчитать')}
        </button>
      </Row>
      {usage && usage.saved ? <p className="s2-disk-saved">{t('Сэкономлено общим хранилищем: {size}', { size: bytesText(usage.saved) })}</p> : null}
      {builds.length ? (
        <ul className="s2-disk" aria-busy={busy === 'scan'}>
          {builds.map((b) => (
            <li key={b.name} className={open === b.name ? 'open' : ''}>
              <button className="s2-disk-row" aria-expanded={open === b.name} onClick={() => setOpen(open === b.name ? '' : b.name)}>
                <b>{b.name}</b>
                <span className="s2-disk-bar" aria-hidden>
                  <i style={{ transform: `scaleX(${Math.max(0.02, b.total / top)})` }} />
                </span>
                <span>{bytesText(b.total)}</span>
              </button>
              {open === b.name ? (
                <div className="s2-disk-more">
                  <dl>
                    {parts()
                      .filter(([k]) => (b[k] as number) > 0)
                      .map(([k, label]) => (
                      <div key={k}>
                        <dt>{label}</dt>
                        <dd>{bytesText(b[k] as number)}</dd>
                      </div>
                    ))}
                    {b.shared ? (
                      <div>
                        <dt>{t('Из общего хранилища')}</dt>
                        <dd>{bytesText(b.shared)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="s2-disk-acts">
                    <button className="btn sm secondary" onClick={() => void openProfileFolder(b.name)}>
                      {t('Открыть папку')}
                    </button>
                    <button className="btn sm ghost" disabled={!!busy || !b.oldLogs} onClick={() => clean(b.name)}>
                      {busy === b.name ? t('Чистим…') : b.oldLogs ? t('Удалить старые логи · {size}', { size: bytesText(b.oldLogs) }) : t('Старых логов нет')}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
