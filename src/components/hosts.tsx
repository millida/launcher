import { useUi } from '../state/ui'
import { useConfirm } from '../state/confirm'
import { useBuildPicker } from '../state/buildPicker'
import { usePackKey } from '../state/packKey'
import { usePackCode } from '../state/packCode'
import { useDepPlan } from '../state/depPlan'
import { useCrash } from '../state/crash'
import { useServerDetail } from '../state/serverDetail'
import { useCall } from '../state/call'
import { useLiveLog } from './liveLogStore'
import { useRooms } from '../state/rooms'
import { usePaid } from './catalog/paidStore'
import { useReward } from './reward/rewardBus'
import { lateMount, lazyHost, lazyHostWith } from '../lib/lateMount'

/*
 * Окна и подвалы, которые открываются не в каждом сеансе. Их код — отдельные
 * чанки: грузится, когда окно впервые понадобилось (флаг в хранилище стал true),
 * а не в стартовом бандле (26.10.2026: стартовый JS был 764 КБ при бюджете 300).
 */

const modalOpen = (id: 'impModal' | 'mvModal' | 'accModal' | 'shotOverlay' | 'mpOverlay' | 'mgModal') => () =>
  useUi((s) => s.modals[id].open || s.modals[id].vis)

export const ImportModal = lazyHost(() => import('../modals/Import').then((m) => ({ default: m.ImportModal })), modalOpen('impModal'))
export const MoveBuildsModal = lazyHost(() => import('../modals/MoveBuilds').then((m) => ({ default: m.MoveBuildsModal })), modalOpen('mvModal'))
export const AccountAddModal = lazyHost(() => import('../modals/AccountAdd').then((m) => ({ default: m.AccountAddModal })), modalOpen('accModal'))
export const ScreenshotsOverlay = lazyHost(() => import('../modals/Overlays').then((m) => ({ default: m.ScreenshotsOverlay })), modalOpen('shotOverlay'))
export const ModpackVersionsOverlay = lazyHost(() => import('../modals/Overlays').then((m) => ({ default: m.ModpackVersionsOverlay })), modalOpen('mpOverlay'))
export const MigrateBuildModal = lazyHost(() => import('../modals/MigrateBuild').then((m) => ({ default: m.MigrateBuildModal })), modalOpen('mgModal'))

export const BuyModal = lazyHost(() => import('./catalog/PaidActs').then((m) => ({ default: m.BuyModal })), () => usePaid((s) => !!s.dialog))
export const ConfirmModal = lazyHost(() => import('./ConfirmModal').then((m) => ({ default: m.ConfirmModal })), () => useConfirm((s) => s.open))
export const BuildPicker = lazyHost(() => import('./BuildPicker').then((m) => ({ default: m.BuildPicker })), () => useBuildPicker((s) => s.open))
export const PackKeyHost = lazyHost(() => import('./PackKeyHost').then((m) => ({ default: m.PackKeyHost })), () => usePackKey((s) => !!s.slug))
export const PackCodeHost = lazyHost(() => import('./PackCodeHost').then((m) => ({ default: m.PackCodeHost })), () => usePackCode((s) => s.open))
export const DepPlanModal = lazyHost(() => import('./DepPlanModal').then((m) => ({ default: m.DepPlanModal })), () => useDepPlan((s) => s.open))
export const CrashModal = lazyHost(() => import('./CrashModal').then((m) => ({ default: m.CrashModal })), () => useCrash((s) => !!s.info))
export const ServerDetail = lazyHost(() => import('./ServerDetail').then((m) => ({ default: m.ServerDetail })), () => useServerDetail((s) => !!s.sv))
export const LiveLog = lazyHost(() => import('./LiveLog').then((m) => ({ default: m.LiveLog })), () => useLiveLog((s) => s.open))
export const CallPanel = lazyHost(() => import('./CallPanel').then((m) => ({ default: m.CallPanel })), () => useCall((s) => s.status !== 'idle'))
export const RoomModals = lazyHost(() => import('./RoomManage').then((m) => ({ default: m.RoomModals })), () => useRooms((s) => !!s.manageId || s.createOpen))

/** Помощник Милли / кнопка поддержки: появляется после простоя, не с первым кадром. */
export const MilliDock = lateMount(() => import('./milli/MilliDock').then((m) => ({ default: m.MilliDock })), 700)

/** Награды: рисуются, только когда есть что показать. В DEV грузится всегда — там ставится демо-кнопка. */
export const RewardHost = lazyHost(
  () => import('./reward/RewardReveal').then((m) => ({ default: m.RewardHost })),
  () => useReward((s) => !!(s.big[0] || s.mid || s.small)) || import.meta.env.DEV,
)

/** Вход: нужен только тому, кто не вошёл (первый запуск, выход из аккаунта). */
export const Login = lazyHostWith<{ on: boolean }>(
  () => import('../screens/Login').then((m) => ({ default: m.Login })),
  (p) => p.on,
)

/** Панель «Мои сборки» над экраном: только на вкладке библиотеки. */
export const PlayhubBar = lazyHost(
  () => import('./playhub/MyBuilds').then((m) => ({ default: m.PlayhubBar })),
  () => useUi((s) => s.screen === 'playhub'),
)

/** Подсказки поверх интерфейса: нужны не с первым кадром, а когда человек начал водить мышью. */
export const PixelTip = lateMount(() => import('./PixelTip').then((m) => ({ default: m.PixelTip })), 800)
export const Tour = lateMount(() => import('./Tour').then((m) => ({ default: m.Tour })), 1200)
export const CommandPalette = lateMount(() => import('./CommandPalette').then((m) => ({ default: m.CommandPalette })), 1200)
