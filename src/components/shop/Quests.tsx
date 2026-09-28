import { Icon } from '../Icon'
import type { PackQuest } from '../../lib/rubies'
import { Head, ItemArt, toneStyle } from './parts'
import { RarityPlate } from './rarityUi'
import { minuteWord, questPct, questState } from './packQuests'

export function QuestsBlock({ quests, busy, onClaim }: { quests: PackQuest[]; busy: string; onClaim: (quest: PackQuest) => void }) {
  if (!quests.length) return null
  return (
    <div className="card sh-block" id="shop-quests" data-section="pack_quests">
      <Head title="Задания сборок">
        <span className="sh-tag">
          <Icon id="i-clock" />
          Половина фрагментов — за игру
        </span>
      </Head>
      <div className="sh-ach-prizes">
        {quests.map((quest) => (
          <QuestRow key={quest.code} quest={quest} busy={busy === 'quest:' + quest.code} onClaim={onClaim} />
        ))}
      </div>
    </div>
  )
}

function QuestRow({ quest, busy, onClaim }: { quest: PackQuest; busy: boolean; onClaim: (quest: PackQuest) => void }) {
  const state = questState(quest)
  const tip = quest.fragments ? quest.item.name + ' · ' + quest.fragments.have + '/' + quest.fragments.need : quest.item.name
  return (
    <div className={'sh-prize sh-quest' + (state.kind === 'claimed' || state.kind === 'owned' ? ' got' : '')} style={toneStyle(quest.item)} data-tip={tip}>
      <ItemArt item={quest.item} size="md" fit />
      <span className="sh-prize-body">
        <b>{quest.title}</b>
        <span className="sh-meter-bar">
          <i style={{ width: questPct(quest) + '%' }} />
        </span>
        <span className="sh-meter-cap">
          {quest.item.name} <RarityPlate rarity={quest.item.rarity} small />
        </span>
      </span>
      <span className="sh-prize-n">
        {Math.min(quest.minutes, quest.needMinutes)}/{quest.needMinutes} мин
      </span>
      {state.kind === 'claim' ? (
        <button
          className="btn sm primary"
          disabled={busy}
          data-track="pack_quest_claim"
          data-kind="item"
          data-id={quest.item.code}
          onClick={() => onClaim(quest)}
        >
          Забрать фрагменты
        </button>
      ) : state.kind === 'play' ? (
        <span className="sh-meter-cap">
          Ещё {state.left} {minuteWord(state.left)} в {quest.packName}
        </span>
      ) : (
        <span className="sh-owned sm">
          <Icon id="i-check" />
          {state.kind === 'owned' ? 'Есть' : 'Забрано'}
        </span>
      )}
    </div>
  )
}
