import { useEffect, useMemo, useRef, useState } from 'react'
import { PxIcon } from '../PxIcon'
import { ServerIcon, StatusBadge, buildLabel } from '../hosting/HostKit'
import { api, mirrorAsset, openExt } from '../../lib/api'
import { createAiBuild } from '../../lib/aiInstall'
import { excludedLines } from '../../lib/aiBuilder'
import { copyText } from '../../lib/clipboard'
import { hasTauri } from '../../ipc/tauri'
import { realLaunch, startPrelaunch } from '../../lib/launch'
import {
  LOADER_LABEL,
  isLockedItem,
  milliChosen,
  milliError,
  milliInstall,
  milliInstallBody,
  milliPackCount,
  milliToServer,
  siteUrl,
} from '../../lib/milli'
import type { MilliItem, MilliPack, MilliServerAnswer } from '../../lib/milli'
import type { HostServer } from '../../screens/Hosting'
import { useInstalls } from '../../state/installs'
import { closeMilli, useMilli } from '../../state/milli'
import { setScreen, showToast } from '../../state/ui'

/*
 * Карточка сборки в ответе Милли: название, версия и загрузчик, моды с
 * галочками (базовые — без галочки), разделы PLUS, «Установить» — новая сборка
 * через установщик ядра (`lib/aiInstall.ts`) и код сборки для друзей,
 * «На сервер» — в PLUS, на свой сервер хостинга.
 */

type Phase = 'plan' | 'install' | 'done'

const play = (name: string) => (hasTauri() ? realLaunch(name) : startPrelaunch(name))

export function openPlus() {
  closeMilli()
  setScreen('premium')
}

