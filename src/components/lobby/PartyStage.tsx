import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type Material, type Object3D } from 'three'
import type { SkinViewEngine } from '../../vendor/mine3d'
import type { Mine3dModule } from '../../lib/mine3d'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { nickSkinUrl } from '../../lib/characterStage'
import { detectSlimFromUrl } from '../../lib/skinArms'
import { DEFAULT_PARTY_CAPACITY, sameIdentity, slotPlan, slotSpot, type Party, type PartyMember } from '../../lib/party'
import { isLeader, kickFromParty, promoteInParty, usePartyStore } from '../../state/party'
import { useCall } from '../../state/call'
import { openChat } from '../../state/friends'
import { useHasMillida } from '../../state/auth'
import { stopMateSearch, useMateSearch } from '../../state/mateSearch'
import { uiConfirm } from '../../state/confirm'

const SHADOW_SIZE = 22
const CHEST = 18
const FLOOR = -16
const OVER_HEAD = 9

interface Seat {
  key: string
  member: PartyMember | null
  spot: { x: number; z: number; yaw: number }
  figure: number
}

function seatsOf(party: Party | null, me: string, view: number): Seat[] {
  const capacity = party ? party.capacity : DEFAULT_PARTY_CAPACITY
  const plan = slotPlan(capacity, party ? party.members : [], me)
  const cos = Math.cos(view)
  const sin = Math.sin(view)
  let figure = 0
  return plan.cells.map((cell, i) => {
    // The promo banner holds the right edge of the lobby, so the wider flank goes left.
    const at = slotSpot(i, cell.side === 'right' ? 'left' : 'right')
    return {
      key: cell.member ? cell.member.userId : 'free' + i,
      member: cell.member,
      spot: { x: at.x * cos + at.z * sin, z: -at.x * sin + at.z * cos, yaw: at.yaw * 0.5 },
      figure: cell.member ? ++figure : 0,
    }
  })
}

function viewYaw(engine: SkinViewEngine | null): number {
  const camera = engine?.stageCamera
  if (!camera) return 0
  const v = camera.position
  return Math.round(Math.atan2(v.x, v.z) * 100) / 100
}

let shadowTexture: CanvasTexture | null = null

