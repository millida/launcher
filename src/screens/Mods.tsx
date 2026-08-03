import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import { FilterPill } from '../components/FilterPill'
import { ModRow } from '../components/ModRow'
import { hasTauri } from '../ipc/tauri'
import { listVersions } from '../ipc/commands'
import { LOADER_NAME, RU_LOADER, cap, loaderId } from '../lib/format'
import { F_LOADERS, F_SIDES, F_SORTS, F_VERS, MOD_TABS, WORLD_CATS, useMods } from '../state/mods'
import { useProfiles } from '../state/profiles'

const TAB_META: [string, string][] = [
  ['Модпаки', 'i-box2'],
  ['Моды', 'i-blocks'],
  ['Ресурспаки', 'i-image'],
  ['Дата-паки', 'i-book'],
  ['Шейдеры', 'i-eye'],
  ['Карты', 'i-map'],
]

export function Mods({ on }: { on: boolean }) {
  const mods = useMods()
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void mods.load()
    ;(hasTauri() ? listVersions() : Promise.resolve(F_VERS.slice(1)))
      .then((vs) => useMods.getState().setVers(vs))
      .catch(() => useMods.getState().setVers(F_VERS.slice(1)))
  }, [])

  useEffect(() => {
    let alive = true
    if (mods.modTab === 'world') {
      useMods.getState().setCats(['все'])
      return
    }
    fetch('https://api.modrinth.com/v2/tag/category')
      .then((r) => r.json())
      .then((tags: { project_type: string; name: string }[]) => {
        if (!alive) return
        const list = [...new Set(tags.filter((t) => t.project_type === mods.modTab).map((t) => t.name))]
        useMods.getState().setCats(['все'].concat(list.slice(0, 40)))
      })
      .catch(() => useMods.getState().setCats(['все']))
    return () => {
      alive = false
    }
  }, [mods.modTab])

  const reload = () => void useMods.getState().load()
  const scoped = useProfiles((s) => s.profiles).find((p) => p.name === mods.targetBuild)
  // the build may run a version the manifest does not list yet (snapshot, fresh release)
  const verOptions = ['любая']
    .concat(mods.vers)
    .concat(scoped && scoped.version && !mods.vers.includes(scoped.version) ? [scoped.version] : [])
  const scopeOn = !!scoped && (mods.fVer === scoped.version || mods.fLoader === loaderId(scoped))
  const isWorld = mods.modTab === 'world'
  const isMr = mods.modSource === 'modrinth' && !isWorld
  const catList = mods.cats.filter((c) => c !== 'все')

  const chips: { key: string; label: string; clear: () => void }[] = []
  if (mods.fLoader !== 'любой')
    chips.push({ key: 'l', label: cap(RU_LOADER(mods.fLoader)), clear: () => (mods.set({ fLoader: 'любой' }), reload()) })
  if (mods.fVer !== 'любая')
    chips.push({ key: 'v', label: mods.fVer, clear: () => (mods.set({ fVer: 'любая' }), reload()) })
  if (isMr && mods.fSide !== 'any') {
    const sl = F_SIDES.find((s) => s[0] === mods.fSide)
    chips.push({ key: 's', label: sl ? sl[1] : mods.fSide, clear: () => (mods.set({ fSide: 'any' }), reload()) })
  }
  mods.fCats.forEach((c) => chips.push({ key: 'c:' + c, label: cap(RU_LOADER(c)), clear: () => mods.toggleCat(c) }))
  if (isWorld && mods.fWorldCat) {
    const wc = WORLD_CATS.find((c) => c[0] === mods.fWorldCat)
    if (wc) chips.push({ key: 'w', label: wc[1], clear: () => (mods.set({ fWorldCat: 0 }), reload()) })
  }

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-mods">
      <div className="page-head">
        <h1>Контент</h1>
        <div className="right">
          <div className="input sm" style={{ width: '240px' }}>
            <Icon id="i-search" />
            <input
              placeholder="Поиск по контенту…"
              onChange={(e) => {
                mods.set({ mq: e.target.value.trim() })
                clearTimeout(searchTimer.current)
                searchTimer.current = setTimeout(reload, 350)
              }}
            />
          </div>
        </div>
      </div>

      {scoped ? (
        <div className="mk-chips" style={{ marginBottom: '10px' }}>
          <span className="mk-chips-cap">Сборка:</span>
          <span className="mk-chip">
            {scoped.name} · {scoped.version} · {LOADER_NAME(scoped)}
          </span>
          <span className="faint-note" style={{ margin: 0 }}>
            {scopeOn
              ? 'показываем только то, что подходит этой сборке'
              : 'фильтр по сборке снят — несовместимое спросим перед установкой'}
          </span>
          {scopeOn ? (
            <button
              className="facet-reset"
              onClick={() => (mods.set({ fVer: 'любая', fLoader: 'любой' }), reload())}
            >
              Показать всё
            </button>
          ) : (
            <button
              className="facet-reset"
              onClick={() => {
                useMods.getState().scopeTo(scoped.name)
                reload()
              }}
            >
              Только для сборки
            </button>
          )}
        </div>
      ) : null}

      <div className="segs" style={{ marginBottom: '14px' }}>
        {TAB_META.map(([t, ic], i) => (
          <button
            key={t}
            className={'seg' + (mods.modTab === MOD_TABS[i] ? ' on' : '')}
            onClick={() => {
              mods.set({ modTab: MOD_TABS[i], fCats: [], fCat: 'все', count: '' })
              reload()
            }}
          >
            <Icon id={ic} />
            {t}
          </button>
        ))}
      </div>

      <div className="mods-filters">
        {isWorld ? (
          <FilterPill
            icon="i-grid"
            label="Категория"
            defaultValue="0"
            width={180}
            value={String(mods.fWorldCat)}
            options={WORLD_CATS.map(([id, label]) => ({ value: String(id), label }))}
            onPick={(v) => (mods.set({ fWorldCat: Number(v) }), reload())}
          />
        ) : (
          <>
            <FilterPill
              icon="i-download"
              label="Источник"
              defaultValue="all"
              value={mods.modSource}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'modrinth', label: 'Modrinth' },
                { value: 'curseforge', label: 'CurseForge' },
              ]}
              onPick={(v) => (mods.set({ modSource: v }), reload())}
            />
            <FilterPill
              icon="i-blocks"
              label="Загрузчик"
              defaultValue="любой"
              value={mods.fLoader}
              options={F_LOADERS.map((v) => ({ value: v, label: RU_LOADER(v) }))}
              onPick={(v) => (mods.set({ fLoader: v }), reload())}
            />
          </>
        )}
        <FilterPill
          icon="i-box"
          label="Версия"
          defaultValue="любая"
          value={mods.fVer}
          width={140}
          options={verOptions.map((v) => ({ value: v, label: v }))}
          onPick={(v) => (mods.set({ fVer: v }), reload())}
        />
        {isMr ? (
          <FilterPill
            icon="i-monitor"
            label="Сторона"
            defaultValue="any"
            value={mods.fSide}
            options={F_SIDES.map(([v, l]) => ({ value: v, label: l }))}
            onPick={(v) => (mods.set({ fSide: v }), reload())}
          />
        ) : null}
        {isMr && catList.length ? (
          <FilterPill
            icon="i-grid"
            label="Категории"
            multi
            values={mods.fCats}
            options={catList.map((c) => ({ value: c, label: RU_LOADER(c) }))}
            onToggle={(c) => mods.toggleCat(c)}
          />
        ) : null}

        <span className="spacer"></span>

        <FilterPill
          icon="i-filter"
          label="Сортировка"
          align="right"
          width={180}
          value={mods.fSort}
          options={Object.keys(F_SORTS).map((v) => ({ value: v, label: v }))}
          onPick={(v) => (mods.set({ fSort: v }), reload())}
        />
      </div>

      {chips.length ? (
        <div className="mk-chips">
          <span className="mk-chips-cap">Выбрано:</span>
          {chips.map((c) => (
            <span key={c.key} className="mk-chip">
              {c.label}
              <button title="Убрать" onClick={c.clear}>
                <Icon id="i-x" />
              </button>
            </span>
          ))}
          <button className="facet-reset" onClick={() => mods.resetFilters()}>
            Сбросить всё
          </button>
        </div>
      ) : null}

      <div className="mods-resbar">
        <span id="modCount" className="faint-note" style={{ margin: 0 }}>
          {mods.count}
        </span>
      </div>

      <div className="stack" id="modList">
        {mods.notice ? (
          <p className="faint-note">{mods.notice}</p>
        ) : (
          mods.hits.map((h, i) => <ModRow key={(h.pid || h.slug || '') + i} h={h} />)
        )}
      </div>
      {mods.showMore ? (
        <button
          className="btn md secondary"
          id="moreBtn"
          style={{ width: '100%', marginTop: '12px' }}
          onClick={() => {
            // load(append) advances the offset itself; adding it here skipped a page.
            void useMods.getState().load(true)
          }}
        >
          Показать ещё
        </button>
      ) : null}
      <p className="faint-note">
        {isWorld
          ? 'Карта распакуется в миры выбранной сборки — после установки она появится в одиночной игре. Версию игры подберём под сборку, несовпадение покажем заранее.'
          : 'Модпак ставится отдельной сборкой. Мод, ресурспак или шейдер — в выбранную сборку (спросим, в какую). Загрузчик и зависимости подберём автоматически.'}
      </p>
    </section>
  )
}
