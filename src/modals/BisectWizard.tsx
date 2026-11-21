// «Найти мод, из-за которого вылет»: мастер поверх ядра (engine/content/bisect.rs). Ядро выключает
// половину подозреваемых, игрок запускает, вылет ловится сам (App → bisectTakesCrash), «Запустилось»
// жмёт игрок. Ход поиска хранится в ядре, окно можно закрыть и вернуться из вкладки модов.
import { useEffect, useState } from 'react'
import { stopGame, updateContent, type BisectView } from '../ipc/commands'
import { bisectAnswer, bisectFinish, bisectStart, bisectVerify } from '../ipc/modTools'
import { hasTauri } from '../ipc/tauri'
import { useT } from '../i18n'
import { apiErrorText } from '../lib/apiError'
import { backdropClose } from '../lib/dismiss'
import { realLaunch } from '../lib/launch'
import { namesText } from '../lib/modsOff'
import { announceBisectMods, useBisect } from '../state/bisect'
import { uiConfirm } from '../state/confirm'
import { useGame } from '../state/game'
import { showToast } from '../state/ui'
import { Icon } from '../components/Icon'

/** Столько ждём, пока игра закроется после «Запустилось». */
const CLOSE_WAIT_MS = 20_000

function waitClosed(profile: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!useGame.getState().list.includes(profile)) return resolve(true)
    let stop = () => {}
    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, CLOSE_WAIT_MS)
    stop = useGame.subscribe((s) => {
      if (s.list.includes(profile)) return
      clearTimeout(timer)
      stop()
      resolve(true)
    })
  })
}

