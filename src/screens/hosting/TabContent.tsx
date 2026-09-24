import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { SiteCatalog } from '../../components/catalog/SiteCatalog'
import type { CatalogTarget } from '../../components/catalog/target'
import { FilterPill } from '../../components/FilterPill'
import { CatalogRow } from '../../components/catalog/CatalogRow'
import { CatalogShell, type CatalogNote, type CatalogTab } from '../../components/catalog/CatalogShell'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { Empty, Loading } from './kit'
import { host, errText } from './api'
import type { CatalogCore, CatalogHit, CurseHit, FtbPack, HostingInstall, InstallUpdate } from './api'
import { mirrorAsset } from '../../lib/api'

type Source = 'modrinth' | 'curseforge' | 'ftb'

/*
 * Контент сервера: обновления, «Сейчас на сервере» и каталог.
 *
 * Каталог — ТОТ ЖЕ компонент, что «Ресурсы» лаунчера (`SiteCatalog`,
 * `target="server"`): те же разделы сайта (сборки, серверные сборки, плагины,
 * моды, дата-паки, карты), те же строки и фильтры, кнопка — «На сервер» этого
 * сервера (приказ владельца 24.09.2026, 18:35: «каталог один — обновили кнопку,
 * и она везде»). Ставит `install-catalog` хостинга, как сайт.
 *
 * Чего в каталоге сайта нет, осталось своим разделом рядом:
 * - «Ядра» — смена ядра и версии сервера (`PATCH /core`), первым разделом;
 * - «Другие каталоги» — прямой поиск Modrinth / CurseForge / FTB хостинга:
 *   в каталоге сайта плагинов 808 против ~18 тыс. на Modrinth, и FTB-сборок
 *   в нём нет — прежний путь установки не теряем.
 */
const SOURCE_TABS: CatalogTab[] = [
  { id: 'modpack', label: 'Сборки', icon: 'i-box2' },
  { id: 'plugin', label: 'Плагины', icon: 'i-grid' },
  { id: 'mod', label: 'Моды', icon: 'i-blocks' },
  { id: 'map', label: 'Карты', icon: 'i-map' },
  { id: 'datapack', label: 'Дата-паки', icon: 'i-book' },
]

const INSTALL_KIND: Record<string, string> = {
  MOD: 'Мод',
  PLUGIN: 'Плагин',
  MODPACK: 'Сборка',
  DATAPACK: 'Дата-пак',
  MAP: 'Карта',
}

const INSTALL_SOURCE: Record<string, string> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  ftb: 'FTB',
  market: 'Маркет',
  upload: 'Свой файл',
  partner: 'Сборка партнёра',
  catalog: 'Каталог Millida',
}

const INSTALL_ST: Record<string, [string, string]> = {
  PENDING: ['Встанет при запуске', 'warn'],
  INSTALLED: ['Установлено', 'acc'],
  FAILED: ['Ошибка', 'danger'],
}

const FAMILY_LABEL: Record<string, string> = {
  vanilla: 'Без модов и плагинов',
  plugins: 'Держит плагины',
  mods: 'Держит моды',
  proxy: 'Связывает серверы',
}

/** Версия сортируется как версия, а не как строка: 1.9 выше 1.10. */
function verKey(v: string): number[] {
  return v.split(/[.\-+]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1))
}
function verCmp(a: string, b: string): number {
  const x = verKey(a)
  const y = verKey(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1)
    if (d) return d
  }
  return 0
}

