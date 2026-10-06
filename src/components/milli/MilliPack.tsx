import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { PxIcon } from '../PxIcon'
import { ServerIcon, StatusBadge, buildLabel } from '../hosting/HostKit'
import { api, mirrorAsset, openExt } from '../../lib/api'
import { installBench } from '../../lib/aiInstall'
import { copyText } from '../../lib/clipboard'
import { hasTauri } from '../../ipc/tauri'
import { realLaunch, startPrelaunch } from '../../lib/launch'
import {
  LOADER_LABEL,
  MILLI_TAB_RU,
  MILLI_TABS,
  milliDownloadMrpack,
  milliError,
  milliInstall,
  milliInstallBody,
  milliModsLabel,
  milliPackById,
  milliPackList,
  milliRamText,
  milliSizeMb,
  milliSizeText,
  milliToServer,
  siteUrl,
} from '../../lib/milli'
import type { MilliCheck, MilliPack, MilliServerAnswer, MilliTab } from '../../lib/milli'
import type { HostServer } from '../../screens/Hosting'
import { useInstalls } from '../../state/installs'
import { closeMilli, useMilli } from '../../state/milli'
import { useBench } from '../../state/milliBench'
import { setScreen, showToast } from '../../state/ui'
import { MilliSafe } from './MilliStage'
import { milliCue } from './Milli'
import { useBenchKeys } from './bench/BenchChanges'
import { PxArt } from './px'
import { reducedMotion, useBump, useHeightAnim, useSegIndicator, useSlideDir } from './motion'
import { BenchMods } from './bench/BenchMods'
import { BenchShaders } from './bench/BenchShaders'
import { BenchPacks } from './bench/BenchPacks'
import { BenchConfig } from './bench/BenchConfig'
import { benchChosen } from './bench/benchTabs'
import { Art, XpOrb } from './MilliModTip'
import '../../styles/pixel/milli-pack.css'

/*
 * Карточка сборки в ленте Милли — всё внутри маленького чата (решение
 * владельца 04.10, SPEC §2): шапка (название, версия и загрузчик, «70 модов ·
 * изменить», тумблер «Для моддеров»), сегмент-вкладки Моды · Ресурс-паки ·
 * Шейдеры · Настройки (счётчик, точка диффа). Тело вкладки раскрывается
 * внутри карточки со своей прокруткой; моды — виртуальный список. Футер —
 * «212 модов · ~1,4 ГБ · ОЗУ 6 ГБ [Установить ▾]».
 *
 * Состав один на весь лаунчер — стор верстака (`state/milliBench.ts`): живая
 * (раскрываемая) только последняя карточка своей цепочки ревизий, когда её
 * цепочка — голова. Старые карточки и stub из истории — компактные, с
 * «Открыть эту версию». Тело монтируется только у раскрытой вкладки.
 */

type Phase = 'plan' | 'install' | 'done'

const play = (name: string) => (hasTauri() ? realLaunch(name) : startPrelaunch(name))

export function openPlus() {
  closeMilli()
  setScreen('premium')
}

const chainOf = (p: Pick<MilliPack, 'chain' | 'buildId'>) => p.chain ?? p.buildId

// ── Выбор размера (FE-tabs). Glob без совпадений — пусто: дерево собирается всегда.
type SizePickProps = { compact?: boolean; value?: number; onPick?: (n: number) => void; onClose?: () => void }
const sizeMod = Object.values(import.meta.glob<{ MilliSizePick?: ComponentType<SizePickProps> }>('./MilliSizePick.tsx', { eager: true }))[0]
const SizePick = sizeMod?.MilliSizePick ?? null

