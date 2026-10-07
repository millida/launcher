import { useEffect, useMemo, useRef, useState } from 'react'
import { loadMine3d } from '../../lib/mine3d'
import { headLook } from '../../lib/headLook'
import type { Mine3dModule } from '../../lib/mine3d'
import type { SkinAnimation, SkinViewEngine } from '../../vendor/mine3d'
import { textureSource } from '../../lib/textureSource'
import { detectSlimFromUrl } from '../../lib/skinArms'
import { useViewPrefs } from '../../state/viewPrefs'
import { LOOK_EVENT, gameProfile, loadCosmeticCatalog, loadWardrobe, loadWornCosmetics, lookVersion } from '../../lib/gameProfile'
import type { CosmeticItem } from '../../lib/gameProfile'
import { useHasMillida } from '../../state/auth'
import { getAccount, useAccounts } from '../../state/accounts'
import { buildCosmetic } from '../../lib/cosmeticModel'
import { SHOP_YAW } from '../../lib/outfitSnapshot'
import { hidesRegularCape, maskUrls, pieceCover } from '../../lib/cosmeticCover'
import { maskedSkin } from '../../lib/maskedSkin'
import { CosmeticEmote, emoteClip } from '../../lib/cosmeticEmote'
import { emoteSequence } from '../../lib/emoteSequence'
import { readAnimations } from '../../lib/cosmeticAnimation'
import { defaultVariant } from '../../lib/cosmeticVariants'
import { Nametag, nametagSpot } from '../character/Nametag'
import { FlatFigure } from '../character/FlatFigure'
import { gpuLite, noteContextCreated, noteContextLost, useGpuLite } from '../../lib/gpuLite'
import { webviewFailure } from '../../lib/webviewHealth'
import { Vector3 } from 'three'
import { setScreen } from '../../state/ui'
import { onRenderGate, renderLive } from '../../lib/renderGate'
import {
  IDLE_SHOW,
  SHOP_LIGHT,
  SHOP_SHOW,
  IDLE_SHOW_FIRST_MAX,
  IDLE_SHOW_FIRST_MIN,
  IDLE_SHOW_GAP_MAX,
  IDLE_SHOW_GAP_MIN,
  MILLIDA_LIGHT,
  TURN_PER_PIXEL,
  between,
  cosmeticModel,
  releaseEngine,
  nickSkinUrl,
  lobbyFrame,
  lobbyHitBox,
  tagBox,
} from '../../lib/characterStage'
import { releaseSnapshotGl } from '../../lib/glPool'

/** Во что одет игрок: то же, что видят другие на сервере. */
interface Look {
  skin: string
  slim: boolean
  cape: string | null
  /** Надетые вещи с уже выбранной текстурой варианта. */
  items: { item: CosmeticItem; texture: string | undefined; glow?: string }[]
  /** Эмоции для автопоказа в лобби — из каталога, по списку LOBBY_EMOTES. */
  show: CosmeticItem[]
  /** Витрина: для какого состава вещей собран образ. */
  dressKey?: string
}

/**
 * Эмоции, которые персонаж сам изредка играет в лобби: только те, что читаются
 * спереди стоя. Полёты, сидячие и лёжа, сальто, «червяк» и бег сюда не идут —
 * фигура уходит из кадра или ложится (приказ владельца 23.09.2026).
 */
const LOBBY_EMOTES = [
  '67',
  'EXCLAIMED_POINT',
  'ANIME_LOVE',
  'WAVE_R',
  'DAB',
  'CLAP',
  'YES',
  'KISS',
  'FLOSS',
  'WHIP_NAE',
  'SHUFFLE_DANCE',
  'VIBE_DANCE',
  'HYPERPOP_DANCE',
  'TAUNT_DANCE',
  'PIGLIN_VICTORY',
  'EVIL_LAUGH',
  'BOW',
  'WHEW',
]

/** Встроенные движения, если эмоции не доехали. */
const BUILTIN_SHOW = IDLE_SHOW

/** Сколько длится показ эмоции: короткую петлю повторяем, длинную режем. */
const EMOTE_MIN_MS = 2500
const EMOTE_MAX_MS = 8000

/** Последний образ: при возврате на главную персонаж надевается сразу. */
let lastLook: Look | null = null

