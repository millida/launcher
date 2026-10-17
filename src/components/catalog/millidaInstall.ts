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
import { t } from '../../i18n'

/*
 * Материал каталога Millida, у которого нет источника на Modrinth (его
 * загрузил автор на millida.net), ставится своим файлом: карточка материала →
 * файл под версию и загрузчик сборки → ядро берёт ссылку и кладёт файл в
 * папку сборки (`install_catalog_file`). Платный — после покупки: ссылку ядру
 * выдаст только аккаунт с доступом.
 */

const RU: Record<string, string> = {
  get mod() {
    return t('Мод')
  },
  get resourcepack() {
    return t('Ресурс-пак')
  },
  get shader() {
    return t('Шейдер')
  },
  get datapack() {
    return t('Дата-пак')
  },
  get world() {
    return t('Карта')
  },
}

export const MILLIDA_KINDS = new Set(Object.keys(RU))

export const millidaPid = (slug: string) => 'millida:' + slug

export const millidaKey = (build: string, kind: string, slug: string) => keyContent('millida', build, kind, slug)

export async function installMillidaItem(o: { slug: string; title: string; kind: string; paid: boolean }): Promise<boolean> {
  if (!MILLIDA_KINDS.has(o.kind)) return false
  if (!hasTauri()) {
    showToast(t('Установка доступна в приложении'))
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
    showToast(apiErrorText(e, t('Каталог не ответил — повтори')), 'error')
    return false
  }
  const pick = pickFile(files, build, o.kind)
  if (!pick) {
    showToast(t('У материала пока нет файла'), 'error')
    return false
  }
  if (!pick.fits && pr) {
    const ok = await uiConfirm(
      pick.versions.length
        ? t('«{title}» нет под {version} · {loader} — есть под {list}. Поставить всё равно?', { title: o.title, version: pr.version, loader: LOADER_NAME(pr), list: pick.versions.join(', ') })
        : t('«{title}» нет под {version} · {loader}. Поставить всё равно?', { title: o.title, version: pr.version, loader: LOADER_NAME(pr) }),
      { title: t('Версия не совпадает'), confirmLabel: t('Поставить'), danger: true },
    )
    if (!ok) return false
  }
  const done = catalogInstallTracker(o.kind, o.slug)
  const startedAt = performance.now()
  return runInstall<ContentInstall>({
    key: millidaKey(prof, o.kind, o.slug),
    title: o.title,
    running: t('Скачивание…'),
    run: () => installCatalogFile(prof, o.kind, o.slug, pick.file.id, o.title, pick.file.sha1),
    onDone: (r) => {
      trackTimed('content_install', startedAt, { name: o.title, kind: o.kind, mc: build?.version || '', loader: build?.loader || '', source: 'millida' })
      done()
      void useMods.getState().refreshInstalled()
      showToast(
        o.kind === 'world'
          ? t('Карта «{map}» → «{pack}»: заходи в одиночную игру', { map: r.file, pack: prof })
          : t('{kind} → «{pack}»: {file}', { kind: RU[o.kind] || t('Файл'), pack: prof, file: r.file }),
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
      showToast(verdictText(v) || apiErrorText(e, t('Не удалось поставить')), 'error')
    },
  })
}
