import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { hasTauri } from '../../ipc/tauri'
import { PARTY_SHOWCASE } from '../../lib/demo'
import { anarchyMode } from '../../lib/ownServer'
import { partyFull, sameIdentity, type Party, type PartyMember, type PartyProposal } from '../../lib/party'
import { targetForMode } from '../../lib/partyPlay'
import { joinPartyVoice, toggleDeafen, toggleMute, useCall } from '../../state/call'
import { uiConfirm } from '../../state/confirm'
import type { LobbyMode } from '../../state/lobbyMode'
import { useLobby } from '../../state/lobbyMode'
import { stopMateSearch, useMateSearch } from '../../state/mateSearch'
import {
  answerPartyProposal,
  isLeader,
  closeRoom,
  kickFromParty,
  openRoom,
  partyWithOthers,
  proposeToParty,
  sendPartyChat,
  usePartyStore,
} from '../../state/party'
import { cancelGo, usePartyFlow } from '../../state/partyFlow'
import { TIER_SERVER } from '../../state/tiers'
import { setScreen, showToast } from '../../state/ui'
import '../../styles/pixel/party-panel.css'
import { t, useMarketOffers, useT } from '../../i18n'
import { TIERS_SECTION_PUBLIC } from '../../lib/tiersSection'
import { liveInterval } from '../../lib/liveInterval'

const CHAT_MAX = 300
/** Быстрые фразы: договориться в один клик, без набора текста (как командный чат в Brawl Stars). */
const quickPhrases = () => [t('Го PvP'), t('Го выживание'), t('Я готов'), t('Минуту'), t('Не могу')]

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/** Тикает раз в секунду, пока панель видна: счётчик поиска и срок предложения. */
function useNow(live: boolean, fast = false) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!live) return
    return liveInterval(() => setNow(Date.now()), fast ? 250 : 1000)
  }, [live, fast])
  return now
}

export interface Where {
  key: string
  title: string
  mode: LobbyMode
  hot?: boolean
}

const PVP_MODE: LobbyMode = {
  kind: 'server',
  slug: 'millida-pvp',
  get name() {
    return t('PvP-дуэли')
  },
  ip: TIER_SERVER.ip,
  logo: null,
  banner: null,
  versions: TIER_SERVER.versions,
  licensed: false,
}

/**
 * «Куда идём»: то, что стоит у меня в «Сегодня играем», наши PvP и анархия, первые
 * серверы рейтинга. Остальное выбирается в каталоге и возвращается сюда первой плашкой.
 */
export function useWhere(mode: LobbyMode | null, modeTitle: string): Where[] {
  const t = useT()
  const partners = useMarketOffers('partners')
  const servers = useLobby((s) => s.servers)
  const list: Where[] = []
  const seen = new Set<string>()
  const add = (w: Where) => {
    const id = w.mode.kind === 'server' ? 'ip:' + w.mode.ip.toLowerCase() : w.key
    if (seen.has(id)) return
    seen.add(id)
    list.push(w)
  }
  if (mode) add({ key: 'mine', title: modeTitle, mode, hot: true })
  if (TIERS_SECTION_PUBLIC) add({ key: 'pvp', title: t('PvP-дуэли'), mode: PVP_MODE })
  if (partners) add({ key: 'anarchy', title: t('Анархия'), mode: anarchyMode() })
  for (const s of servers.filter((x) => x.isOnline).slice(0, 2)) {
    add({
      key: 'srv:' + s.slug,
      title: s.name,
      mode: { kind: 'server', slug: s.slug, name: s.name, ip: s.ip, logo: s.logo || null, banner: s.banner || null, versions: s.versions, licensed: s.lic === 'licensed' },
    })
  }
  return list
}

