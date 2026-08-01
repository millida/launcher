import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { Cap, Empty, Loading, Row, downloadsLabel } from './kit'
import { host, errText } from './api'
import type { CatalogCore, CatalogHit, CurseHit, FtbPack, HostingInstall, InstallUpdate } from './api'

type Source = 'modrinth' | 'curseforge' | 'ftb'

const KIND_TABS: [string, string][] = [
  ['modpack', 'Сборки'],
  ['map', 'Карты'],
  ['mod', 'Моды'],
  ['plugin', 'Плагины'],
  ['datapack', 'Датапаки'],
]

const INSTALL_KIND: Record<string, string> = {
  MOD: 'Мод',
  PLUGIN: 'Плагин',
  MODPACK: 'Сборка',
  DATAPACK: 'Датапак',
  MAP: 'Карта',
}

const INSTALL_ST: Record<string, [string, string]> = {
  PENDING: ['Встанет при запуске', 'warn'],
  INSTALLED: ['Установлено', 'acc'],
  FAILED: ['Ошибка', 'danger'],
}

const FAMILY_LABEL: Record<string, string> = {
  vanilla: 'Ванильные',
  plugins: 'С плагинами',
  mods: 'С модами',
  proxy: 'Прокси',
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
  const [cores, setCores] = useState<CatalogCore[]>([])
  const [pickCore, setPickCore] = useState(core)
  const [pickVersion, setPickVersion] = useState(version)
  const [savingCore, setSavingCore] = useState(false)

  const [installs, setInstalls] = useState<HostingInstall[] | null>(null)
  const [updates, setUpdates] = useState<InstallUpdate[]>([])

  const [kind, setKind] = useState('modpack')
  const [source, setSource] = useState<Source>('modrinth')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<(CatalogHit | CurseHit)[] | null>(null)
  const [packs, setPacks] = useState<FtbPack[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    setPickCore(core)
    setPickVersion(version)
  }, [core, version])

  useEffect(() => {
    void host
      .cores()
      .then((r) => setCores(r.cores || []))
      .catch(() => {})
  }, [])

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

  const search = async () => {
    setSearching(true)
    setHits(null)
    setPacks(null)
    try {
      if (source === 'ftb') {
        const r = await host.searchFtb(query.trim() || undefined)
        setPacks(r.packs || [])
      } else if (source === 'curseforge') {
        const r = await host.searchCurse({ type: kind, query: query.trim() || undefined, version })
        if (!r.enabled) showToast('Каталог CurseForge сейчас недоступен', 'error')
        setHits(r.hits || [])
      } else {
        const r = await host.search({ type: kind, query: query.trim() || undefined, sort: query.trim() ? 'relevance' : 'downloads' })
        setHits(r.hits || [])
      }
    } catch (e) {
      showToast('Поиск не удался: ' + errText(e), 'error')
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    void search()
  }, [kind, source])

  const applyCore = async () => {
    if (pickCore === core && pickVersion === version) return
    if (
      !(await uiConfirm(
        'Сменить ядро на ' + pickCore + ' ' + pickVersion + '? Установленная сборка при этом сбрасывается, мир остаётся.',
        { confirmLabel: 'Сменить' },
      ))
    )
      return
    setSavingCore(true)
    try {
      await host.changeCore(serverId, { core: pickCore, version: pickVersion })
      showToast('Ядро сервера: ' + pickCore + ' ' + pickVersion)
      onChanged()
      loadInstalls()
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
      loadInstalls()
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

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
    await install(item.projectId, item.name, (item.source as Source) || 'modrinth', u.latestVersionId || undefined)
  }

  const coreOptions = [...cores]
    .sort((a, b) => a.family.localeCompare(b.family) || Number(b.recommended) - Number(a.recommended))
    .map((c) => ({ value: c.id, label: c.name, sub: FAMILY_LABEL[c.family] + (c.recommended ? ' · рекомендуем' : '') }))
  const selected = cores.find((c) => c.id === pickCore)
  const versionOptions = (selected?.versions || (pickCore === core ? [version] : [])).map((v) => ({ value: v, label: v }))

  return (
    <>
      <div className="card set-group" style={{ padding: '10px 20px 18px' }}>
        <Cap first>Ядро и версия</Cap>
        <Row k="Ядро" sub="Paper и Purpur — плагины, Forge и Fabric — моды">
          <Select
            value={pickCore}
            options={coreOptions.length ? coreOptions : [{ value: core, label: core }]}
            width={220}
            disabled={savingCore}
            onChange={(v) => {
              setPickCore(v)
              const c = cores.find((x) => x.id === v)
              if (c && !c.versions.includes(pickVersion)) setPickVersion(c.latest || c.versions[0] || pickVersion)
            }}
          />
        </Row>
        <Row k="Версия игры" sub="Ту же версию нужно выбрать в сборке лаунчера">
          <Select
            value={pickVersion}
            options={versionOptions.length ? versionOptions : [{ value: version, label: version }]}
            width={160}
            disabled={savingCore}
            onChange={setPickVersion}
          />
          <button
            className="btn sm primary"
            disabled={savingCore || (pickCore === core && pickVersion === version)}
            onClick={() => void applyCore()}
          >
            Применить
          </button>
        </Row>
        {running ? (
          <p className="faint-note" style={{ marginTop: '10px' }}>
            Сервер работает — смена ядра перезапустит его.
          </p>
        ) : null}
      </div>

      {updates.length ? (
        <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
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
                <button className="btn sm secondary" disabled={!u.compatible} onClick={() => void applyUpdate(u)}>
                  Обновить
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          Установлено на сервере
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
                    <img src={i.iconUrl} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }} />
                  ) : (
                    <span className="host-ico" style={{ width: 34, height: 34 }}>
                      <Icon id="i-box" />
                    </span>
                  )}
                  <span className="fr-body">
                    <span className="fr-nick">{i.name}</span>
                    <span className="fr-status">
                      {(INSTALL_KIND[i.kind] || i.kind) + (i.versionName ? ' · ' + i.versionName : '')}
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
          <Empty icon="i-box" text="Пока пусто. Ниже — каталог: сборки, карты, моды и плагины ставятся в один клик." />
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div className="host-cat-head">
          <div className="segs" style={{ width: 'auto' }}>
            {KIND_TABS.map(([v, label]) => (
              <button
                key={v}
                className={'seg' + (kind === v ? ' on' : '')}
                style={{ height: '30px', fontSize: '12px' }}
                onClick={() => {
                  setKind(v)
                  if (v !== 'modpack' && source === 'ftb') setSource('modrinth')
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="segs" style={{ width: 'auto' }}>
            {(['modrinth', 'curseforge', ...(kind === 'modpack' ? ['ftb'] : [])] as Source[]).map((s) => (
              <button
                key={s}
                className={'seg' + (source === s ? ' on' : '')}
                style={{ height: '30px', fontSize: '12px' }}
                onClick={() => setSource(s)}
              >
                {s === 'modrinth' ? 'Modrinth' : s === 'curseforge' ? 'CurseForge' : 'FTB'}
              </button>
            ))}
          </div>
        </div>
        <div className="host-cat-search">
          <div className="input sm" style={{ flex: 1 }}>
            <Icon id="i-search" />
            <input
              placeholder="Поиск по каталогу…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
            />
          </div>
          <button className="btn sm secondary" disabled={searching} onClick={() => void search()}>
            Найти
          </button>
        </div>

        {searching ? (
          <Loading text="Ищем в каталоге…" />
        ) : packs ? (
          packs.length ? (
            <div className="host-cat-grid">
              {packs.map((p) => {
                const v = p.versions && p.versions.length ? p.versions[0] : null
                return (
                  <div className="host-cat-card" key={p.id}>
                    {p.iconUrl ? <img src={p.iconUrl} alt="" /> : <span className="host-cat-ico"><Icon id="i-box" /></span>}
                    <div className="host-cat-body">
                      <div className="host-cat-name">{p.name}</div>
                      <div className="host-cat-sum">{p.summary}</div>
                      <div className="host-cat-meta">
                        {downloadsLabel(p.installs)} установок
                        {v ? ' · ' + (v.gameVersion || '') + ' · от ' + Math.round(v.minRamMb / 1024) + ' ГБ' : ''}
                      </div>
                    </div>
                    <button className="btn sm primary" disabled={busyId === String(p.id)} onClick={() => void install(String(p.id), p.name, 'ftb')}>
                      Поставить
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty text="Ничего не нашли — попробуй другой запрос." />
          )
        ) : hits ? (
          hits.length ? (
            <div className="host-cat-grid">
              {hits.map((h) => {
                const id = source === 'curseforge' ? String((h as CurseHit).id) : (h as CatalogHit).id
                return (
                  <div className="host-cat-card" key={id}>
                    {h.iconUrl ? <img src={h.iconUrl} alt="" /> : <span className="host-cat-ico"><Icon id="i-box" /></span>}
                    <div className="host-cat-body">
                      <div className="host-cat-name">{h.name}</div>
                      <div className="host-cat-sum">{h.summary}</div>
                      <div className="host-cat-meta">
                        {downloadsLabel(h.downloads)} загрузок
                        {'author' in h && h.author ? ' · ' + h.author : ''}
                      </div>
                    </div>
                    <button
                      className="btn sm primary"
                      disabled={busyId === id}
                      onClick={() => void install(id, h.name, source)}
                    >
                      Поставить
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty text="Ничего не нашли — попробуй другой запрос." />
          )
        ) : null}
      </div>
    </>
  )
}