function shadowMap(): CanvasTexture {
  if (shadowTexture) return shadowTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')!
  const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  fade.addColorStop(0, 'rgba(0,0,0,0.55)')
  fade.addColorStop(0.55, 'rgba(0,0,0,0.28)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = fade
  g.fillRect(0, 0, 64, 64)
  shadowTexture = new CanvasTexture(canvas)
  return shadowTexture
}

/** A soft contact shadow under a party figure, the same kind of blot the player stands on. */
function shadow(): Mesh {
  const mesh = new Mesh(
    new PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE * 0.8),
    new MeshBasicMaterial({ map: shadowMap(), transparent: true, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.05
  mesh.renderOrder = -1
  return mesh
}

/** Where a seat stands; a figure gets a shadow, a free seat stays empty under its «+». */
function anchor(x: number, z: number, taken: boolean): Group {
  const group = new Group()
  if (taken) group.add(shadow())
  group.position.set(x, FLOOR, z)
  return group
}

function dispose(root: Object3D) {
  root.traverse((node) => {
    const mesh = node as Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as Material | Material[] | undefined
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material?.dispose()
  })
}

/**
 * Party seats live in the lobby's own 3D scene: friends are real figures beside me on
 * glowing pads, free seats are bare pads with a «+» above them. Labels and hit areas are
 * DOM laid over the canvas and follow the projected heads every frame.
 */
export function usePartyStage(engine: SkinViewEngine | null, m3d: Mine3dModule | null, ready: number, enabled: boolean) {
  const party = usePartyStore((s) => s.party)
  const me = usePartyStore((s) => s.me)
  const view = ready ? viewYaw(engine) : 0
  const seats = useMemo(() => (enabled ? seatsOf(party, me, view) : []), [enabled, party, me, view])
  const figuresKey = view + '/' + seats.map((s) => (s.member ? s.member.userId + ':' + s.member.nickname : '-')).join('|')
  const pads = useRef<Group[]>([])

  useEffect(() => {
    if (!engine || !m3d || !ready) return
    const group = new Group()
    engine.addStageProp(group)
    const list: Group[] = []
    for (const seat of seats) {
      const at = anchor(seat.spot.x, seat.spot.z, !!seat.member)
      group.add(at)
      list.push(at)
    }
    pads.current = list
    return () => {
      pads.current = []
      group.parent?.remove(group)
      dispose(group)
    }
  }, [engine, m3d, ready, seats])

  useEffect(() => {
    if (!engine || !m3d || !ready) return
    let alive = true
    const members = seats.filter((s) => s.member)
    void Promise.all(
      members.map(async (s) => {
        const url = nickSkinUrl(s.member!.nickname || 'MHF_Steve')
        const slim = await detectSlimFromUrl(url).catch(() => false)
        return { skin: url, slim, animation: m3d.createSkinAnimation('idle'), at: { x: s.spot.x, y: 0, z: s.spot.z, yaw: s.spot.yaw } }
      }),
    ).then((figures) => {
      if (alive) void engine.setExtras(figures).catch(() => {})
    })
    return () => {
      alive = false
    }
  }, [engine, m3d, ready, figuresKey])

  useEffect(() => {
    if (!engine || !ready) return
    return () => {
      void engine.setExtras([]).catch(() => {})
    }
  }, [engine, ready])

  return { seats, pads, party, me }
}

type Point = { x: number; y: number }

function project(engine: SkinViewEngine, stage: HTMLElement, at: Vector3): Point {
  at.project(engine.stageCamera)
  return { x: ((at.x + 1) / 2) * stage.clientWidth, y: ((1 - at.y) / 2) * stage.clientHeight }
}

function MemberMenu({
  m,
  leader,
  ready,
  close,
}: {
  m: PartyMember
  leader: boolean
  ready: boolean
  close: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useCloseOutside(ref, close)
  const nick = m.nickname || 'Игрок'
  return (
    <div className="party-pop" ref={ref} role="menu">
      <div className="party-pop-head">
        <Head nick={nick} src={m.avatarUrl} size={28} />
        <span className="party-pop-who">
          <b>{nick}</b>
          <span className={ready ? 'on' : ''}>{m.role === 'leader' ? 'Лидер' : ready ? 'Готов' : 'Не готов'}</span>
        </span>
      </div>
      <button role="menuitem" onClick={() => void openChat(m.userId, nick).then(close)}>
        <Icon id="i-msg" />
        Написать
      </button>
      {leader ? (
        <>
          <button role="menuitem" onClick={() => void promoteInParty(m.userId).then(close)}>
            <Icon id="i-crown" />
            Сделать лидером
          </button>
          <button
            role="menuitem"
            onClick={() =>
              void uiConfirm('Исключить ' + nick + ' из пати?', { confirmLabel: 'Исключить', danger: true }).then((ok) => {
                close()
                if (ok) void kickFromParty(m.userId)
              })
            }
          >
            <Icon id="i-logout" />
            Исключить
          </button>
        </>
      ) : null}
      <button
        role="menuitem"
        className="danger"
        onClick={() => {
          close()
          usePartyStore.getState().set({ reportAsk: { userId: m.userId, nick, context: 'party' } })
        }}
      >
        <Icon id="i-flag" />
        Пожаловаться
      </button>
    </div>
  )
}

/** Only while a mate search runs: the seat then has two things to offer — calling a friend or stopping the search. */
function SeatMenu({ close }: { close: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useCloseOutside(ref, close)
  return (
    <div className="party-pop seat" ref={ref} role="menu">
      <button
        role="menuitem"
        onClick={() => {
          close()
          usePartyStore.getState().set({ inviteOpen: true })
        }}
      >
        <Icon id="i-users" />
        Позвать друга
      </button>
      <button
        role="menuitem"
        className="danger"
        onClick={() => {
          close()
          void stopMateSearch()
        }}
      >
        <Icon id="i-x" />
        Отменить поиск
      </button>
    </div>
  )
}

function useCloseOutside(ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [ref, close])
}

/** Labels, «+» buttons and member menus over the lobby canvas. */
export function PartyOverlay({
  engine,
  stage,
  seats,
  pads,
  party,
  me,
  awake,
}: {
  engine: SkinViewEngine | null
  stage: RefObject<HTMLDivElement | null>
  seats: Seat[]
  pads: RefObject<Group[]>
  party: Party | null
  me: string
  awake: boolean
}) {
  const millida = useHasMillida()
  const parts = useCall((s) => s.parts)
  const callRoom = useCall((s) => s.roomId)
  const [menu, setMenu] = useState('')
  const refs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    if (!engine || !seats.length) return
    let raf = 0
    const v = new Vector3()
    const place = () => {
      const host = stage.current
      if (!host) return
      seats.forEach((seat, i) => {
        const el = refs.current[seat.key]
        const padMesh = pads.current?.[i]
        if (!el || !padMesh) return
        let top: Point
        let foot: Point
        if (seat.member) {
          const head: Object3D | null = engine.figureHead(seat.figure)
          if (!head) return
          head.getWorldPosition(v)
          v.y += OVER_HEAD
          top = project(engine, host, v)
        } else {
          padMesh.localToWorld(v.set(0, CHEST - FLOOR - 16, 0))
          top = project(engine, host, v)
        }
        padMesh.localToWorld(v.set(0, 0, 0))
        foot = project(engine, host, v)
        el.style.transform = 'translate(' + Math.round(top.x) + 'px,' + Math.round(top.y) + 'px)'
        el.style.setProperty('--seat-h', Math.max(0, Math.round(foot.y - top.y)) + 'px')
      })
    }
    let t = 0
    const loop = () => {
      place()
      if (awake) raf = requestAnimationFrame(loop)
      else t = window.setTimeout(loop, 500)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [engine, seats, pads, stage, awake])

  if (!millida || !seats.length) return null
  const leader = isLeader(party, me)
  const inVoice = !!party && callRoom === party.id
  const searching = useMateSearch((st) => st.searching)

  // One way to call someone, not a «+» on every empty seat (владелец 11.10.2026):
  // the button stands on the next seat to fill, the rest stay bare.
  const inviteSeat = seats.find((s) => !s.member)?.key

  return (
    <div className="party-overlay" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      {seats.map((seat) => {
        const m = seat.member
        if (!m) {
          if (seat.key !== inviteSeat) return null
          return (
            <span
              key={seat.key}
              className={'party-seat free' + (searching ? ' searching' : '') + (seat.spot.x > 0 ? ' flip' : '')}
              ref={(el) => void (refs.current[seat.key] = el)}
            >
              <button
                className={'party-add' + (menu === seat.key ? ' open' : '')}
                data-sound="open"
                data-notip
                aria-haspopup={searching ? 'menu' : 'dialog'}
                aria-label={searching ? 'Ищем напарника' : 'Позвать в пати'}
                onClick={() => {
                  if (searching) setMenu(menu === seat.key ? '' : seat.key)
                  else usePartyStore.getState().set({ inviteOpen: true })
                }}
              >
                {searching ? (
                  <span className="party-dots" aria-hidden="true"><i /><i /><i /></span>
                ) : (
                  <>
                    <Icon id="i-user" />
                    <Icon id="i-plus" className="icon party-add-badge" />
                  </>
                )}
              </button>
              <span className="party-add-label">{searching ? 'Ищем напарника' : 'Позвать'}</span>
              {menu === seat.key ? <SeatMenu close={() => setMenu('')} /> : null}
            </span>
          )
        }
        const part = inVoice ? parts.find((p) => p.userId === m.userId) : undefined
        const speaking = !!part && part.speaking
        const ready = m.role === 'leader' || (m.ready && !!party?.target && sameIdentity(m.have, party.target))
        const open = menu === m.userId
        return (
          <span key={seat.key} className={'party-seat' + (speaking ? ' speaking' : '') + (seat.spot.x > 0 ? ' flip' : '')} ref={(el) => void (refs.current[seat.key] = el)}>
            <span className="seat-tag">
              <span className="seat-nick">
                {m.role === 'leader' ? <Icon id="i-crown" className="party-crown" /> : null}
                {m.nickname || 'Игрок'}
                {speaking ? <Icon id="i-mic" className="party-mic" /> : null}
                {ready && m.role !== 'leader' ? <Icon id="i-check" className="party-ready" /> : null}
              </span>
            </span>
            <button
              className={'party-hit' + (open ? ' open' : '')}
              aria-label={m.nickname || 'Игрок'}
              aria-haspopup="menu"
              onClick={() => setMenu(open ? '' : m.userId)}
            />
            {open ? <MemberMenu m={m} leader={leader} ready={ready} close={() => setMenu('')} /> : null}
          </span>
        )
      })}
    </div>
  )
}