function Offer({ party, me, offer, now }: { party: Party; me: string; offer: PartyProposal; now: number }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const by = party.members.find((m) => m.userId === offer.byId)
  const mine = offer.byId === me
  const said = offer.answers[me] === true
  const left = Math.max(0, offer.expiresAt - now)
  const share = Math.max(0, Math.min(1, left / Math.max(1, offer.expiresAt - offer.at)))
  const answer = async (yes: boolean) => {
    if (busy) return
    setBusy(true)
    await answerPartyProposal(offer.id, yes)
    setBusy(false)
  }
  return (
    <div className={'pty-offer' + (said ? ' wait' : '')} role="group" aria-label={t('Предложение')}>
      <span className="pty-offer-who">{mine ? t('Ты зовёшь') : t('{nick} зовёт', { nick: by?.nickname || t('Игрок') })}</span>
      <b className="pty-offer-title">{offer.target.title}</b>
      <span className="pty-offer-votes">
        {party.members.map((m) => (
          <span key={m.userId} className={'pty-vote' + (offer.answers[m.userId] === true ? ' yes' : '')}>
            <Head nick={m.nickname || 'MHF_Steve'} src={m.avatarUrl} size={24} />
            {offer.answers[m.userId] === true ? <Icon id="i-check" /> : null}
          </span>
        ))}
      </span>
      {said ? (
        <button className="btn sm secondary pty-offer-no" disabled={busy} onClick={() => void answer(false)}>
          {mine ? t('Отменить') : t('Передумал')}
        </button>
      ) : (
        <span className="pty-offer-acts">
          <button className="btn sm primary" data-track="party_offer_yes" disabled={busy} onClick={() => void answer(true)}>
            {t('Идём')}
          </button>
          <button className="btn sm secondary" data-track="party_offer_no" disabled={busy} onClick={() => void answer(false)}>
            {t('Нет')}
          </button>
        </span>
      )}
      <span className="pty-offer-bar" aria-hidden="true">
        <span style={{ width: Math.round(share * 100) + '%' }} />
      </span>
    </div>
  )
}

function MemberRow({ party, m, me, leader }: { party: Party; m: PartyMember; me: string; leader: boolean }) {
  const t = useT()
  const parts = useCall((s) => s.parts)
  const callRoom = useCall((s) => s.roomId)
  const iSpeak = useCall((s) => s.speaking)
  const iMuted = useCall((s) => s.muted)
  const inVoice = callRoom === party.id
  const mine = m.userId === me
  const part = inVoice && !mine ? parts.find((p) => p.userId === m.userId) : undefined
  const heard = mine ? inVoice : !!part || party.voice.some((v) => v.userId === m.userId)
  const speaking = mine ? inVoice && iSpeak : !!part && part.speaking
  const muted = mine ? iMuted : part ? part.muted : !!party.voice.find((v) => v.userId === m.userId)?.muted
  const ready = m.role === 'leader' || (m.ready && !!party.target && sameIdentity(m.have, party.target))
  const nick = m.nickname || t('Игрок')
  return (
    <div className={'pty-mate' + (speaking ? ' speaking' : '')}>
      <Head nick={nick} src={m.avatarUrl} size={28} className="pty-mate-head" />
      <b>{nick}</b>
      {m.role === 'leader' ? <Icon id="i-crown" className="icon pty-crown" /> : null}
      {party.target && ready && m.role !== 'leader' ? <Icon id="i-check" className="icon pty-ready" /> : null}
      <span className="pty-mate-end">
        {heard && !mine ? <Icon id={muted ? 'i-mic-off' : 'i-mic'} className={'icon pty-mic' + (muted ? ' off' : '')} /> : null}
        {mine ? (
          <MyVoice party={party} />
        ) : (
          <>
            {leader ? (
              <button
                className="pty-ico"
                aria-label={t('Исключить {nick}', { nick })}
                data-track="party_kick"
                onClick={() =>
                  void uiConfirm(t('Исключить {nick} из пати?', { nick }), { confirmLabel: t('Исключить'), danger: true }).then((ok) => {
                    if (ok) void kickFromParty(m.userId)
                  })
                }
              >
                <Icon id="i-x" />
              </button>
            ) : null}
            <button
              className="pty-ico"
              aria-label={t('Пожаловаться на {nick}', { nick })}
              onClick={() => usePartyStore.getState().set({ reportAsk: { userId: m.userId, nick, context: 'party' } })}
            >
              <Icon id="i-flag" />
            </button>
          </>
        )}
      </span>
    </div>
  )
}

