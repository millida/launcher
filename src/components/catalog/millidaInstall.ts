import { hasTauri } from '../../ipc/tauri'
import { installCatalogFile } from '../../ipc/commands'
import type { ContentInstall } from '../../ipc/commands'
import { catalogInstallTracker, resolveTargetBuild } from '../../lib/install'
import { keyContent } from '../../lib/installKeys'
import { LOADER_NAME, loaderId } from '../../lib/format'
import { apiErrorText } from '../../lib/apiError'
import { trackTimed } from '../../lib/telemetry'
import { runInstall } from '../../state/installs'
import { useMods } from '../../state/mods'
import { useProfiles } from '../../state/profiles'
import { uiConfirm } from '../../state/confirm'
import { showToast } from '../../state/ui'
import { loadItem } from './site'
import { paidVerdict, pickFile, verdictText } from './paid'
import { requireMillida, usePaid } from './paidStore'

/*
 * Материал каталога Millida, у которого нет источника на Modrinth (его
 * загрузил автор на millida.net), ставится своим файлом: карточка материала →
 * файл под версию и загрузчик сборки → ядро берёт ссылку и кладёт файл в
 * папку сборки (`install_catalog_file`). Платный — после покупки: ссылку ядру
 * выдаст только аккаунт с доступом.
 */

const RU: Record<string, string> = { mod: 'Мод', resourcepack: 'Ресурс-пак', shader: 'Шейдер', datapack: 'Дата-пак', world: 'Карта' }

export const MILLIDA_KINDS = new Set(Object.keys(RU))

export const millidaPid = (slug: string) => 'millida:' + slug

export const millidaKey = (build: string, kind: string, slug: string) => keyContent('millida', build, kind, slug)

export async function installMillidaItem(o: { slug: string; title: string; kind: string; paid: boolean }): Promise<boolean> {
  if (!MILLIDA_KINDS.has(o.kind)) return false
  if (!hasTauri()) {
    showToast('Установка доступна в приложении')
    return false
  }
  if (o.paid && !(await requireMillida())) return false
  const prof = await resolveTargetBuild(o.kind)
  if (!prof) return false
  const pr = useProfiles.getState().profiles.find((p) => p.name === prof)
  const build = pr ? { version: pr.version || '', loader: loaderId(pr) } : null
  let files
  try {
    // После покупки — мимо кэша: до неё сервер мог не показать файлы.
    files = (await loadItem(o.slug, o.paid)).files
  } catch (e) {
    showToast(apiErrorText(e, 'Каталог не ответил — повтори'), 'error')
    return false
  }
  const pick = pickFile(files, build, o.kind)
  if (!pick) {
    showToast('У материала пока нет файла', 'error')
    return false
  }
  if (!pick.fits && pr) {
    const ok = await uiConfirm(
      '«' + o.title + '» нет под ' + pr.version + ' · ' + LOADER_NAME(pr) + (pick.versions.length ? ' — есть под ' + pick.versions.join(', ') : '') + '. Поставить всё равно?',
      { title: 'Версия не совпадает', confirmLabel: 'Поставить', danger: true },
    )
    if (!ok) return false
  }
  const done = catalogInstallTracker(o.kind, o.slug)
  const startedAt = performance.now()
  return runInstall<ContentInstall>({
    key: millidaKey(prof, o.kind, o.slug),
    title: o.title,
    running: 'Скачивание…',
    run: () => installCatalogFile(prof, o.kind, o.slug, pick.file.id, o.title, pick.file.sha1),
    onDone: (r) => {
      trackTimed('content_install', startedAt, { name: o.title, kind: o.kind, mc: build?.version || '', loader: build?.loader || '', source: 'millida' })
      done()
      void useMods.getState().refreshInstalled()
      showToast(
        o.kind === 'world'
          ? 'Карта «' + r.file + '» → «' + prof + '»: заходи в одиночную игру'
          : (RU[o.kind] || 'Файл') + ' → «' + prof + '»: ' + r.file,
        'ok',
        'install',
      )
    },
    onError: (e) => {
      const v = paidVerdict(e)
      if (v.kind === 'no-access') usePaid.setState((s) => ({ access: { ...s.access, [o.slug]: 'locked' } }))
      if (v.kind === 'login') {
        void requireMillida()
        return
      }
      showToast(verdictText(v) || apiErrorText(e, 'Не удалось поставить'), 'error')
    },
  })
}