/** Тот же ли образ: иначе повторное надевание дёргает кадр на ровном месте. */
const lookKey = (l: Look | null) =>
  l ? [l.skin, l.slim, l.cape, l.items.map((x) => x.item.id + ':' + (x.texture || '')).join(',')].join('|') : ''

type Movable = { position?: { x: number; z: number } }

/**
 * Эмоция не должна уводить фигуру с места: корень по горизонтали прибит
 * к центру сцены после каждого кадра клипа (владелец 23.09.2026).
 */
function pinned<A extends { update(player: unknown, dt: number): void }>(anim: A): A {
  const step = anim.update.bind(anim)
  anim.update = (player: unknown, dt: number) => {
    step(player, dt)
    const root = player as Movable
    if (root.position) {
      root.position.x = 0
      root.position.z = 0
    }
  }
  return anim
}

async function loadLook(nick: string, signedIn: boolean): Promise<Look> {
  const look: Look = { skin: nickSkinUrl(nick), slim: false, cape: null, items: [], show: [] }
  const catalogAsked = loadCosmeticCatalog().catch(() => ({ items: [] as CosmeticItem[] }))
  const pickShow = (items: CosmeticItem[]) =>
    LOBBY_EMOTES.map((id) => items.find((c) => c.id === id)).filter((c): c is CosmeticItem => Boolean(c && c.model))
  // A skin found by nick carries no arm type, so it is read from the texture
  // exactly as the wardrobe does; otherwise an Alex skin got Steve arms here.
  const nickArms = () => detectSlimFromUrl(look.skin).catch(() => false)
  if (!signedIn) {
    const [catalog, slim] = await Promise.all([catalogAsked, nickArms()])
    look.show = pickShow(catalog.items || [])
    look.slim = slim
    return look
  }
  const [wardrobe, catalog, worn] = await Promise.all([
    loadWardrobe().catch(() => null),
    catalogAsked,
    gameProfile()
      .then((p) => (p.uuid ? loadWornCosmetics(p.uuid) : []))
      .catch(() => []),
  ])
  const fresh = (u: string) => (lookVersion && !/^(data|blob):/i.test(u) ? u + (u.includes('?') ? '&' : '?') + 'v=' + lookVersion : u)
  if (wardrobe?.active.skinUrl) {
    look.skin = fresh(wardrobe.active.skinUrl)
    look.slim = wardrobe.active.model === 'slim'
  } else look.slim = await nickArms()
  look.cape = wardrobe?.active.capeUrl ? fresh(wardrobe.active.capeUrl) : null
  look.show = pickShow(catalog.items || [])
  for (const w of worn) {
    // Служба отдаёт базовый код вещи; если ответ пришёл раньше каталога, fromServer
    // не развернул его в «КОД~расцветка» — ищем карточку по baseId и имени расцветки.
    const all = catalog.items || []
    const item =
      all.find((c) => c.id === w.id) ??
      all.find((c) => c.baseId === w.id && c.variants?.[0]?.name === w.variant) ??
      all.find((c) => c.baseId === w.id)
    if (!item || !item.model) continue
    const list = item.variants ?? []
    const variant = list.find((v) => v.name === w.variant) ?? (list.length ? defaultVariant(list) : null)
    look.items.push({ item, texture: variant?.texture ?? item.texture, glow: variant?.emissive ?? item.emissive })
  }
  return look
}

/**
 * Персонаж на главной — тот, которого собирают в «Персонаже»: скин, плащ и
 * вся надетая косметика. Голый скин по умолчанию выглядит скучно, и это
 * задумано: главная — витрина того, что человек на себя надел.
 *
 * Фигуру крутят мышью, как в гардеробе. В гардероб ведёт только кнопка:
 * клик по пустой сцене уводил туда случайно.
 */
/** Настроение эмоции по названию: облачко показывает смайл того же тона. */
export type EmoteMood = 'happy' | 'sad' | 'love' | 'angry' | 'think' | 'cool' | 'wow' | 'sleepy'
function emoteMood(name: string): EmoteMood {
  const n = name.toLowerCase()
  if (/sad|cry|tear|груст|плач|слез|печал|рыда/.test(n)) return 'sad'
  if (/love|heart|kiss|hug|любов|серд|поцел|обним/.test(n)) return 'love'
  if (/angry|rage|mad|зл|ярост|бешен/.test(n)) return 'angry'
  if (/think|look|hmm|дума|смотр|огляд/.test(n)) return 'think'
  if (/cool|swag|крут|стил/.test(n)) return 'cool'
  if (/sleep|yawn|tired|сон|сп(ит|ать)|зев|устал/.test(n)) return 'sleepy'
  if (/wow|shock|scare|surpr|удив|испуг|шок/.test(n)) return 'wow'
  return 'happy'
}