/** Свой голос — на своей строке: подключиться, открыть микрофон, заглушить всех. */
function MyVoice({ party }: { party: Party }) {
  const t = useT()
  const status = useCall((s) => s.status)
  const room = useCall((s) => s.roomId)
  const muted = useCall((s) => s.muted)
  const deafened = useCall((s) => s.deafened)
  const strangers = usePartyFlow((s) => s.strangers)
  const age = usePartyStore((s) => s.safety.ageBracket)
  if (strangers && age === 'u13') return null
  const inVoice = room === party.id && status !== 'idle'
  if (!inVoice) {
    return (
      <button
        className="pty-mini"
        data-track="party_voice_join"
        onClick={() => {
          if (PARTY_SHOWCASE) return showToast(t('В показе голоса нет'), 'error')
          if (!hasTauri()) return showToast(t('Голос работает в приложении'), 'error')
          void joinPartyVoice(party.id, true)
        }}
      >
        <Icon id="i-headset" />
        {t('Голос')}
      </button>
    )
  }
  return (
    <>
      <button
        className={'pty-mini' + (muted ? '' : ' on')}
        aria-pressed={!muted}
        aria-label={muted ? t('Включить микрофон') : t('Выключить микрофон')}
        data-track={muted ? 'party_mic_on' : 'party_mic_off'}
        disabled={status !== 'active' || deafened}
        onClick={toggleMute}
      >
        <Icon id={muted ? 'i-mic-off' : 'i-mic'} />
        {muted ? t('Микрофон') : t('Говорю')}
      </button>
      <button
        className={'pty-ico pty-deaf' + (deafened ? ' off' : '')}
        aria-pressed={deafened}
        aria-label={deafened ? t('Включить звук') : t('Выключить звук')}
        onClick={toggleDeafen}
      >
        <Icon id={deafened ? 'i-mute' : 'i-volume'} />
      </button>
    </>
  )
}

function Chat({ party, me }: { party: Party; me: string }) {
  const t = useT()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const strangers = usePartyFlow((s) => s.strangers)
  const age = usePartyStore((s) => s.safety.ageBracket)
  // До 13 лет со случайными напарниками — только готовые фразы.
  const phrasesOnly = strangers && age === 'u13'
  const box = useRef<HTMLDivElement>(null)
  const lines = party.chat || []
  const last = lines.length ? lines[lines.length - 1].id : ''

  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last])

  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    const ok = await sendPartyChat(t)
    setBusy(false)
    if (ok !== null) setText('')
  }
  const quick = async (phrase: string) => {
    if (busy) return
    setBusy(true)
    await sendPartyChat(phrase)
    // Сервер пускает одно сообщение в секунду.
    window.setTimeout(() => setBusy(false), 1000)
  }

  return (
    <>
      <div className="pty-chat" ref={box} role="log" aria-label={t('Чат пати')}>
        {lines.map((l) =>
          l.system ? (
            <span key={l.id} className="pty-line sys">
              {l.text}
            </span>
          ) : (
            <span key={l.id} className={'pty-line' + (l.userId === me ? ' mine' : '')}>
              <b>{l.nickname || t('Игрок')}</b>
              {l.text}
            </span>
          ),
        )}
      </div>
      <div className="pty-quick" role="group" aria-label={t('Быстрые фразы')}>
        {quickPhrases().map((q) => (
          <button key={q} className="pty-q" data-track="party_quick" disabled={busy} onClick={() => void quick(q)}>
            {q}
          </button>
        ))}
      </div>
      {phrasesOnly ? null : (
      <form
        className="pty-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          className="pty-input"
          value={text}
          maxLength={CHAT_MAX}
          placeholder={t('Сообщение')}
          aria-label={t('Сообщение в чат пати')}
          data-private
          onChange={(e) => setText(e.target.value)}
        />
        <button className="pty-send" type="submit" aria-label={t('Отправить')} disabled={busy || !text.trim()}>
          <Icon id="i-send" />
        </button>
      </form>
      )}
    </>
  )
}

/**
 * Лобби в режиме пати (владелец 12.10.2026: «нажимаешь поиск пати — убирается
 * баннер, появляется кнопка отмены и чат; обсуждаете, куда пойти, и идёте
 * вместе»). Стоит на месте рекламного баннера: поиск → состав и голос →
 * предложение «куда идём» → чат.
 */
