import { hasTauri } from '../ipc/tauri'
import {
  PACK_ACCESS_PREFIX,
  installCatalogPack,
  installSharedPack,
  loadProfileSettings,
  packPreview,
  shareProfile,
} from '../ipc/commands'
import type { Profile } from '../ipc/commands'
import { identityOf, launchBlock, launchToRun, sameIdentity, type PartyHave, type PartyLaunch, type PartyTarget } from './party'
import type { LobbyMode } from '../state/lobbyMode'
import { useLobby } from '../state/lobbyMode'
import { installedPack, openPremiumPack } from './lobbyPlay'
import { ensureVersionBuild, versionFps } from './versionBuild'
import { joinWithAuth, realLaunch } from './launch'
import { quickJoin } from './joinServer'
import { inviteServer, loadMyServers } from '../state/playInvite'
import { runInstall } from '../state/installs'
import { keyCatalogPack } from './installKeys'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import {
  isLeader,
  partyWithOthers,
  setPartyReady,
  setPartyTarget,
  startPartyLaunch,
  usePartyStore,
} from '../state/party'

const PACKS_KEY = 'm-party-packs'

type SharedPacks = Record<string, { profile: string; version: string }>

function readPacks(): SharedPacks {
  try {
    const raw = localStorage.getItem(PACKS_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' ? (v as SharedPacks) : {}
  } catch {
    return {}
  }
}

function rememberPack(code: string, profile: string, version: string) {
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify({ ...readPacks(), [code]: { profile, version } }))
  } catch (e) {
    console.error('[party] remember pack', e)
  }
}

const profilesNow = (): Profile[] => useProfiles.getState().profiles

const clip = (s: string, n: number) => s.replace(/\p{C}/gu, '').slice(0, n)

/**
 * What the leader's lobby choice means for everybody. A custom build travels as a
 * share code, so friends install it through the same verified path as any shared pack.
 */
export async function targetForMode(mode: LobbyMode): Promise<PartyTarget | null> {
  if (mode.kind === 'version') {
    return { kind: 'version', ref: mode.version, version: mode.version, title: 'Minecraft ' + mode.version, game: mode.version }
  }
  if (mode.kind === 'server') {
    return { kind: 'server', ref: mode.ip, version: '', title: clip(mode.name, 64), game: mode.versions[mode.versions.length - 1] || '' }
  }
  if (mode.kind === 'premium') {
    const slug = mode.slug || mode.id
    const have = await installedPack(slug, profilesNow())
    const settings = have ? await loadProfileSettings(have).catch(() => null) : null
    return { kind: 'premium', ref: slug, version: settings?.catalogPackVersion || '', title: clip(mode.title, 64), game: '' }
  }
  if (!hasTauri()) return null
  const prof = profilesNow().find((p) => p.name === mode.name)
  if (!prof) return null
  const ok = await uiConfirm('Друзья получат список модов этой сборки и поставят её у себя.', {
    title: 'Поделиться сборкой с пати?',
    confirmLabel: 'Поделиться',
  })
  if (!ok) return null
  const shared = await shareProfile(prof.name)
  const preview = await packPreview(shared.code)
  rememberPack(shared.code, prof.name, preview.updatedAt)
  return { kind: 'build', ref: shared.code, version: preview.updatedAt, title: clip(prof.name, 64), game: prof.version }
}

/** The build on this machine that matches the target, if there is one. */
async function localBuild(target: PartyTarget): Promise<string | null> {
  if (target.kind === 'build') {
    const hit = readPacks()[target.ref]
    return hit && hit.version === target.version && profilesNow().some((p) => p.name === hit.profile) ? hit.profile : null
  }
  if (target.kind === 'premium') {
    const name = await installedPack(target.ref, profilesNow())
    if (!name) return null
    if (!target.version) return name
    const settings = await loadProfileSettings(name).catch(() => null)
    return settings?.catalogPackVersion === target.version ? name : null
  }
  return null
}

export async function localHave(target: PartyTarget): Promise<PartyHave | null> {
  if (target.kind === 'version' || target.kind === 'server') return identityOf(target)
  return (await localBuild(target)) ? identityOf(target) : null
}

function askPackConfirm(code: string, title: string): Promise<boolean> {
  return new Promise((resolve) => usePartyStore.getState().set({ packAsk: { code, title, resolve } }))
}

function installCatalog(slug: string, title: string): Promise<boolean> {
  return new Promise((resolve) => {
    const started = runInstall({
      key: keyCatalogPack(slug),
      title,
      running: 'Скачивание…',
      run: () => installCatalogPack(slug),
      onError: (e) => {
        if (String(e).startsWith(PACK_ACCESS_PREFIX)) {
          const hit = useLobby.getState().premium.find((p) => p.slug === slug || p.id === slug)
          openPremiumPack(hit ? hit.id : slug)
        } else showToast('Сборка не установилась: ' + String(e), 'error')
        resolve(false)
      },
      onCancel: () => resolve(false),
      onDone: () => {
        void useProfiles.getState().refresh()
        resolve(true)
      },
    })
    if (!started) resolve(false)
  })
}

/**
 * Brings this machine to the leader's choice. Nothing is downloaded before the
 * player agrees: a custom build first shows its full mod list.
 */