export function LobbyCharacter({
  on,
  dress,
  shop,
  onDressed,
}: {
  on: boolean
  /**
   * Витрина магазина (v2, 06.10.2026): вместо надетого на игроке стоят эти вещи
   * поверх его скина и плаща. Без ника, эмоций и перехода в гардероб.
   */
  dress?: { code: string }[]
  shop?: boolean
  /** Витрина: сколько вещей из `dress` встало на фигуру (0 — 3D не вышло, покажи превью). */
  onDressed?: (n: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<SkinViewEngine | null>(null)
  const activeId = useAccounts((s) => s.active)
  // Сессия Millida поднимается из хранилища уже после первого кадра, а лобби
  // монтируется сразу: без этой зависимости образ читался «без входа» и вещи
  // не появлялись до следующего захода на главную (владелец 23.09.2026:
  // «косметика полностью вся пропала»).
  const signedIn = useHasMillida()
  const charAnim = useViewPrefs((s) => s.charAnim)
  const [m3d, setM3d] = useState<Mine3dModule | null>(null)
  // Номер живой сцены, 0 — сцены нет. Не флаг: при потере контекста WebGL
  // старая сцена гасит его, новая зажигает в том же кадре, React видел то же
  // true — и скин с вещами на новую сцену не надевались.
  const [ready, setReady] = useState(0)
  const [baseLook, setLook] = useState<Look | null>(lastLook)
  const [dressItems, setDressItems] = useState<{ key: string; items: Look['items'] }>({ key: '', items: [] })
  const dressKey = (dress ?? []).map((d) => d.code).join(',')
  useEffect(() => {
    if (!dressKey) return setDressItems({ key: '', items: [] })
    let alive = true
    void loadCosmeticCatalog()
      .then((cat) => {
        if (!alive) return
        const out: Look['items'] = []
        for (const code of dressKey.split(',')) {
          const item = (cat.items || []).find((c) => c.id === code)
          if (!item || !item.model) continue
          const variant = item.variants?.[0]
          out.push({ item, texture: variant?.texture ?? item.texture, glow: variant?.emissive ?? item.emissive })
        }
        setDressItems({ key: dressKey, items: out })
      })
      .catch(() => alive && setDressItems({ key: dressKey, items: [] }))
    return () => {
      alive = false
    }
  }, [dressKey])
  const onDressedRef = useRef(onDressed)
  onDressedRef.current = onDressed
  const dressKeyRef = useRef(dressKey)
  dressKeyRef.current = dressKey
  const look = useMemo<Look | null>(
    () => (baseLook && shop ? { ...baseLook, items: dressItems.items, show: [], dressKey: dressItems.key } : baseLook),
    [baseLook, dressItems, shop],
  )
  // Показываем только одетого персонажа с окончательным кадром: иначе он
  // появлялся голым, а потом кадр перескакивал под плащ и вещи.
  const [skinFor, setSkinFor] = useState('')
  const [dressedFor, setDressedFor] = useState('')
  const shown = !!look && skinFor === lookKey(look) && dressedFor === lookKey(look)
  const [emoting, setEmoting] = useState(false)
  const [awake, setAwake] = useState(false)
  const [tag, setTag] = useState<{ x: number; y: number } | null>(null)
  // Ник следует за головой (правка владельца 23.09.2026: в прыжке и эмоции
  // стоял на месте). При кадрировании запоминаем, где была голова, дальше
  // каждый кадр сдвигаем ник на столько же, на сколько сдвинулась голова.
  const tagWrap = useRef<HTMLSpanElement>(null)
  const pressAt = useRef<{ x: number; y: number } | null>(null)
  const headRest = useRef<{ x: number; y: number } | null>(null)
  // Габарит тела в NDC последнего кадра: по нему считаем зону клика в гардероб.
  const bodyNdc = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null)
  /** Идёт эмоция — голова её, за мышкой не следим. */
  const busyRef = useRef(false)
  // Контекст WebGL всё-таки отобрали — сцену собираем заново на новом холсте:
  // на старом новый движок получил бы тот же потерянный контекст.
  const [glEpoch, setGlEpoch] = useState(0)
  /** Сколько раз подряд браузер не дал контекст WebGL (все заняты): пока 0 —
   *  3D, иначе плоская фигурка и новая попытка через паузу (06.10.2026). */
  const [glFail, setGlFail] = useState(0)
  const [glTry, setGlTry] = useState(false)
  const nick = (getAccount() || { nick: '' }).nick || 'MHF_Steve'
  // Переоделись в гардеробе — образ перечитываем со свежей картинкой.
  const [lookVer, setLookVer] = useState(lookVersion)
  useEffect(() => {
    const on = () => setLookVer(lookVersion)
    window.addEventListener(LOOK_EVENT, on)
    return () => window.removeEventListener(LOOK_EVENT, on)
  }, [])

  // Образ перечитываем при каждом заходе на главную: человек только что мог
  // переодеться в гардеробе.
  useEffect(() => {
    if (!on) return
    let alive = true
    void loadLook(nick, signedIn).then((l) => {
      if (!alive) return
      if (lookKey(l) === lookKey(lastLook) && lastLook) return setLook((cur) => cur ?? lastLook)
      lastLook = l
      setLook(l)
    })
    return () => {
      alive = false
    }
  }, [on, nick, activeId, signedIn, lookVer])

  // Лёгкая графика после сбоя видеокарты: без WebGL, плоская фигурка.
  const lite = useGpuLite()
  const [flatShown, setFlatShown] = useState(false)
  useEffect(() => {
    if (!on || m3d || lite) return
    let alive = true
    // Сначала узнаём, не убил ли прошлое окно сбой видеокарты: тогда WebGL
    // не создаём вовсе (иначе окно падало снова и снова).
    webviewFailure()
      .then(() => (gpuLite() ? null : loadMine3d()))
      .then((mod) => {
        if (!mod) return
        if (alive) setM3d(mod)
      })
      .catch((e) => console.error('[lobby] 3d', e))
    return () => {
      alive = false
    }
  }, [on, m3d, lite])

  const headScreen = (): { x: number; y: number } | null => {
    const engine = viewerRef.current as unknown as {
      camera?: import('three').Camera
      playerObject?: { skin?: { head?: import('three').Object3D } }
    } | null
    const stage = stageRef.current
    const head = engine?.playerObject?.skin?.head
    if (!engine?.camera || !head || !stage) return null
    const v = new Vector3()
    head.getWorldPosition(v)
    v.project(engine.camera)
    return { x: ((v.x + 1) / 2) * stage.clientWidth, y: ((1 - v.y) / 2) * stage.clientHeight }
  }

  /** Голова на экране: центр и полуширина в пикселях сцены. */
  const headBox = (): { x: number; y: number; r: number } | null => {
    const engine = viewerRef.current as unknown as {
      camera?: import('three').Camera
      playerObject?: { skin?: { head?: import('three').Object3D } }
    } | null
    const stage = stageRef.current
    const head = engine?.playerObject?.skin?.head
    if (!engine?.camera || !head || !stage) return null
    const a = new Vector3()
    head.getWorldPosition(a)
    const b = a.clone().add(new Vector3(4, 0, 0))
    a.project(engine.camera)
    b.project(engine.camera)
    const w = stage.clientWidth
    const h = stage.clientHeight
    return { x: ((a.x + 1) / 2) * w, y: ((1 - a.y) / 2) * h, r: Math.abs(b.x - a.x) * w * 0.5 }
  }

  const fit = () => {
    const engine = viewerRef.current
    const stage = stageRef.current
    if (!engine || !stage) return
    try {
      const w = stage.clientWidth || 300
      const h = stage.clientHeight || 430
      engine.setSize(w, h)
      // Кадр — по одному телу: крылья, питомец и плащ его не двигают. Ник —
      // над самой высокой вещью в нейтральной стойке, по центру тела.
      const scene = (stage.offsetParent as HTMLElement | null)?.clientHeight || h
      const frame = shop ? { fillY: 0.6, offsetY: 1 - 2 * 0.86 + 0.6 } : lobbyFrame(h, stage.offsetTop, scene)
      // Размер фигуры всегда один, при любых вещах (владелец 22:35).
      const r = engine.fitPlayerToFrame(frame)
      if (r) {
        setTag(nametagSpot(tagBox(r), w, h))
        headRest.current = headScreen()
        bodyNdc.current = r.ndc
      }
    } catch {}
  }


  // Ник ходит за головой, только пока сцена живая: остановленная модель не
  // двигается, а пустой цикл кадров будил бы видеокарту и поверх игры.
  useEffect(() => {
    if (!shown || !awake) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = tagWrap.current
      const rest = headRest.current
      const now = headScreen()
      if (!el || !rest || !now) return
      el.style.transform = 'translate(' + (now.x - rest.x).toFixed(1) + 'px,' + (now.y - rest.y).toFixed(1) + 'px)'
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [shown, awake])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!m3d || !canvas || lite) return
    const onLost = (ev: Event) => {
      ev.preventDefault()
      console.warn('[lobby] webgl context lost')
      noteContextLost()
      setSkinFor('')
      setDressedFor('')
      setGlEpoch((n) => n + 1)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    let engine: SkinViewEngine
    try {
      noteContextCreated()
      engine = new m3d.SkinViewEngine(canvas, {
        autoResize: false,
        autoDetectModel: false,
        transparent: true,
        enableControls: false,
      })
    } catch (e) {
      console.warn('[lobby] engine: нет контекста WebGL, пока плоская фигурка', e)
      canvas.removeEventListener('webglcontextlost', onLost)
      // Освободить контексты снимков магазина и превью — следующая попытка их получит.
      releaseSnapshotGl()
      setGlTry(false)
      setGlFail((n) => n + 1)
      return
    }
    setGlFail(0)
    setGlTry(false)
    engine.applyLightSettings(shop ? SHOP_LIGHT : MILLIDA_LIGHT)
    engine.setContactShadowVisible(true)
    // За курсором не следит: корпус поворачивался за мышью, пока человек
    // тянулся к кнопкам, — «персонаж скачет» (владелец 23.09.2026).
    engine.setCursorFollow(false)
    // Зато голова следит за мышкой в покое — корпус стоит (владелец 24.09.2026).
    engine.setPoseHook(headLook(() => busyRef.current))
    engine.setPresentationMode('full')
    // Витрина: три четверти, как на снимках карточек (lib/outfitSnapshot).
    if (shop) engine.setPlayerYaw(SHOP_YAW)
    viewerRef.current = engine
    // Только в разработке: замер «персонаж не сдвигается» (scripts/лобби) читает
    // движок отсюда. В сборку не попадает.
    if (import.meta.env.DEV) (window as unknown as { __lobbyEngine?: SkinViewEngine }).__lobbyEngine = engine
    setReady(glEpoch + 1)
    fit()
    engine.start()
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      viewerRef.current = null
      // Ссылка для замеров не должна держать снесённую сцену с её холстом.
      if (import.meta.env.DEV) {
        const w = window as unknown as { __lobbyEngine?: SkinViewEngine }
        if (w.__lobbyEngine === engine) delete w.__lobbyEngine
      }
      setReady(0)
      releaseEngine(engine)
    }
  }, [m3d, glEpoch, lite])

  useEffect(() => {
    const engine = viewerRef.current
    if (!engine || !m3d || !look) return
    let alive = true
    engine.setModelType(look.slim ? m3d.SkinModelType.Slim : m3d.SkinModelType.Classic)
    const outfit = look.items.map((x) => x.item)
    const masks = maskUrls(outfit, look.slim, outfit.find((item) => item.slot === 'EMOTE'))
    void textureSource(look.skin)
      .then((src) =>
        maskedSkin(src, masks, look.slim).catch((e: unknown) => {
          console.warn('[lobby] skin under the outfit was not cut', e)
          return src
        }),
      )
      .then((src) => {
        if (!alive) return
        return engine
          .setSkin(src)
          .then(() => {
            if (!alive) return
            fit()
            requestAnimationFrame(() => requestAnimationFrame(() => alive && setSkinFor(lookKey(look))))
          })
          // Скин не прочитался — всё равно показываем персонажа (запасной
          // скин по нику), а не оставляем его невидимым навсегда.
          .catch(() =>
            engine
              .setSkin(nickSkinUrl(nick))
              .catch(() => {})
              .finally(() => {
                if (!alive) return
                fit()
                setSkinFor(lookKey(look))
              }),
          )
      })
    if (look.cape && !hidesRegularCape(outfit)) {
      void textureSource(look.cape).then((src) => {
        if (alive)
          engine
            .setCape(src)
            .then(() => {
              if (alive) fit()
            })
            .catch(() => {})
      })
    } else engine.clearCape()
    return () => {
      alive = false
    }
  }, [look, ready, m3d])

  useEffect(() => {
    const engine = viewerRef.current
    if (!engine || !ready || !look || typeof engine.clearCosmetics !== 'function') return
    let alive = true
    engine.clearCosmetics()
    const outfit = look.items.map((x) => x.item)
    const worn = look.items.filter((x) => x.texture || x.item.slot === 'EMOTE')
    void Promise.all(worn.map((x) => cosmeticModel(x.item.model as string).then((file) => ({ ...x, file })))).then(
      (loaded) => {
        if (!alive) return
        const emote = loaded.find((got) => got.item.slot === 'EMOTE' && got.file?.animations)
        const clips = emote?.file ? readAnimations(emote.file.animations) : {}
        const sequence = emote?.file ? emoteSequence(clips, emoteClip(clips, emote.item.animation)) : null
        const playing = sequence ? new CosmeticEmote(sequence, emote?.file?.geometry) : null
        if (playing) engine.setAnimation(pinned(playing) as unknown as SkinAnimation)
        setEmoting(!!playing)
        let dressedCount = 0
        for (const got of loaded) {
          if (!got.file || !got.texture) continue
          const geometry = look.slim && got.file.geometrySlim ? got.file.geometrySlim : got.file.geometry
          let worn = false
          try {
            for (const piece of buildCosmetic(
              geometry,
              got.texture,
              got.item.slot,
              got.file.animations,
              got.item.animation,
              got === emote && playing && sequence ? { sequence, clock: () => playing.progress } : undefined,
              pieceCover(outfit, got.item),
              got.glow,
            )) {
              engine.attachCosmetic(piece.anchor, piece.object)
              worn = true
            }
            if (worn) dressedCount += 1
          } catch {
            // Кривая модель не гасит главную: вещь просто не покажется.
          }
        }
        // Кадр от вещей не зависит, но ник встаёт над новой шляпой.
        fit()
        setDressedFor(lookKey(look))
        if (shop && look.dressKey === dressKeyRef.current) onDressedRef.current?.(dressedCount)
      },
    )
    return () => {
      alive = false
      engine.clearCosmetics()
    }
  }, [look, ready])

  // Покой и изредка эмоция: стоит спокойно, а время от времени сам играет
  // «67», жест или танец из каталога. Эмоции нет — встроенное движение.
  useEffect(() => {
    const engine = viewerRef.current
    if (!engine || !m3d || emoting) return
    const rest = () => {
      const e = viewerRef.current
      if (!e) return
      e.setAnimation(m3d.createSkinAnimation('idle'))
    }
    rest()
    if (!awake) return
    // «Настройки → Вид»: без периодических движений — только спокойная стойка.
    if (!charAnim) return
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Витрина: стоит и дышит, изредка оглядывается или машет — без эмоций
    // из каталога и облачков (владелец 06.10.2026: «персонажи должны двигаться сами»).
    if (shop) {
      let live = true
      let wait: ReturnType<typeof setTimeout> | undefined
      let k = Math.floor(Math.random() * SHOP_SHOW.length)
      const play = () => {
        const e = viewerRef.current
        if (!e || !live) return
        const clip = SHOP_SHOW[k++ % SHOP_SHOW.length]
        e.setAnimation(m3d.createSkinAnimation(clip.id))
        wait = setTimeout(() => {
          if (!live) return
          rest()
          wait = setTimeout(play, between(IDLE_SHOW_GAP_MIN * 1.6, IDLE_SHOW_GAP_MAX * 1.6))
        }, clip.ms)
      }
      wait = setTimeout(play, between(IDLE_SHOW_FIRST_MAX, IDLE_SHOW_GAP_MAX))
      return () => {
        live = false
        clearTimeout(wait)
      }
    }
    // Персонаж перестаёт танцевать по выбору в «Настройки → Вид»: остаётся
    // спокойная стойка без периодических эмоций (владелец 25.09.2026).
    if (!charAnim) return
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let bag: number[] = []
    const show = look?.show ?? []
    const next = () => {
      if (!bag.length) bag = show.map((_, i) => i).sort(() => Math.random() - 0.5)
      return show[bag.pop() as number]
    }
    // Реквизит эмоции (сердечки, монета) снимается точечно, надетое не трогаем:
    // полное переодевание мигало крыльями и шляпой.
    let props: { anchor: string; object: import('three').Object3D }[] = []
    const dropProps = () => {
      const e = viewerRef.current as unknown as { _cosmetics?: { object: unknown }[] } | null
      for (const piece of props) {
        piece.object.parent?.remove(piece.object)
        piece.object.traverse((node) => {
          const mesh = node as { geometry?: { dispose(): void } }
          mesh.geometry?.dispose()
        })
      }
      if (e && Array.isArray(e._cosmetics)) {
        const gone = new Set<unknown>(props.map((x) => x.object))
        e._cosmetics = e._cosmetics.filter((x) => !gone.has(x.object))
      }
      props = []
    }
    // Облачко над эмоцией — по её настроению (владелец 24.09.2026, 07:45).
    const emote = (name: string) => {
      busyRef.current = true
      // Где голова и какого она размера на экране — облачко встаёт справа
      // от неё (владелец 24.09.2026: «сверху неудобно, справа»).
      window.dispatchEvent(new CustomEvent('lobby-emote', { detail: { mood: emoteMood(name), head: headBox() } }))
    }
    const toRest = (dressed: boolean) => {
      busyRef.current = false
      if (!alive) return
      rest()
      if (dressed) dropProps()
      timer = setTimeout(() => void toShow(), between(IDLE_SHOW_GAP_MIN, IDLE_SHOW_GAP_MAX))
    }
    const builtin = () => {
      const e = viewerRef.current
      if (!e) return
      const clip = BUILTIN_SHOW[Math.floor(Math.random() * BUILTIN_SHOW.length)]
      emote(clip.id)
      e.setAnimation(m3d.createSkinAnimation(clip.id))
      timer = setTimeout(() => toRest(false), clip.ms)
    }
    const toShow = async () => {
      const e = viewerRef.current
      if (!e || !alive) return
      const item = show.length ? next() : null
      const file = item?.model ? await cosmeticModel(item.model) : null
      if (!alive) return
      const clips = file?.animations ? readAnimations(file.animations) : {}
      const sequence = item && file ? emoteSequence(clips, emoteClip(clips, item.animation)) : null
      if (!item || !file || !sequence) return builtin()
      emote(item.name + ' ' + (item.animation || ''))
      const playing = pinned(new CosmeticEmote(sequence, file.geometry))
      e.setAnimation(playing as unknown as SkinAnimation)
      const list = item.variants ?? []
      const base = list.length ? defaultVariant(list) : undefined
      const texture = base?.texture ?? item.texture
      if (texture) {
        try {
          for (const piece of buildCosmetic(
            look?.slim && file.geometrySlim ? file.geometrySlim : file.geometry,
            texture,
            item.slot,
            file.animations,
            item.animation,
            { sequence, clock: () => playing.progress },
            pieceCover([...(look?.items ?? []).map((x) => x.item), item], item),
            base?.emissive ?? item.emissive,
          )) {
            e.attachCosmetic(piece.anchor, piece.object)
            props.push(piece)
          }
        } catch {}
      }
      const intro = sequence.intro ? sequence.intro.length : 0
      const loop = sequence.main.length || 1
      const ms = Math.min(EMOTE_MAX_MS, Math.max(EMOTE_MIN_MS, (intro + loop * Math.max(1, Math.ceil(3 / loop))) * 1000))
      timer = setTimeout(() => toRest(true), ms)
    }
    timer = setTimeout(() => void toShow(), between(IDLE_SHOW_FIRST_MIN, IDLE_SHOW_FIRST_MAX))
    return () => {
      alive = false
      clearTimeout(timer)
      dropProps()
    }
  }, [m3d, ready, awake, emoting, look, charAnim])

  useEffect(() => {
    if (!ready) return
    const stage = stageRef.current
    if (!stage) return
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fit())
    ro.observe(stage)
    return () => ro.disconnect()
  }, [ready, on])

  // Вне главной и в свёрнутом окне сцена стоит: видеокарта нужна игре.
  useEffect(() => {
    if (!ready) return
    const setPaused = (v: boolean) => {
      const engine = viewerRef.current
      if (!engine) return
      if (v) engine.stop()
      else engine.start()
      setAwake(!v)
    }
    // Окно без фокуса (человек смотрит, а курсор в другой программе) — персонаж
    // живёт дальше: стоп только когда окна не видно или поверх игра
    // (владелец 06.10.2026: «персонажи стоят как статуи»).
    const sync = () => setPaused(document.hidden || !on || !renderLive())
    document.addEventListener('visibilitychange', sync)
    const offGate = onRenderGate(sync)
    sync()
    return () => {
      document.removeEventListener('visibilitychange', sync)
      offGate()
    }
  }, [ready, on])

  // Нет контекста — снова через 1,5 / 3 / 4,5… с, не дольше 10 попыток.
  useEffect(() => {
    if (!glFail || glFail > 10 || lite) return
    const t = window.setTimeout(() => {
      setGlTry(true)
      setGlEpoch((n) => n + 1)
    }, 1500 * Math.min(glFail, 4))
    return () => window.clearTimeout(t)
  }, [glFail, lite])

  const drag = useRef<{ x: number; yaw: number } | null>(null)

  if (lite || (glFail > 0 && !glTry)) {
    if (shop) queueMicrotask(() => onDressedRef.current?.(0))
    return (
      <div className={'lobby-char lobby-char-flat' + (shop ? ' shop-stage' : '') + (flatShown ? ' shown' : '')} onClick={() => (shop ? undefined : setScreen('skins'))}>
        {shop ? null : (
          <span className="lobby-flat-tag">
            <Nametag nick={nick} at={{ x: 0, y: 0 }} />
          </span>
        )}
        {look ? <FlatFigure url={look.skin} slim={look.slim} onReady={() => setFlatShown(true)} /> : null}
      </div>
    )
  }

  return (
    <div
      ref={stageRef}
      className={'lobby-char' + (shop ? ' shop-stage' : '') + (shown ? ' shown' : '')}
      onPointerDown={(e) => {
        const engine = viewerRef.current
        if (!engine || e.button !== 0) return
        drag.current = { x: e.clientX, yaw: engine.playerYaw }
        pressAt.current = { x: e.clientX, y: e.clientY }
        e.currentTarget.style.cursor = 'grabbing'
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
      }}
      onPointerMove={(e) => {
        const engine = viewerRef.current
        const held = drag.current
        if (engine && held) {
          engine.setPlayerYaw(held.yaw + (e.clientX - held.x) * TURN_PER_PIXEL)
          return
        }
        // Указатель — только над самой фигурой (клик туда открывает гардероб);
        // на остальной сцене это перетаскивание, курсор обычный (владелец
        // 25.09.2026: «не указательный, там область перетаскивания»).
        const stage = stageRef.current
        const ndc = bodyNdc.current
        if (!stage || !ndc) return
        const rect = stage.getBoundingClientRect()
        const box = lobbyHitBox(ndc, rect.width, rect.height)
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const over = x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height
        stage.style.cursor = over ? 'pointer' : 'grab'
      }}
      onPointerUp={(e) => {
        drag.current = null
        e.currentTarget.style.cursor = 'grab'
        // Клик без перетаскивания и по самой фигуре — в «Мой скин» (правка
        // владельца 21:56; зона сужена до рамки тела 25.09.2026). Перетаскивание
        // по-прежнему крутит персонажа.
        const p = pressAt.current
        pressAt.current = null
        if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 6) return
        const stage = stageRef.current
        const ndc = bodyNdc.current
        if (!stage || !ndc) return
        const rect = stage.getBoundingClientRect()
        const box = lobbyHitBox(ndc, rect.width, rect.height)
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        if (!shop && x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) setScreen('skins')
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    >
      <canvas key={glEpoch} ref={canvasRef} aria-label={'Персонаж ' + nick} />
      <span ref={tagWrap} className="lobby-tag-follow">
        {shop ? null : <Nametag nick={nick} at={shown ? tag : null} />}
      </span>
    </div>
  )
}