function ServerPick({ pack, projectIds, onClose }: { pack: MilliPack; projectIds: string[]; onClose: () => void }) {
  const [list, setList] = useState<HostServer[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState<MilliServerAnswer | null>(null)
  useEffect(() => {
    api<HostServer[]>('/hosting/servers/me')
      .then((l) => setList(Array.isArray(l) ? l : []))
      .catch(() => setFailed(true))
  }, [])
  const send = async (s: HostServer) => {
    setBusy(s.id)
    try {
      setDone(await milliToServer(pack.buildId, s.id, projectIds))
    } catch (e) {
      const m = milliError(e)
      if (m.kind === 'plus') openPlus()
      else showToast(m.kind === 'failed' ? 'Не встало на сервер — повтори' : m.text, 'error')
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="mpc-srv" role="group" aria-label="Сервер">
      <div className="mpc-srv-head">
        <b>{done ? 'Готово' : 'На какой сервер?'}</b>
        <button type="button" className="mpc-x" aria-label="Закрыть" onClick={onClose}>
          <PxIcon name="x" size={12} />
        </button>
      </div>
      {done ? (
        <p className="mpc-srv-done">
          Встало {done.installed.length}
          {done.skipped.length ? ', пропущено ' + done.skipped.length : ''}
        </p>
      ) : failed ? (
        <p className="mpc-srv-done">Список серверов не загрузился</p>
      ) : !list ? (
        <span className="skel" style={{ height: 44 }} />
      ) : !list.length ? (
        <button type="button" className="btn sm secondary" onClick={() => (closeMilli(), setScreen('hosting'))}>
          Создать сервер
        </button>
      ) : (
        <ul className="mpc-srv-list">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" className="mpc-srv-row" disabled={!!busy} data-track="milli_server_pick" onClick={() => void send(s)}>
                <ServerIcon icon={s.icon} size={28} />
                <span className="mpc-srv-body">
                  <b>{s.name || s.slug || 'Мой сервер'}</b>
                  <i>{buildLabel(s)}</i>
                </span>
                {busy === s.id ? <span className="spin" /> : <StatusBadge status={s.status || ''} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Полоса опыта: уровень — проценты, деления как в игре. */
function XpBar({ pct, done, msg }: { pct: number; done: boolean; msg: string }) {
  return (
    <div className={'mpc-xp' + (done ? ' done' : '')}>
      <span className="mpc-xp-row">
        <span className="mpc-xp-msg">{msg}</span>
        <b className="mpc-xp-lvl">
          <XpOrb size={16} />
          {pct}
        </b>
      </span>
      <div className="mpc-xp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: pct + '%' }} />
      </div>
    </div>
  )
}

const CodeLine = memo(function CodeLine({ code }: { code: string }) {
  if (!code) return null
  return (
    <div className="mpc-code">
      <span>Код для друзей</span>
      <b>{code}</b>
      <button
        type="button"
        className="mpc-x"
        aria-label="Скопировать код"
        data-track="milli_code_copy"
        onClick={() => void copyText(code).then((ok) => showToast(ok ? 'Код скопирован' : 'Не удалось скопировать', ok ? 'ok' : 'error'))}
      >
        <PxIcon name="copy" size={12} />
      </button>
    </div>
  )
})


/** Бейдж мгновенной проверки (pack.check): «✓ Совместимо» или «⚠ 2»; по клику — пункты значками. */
function CheckBadge({ check }: { check: MilliCheck }) {
  const [open, setOpen] = useState(false)
  const fold = useRef<HTMLSpanElement>(null)
  const keep = useHeightAnim(fold, open)
  const items = Array.isArray(check.items) ? check.items : []
  const n = check.issues || items.filter((x) => !x.ok).length
  const ok = check.ok && !n
  return (
    <span className="mpc-check-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="mlm-spark-host">
        <button type="button" className={'mpc-plate mpc-compat ' + (ok ? 'ok' : 'mid')} aria-expanded={open} data-track="milli_check" onClick={() => setOpen((v) => !v)}>
          <PxIcon name={ok ? 'check' : 'alert'} size={8} />
          {ok ? 'Совместимо' : n}
        </button>
        {ok ? <i className="mlm-spark" aria-hidden="true" /> : null}
      </span>
      <span ref={fold} className="mpc-checks-fold">
        {(open || keep) && items.length ? (
          <ul className="mpc-checks">
            {items.map((x) => (
              <li key={x.key} className={x.ok ? 'ok' : 'bad'}>
                <PxIcon name={x.ok ? 'check' : 'alert'} size={8} />
                {x.ru}
                {!x.ok && x.note ? <i>{x.note}</i> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </span>
  )
}

const Plates = memo(function Plates({ pack }: { pack: MilliPack }) {
  const loader = LOADER_LABEL[pack.loader] || pack.loader
  const check = pack.check && typeof pack.check === 'object' ? pack.check : null
  return (
    <span className="mpc-plates">
      <span className="mpc-plate v">{pack.mcVersion}</span>
      <span className="mpc-plate">{loader}</span>
      {check ? <CheckBadge check={check} /> : null}
    </span>
  )
})



/** Установка: новая сборка через ядро (installBench — ровно голова) + код для друзей («Поделиться»). */
function useInstall() {
  const [phase, setPhase] = useState<Phase>('plan')
  const [key, setKey] = useState<string | null>(null)
  const [built, setBuilt] = useState('')
  const [code, setCode] = useState('')
  const codeFor = useRef('')
  const task = useInstalls((s) => (key ? s.tasks[key] : undefined))
  const install = async (head: MilliPack, title: string) => {
    const chosen = benchChosen(head)
    if (!chosen.mods.length && !chosen.resourcepacks.length && !chosen.shaders.length) return
    setPhase('install')
    if (codeFor.current !== head.buildId) {
      codeFor.current = head.buildId
      // Код сборки для друзей — сервер записывает, что именно поставили.
      void milliInstall(head.buildId, milliInstallBody(head, chosen, title))
        .then((r) => setCode(r.code))
        .catch(() => (codeFor.current = ''))
    }
    const started = await installBench(
      head,
      title,
      setKey,
      (name, failed) => {
        setBuilt(name)
        setPhase('done')
        milliCue('spin', document.querySelector('.ml-panel .mlh'))
        if (!failed.length) showToast('Сборка готова', 'ok', 'install', { label: 'Играть', run: () => play(name) })
      },
      () => setPhase('plan'),
    )
    if (!started) setPhase('plan')
  }
  const pct = phase === 'done' ? 100 : Math.round(task?.pct ?? 0)
  const msg = phase === 'done' ? 'Сборка готова' : task?.msg || task?.label || 'Создаём…'
  return { phase, built, code, pct, msg, install, reset: () => setPhase('plan') }
}

/** «212 модов · ~1,4 ГБ · ОЗУ 6 ГБ» — числа жирным, разделители рисует CSS. */
function Sum({ mods, mb, ram }: { mods: number; mb?: number; ram?: number }) {
  const word = milliModsLabel(mods).slice(String(mods).length)
  return (
    <span className="mpc-sum">
      <b>{mods}</b>
      {word}
      {mb != null ? <span>{milliSizeText(mb)}</span> : null}
      {ram ? <span>{milliRamText(ram)}</span> : null}
    </span>
  )
}

/** «Установить ▾»: Установить · Скачать .mrpack · Скопировать список · На сервер (PLUS). */
function InstallMenu({ onInstall, onServer, head, canServer }: { onInstall: () => void; onServer: () => void; head: MilliPack; canServer: boolean }) {
  const modder = useBench((s) => s.ui.modder)
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Меню — порталом в .ml-panel: clip-path карточки (.mpc) обрезал его, «▾» ничего не показывал.
  const [pos, setPos] = useState<{ host: HTMLElement; fixed: boolean; right: number; bottom: number } | null>(null)
  useLayoutEffect(() => {
    if (!menu) return setPos(null)
    if (!ref.current) return setPos(null)
    const panel = ref.current.closest<HTMLElement>('.ml-panel')
    const p = panel ? panel.getBoundingClientRect() : { right: window.innerWidth, bottom: window.innerHeight }
    const b = ref.current.getBoundingClientRect()
    setPos({ host: panel ?? document.body, fixed: !panel, right: Math.max(8, p.right - b.right), bottom: p.bottom - b.top + 6 })
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current && !ref.current.contains(t) && !menuRef.current?.contains(t)) setMenu(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    const away = (e: Event) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
    }
  }, [menu])
  const pick = (fn: () => void) => () => {
    setMenu(false)
    fn()
  }
  const copy = async () => {
    const ok = await copyText(milliPackList(head, modder))
    showToast(ok ? 'Список скопирован' : 'Не удалось скопировать', ok ? 'ok' : 'error')
  }
  return (
    <span className="mpc-inst ml-menu-wrap" ref={ref}>
      <button type="button" className="btn sm primary mpc-inst-main" data-track="milli_install" onClick={onInstall}>
        <PxIcon name="download" size={12} />
        Установить
      </button>
      <button type="button" className="btn sm primary mpc-inst-more" aria-label="Ещё" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
        <PxIcon name="chev-d" size={10} />
      </button>
      {menu && pos ? createPortal(
        <div ref={menuRef} className="ml-menu mpc-menu is-portal" role="menu" style={{ position: pos.fixed ? 'fixed' : 'absolute', right: pos.right, bottom: pos.bottom }}>
          <button type="button" className="ml-menu-item" role="menuitem" onClick={pick(onInstall)}>
            <Art px="crafting_table" size={16}>
              <PxIcon name="download" size={12} />
            </Art>
            Установить
          </button>
          <button type="button" className="ml-menu-item" role="menuitem" data-track="milli_mrpack" onClick={pick(() => void milliDownloadMrpack(head, openExt).then((ok) => ok || showToast('Скачать не вышло', 'error')))}>
            <Art px="hopper" size={16}>
              <PxIcon name="download" size={12} />
            </Art>
            Скачать .mrpack
          </button>
          <button type="button" className="ml-menu-item" role="menuitem" data-track="milli_copy_list" onClick={pick(() => void copy())}>
            <Art px="book_quill" size={16}>
              <PxIcon name="copy" size={12} />
            </Art>
            Скопировать список
          </button>
          <button type="button" className="ml-menu-item" role="menuitem" data-track="milli_server" data-plus={canServer ? 1 : 0} onClick={pick(onServer)}>
            {canServer ? <PxIcon name="server" size={12} /> : <PxIcon name="crown" size={12} />}
            На сервер
          </button>
        </div>,
        pos.host,
      ) : null}
    </span>
  )
}

const TAB_PX: Record<MilliTab, string> = { mods: 'crafting_table', resourcepacks: 'painting', shaders: 'glowstone', config: 'comparator' }
const TAB_SHORT: Record<MilliTab, string> = { mods: 'Моды', resourcepacks: 'Паки', shaders: 'Шейдеры', config: 'Графика' }

type Counts = { mods: number; resourcepacks: number; shaders: number }
const countsOf = (p: MilliPack): Counts =>
  p.stub && p.counts ? p.counts : { mods: p.mods.length, resourcepacks: p.resourcepacks.length, shaders: p.shaders.length }

/** Вкладки с изменениями в дифе головы — точка на сегменте. */
function diffTabs(p: MilliPack | null): Set<MilliTab> {
  const out = new Set<MilliTab>()
  const c = p?.changes
  if (!c) return out
  for (const r of [...c.added, ...c.removed]) out.add(r.tab)
  if (c.changed.some((x) => x.projectId)) out.add('mods')
  if (c.config?.length) out.add('config')
  return out
}

function Skeleton() {
  return (
    <div aria-hidden="true">
      {[62, 48, 71, 55, 40, 66].map((w, i) => (
        <span key={i} className="mpc-skel-row">
          <i className="skel" />
          <i className="skel" style={{ width: w + '%' }} />
        </span>
      ))}
    </div>
  )
}

function TabFail() {
  return (
    <div className="mpc-err" role="alert">
      <PxIcon name="alert" size={12} />
      Ошибка
    </div>
  )
}

/**
 * Пэйн вкладки: монтируется при первом показе и живёт, пока карточка раскрыта
 * (переключение без перерисовки). Шейдеры/РП/Настройки прокручивает сам пэйн
 * (scrollTop в ui.scroll[tab]); моды — свой виртуальный список.
 */
const Pane = memo(function Pane({ tab, on }: { tab: MilliTab; on: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Тело вкладки монтируется переходом (startTransition) кадром позже: React режет рендер
  // на кусочки по ~5 мс — сначала кадр со скелетом, без одной длинной задачи.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (ready) return
    const id = requestAnimationFrame(() => startTransition(() => setReady(true)))
    return () => cancelAnimationFrame(id)
  }, [ready])
  const restoreSeq = useBench((s) => s.restoreSeq)
  const panelOpen = useMilli((s) => s.open)
  const scrolls = tab !== 'mods'
  // Замер для QA: клик по вкладке → коммит пэйна (milli:tab:switch).
  useLayoutEffect(() => {
    if (!on) return
    try {
      performance.mark('milli:tab:switch:end')
      performance.measure('milli:tab:switch', 'milli:tab:switch:start', 'milli:tab:switch:end')
    } catch {}
  }, [on])
  useEffect(() => {
    const el = ref.current
    if (!el || !scrolls || !on || !ready) return
    const top = useBench.getState().ui.scroll[tab] ?? 0
    if (top > 0 && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top
  }, [tab, on, scrolls, ready, restoreSeq, panelOpen])
  // scrollTop — в ui.scroll[tab] после остановки (тело может уйти в display:none, WebKit его теряет).
  const settle = useRef<number | undefined>(undefined)
  const onScroll = scrolls
    ? () => {
        window.clearTimeout(settle.current)
        settle.current = window.setTimeout(() => {
          const el = ref.current
          const s = useBench.getState()
          if (el && (s.ui.scroll[tab] ?? 0) !== el.scrollTop) s.setUi({ scroll: { ...s.ui.scroll, [tab]: el.scrollTop } })
        }, 150)
      }
    : undefined
  useEffect(() => () => window.clearTimeout(settle.current), [])
  return (
    <div
      ref={ref}
      className={'mpc-pane' + (on ? ' on' : '')}
      role="tabpanel"
      aria-hidden={!on}
      aria-label={MILLI_TAB_RU[tab]}
      data-tab={tab}
      data-bench-scroll={scrolls ? tab : undefined}
      onScroll={onScroll}
    >
      <MilliSafe fallback={<TabFail />}>
        {!ready ? (
          <Skeleton />
        ) : tab === 'mods' ? (
          <BenchMods />
        ) : tab === 'shaders' ? (
          <BenchShaders />
        ) : tab === 'resourcepacks' ? (
          <BenchPacks />
        ) : (
          <BenchConfig />
        )}
      </MilliSafe>
    </div>
  )
})

/** Вкладка: счётчик подпрыгивает при смене (моушн). */
function TabBtn({ t, n, on, dot, onTab }: { t: MilliTab; n: number | null; on: boolean; dot: boolean; onTab: (t: MilliTab) => void }) {
  const bump = useBump(n)
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      aria-expanded={on}
      className={'mpc-tab' + (on ? ' on' : '')}
      data-track="milli_card_tab"
      data-tab={t}
      onClick={() => onTab(t)}
    >
      <PxArt name={TAB_PX[t]} size={14} className="mci" />
      <span className="mpc-tab-t" data-short={TAB_SHORT[t]}>
        {MILLI_TAB_RU[t]}
      </span>
      {n !== null ? (
        <b className="mpc-tab-n" data-mlm-bump={bump}>
          {n}
        </b>
      ) : null}
      {dot ? <i className="mpc-tab-dot" aria-label="Есть изменения" /> : null}
    </button>
  )
}

/** Сегмент-вкладки со скользящим индикатором. Клик по открытой — свернуть. */
function TabSeg({ counts, tab, open, marked, onTab }: { counts: Counts; tab: MilliTab | null; open: boolean; marked: Set<MilliTab>; onTab: (t: MilliTab) => void }) {
  const idx = open && tab ? MILLI_TABS.indexOf(tab) : -1
  const ind = useSegIndicator(idx)
  return (
    <nav className="mpc-tabs" role="tablist" aria-label="Состав сборки" ref={ind}>
      <i className="mlm-seg-ind" aria-hidden="true" />
      {MILLI_TABS.map((t) => (
        <TabBtn key={t} t={t} n={t === 'config' || !counts[t] ? null : counts[t]} on={open && tab === t} dot={marked.has(t)} onTab={onTab} />
      ))}
    </nav>
  )
}



function MapIcon({ icon }: { icon: string | null }) {
  const [bad, setBad] = useState(false)
  return icon && !bad ? <img src={mirrorAsset(icon)} alt="" loading="lazy" width={28} height={28} onError={() => setBad(true)} /> : <PxIcon name="map" size={16} />
}

/** Карты, ссылки, «Можно добавить», PLUS — короткими строками под вкладками. */
const Extras = memo(function Extras({ pack }: { pack: MilliPack }) {
  const plus = useMilli((s) => !!s.status?.plus)
  const extras = pack.resourcepacks.length + pack.shaders.length + pack.maps.length + pack.links.length > 0
  return (
    <>
      {pack.maps.length ? (
        <ul className="mpc-list mpc-maps">
          {pack.maps.map((m) => (
            <li key={m.slug}>
              <button type="button" className="mpc-row mpc-link on" data-track="milli_map" data-id={m.slug} onClick={() => openExt(siteUrl(m.url))}>
                <span className="mpc-slot" aria-hidden="true">
                  <MapIcon icon={m.icon} />
                </span>
                <span className="mpc-txt">
                  <span className="mpc-name">{m.title}</span>
                </span>
                <span className="mpc-go" aria-hidden="true">
                  <PxIcon name="ext" size={10} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {pack.links.length ? (
        <div className="mpc-links">
          {pack.links.map((l) => (
            <button key={l.url} type="button" className="seg mpc-chip" data-track="milli_link" data-kind={l.kind} onClick={() => openExt(siteUrl(l.url))}>
              <PxIcon name={l.kind === 'skins' ? 'shirt' : 'map'} size={12} />
              {l.title}
            </button>
          ))}
        </div>
      ) : null}
      {pack.locked.extras && !plus && !extras ? (
        <button type="button" className="mpc-up" data-track="milli_plus_upsell" data-src="extras" onClick={openPlus}>
          <span className="mpc-up-t">Шейдеры и карты</span>
          <b>
            <PxIcon name="crown" size={10} />
            PLUS
          </b>
        </button>
      ) : null}
    </>
  )
})




/** Это последняя карточка своей цепочки ревизий в ленте? */
function useLatestOfChain(pack: MilliPack): boolean {
  const chain = chainOf(pack)
  return useMilli((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const p = s.messages[i]!.pack
      if (p && chainOf(p) === chain) return p.buildId === pack.buildId
    }
    return true
  })
}

export function MilliPackCard({ pack }: { pack: MilliPack }) {
  const latest = useLatestOfChain(pack)
  const live = useBench((s) => !!s.head && latest && chainOf(s.head) === chainOf(pack))
  return live ? <LiveCard key={chainOf(pack)} pack={pack} /> : <MiniCard pack={pack} latest={latest} />
}

/** Голова и раскрытая вкладка — общие на ленту: сделать карточку живой и открыть вкладку. */
function openVersion(pack: MilliPack, tab: MilliTab | null, done: () => void) {
  const go = (p: MilliPack) => {
    const b = useBench.getState()
    b.setHead(p)
    if (tab) b.openBench(tab)
  }
  if (!pack.stub) {
    go(pack)
    done()
    return
  }
  milliPackById(pack.buildId)
    .then((p) => {
      if (!p || !Array.isArray(p.mods)) throw new Error('empty')
      go(p)
    })
    .catch(() => showToast('Не удалось открыть эту версию', 'error'))
    .finally(done)
}

/** Компактная карточка: старая ревизия в ленте или stub из истории. Клик по вкладке — сделать её головой и раскрыть. */
function MiniCard({ pack, latest }: { pack: MilliPack; latest: boolean }) {
  const [opening, setOpening] = useState(false)
  const counts = countsOf(pack)
  const old = !latest && !pack.stub
  const open = (tab: MilliTab | null) => {
    if (opening) return
    setOpening(true)
    openVersion(pack, tab ?? (old ? null : 'mods'), () => setOpening(false))
  }
  // «Вернуться к ней» — новая ревизия с составом этой (линейная история, SPEC §0.4).
  const back = () => {
    if (opening) return
    setOpening(true)
    void useBench
      .getState()
      .revertTo(pack.buildId)
      .finally(() => setOpening(false))
  }
  return (
    <div
      className={'mpc is-mini' + (pack.stub ? ' is-stub' : '') + (old ? ' is-old' : '') + (opening ? ' is-load' : '')}
      data-section="milli_pack"
      data-id={pack.buildId}
    >
      {old ? (
        <p className="mpc-note">
          Старая версия
          <button type="button" className="mpc-note-btn" data-track="milli_rev_back" data-id={pack.buildId} disabled={opening} onClick={back}>
            Вернуть
          </button>
        </p>
      ) : null}
      <div className="mpc-head">
        <span className="mpc-badge" aria-hidden="true">
          <PxArt name="crafting_table" size={24} />
        </span>
        <span className="mpc-head-id">
          <b className="mpc-title" title={pack.title}>
            {pack.title}
          </b>
          <span className="mpc-meta">
            <Plates pack={pack} />
            {pack.rev ? <span className="mpr-rev">версия {pack.rev}</span> : null}
          </span>
        </span>
      </div>
      <TabSeg counts={counts} tab={null} open={false} marked={EMPTY_TABS} onTab={(t) => open(t)} />
      <div className="mpc-foot">
        <Sum mods={counts.mods} />
        {pack.stub ? (
          <button type="button" className="btn sm secondary" data-track="milli_stub_open" data-id={pack.buildId} disabled={opening} onClick={() => open('mods')}>
            {opening ? <span className="spin" /> : <PxIcon name="restart" size={12} />}
            Открыть
          </button>
        ) : null}
      </div>
    </div>
  )
}

const EMPTY_TABS: Set<MilliTab> = new Set()
const HIDE = { display: 'none' } as const

/** Живая карточка: голова цепочки, вкладки раскрываются внутри. */
function LiveCard({ pack }: { pack: MilliPack }) {
  const head = useBench((s) => s.head) ?? pack
  const open = useBench((s) => s.ui.open)
  const tab = useBench((s) => s.ui.tab)
  const modder = useBench((s) => s.ui.modder)
  const busy = useBench((s) => s.busy)
  const canServer = useMilli((s) => !!s.status?.features.server)
  const [title, setTitle] = useState(head.title)
  const [server, setServer] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const fold = useRef<HTMLDivElement>(null)
  const keep = useHeightAnim(fold, open, tab)
  const slide = useSlideDir(MILLI_TABS.indexOf(tab))
  // Игрок раскрыл вкладку («Показать», клик) — тело карточки должно быть видно над полем ввода.
  // После анимации высоты (240 мс); при монтировании (возврат из окна мода) не крутим — ленту восстановит оболочка.
  const revealSeq = useBench((s) => s.reveal?.seq ?? 0)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (!open) return
    // Карточка целиком над полем ввода; не влезает — к её началу (шапка и вкладки).
    const t = window.setTimeout(() => {
      const card = root.current
      const sc = card?.closest<HTMLElement>('.ml-scroll')
      if (!card || !sc) return
      const cr = card.getBoundingClientRect()
      const sr = sc.getBoundingClientRect()
      const delta = cr.height <= sr.height - 16 ? cr.bottom - sr.bottom + 12 : cr.top - sr.top - 8
      if (Math.abs(delta) > 2) sc.scrollBy({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' })
    }, 260)
    return () => window.clearTimeout(t)
  }, [open, tab, revealSeq])
  // Пэйны, которые уже показывали: живут, пока карточка раскрыта (переключение без перерисовки).
  const [seen, setSeen] = useState<ReadonlySet<MilliTab>>(() => (open ? new Set([tab]) : new Set()))
  // Сборка сменилась (другая цепочка) — карточка новая, и так; ревизии той же цепочки тела не пересоздают.
  useEffect(() => {
    if (open) setSeen((s) => (s.has(tab) ? s : new Set([...s, tab])))
  }, [open, tab])
  const shown = open || keep
  const inst = useInstall()
  const root = useRef<HTMLDivElement>(null)
  useBenchKeys(root)
  // Новая ревизия — новая сборка для установки.
  const resetInst = inst.reset
  useEffect(() => {
    if (inst.phase === 'done') resetInst()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head.buildId])

  const counts = countsOf(head)
  const marked = useMemo(() => diffTabs(head), [head])
  const onTab = useCallback((t: MilliTab) => {
    const b = useBench.getState()
    try {
      performance.mark('milli:tab:switch:start')
    } catch {}
    if (b.ui.open && b.ui.tab === t) b.closeBench()
    else b.openBench(t)
  }, [])
  const ram = head.config?.ramMb
  const toServer = () => (canServer ? setServer((v) => !v) : openPlus())
  const toggleModder = () => useBench.getState().setUi({ modder: !useBench.getState().ui.modder })

  return (
    <div
      ref={root}
      className={'mpc is-live is-' + inst.phase + (open ? ' is-open' : '') + (busy ? ' is-busy' : '') + (modder ? ' is-modder' : '')}
      data-section="milli_pack"
      data-id={head.buildId}
    >
      <div className="mpc-head">
        <span className="mpc-badge" aria-hidden="true">
          <PxArt name="crafting_table" size={24} />
        </span>
        <span className="mpc-head-id">
          <input
            className="mpc-title"
            value={title}
            maxLength={24}
            aria-label="Название сборки"
            disabled={inst.phase !== 'plan'}
            spellCheck={false}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="mpc-meta">
            <Plates pack={head} />
            <button
              type="button"
              className="msz-inline-btn"
              aria-expanded={sizeOpen}
              data-track="milli_size_edit"
              disabled={!SizePick || inst.phase !== 'plan'}
              onClick={() => setSizeOpen((v) => !v)}
            >
              <b>{milliModsLabel(counts.mods)}</b>
              {SizePick ? ' · изменить' : null}
            </button>
          </span>
        </span>
        <label
          className="mpc-modder"
          role="switch"
          aria-checked={modder}
          tabIndex={0}
          data-track="milli_modder"
          onClick={toggleModder}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              toggleModder()
            }
          }}
        >
          <span>Для моддеров</span>
          <span className={'tgl' + (modder ? ' on' : '')} aria-hidden="true" />
        </label>
      </div>
      {SizePick && sizeOpen ? <SizePick compact value={head.size ?? counts.mods} onPick={() => setSizeOpen(false)} onClose={() => setSizeOpen(false)} /> : null}


      <TabSeg counts={counts} tab={tab} open={open} marked={marked} onTab={onTab} />
      <div ref={fold} className="mpc-fold">
        {seen.size ? (
          // Однажды открытые тела живут и в свёрнутой карточке (display:none) — повторное раскрытие без ремонта.
          <div className="mpc-body" data-tab={tab} data-mlm-slide={slide} style={shown ? undefined : HIDE} inert={!shown}>
            {busy && shown ? <i className="mpc-busy" aria-hidden="true" /> : null}
            {MILLI_TABS.filter((t) => seen.has(t) || (shown && t === tab)).map((t) => (
              <Pane key={t} tab={t} on={t === tab} />
            ))}
          </div>
        ) : null}
      </div>

      <Extras pack={pack} />

      {server && inst.phase !== 'install' ? <ServerPick pack={head} projectIds={benchChosen(head).mods.map((m) => m.projectId)} onClose={() => setServer(false)} /> : null}

      <div className="mpc-foot">
        {inst.phase === 'plan' ? (
          <>
            <Sum mods={counts.mods} mb={modder ? milliSizeMb(head) : undefined} ram={modder ? ram : undefined} />
            <InstallMenu head={head} canServer={canServer} onInstall={() => void inst.install(head, title)} onServer={toServer} />
          </>
        ) : (
          <>
            <XpBar pct={inst.pct} done={inst.phase === 'done'} msg={inst.msg} />
            {inst.phase === 'done' ? (
              <button type="button" className="btn sm primary" data-track="play" data-kind="build" data-id={inst.built} data-private onClick={() => play(inst.built)}>
                <PxIcon name="play" size={12} />
                Играть
              </button>
            ) : null}
          </>
        )}
      </div>
      <CodeLine code={inst.code} />
    </div>
  )
}