export async function prepareTarget(target: PartyTarget): Promise<boolean> {
  if (target.kind === 'version' || target.kind === 'server') return true
  if (await localBuild(target)) return true
  if (!hasTauri()) {
    showToast('Установка сборок — в приложении', 'error')
    return false
  }
  if (target.kind === 'premium') {
    const ok = await uiConfirm('У тебя нет сборки «' + target.title + '» этой версии. Поставить?', {
      title: 'Нужна сборка лидера',
      confirmLabel: 'Поставить',
    })
    return ok ? installCatalog(target.ref, target.title) : false
  }
  if (!(await askPackConfirm(target.ref, target.title))) return false
  try {
    const prof = await installSharedPack(target.ref)
    const preview = await packPreview(target.ref)
    if (preview.updatedAt !== target.version) {
      showToast('Лидер успел поменять сборку — дождись новой версии', 'error')
      return false
    }
    rememberPack(target.ref, prof.name, preview.updatedAt)
    await useProfiles.getState().refresh()
    return true
  } catch (e) {
    showToast('Сборка не установилась: ' + String(e), 'error')
    return false
  }
}

async function buildFor(target: PartyTarget): Promise<string | null> {
  if (target.kind === 'version') return ensureVersionBuild(target.ref, { fps: versionFps(target.ref) })
  return localBuild(target)
}

/** Everybody starts the same build and lands on the same server when there is one. */
export async function runLaunch(launch: PartyLaunch): Promise<void> {
  const { target, addr } = launch
  if (target.kind === 'server') {
    await quickJoin(target.ref, target.title).catch((e) => console.error('[party] join', e))
    return
  }
  const name = await buildFor(target)
  if (!name) {
    showToast('Сборки пати нет на компьютере — поставь её и нажми «Готов»', 'error')
    return
  }
  if (addr) {
    await joinWithAuth(name, null, addr, target.title).catch((e) => console.error('[party] join', e))
    return
  }
  realLaunch(name)
}

function readLastSeq(): number {
  try {
    return Number(sessionStorage.getItem('m-party-launch') || 0) || 0
  } catch {
    return 0
  }
}

let lastSeq = readLastSeq()

export function maybeRunLaunch() {
  const party = usePartyStore.getState().party
  const launch = party ? launchToRun(party.launch, lastSeq, Date.now()) : null
  if (!launch) {
    if (party?.launch) lastSeq = Math.max(lastSeq, party.launch.seq)
    return
  }
  lastSeq = launch.seq
  try {
    sessionStorage.setItem('m-party-launch', String(lastSeq))
  } catch (e) {
    console.error('[party] launch seq', e)
  }
  void runLaunch(launch)
}

/** The leader's own server, if hosting has one with an address: the party plays there. */
async function leaderAddr(target: PartyTarget): Promise<string | null> {
  if (target.kind === 'server') return target.ref
  const s = inviteServer(await loadMyServers(15_000))
  return s && s.address ? s.address : null
}

let readyBusy = false

/** Ready-up for a member: install what the leader picked, then report what is on disk. */
export async function toggleReady(): Promise<void> {
  const { party, me } = usePartyStore.getState()
  if (!party || readyBusy) return
  const mine = party.members.find((m) => m.userId === me)
  if (mine?.ready) {
    await setPartyReady(false, null)
    return
  }
  if (!party.target) {
    showToast('Лидер ещё не выбрал, во что играем', 'error')
    return
  }
  readyBusy = true
  try {
    const target = party.target
    if (!(await prepareTarget(target))) return
    const have = await localHave(target)
    if (!sameIdentity(have, target)) {
      showToast('Сборка не совпала с выбором лидера — попробуй ещё раз', 'error')
      return
    }
    await setPartyReady(true, have)
  } finally {
    readyBusy = false
  }
}

/** Play in a party: the leader starts everybody, a member marks ready. */
export async function partyPlayPressed(mode: LobbyMode | null): Promise<void> {
  const { party, me } = usePartyStore.getState()
  if (!party) return
  if (!isLeader(party, me)) {
    await toggleReady()
    return
  }
  if (!mode) {
    showToast('Сначала выбери, во что играем', 'error')
    return
  }
  let current = party
  if (!current.target || !(await targetMatchesMode(current.target, mode))) {
    const target = await targetForMode(mode).catch((e) => {
      showToast('Не удалось подготовить выбор для пати: ' + String(e), 'error')
      return null
    })
    if (!target) return
    const next = await setPartyTarget(target)
    if (!next) return
    current = next
  }
  if (!partyWithOthers(current)) return
  const block = launchBlock(current)
  if (block) {
    showToast(block.kind === 'no_target' ? 'Выбери, во что играем' : 'Ждём: ' + block.nicks.join(', '), 'error')
    return
  }
  if (!current.target) return
  if (!(await prepareTarget(current.target))) return
  if (await startPartyLaunch(await leaderAddr(current.target))) maybeRunLaunch()
}

/** The server stores the address as host:port, the lobby keeps it as typed. */
const serverKey = (addr: string) =>
  addr
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/:25565$/, '')

async function targetMatchesMode(t: PartyTarget, mode: LobbyMode): Promise<boolean> {
  if (mode.kind === 'version') return t.kind === 'version' && t.ref === mode.version
  if (mode.kind === 'server') return t.kind === 'server' && serverKey(t.ref) === serverKey(mode.ip)
  if (mode.kind === 'premium') return t.kind === 'premium' && t.ref === (mode.slug || mode.id)
  if (t.kind !== 'build') return false
  const hit = readPacks()[t.ref]
  return !!hit && hit.profile === mode.name && hit.version === t.version
}

export const partyBlocksSolo = (): boolean => {
  const { party } = usePartyStore.getState()
  return partyWithOthers(party)
}