export function PartyPanel({ on, mode, modeTitle }: { on: boolean; mode: LobbyMode | null; modeTitle: string }) {
  const t = useT()
  const party = usePartyStore((s) => s.party)
  const me = usePartyStore((s) => s.me)
  const searching = useMateSearch((s) => s.searching)
  const since = useMateSearch((s) => s.since)
  const together = partyWithOthers(party)
  const offer = party?.proposal || null
  const launchAt = usePartyFlow((s) => s.launchAt)
  // Своя открытая комната, в которую ещё никто не зашёл: ждём игроков.
  const waiting = !!party?.room?.open && !together
  const now = useNow(on && (searching || waiting || !!offer || !!launchAt), !!launchAt)
  const where = useWhere(mode, modeTitle)
  const [asking, setAsking] = useState('')

  if (!on || (!together && !searching && !waiting)) return null

  if (party && waiting) {
    return (
      <aside className="pty pty-search" aria-label={t('Комната')}>
        <span className="party-dots pty-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <b className="pty-search-title">{party.target?.title || t('Комната')}</b>
        <span className="pty-search-time">{t('Ждём игроков · {time}', { time: clock(now - (party.room?.since || now)) })}</span>
        <button className="btn sm secondary pty-cancel" data-sound="close" data-track="party_room_close" onClick={() => void closeRoom()}>
          <Icon id="i-x" />
          {t('Закрыть комнату')}
        </button>
      </aside>
    )
  }

  if (!party || !together) {
    return (
      <aside className="pty pty-search" aria-label={t('Поиск пати')}>
        <span className="party-dots pty-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <b className="pty-search-title">{t('Ищем пати')}</b>
        <span className="pty-search-time">{clock(now - since)}</span>
        <button className="btn sm secondary pty-cancel" data-sound="close" data-track="party_search_cancel" onClick={() => void stopMateSearch()}>
          <Icon id="i-x" />
          {t('Отмена')}
        </button>
      </aside>
    )
  }

  const leader = isLeader(party, me)
  const chatOn = Array.isArray(party.chat)
  const others = party.members.filter((m) => m.role !== 'leader')
  const stepReady = leader ? !!party.target && others.every((m) => m.ready) : !!party.members.find((m) => m.userId === me)?.ready
  const full = partyFull(party)

  const propose = async (w: Where) => {
    if (asking) return
    setAsking(w.key)
    try {
      const target = await targetForMode(w.mode)
      if (target) await proposeToParty(target)
    } catch (e) {
      console.error('[party] propose', e)
      showToast(t('Не удалось предложить'), 'error')
    } finally {
      setAsking('')
    }
  }

  return (
    <aside className="pty" aria-label={t('Пати')}>
      <div className="pty-head">
        <b>{t('Пати')}</b>
        <span className="pty-count">
          {party.members.length}/{party.capacity}
        </span>
        {leader && party.room && party.target && !full ? (
          <button
            className={'pty-door' + (party.room.open ? ' on' : '')}
            aria-pressed={party.room.open}
            data-track={party.room.open ? 'party_room_lock' : 'party_room_unlock'}
            onClick={() => void (party.room!.open ? closeRoom() : openRoom(party.target!, true))}
          >
            <Icon id={party.room.open ? 'i-users' : 'i-lock'} />
            {party.room.open ? t('Открытая') : t('Закрытая')}
          </button>
        ) : null}
        {searching && !full ? (
          <span className="pty-seeking">
            <span className="party-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {t('ищем ещё')}
          </span>
        ) : null}
      </div>

      {/* Что будет дальше — тремя шагами: зашёл, отметился, общий старт. */}
      <ol className="pty-steps" aria-label={t('Что дальше')}>
        <li className="done">{t('Зашёл')}</li>
        <li className={stepReady ? 'done' : 'now'}>{leader ? t('Все готовы') : t('Жми «Готов»')}</li>
        <li className={launchAt ? 'now' : ''}>{t('Старт')}</li>
      </ol>

      <div className="pty-mates">
        {party.members.map((m) => (
          <MemberRow key={m.userId} party={party} m={m} me={me} leader={leader} />
        ))}
      </div>

      {offer ? (
        <Offer party={party} me={me} offer={offer} now={now} />
      ) : party.target ? (
        <div className={'pty-going' + (launchAt ? ' count' : '')}>
          <span>{launchAt ? (launchAt > now ? t('Старт через {n}', { n: Math.max(1, Math.ceil((launchAt - now) / 1000)) }) : leader ? t('Запускаем') : t('Ждём лидера')) : t('Идём')}</span>
          <b>{party.target.title}</b>
          {launchAt ? (
            <button className="pty-mini" data-sound="close" data-track="party_launch_cancel" onClick={cancelGo}>
              {t('Отмена')}
            </button>
          ) : null}
        </div>
      ) : null}

      {chatOn ? <Chat party={party} me={me} /> : null}

      {chatOn && !offer && (leader || !party.room?.open) ? (
        <div className="pty-where" role="group" aria-label={t('Куда идём')}>
          <span className="pty-where-cap">
            {t('Куда идём?')}
            <button className="pty-other" data-sound="open" data-track="party_propose_other" onClick={() => setScreen('playhub')}>
              {t('Другое')}
              <Icon id="i-chev-r" />
            </button>
          </span>
          <div className="pty-where-list">
            {where.map((w) => (
              <button
                key={w.key}
                className={'pty-chip' + (w.hot ? ' hot' : '')}
                data-track="party_propose"
                data-kind={w.key.split(':')[0]}
                disabled={!!asking}
                onClick={() => void propose(w)}
              >
                {w.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  )
}