function Row({ m, on, locked, onToggle, tag }: { m: MilliItem; on: boolean; locked: boolean; onToggle?: () => void; tag?: string }) {
  return (
    <li
      className={'mpk-row' + (on ? ' on' : '') + (locked ? ' locked' : '')}
      role="checkbox"
      aria-checked={on}
      aria-disabled={!onToggle || undefined}
      tabIndex={onToggle ? 0 : -1}
      data-track="milli_mod_toggle"
      data-id={m.slug}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (onToggle && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault()
          onToggle()
        }
      }}
    >
      <span className="mpk-chk" aria-hidden="true">
        {locked ? <PxIcon name="lock" size={12} /> : on ? <PxIcon name="check" size={12} /> : null}
      </span>
      <span className="mpk-ic" aria-hidden="true">
        {m.icon ? <img src={mirrorAsset(m.icon)} alt="" loading="lazy" /> : <PxIcon name="box" size={18} />}
      </span>
      <span className="mpk-body">
        <span className="mpk-name">
          <span>{m.title}</span>
          {tag ? <span className="mpk-tag">{tag}</span> : null}
        </span>
        <span className="mpk-why">{m.why}</span>
      </span>
    </li>
  )
}

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
    <div className="mpk-srv" role="group" aria-label="Сервер">
      <div className="mpk-srv-head">
        <b>{done ? 'Готово' : 'На какой сервер?'}</b>
        <button type="button" className="mpk-x" aria-label="Закрыть" onClick={onClose}>
          <PxIcon name="x" size={12} />
        </button>
      </div>
      {done ? (
        <p className="mpk-srv-done">
          Встало {done.installed.length}
          {done.skipped.length ? ', пропущено ' + done.skipped.length : ''}
        </p>
      ) : failed ? (
        <p className="mpk-srv-done">Список серверов не загрузился</p>
      ) : !list ? (
        <span className="skel" style={{ height: 44 }} />
      ) : !list.length ? (
        <button type="button" className="btn sm secondary" onClick={() => (closeMilli(), setScreen('hosting'))}>
          Создать сервер
        </button>
      ) : (
        <ul className="mpk-srv-list">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" className="mpk-srv-row" disabled={!!busy} data-track="milli_server_pick" onClick={() => void send(s)}>
                <ServerIcon icon={s.icon} size={28} />
                <span className="mpk-srv-body">
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

export function MilliPackCard({ pack }: { pack: MilliPack }) {
  const status = useMilli((s) => s.status)
  const plus = !!status?.plus
  const canServer = !!status?.features.server
  const [off, setOff] = useState<Set<string>>(() => new Set())
  const [title, setTitle] = useState(pack.title)
  const [phase, setPhase] = useState<Phase>('plan')
  const [key, setKey] = useState<string | null>(null)
  const [built, setBuilt] = useState('')
  const [code, setCode] = useState('')
  const [server, setServer] = useState(false)
  const codeAsked = useRef(false)
  const task = useInstalls((s) => (key ? s.tasks[key] : undefined))

  const chosen = useMemo(() => milliChosen(pack, off), [pack, off])
  const total = milliPackCount(pack)
  const count =
    pack.mods.filter((m) => isLockedItem(m) || !off.has(m.projectId)).length +
    chosen.resourcepacks.length +
    chosen.shaders.length
  const extras = pack.resourcepacks.length + pack.shaders.length + pack.maps.length + pack.links.length > 0

  const toggle = (m: MilliItem) =>
    setOff((s) => {
      const n = new Set(s)
      if (n.has(m.projectId)) n.delete(m.projectId)
      else n.add(m.projectId)
      return n
    })

  const install = async () => {
    if (!chosen.mods.length && !chosen.resourcepacks.length && !chosen.shaders.length) return
    setPhase('install')
    if (!codeAsked.current) {
      codeAsked.current = true
      // Код сборки для друзей — сервер записывает, что именно поставили.
      void milliInstall(pack.buildId, milliInstallBody(pack, chosen, title))
        .then((r) => setCode(r.code))
        .catch(() => (codeAsked.current = false))
    }
    const started = await createAiBuild(
      pack,
      title,
      chosen,
      setKey,
      (name, failed) => {
        setBuilt(name)
        setPhase('done')
        if (!failed.length) showToast('Сборка готова', 'ok', 'install', { label: 'Играть', run: () => play(name) })
      },
      () => setPhase('plan'),
    )
    if (!started) setPhase('plan')
  }

  const toServer = () => {
    if (!canServer) {
      openPlus()
      return
    }
    setServer((v) => !v)
  }

  const pct = phase === 'done' ? 100 : Math.round(task?.pct ?? 0)
  const editable = phase === 'plan'
  const excluded = excludedLines(pack.excluded)

  return (
    <div className="mpk" data-section="milli_pack" data-id={pack.buildId}>
      <div className="mpk-head">
        <input
          className="mpk-title"
          value={title}
          maxLength={24}
          aria-label="Название сборки"
          disabled={!editable}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className="mpk-plates">
          <span className="mpk-plate">{pack.mcVersion}</span>
          <span className="mpk-plate">{LOADER_LABEL[pack.loader] || pack.loader}</span>
          <span className="mpk-count">
            {count}/{total}
          </span>
        </span>
        {pack.review && (pack.review.added.length || pack.review.removed.length) ? (
          <span className="mpk-review" aria-label="Улучшенная проверка">
            {pack.review.added.slice(0, 6).map((m) => (
              <span key={'a-' + m.title} className="add">
                {'+ ' + m.title}
              </span>
            ))}
            {pack.review.removed.slice(0, 4).map((m) => (
              <span key={'r-' + m.title} data-tip={m.reason || undefined}>
                {'− ' + m.title}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      <ul className={'mpk-list' + (editable ? '' : ' frozen')}>
        {pack.mods.map((m) => {
          const locked = isLockedItem(m)
          return (
            <Row
              key={m.projectId}
              m={m}
              locked={locked}
              on={locked || !off.has(m.projectId)}
              tag={m.base ? 'база' : undefined}
              onToggle={editable && !locked ? () => toggle(m) : undefined}
            />
          )
        })}
      </ul>

      {pack.resourcepacks.length ? (
        <>
          <b className="mpk-sec">Ресурспаки</b>
          <ul className={'mpk-list' + (editable ? '' : ' frozen')}>
            {pack.resourcepacks.map((m) => (
              <Row key={m.projectId} m={m} locked={false} on={!off.has(m.projectId)} onToggle={editable ? () => toggle(m) : undefined} />
            ))}
          </ul>
        </>
      ) : null}
      {pack.shaders.length ? (
        <>
          <b className="mpk-sec">Шейдеры</b>
          <ul className={'mpk-list' + (editable ? '' : ' frozen')}>
            {pack.shaders.map((m) => (
              <Row key={m.projectId} m={m} locked={false} on={!off.has(m.projectId)} onToggle={editable ? () => toggle(m) : undefined} />
            ))}
          </ul>
        </>
      ) : null}
      {pack.maps.length ? (
        <>
          <b className="mpk-sec">Карты</b>
          <ul className="mpk-list">
            {pack.maps.map((m) => (
              <li key={m.slug}>
                <button type="button" className="mpk-row mpk-link-row" data-track="milli_map" data-id={m.slug} onClick={() => openExt(siteUrl(m.url))}>
                  <span className="mpk-ic" aria-hidden="true">
                    {m.icon ? <img src={mirrorAsset(m.icon)} alt="" loading="lazy" /> : <PxIcon name="map" size={18} />}
                  </span>
                  <span className="mpk-body">
                    <span className="mpk-name">
                      <span>{m.title}</span>
                    </span>
                  </span>
                  <PxIcon name="ext" size={12} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {pack.links.length ? (
        <div className="mpk-links">
          {pack.links.map((l) => (
            <button key={l.url} type="button" className="seg mpk-chip" data-track="milli_link" data-kind={l.kind} onClick={() => openExt(siteUrl(l.url))}>
              <PxIcon name={l.kind === 'skins' ? 'shirt' : 'map'} size={12} />
              {l.title}
            </button>
          ))}
        </div>
      ) : null}

      {pack.locked.extras && !plus && !extras ? (
        <button type="button" className="mpk-up" data-track="milli_plus_upsell" data-src="extras" onClick={openPlus}>
          <PxIcon name="crown" size={18} />
          <span>Шейдеры, карты, ресурспаки</span>
          <b>PLUS</b>
        </button>
      ) : null}

      {excluded.length ? <p className="mpk-note">Не вошли: {excluded.join('; ')}</p> : null}

      {server && phase !== 'install' ? <ServerPick pack={pack} projectIds={chosen.mods.map((m) => m.projectId)} onClose={() => setServer(false)} /> : null}

      <div className="mpk-foot">
        {phase === 'plan' ? (
          <>
            <button type="button" className="btn md primary" data-track="milli_install" disabled={!count} onClick={() => void install()}>
              <PxIcon name="download" size={12} />
              Установить
            </button>
            <button type="button" className="btn md secondary" data-track="milli_server" data-plus={canServer ? 1 : 0} onClick={toServer}>
              {canServer ? <PxIcon name="server" size={12} /> : <PxIcon name="crown" size={12} />}
              На сервер
            </button>
          </>
        ) : (
          <>
            <div className="mpk-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: pct + '%' }} />
            </div>
            {phase === 'done' ? (
              <button type="button" className="btn md primary" data-track="play" data-kind="build" data-id={built} data-private onClick={() => play(built)}>
                <PxIcon name="play" size={12} />
                Играть
              </button>
            ) : (
              <span className="mpk-pmsg">{task?.msg || task?.label || 'Создаём…'}</span>
            )}
          </>
        )}
      </div>
      {code ? (
        <div className="mpk-code">
          <span>Код</span>
          <b>{code}</b>
          <button
            type="button"
            className="mpk-x"
            aria-label="Скопировать код"
            data-track="milli_code_copy"
            onClick={() => void copyText(code).then((ok) => showToast(ok ? 'Код скопирован' : 'Не удалось скопировать', ok ? 'ok' : 'error'))}
          >
            <PxIcon name="copy" size={12} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
