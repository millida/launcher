import { useEffect, useRef, useState } from 'react'
import { hasTauri } from '../../ipc/tauri'
import { launchHooks, setLaunchHooks, type LaunchHooks } from '../../ipc/commands'
import { showToast } from '../../state/ui'
import { tx, useT } from '../../i18n'

const EMPTY: LaunchHooks = { wrapper: '', preLaunch: '', postExit: '', env: {} }

export function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

/// One `NAME=value` per line; blank lines are skipped and a line without `=` is reported, not dropped.
export function envFromText(text: string): { env: Record<string, string>; bad: string | null } {
  const env: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq <= 0) return { env, bad: line }
    env[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  return { env, bad: null }
}

export function LaunchHooksBlock({ profile }: { profile: string | null }) {
  const t = useT()
  const [saved, setSaved] = useState<LaunchHooks>(EMPTY)
  const [wrapper, setWrapper] = useState('')
  const [pre, setPre] = useState('')
  const [post, setPost] = useState('')
  const [envText, setEnvText] = useState('')
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!profile || !hasTauri()) return
    const mine = ++seq.current
    launchHooks(profile)
      .then((h) => {
        if (mine !== seq.current) return
        setSaved(h)
        setWrapper(h.wrapper)
        setPre(h.preLaunch)
        setPost(h.postExit)
        setEnvText(envToText(h.env))
      })
      .catch((e) => showToast(t('Не удалось прочитать команды запуска: {error}', { error: tx(e) }), 'error'))
  }, [profile, t])

  const dirty = wrapper !== saved.wrapper || pre !== saved.preLaunch || post !== saved.postExit || envText !== envToText(saved.env)

  const save = async () => {
    if (!profile || !hasTauri()) {
      showToast(t('Доступно в приложении'))
      return
    }
    const { env, bad } = envFromText(envText)
    if (bad) {
      showToast(t('Строка «{line}» не похожа на ИМЯ=значение', { line: bad }), 'error')
      return
    }
    const next: LaunchHooks = { wrapper: wrapper.trim(), preLaunch: pre.trim(), postExit: post.trim(), env }
    setBusy(true)
    try {
      const ok = await setLaunchHooks(profile, next)
      if (!ok) {
        showToast(t('Команды не сохранены'))
        return
      }
      setSaved(next)
      setEnvText(envToText(env))
      showToast(t('Команды запуска сохранены'))
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <div className="set-row">
      <label className="lab" htmlFor={id}>
        {label}
      </label>
      <div className="input sm" style={{ width: '220px' }}>
        <input id={id} placeholder={placeholder} value={value} spellCheck={false} onChange={(e) => set(e.target.value)} />
      </div>
    </div>
  )

  return (
    <>
      {field('bsWrapper', t('Обёртка запуска'), wrapper, setWrapper, 'gamemoderun')}
      {field('bsPreLaunch', t('Перед запуском'), pre, setPre, 'obs64.exe --startreplaybuffer')}
      {field('bsPostExit', t('После выхода'), post, setPost, 'backup.bat')}
      <div className="set-row" style={{ alignItems: 'flex-start' }}>
        <label className="lab" htmlFor="bsEnv">
          {t('Переменные окружения')}
        </label>
        <div className="input sm" style={{ width: '220px', height: 'auto' }}>
          <textarea
            id="bsEnv"
            rows={3}
            placeholder="MESA_GL_VERSION_OVERRIDE=4.6"
            value={envText}
            spellCheck={false}
            onChange={(e) => setEnvText(e.target.value)}
          />
        </div>
      </div>
      {dirty ? (
        <div className="set-row">
          <span className="lab" />
          <button className="btn sm" id="bsHooksSave" disabled={busy} onClick={() => void save()}>
            {t('Сохранить команды')}
          </button>
        </div>
      ) : null}
    </>
  )
}
