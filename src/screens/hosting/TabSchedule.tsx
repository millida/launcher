import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { showToast } from '../../state/ui'
import { Empty, Loading, Toggle } from './kit'
import { host, errText } from './api'
import type { HostingSchedule, ScheduleKind } from './api'

// Times are Moscow time, same as on the backend.

const KINDS: [ScheduleKind, string][] = [
  ['restart', 'Перезапуск'],
  ['backup', 'Резервная копия'],
  ['stop', 'Остановка'],
  ['command', 'Команда'],
]

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const ALL_DAYS = 127

const hhmm = (minute: number) =>
  String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')

const parseTime = (v: string, fallback: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return fallback
  const h = Math.min(23, parseInt(m[1], 10))
  const min = Math.min(59, parseInt(m[2], 10))
  return h * 60 + min
}

export function TabSchedule({ serverId }: { serverId: string }) {
  const [list, setList] = useState<HostingSchedule[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDirty(false)
    void host
      .schedules(serverId)
      .then((r) => setList(Array.isArray(r) ? r : []))
      .catch(() => setList([]))
  }, [serverId])

  const patch = (id: string, next: Partial<HostingSchedule>) => {
    setList((l) => (l || []).map((s) => (s.id === id ? { ...s, ...next } : s)))
    setDirty(true)
  }

  const add = () => {
    const id = 'new-' + Date.now().toString(36)
    setList((l) => [...(l || []), { id, kind: 'restart', enabled: true, minute: 5 * 60, days: ALL_DAYS }])
    setDirty(true)
  }

  const remove = (id: string) => {
    setList((l) => (l || []).filter((s) => s.id !== id))
    setDirty(true)
  }

  const save = async () => {
    if (!list) return
    setSaving(true)
    try {
      const saved = await host.saveSchedules(serverId, list)
      setList(Array.isArray(saved) ? saved : list)
      setDirty(false)
      showToast('Расписание сохранено')
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
        <div className="side-cap" style={{ padding: 0, flex: 1 }}>
          Задачи по времени (Москва)
        </div>
        <button className="btn sm secondary" onClick={add} disabled={(list || []).length >= 10}>
          <Icon id="i-plus" /> Добавить
        </button>
        <button className="btn sm primary" style={{ marginLeft: '8px' }} disabled={!dirty || saving} onClick={() => void save()}>
          Сохранить
        </button>
      </div>

      {list === null ? (
        <Loading />
      ) : list.length ? (
        <div className="stack">
          {list.map((s) => (
            <div className="host-sched" key={s.id}>
              <div className="host-sched-top">
                <Toggle on={s.enabled} onChange={(v) => patch(s.id, { enabled: v })} />
                <Select
                  value={s.kind}
                  options={KINDS.map(([v, l]) => ({ value: v, label: l }))}
                  width={180}
                  onChange={(v) => patch(s.id, { kind: v as ScheduleKind })}
                />
                <div className="input sm" style={{ width: '92px' }}>
                  <input
                    defaultValue={hhmm(s.minute)}
                    placeholder="05:00"
                    onBlur={(e) => {
                      const minute = parseTime(e.target.value, s.minute)
                      e.target.value = hhmm(minute)
                      if (minute !== s.minute) patch(s.id, { minute })
                    }}
                  />
                </div>
                <span style={{ flex: 1 }}></span>
                <button className="btn sm ghost" title="Удалить" onClick={() => remove(s.id)}>
                  <Icon id="i-trash" />
                </button>
              </div>
              <div className="host-sched-days">
                {DAYS.map((d, i) => {
                  const on = (s.days & (1 << i)) !== 0
                  return (
                    <button
                      key={d}
                      className={'host-day' + (on ? ' on' : '')}
                      onClick={() => patch(s.id, { days: on ? s.days & ~(1 << i) : s.days | (1 << i) })}
                    >
                      {d}
                    </button>
                  )
                })}
                <button className="host-day wide" onClick={() => patch(s.id, { days: ALL_DAYS })}>
                  Каждый день
                </button>
              </div>
              {s.kind === 'command' ? (
                <div className="input sm" style={{ marginTop: '8px' }}>
                  <span style={{ color: 'var(--m-fg-faint)', fontWeight: 700 }}>/</span>
                  <input
                    placeholder="say сервер перезагрузится через 5 минут"
                    defaultValue={s.command || ''}
                    onBlur={(e) => patch(s.id, { command: e.target.value })}
                  />
                </div>
              ) : null}
              {s.lastRunAt ? (
                <div className="host-sched-last">Последний запуск: {new Date(s.lastRunAt).toLocaleString('ru-RU')}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="i-clock" text="Задач нет. Например: перезапуск каждую ночь в 05:00 — сервер работает ровнее." />
      )}
    </div>
  )
}
