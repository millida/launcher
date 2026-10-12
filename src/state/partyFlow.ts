import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { PARTY_SHOWCASE } from '../lib/demo'
import { identityOf, launchBlock, sameIdentity, type Party } from '../lib/party'
import { launchPartyTarget, prepareTarget, toggleReady } from '../lib/partyPlay'
import { playSound } from '../lib/sound'
import { joinPartyVoice, useCall } from './call'
import { useGame } from './game'
import { useMateSearch } from './mateSearch'
import { isLeader, partyWithOthers, usePartyStore } from './party'

/**
 * Что пати делает сама, без кнопок (владелец 12.10.2026: «нажал найти — сразу
 * подключают, у вас есть voice-чат… согласились — пошли играть»):
 *  - собралась — голос подключается сам, микрофон закрыт, пока человек его не откроет;
 *  - реплика в чате — облачком над фигуркой сказавшего;
 *  - все ответили «Идём» — каждый сам ставит сборку и отмечается готовым, лидер запускает.
 */
interface Say {
  text: string
  until: number
}

interface PartyFlow {
  say: Record<string, Say>
  /** Пати собрана поиском, а не приглашением друга. */
  strangers: boolean
  /** targetRev цели, принятой общим «Идём»; 0 — цель выбирал лидер по-старому. */
  going: number
  /** Все готовы — когда стартуем (наши часы); 0 — отсчёта нет. Запускает лидер, у остальных это подсказка. */
  launchAt: number
}

export const usePartyFlow = create<PartyFlow>(() => ({ say: {}, strangers: false, going: 0, launchAt: 0 }))

/** Отсчёт перед общим стартом: успеть передумать (как ready-check в шутерах). */
export const LAUNCH_COUNTDOWN_MS = 5000

const SAY_MS = 6000
const flow = () => usePartyFlow.getState()

function say(userId: string, text: string) {
  const until = Date.now() + SAY_MS
  usePartyFlow.setState({ say: { ...flow().say, [userId]: { text, until } } })
  window.setTimeout(() => {
    const cur = flow().say[userId]
    if (!cur || cur.until > Date.now()) return
    const next = { ...flow().say }
    delete next[userId]
    usePartyFlow.setState({ say: next })
  }, SAY_MS + 50)
}

function autoVoice(party: Party, strangers: boolean) {
  // В витрине (dev) пати ненастоящая: голосу подключаться некуда.
  if (PARTY_SHOWCASE) return
  if (!hasTauri() || useCall.getState().status !== 'idle' || useGame.getState().list.length) return
  // До 13 с незнакомцами голоса нет: остаются чат и готовые ответы.
  if (strangers && usePartyStore.getState().safety.ageBracket === 'u13') return
  void joinPartyVoice(party.id, true)
}

let launchedRev = 0
let launchTimer = 0
/** Лидер придержал старт этой цели кнопкой «Отмена»: сам отсчёт больше не начинается. */
let held = 0

function disarm() {
  window.clearTimeout(launchTimer)
  launchTimer = 0
  if (flow().launchAt) usePartyFlow.setState({ launchAt: 0 })
}

/** Все готовы: пять секунд отсчёта, потом лидер запускает всех. */
function arm(rev: number) {
  window.clearTimeout(launchTimer)
  usePartyFlow.setState({ launchAt: Date.now() + LAUNCH_COUNTDOWN_MS })
  launchTimer = window.setTimeout(() => {
    launchTimer = 0
    const { party, me } = usePartyStore.getState()
    if (!party || !flow().launchAt || party.targetRev !== rev || launchBlock(party)) return disarm()
    if (!isLeader(party, me)) return
    launchedRev = rev
    void launchPartyTarget().then((ok) => {
      if (!ok) launchedRev = 0
      disarm()
    })
  }, LAUNCH_COUNTDOWN_MS)
}

/**
 * «Отмена» во время отсчёта. Участник снимает готовность — лидер видит это и его отсчёт
 * гаснет сам; лидер просто придерживает старт (цель остаётся, «Играть» запустит вручную).
 */
export function cancelGo() {
  const { party, me } = usePartyStore.getState()
  disarm()
  if (!party) return
  if (isLeader(party, me)) {
    held = party.targetRev
    usePartyFlow.setState({ going: 0 })
    return
  }
  if (party.members.find((m) => m.userId === me)?.ready) void toggleReady()
}

async function goTogether(party: Party, me: string) {
  if (!hasTauri() || !party.target) return
  if (isLeader(party, me)) {
    await prepareTarget(party.target).catch(() => false)
    return
  }
  const mine = party.members.find((m) => m.userId === me)
  if (mine && !mine.ready) await toggleReady()
}

let started = false

export function initPartyFlow(): () => void {
  if (started) return () => {}
  started = true
  let prev: Party | null = usePartyStore.getState().party
  const seen = new Set<string>((prev?.chat || []).map((l) => l.id))
  const off = usePartyStore.subscribe((s) => {
    const party = s.party
    if (party === prev) return
    const was = prev && party && prev.id === party.id ? prev : null
    prev = party
    if (!party) {
      seen.clear()
      launchedRev = 0
      disarm()
      usePartyFlow.setState({ say: {}, strangers: false, going: 0 })
      return
    }

    if (partyWithOthers(party) && !partyWithOthers(was)) {
      const strangers = useMateSearch.getState().searching
      usePartyFlow.setState({ strangers })
      playSound('success')
      autoVoice(party, strangers)
    }

    const fresh = (party.chat || []).filter((l) => !seen.has(l.id))
    for (const l of fresh) seen.add(l.id)
    // Первая загрузка пати — это история, а не новые реплики.
    if (was) {
      for (const l of fresh) {
        if (l.system || l.userId === s.me) continue
        say(l.userId, l.text)
        playSound('notify')
      }
    }

    const offer = was?.proposal
    if (
      offer &&
      !party.proposal &&
      party.target &&
      party.targetRev !== was?.targetRev &&
      sameIdentity(identityOf(offer.target), identityOf(party.target))
    ) {
      usePartyFlow.setState({ going: party.targetRev })
      launchedRev = 0
      void goTogether(party, s.me)
    }

    // Все отметились готовыми — отсчёт; кто-то снял готовность или цель сменилась — отсчёт гаснет.
    const justLaunched = !!party.launch && Date.now() - party.launch.at < 15_000
    // Цель объявлена общим «Идём» или самой комнатой — в обоих случаях ждём только готовности.
    const agreed = flow().going === party.targetRev || (!!party.room && !!party.target && held !== party.targetRev)
    const allReady = agreed && partyWithOthers(party) && !launchBlock(party) && !justLaunched
    if (allReady && launchedRev !== party.targetRev && !flow().launchAt) arm(party.targetRev)
    else if (!allReady && flow().launchAt) disarm()
  })
  return () => {
    started = false
    off()
  }
}