export function TabContent({
  serverId,
  core,
  version,
  running,
  onChanged,
}: {
  serverId: string
  core: string
  version: string
  running: boolean
  onChanged: () => void
}) {
  const [installs, setInstalls] = useState<HostingInstall[] | null>(null)
  const [updates, setUpdates] = useState<InstallUpdate[]>([])
  const [updBusy, setUpdBusy] = useState<string | null>(null)

  const loadInstalls = () => {
    void host
      .installs(serverId)
      .then((r) => setInstalls(Array.isArray(r) ? r : []))
      .catch(() => setInstalls([]))
    void host
      .installUpdates(serverId)
      .then((r) => setUpdates(Array.isArray(r) ? r.filter((u) => u.updateAvailable) : []))
      .catch(() => setUpdates([]))
  }
  useEffect(loadInstalls, [serverId])

  // Установка из каталога (любой раздел) обновляет «Сейчас на сервере» и шапку панели.
  const changed = useRef(() => {})
  changed.current = () => {
    loadInstalls()
    onChanged()
  }
  const target = useMemo<CatalogTarget>(() => ({ kind: 'server', serverId, onInstalled: () => changed.current() }), [serverId])

  const removeInstall = async (item: HostingInstall) => {
    if (!(await uiConfirm('Убрать «' + item.name + '» с сервера?', { confirmLabel: 'Убрать' }))) return
    try {
      await host.removeInstall(serverId, item.id)
      setInstalls((list) => (list || []).filter((x) => x.id !== item.id))
      showToast('Убрали. Применится после перезапуска')
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const applyUpdate = async (u: InstallUpdate) => {
    const item = (installs || []).find((i) => i.id === u.installId)
    if (!item) return
    setUpdBusy(u.installId)
    try {
      await host.install(serverId, {
        projectId: item.projectId,
        source: (item.source as Source) || 'modrinth',
        ...(u.latestVersionId ? { versionId: u.latestVersionId } : {}),
      })
      showToast('«' + item.name + '» обновится при следующем запуске')
      changed.current()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setUpdBusy(null)
    }
  }

  const legacy = { serverId, core, version, running, onChanged: () => changed.current() }

  return (
    <>
      {updates.length ? (
        <div className="card" style={{ padding: '18px' }}>
          <div className="side-cap" style={{ padding: '0 2px 10px' }}>
            Есть обновления — {updates.length}
          </div>
          <div className="stack">
            {updates.map((u) => (
              <div className="fr-row" key={u.installId}>
                <span className="host-ico" style={{ width: 34, height: 34 }}>
                  <Icon id="i-arrow-up" />
                </span>
                <span className="fr-body">
                  <span className="fr-nick">{u.name}</span>
                  <span className="fr-status">
                    {(u.current || '—') + ' → ' + (u.latest || '—')}
                    {u.compatible ? '' : ' · под другую версию'}
                  </span>
                </span>
                <button className="btn sm secondary" disabled={!u.compatible || updBusy === u.installId} onClick={() => void applyUpdate(u)}>
                  Обновить
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: '18px', marginTop: updates.length ? '14px' : 0 }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          Сейчас на сервере — {core} {version}
        </div>
        {installs === null ? (
          <Loading />
        ) : installs.length ? (
          <div className="stack">
            {installs.map((i) => {
              const st = INSTALL_ST[i.status] || ['—', 'off']
              return (
                <div className="fr-row" key={i.id}>
                  {i.iconUrl ? (
                    <img src={mirrorAsset(i.iconUrl)} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }} />
                  ) : (
                    <span className="host-ico" style={{ width: 34, height: 34 }}>
                      <Icon id="i-box" />
                    </span>
                  )}
                  <span className="fr-body">
                    <span className="fr-nick">{i.name}</span>
                    <span className="fr-status">
                      {(INSTALL_KIND[i.kind] || i.kind) +
                        (INSTALL_SOURCE[i.source] ? ' · ' + INSTALL_SOURCE[i.source] : '') +
                        (i.versionName ? ' · ' + i.versionName : '')}
                      {i.error ? ' · ' + i.error : ''}
                    </span>
                  </span>
                  <span className={'pill ' + st[1]}>
                    <span className="dot"></span> {st[0]}
                  </span>
                  <button className="btn sm secondary" onClick={() => void removeInstall(i)}>
                    <Icon id="i-trash" /> Убрать
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <Empty icon="i-box" text="Пока пусто" />
        )}
      </div>

      <div className="card cat2-host" style={{ padding: '18px', marginTop: '14px' }}>
        <SiteCatalog
          target={target}
          extra={[
            { id: 'core', label: 'Ядра', first: true, node: <LegacyCatalog key="core" mode="core" {...legacy} /> },
            { id: 'sources', label: 'Другие каталоги', node: <LegacyCatalog key="sources" mode="sources" {...legacy} /> },
          ]}
        />
      </div>
    </>
  )
}

/** Ядра и прямой поиск Modrinth / CurseForge / FTB — то, чего нет в каталоге сайта. */
function LegacyCatalog({
  mode,
  serverId,
  core,
  version,
  running,
  onChanged,
}: {
  mode: 'core' | 'sources'
  serverId: string
  core: string
  version: string
  running: boolean
  onChanged: () => void
}) {
  const [cores, setCores] = useState<CatalogCore[] | null>(null)
  const [coresFailed, setCoresFailed] = useState(false)
  const [pickVersion, setPickVersion] = useState(version)
  const [savingCore, setSavingCore] = useState(false)

  const [tab, setTab] = useState(mode === 'core' ? 'core' : 'modpack')
  const [source, setSource] = useState<Source>('modrinth')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<(CatalogHit | CurseHit)[] | null>(null)
  const [packs, setPacks] = useState<FtbPack[] | null>(null)
  const [more, setMore] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => setPickVersion(version), [version])

  const loadCores = () => {
    setCoresFailed(false)
    setCores(null)
    void host
      .cores()
      .then((r) => setCores(r.cores || []))
      .catch((e) => {
        console.warn('[hosting] cores', e)
        setCores([])
        setCoresFailed(true)
      })
  }
  useEffect(() => {
    if (mode === 'core') loadCores()
  }, [mode])

  const search = async (offset?: number) => {
    const my = ++seq.current
    setSearching(true)
    setFailed(false)
    if (!offset) {
      setHits(null)
      setPacks(null)
      setMore(null)
    }
    try {
      if (source === 'ftb') {
        const r = await host.searchFtb(query.trim() || undefined)
        if (my !== seq.current) return
        setPacks(r.packs || [])
        setMore(null)
      } else if (source === 'curseforge') {
        const r = await host.searchCurse({ type: tab, query: query.trim() || undefined, version, offset })
        if (my !== seq.current) return
        // «Каталог выключен» — это не пустая выдача: показываем причину списком, а не тостом.
        setHits((old) => (offset ? [...(old || []), ...(r.hits || [])] : r.hits || []))
        setMore(r.enabled && r.hasMore ? r.nextOffset : null)
        if (!r.enabled) setFailed(true)
      } else {
        const r = await host.search({
          type: tab,
          query: query.trim() || undefined,
          sort: query.trim() ? 'relevance' : 'downloads',
          offset,
        })
        if (my !== seq.current) return
        setHits((old) => (offset ? [...(old || []), ...(r.hits || [])] : r.hits || []))
        setMore(r.hasMore ? r.nextOffset : null)
      }
    } catch (e) {
      if (my !== seq.current) return
      console.warn('[hosting] catalog search', e)
      setFailed(true)
      if (!offset) setHits([])
    } finally {
      if (my === seq.current) setSearching(false)
    }
  }

  useEffect(() => {
    if (tab === 'core') return
    void search()
  }, [tab, source])

  const applyCore = async (next: CatalogCore) => {
    const ver = next.versions.includes(pickVersion) ? pickVersion : next.latest || next.versions[0] || pickVersion
    if (
      !(await uiConfirm(
        'Поставить ' + next.name + ' ' + ver + '? Установленная сборка сбросится, мир останется.',
        { confirmLabel: 'Поставить' },
      ))
    )
      return
    setSavingCore(true)
    try {
      await host.changeCore(serverId, { core: next.id, version: ver })
      showToast('Ядро сервера: ' + next.name + ' ' + ver + (running ? ' — сервер перезапустится' : ''))
      onChanged()
    } catch (e) {
      showToast('Не удалось сменить ядро: ' + errText(e), 'error')
    } finally {
      setSavingCore(false)
    }
  }

  const install = async (projectId: string, name: string, src: Source, versionId?: string) => {
    setBusyId(projectId)
    try {
      await host.install(serverId, { projectId, source: src, ...(versionId ? { versionId } : {}) })
      showToast('«' + name + '» встанет при следующем запуске')
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const isCores = tab === 'core'
  const coreList = cores || []
  const allVersions = [...new Set(coreList.flatMap((c) => c.versions).concat(version))].sort(verCmp)
  const q = query.trim().toLowerCase()
  const coreHits = coreList
    .filter((c) => c.versions.includes(pickVersion))
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name))

  const rows = isCores ? coreHits.length : packs ? packs.length : hits ? hits.length : 0
  const loading = isCores ? cores === null : searching && !rows
  const note: CatalogNote | null =
    loading || rows
      ? null
      : isCores
        ? coresFailed
          ? { icon: 'i-alert', title: 'Каталог не ответил', action: { label: 'Повторить', primary: true, icon: 'i-restart', onClick: loadCores } }
          : { icon: 'i-search', title: 'Под эту версию ядер нет' }
        : failed
          ? {
              icon: 'i-alert',
              title: 'Каталог не ответил',
              action: { label: 'Повторить', primary: true, icon: 'i-restart', onClick: () => void search() },
            }
          : {
              icon: 'i-search',
              title: 'Ничего не нашли',
              ...(q
                ? {
                    action: {
                      label: 'Сбросить',
                      onClick: () => {
                        setQuery('')
                        void search()
                      },
                    },
                  }
                : {}),
            }

  return (
    <>
      <div className="cat2-legacy">
        <CatalogShell
          tabs={mode === 'core' ? [] : SOURCE_TABS}
          tab={tab}
          compact
          onTab={(id) => {
            setTab(id)
            if (id !== 'modpack' && source === 'ftb') setSource('modrinth')
          }}
          search={{
            value: query,
            onChange: (v, commit) => {
              setQuery(v)
              if (commit && !isCores) void search()
            },
          }}
          filters={
            isCores ? (
              <FilterPill
                icon="i-box"
                label="Версия игры"
                width={160}
                value={pickVersion}
                options={allVersions.map((v) => ({ value: v, label: v }))}
                onPick={setPickVersion}
              />
            ) : (
              <FilterPill
                icon="i-download"
                label="Источник"
                defaultValue="modrinth"
                value={source}
                options={[
                  { value: 'modrinth', label: 'Modrinth' },
                  { value: 'curseforge', label: 'CurseForge' },
                  ...(tab === 'modpack' ? [{ value: 'ftb', label: 'FTB' }] : []),
                ]}
                onPick={(v) => setSource(v as Source)}
              />
            )
          }
          note={note}
          loading={loading}
          dim={searching && !!rows}
          more={!isCores && more !== null ? { onClick: () => void search(more), busy: searching } : undefined}
        >
          {isCores
            ? coreHits.map((c) => {
                const now = c.id === core && pickVersion === version
                return (
                  <CatalogRow
                    key={c.id}
                    fallbackIcon="i-server-cog"
                    title={c.name}
                    desc={FAMILY_LABEL[c.family] || ''}
                    aside={
                      c.recommended && !now ? (
                        <span className="cat2-now">
                          <Icon id="i-star" />
                          Советуем
                        </span>
                      ) : null
                    }
                    action={{
                      label: now ? 'Стоит сейчас' : 'Поставить',
                      done: now,
                      disabled: savingCore || now,
                      onClick: () => void applyCore(c),
                    }}
                  />
                )
              })
            : packs
              ? packs.map((p) => {
                  const v = p.versions && p.versions.length ? p.versions[0] : null
                  return (
                    <CatalogRow
                      key={p.id}
                      icon={p.iconUrl}
                      title={p.name}
                      desc={p.summary}
                      downloads={p.installs}
                      downloadsLabel="установок"
                      aside={
                        v && v.minRamMb ? (
                          <span className="cat-dl">
                            <Icon id="i-server" />
                            <b>от {Math.round(v.minRamMb / 1024)} ГБ</b>
                          </span>
                        ) : null
                      }
                      action={{
                        label: 'Поставить',
                        disabled: busyId === String(p.id),
                        onClick: () => void install(String(p.id), p.name, 'ftb'),
                      }}
                    />
                  )
                })
              : (hits || []).map((h) => {
                  const id = source === 'curseforge' ? String((h as CurseHit).id) : (h as CatalogHit).id
                  return (
                    <CatalogRow
                      key={id}
                      icon={h.iconUrl}
                      title={h.name}
                      author={'author' in h ? h.author : undefined}
                      desc={h.summary}
                      downloads={h.downloads}
                      action={{
                        label: 'Поставить',
                        disabled: busyId === id,
                        onClick: () => void install(id, h.name, source),
                      }}
                    />
                  )
                })}
        </CatalogShell>
      </div>
    </>
  )
}