export function BisectWizard() {
  const t = useT()
  const { profile, view, crashed, close } = useBisect()
  const running = useGame((s) => s.list.includes(profile))
  const [busy, setBusy] = useState(false)
  const [launched, setLaunched] = useState(false)

  const show = (v: BisectView) => useBisect.setState({ view: v, crashed: false })
  const fail = (e: unknown) => showToast(apiErrorText(e, t('Не удалось выполнить действие')), 'error')
  const act = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await work()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
      announceBisectMods(profile)
    }
  }
  // Шаг, на который уже пробовали ответить «вылетело» сами: неудачная попытка не крутится по кругу.
  const [autoTried, setAutoTried] = useState(-1)

  // Открыли без хода поиска — начинаем (или ядро вернёт уже идущий).
  useEffect(() => {
    if (!profile || view || !hasTauri()) return
    void act(async () => show(await bisectStart(profile)))
  }, [profile, view])

  const reply = (didCrash: boolean) =>
    act(async () => {
      const at = useBisect.getState().view
      if (!at || at.phase !== 'test') return
      // Вылет этого запуска уже пойман (автоответ не прошёл): «Запустилось» его не отменяет.
      const answer = didCrash || useBisect.getState().crashed
      if (useGame.getState().list.includes(profile)) {
        await stopGame(profile)
        if (!(await waitClosed(profile))) throw new Error(t('Закрой игру, чтобы продолжить поиск'))
      }
      setLaunched(false)
      show(await bisectAnswer(profile, answer, at.step))
    })

  // Вылет пришёл сам — это ответ «вылетело». Пришёл, пока мастер занят, — ответ уйдёт, когда освободится;
  // не ушёл — флаг вылета остаётся до ответа игрока, а повтор ядро не засчитает следующему шагу.
  useEffect(() => {
    if (!crashed || busy || view?.phase !== 'test' || autoTried === view.step) return
    setAutoTried(view.step)
    void reply(true)
  }, [crashed, busy, view?.phase, view?.step])

  const finish = (disable: string | null, after?: () => Promise<void>) =>
    act(async () => {
      await bisectFinish(profile, disable)
      close()
      if (after) await after()
    })

  const abort = async () => {
    if (busy) return
    if (view && view.step > 0 && !(await uiConfirm(t('Прервать поиск и включить моды как было?'), { confirmLabel: t('Прервать'), danger: false }))) return
    void finish(null, async () => showToast(t('Моды сборки включены как до поиска'), 'ok'))
  }

  if (!profile) return null
  const culprit = view?.culprit
  return (
    <div className="modal-bg open vis" style={{ zIndex: 215 }} {...backdropClose(() => void abort())}>
      <div className="modal mw-sm" data-bisect={view?.phase ?? 'start'}>
        <div className="crash-head">
          <span className="crash-ic">
            <Icon id="i-search" />
          </span>
          <div>
            <h3>{t('Поиск мода-виновника')}</h3>
            <div className="sub" style={{ marginTop: '2px' }}>
              {profile}
            </div>
          </div>
        </div>

        {!view ? (
          <p className="crash-reason">{hasTauri() ? t('Готовим сборку…') : t('Доступно в приложении')}</p>
        ) : view.phase === 'test' ? (
          <>
            <p className="crash-reason">
              {running
                ? t('Дождись главного меню или зайди в мир. Если игра вылетит, мастер заметит это сам.')
                : t('На время проверки выключено модов: {n}. Запусти игру и посмотри, вылетит ли она.', { n: view.off })}
            </p>
            <p className="crash-plan">
              {t('Подозреваемых: {n}. Осталось запусков: не больше {k}.', { n: view.suspects, k: view.runsLeft })}
            </p>
            <div className="crash-acts">
              {running ? (
                <button className="btn lg primary" data-track="bisect_ok" disabled={busy} onClick={() => void reply(false)}>
                  <Icon id="i-check" /> {t('Запустилось — закрыть игру')}
                </button>
              ) : (
                <button
                  className="btn lg primary"
                  data-track="bisect_launch"
                  disabled={busy}
                  onClick={() => {
                    setLaunched(true)
                    realLaunch(profile)
                  }}
                >
                  <Icon id="i-play" /> {launched ? t('Запустить ещё раз') : t('Запустить игру')}
                </button>
              )}
              <div className="crash-acts-min">
                {!running && launched ? (
                  <button className="btn md secondary" disabled={busy} onClick={() => void reply(false)}>
                    {t('Запустилось')}
                  </button>
                ) : null}
                <button className="btn md secondary" data-track="bisect_crash" disabled={busy} onClick={() => void reply(true)}>
                  {t('Вылетело')}
                </button>
                <button className="btn md ghost" disabled={busy} onClick={() => void abort()}>
                  {t('Прервать')}
                </button>
              </div>
            </div>
          </>
        ) : view.phase === 'found' && culprit ? (
          <>
            <p className="crash-reason">
              {view.verified
                ? t('Виновник — «{mod}»: без него сборка запускается.', { mod: culprit.title })
                : t('Скорее всего, виновник — «{mod}». Можно проверить: запустить сборку без него одного.', { mod: culprit.title })}
            </p>
            <div className="crash-acts">
              <button
                className="btn lg primary"
                data-track="bisect_disable"
                disabled={busy}
                onClick={() => void finish(culprit.name, async () => showToast(t('«{mod}» выключен, остальные моды включены как были', { mod: culprit.title }), 'ok'))}
              >
                <Icon id="i-ban" /> {t('Выключить его')}
              </button>
              <div className="crash-acts-min">
                {!view.verified ? (
                  <button className="btn md secondary" disabled={busy} onClick={() => void act(async () => show(await bisectVerify(profile)))}>
                    {t('Проверить без него')}
                  </button>
                ) : null}
                <button
                  className="btn md secondary"
                  data-track="bisect_update"
                  disabled={busy}
                  onClick={() =>
                    void finish(null, async () => {
                      await updateContent(profile, 'mod', culprit.name)
                      showToast(t('«{mod}» обновлён', { mod: culprit.title }), 'ok')
                    })
                  }
                >
                  {t('Обновить')}
                </button>
                <button className="btn md ghost" disabled={busy} onClick={() => void finish(null)}>
                  {t('Вернуть всё как было')}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="crash-reason">
              {view.phase === 'notMods'
                ? t('Без подозреваемых модов игра всё равно вылетает — похоже, дело не в модах. Попробуй «Починить сборку» или напиши в поддержку.')
                : t('Дальше не сузить: оставшиеся моды нужны друг другу — {list}.', { list: namesText(view.left.map((m) => m.title)) })}
            </p>
            <div className="crash-acts">
              <button className="btn lg primary" disabled={busy} onClick={() => void finish(null)}>
                {t('Вернуть всё как было')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
