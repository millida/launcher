import { Icon } from './Icon'
import { fmtSize } from '../lib/format'
import type { PackPreview } from '../ipc/commands'
import { useT } from '../i18n'

/** The sha512 of every own jar the player approved, or none while the box is unticked. */
export function approvedOwnJars(preview: PackPreview | null, trusted: boolean): string[] {
  return trusted ? (preview?.customMods || []).map((m) => m.sha512) : []
}

export const needsOwnJarsConsent = (preview: PackPreview | null): boolean => (preview?.customMods || []).length > 0

/**
 * Jars the author added by hand were checked by no catalogue: running them is trusting the author.
 * They are installed only when the player ticks the box after seeing each of them.
 */
export function OwnJarsConsent({
  preview,
  trusted,
  onTrusted,
}: {
  preview: PackPreview
  trusted: boolean
  onTrusted: (v: boolean) => void
}) {
  const t = useT()
  const jars = preview.customMods || []
  if (!jars.length) return null
  return (
    <>
      <div className="nb-err">
        <Icon id="i-alert" />
        <span>
          {t('Свои моды автора не проверены Modrinth и CurseForge. Ставь, только если доверяешь {author}: такой мод может украсть аккаунт.', {
            author: preview.author || t('автору'),
          })}
        </span>
      </div>
      <div className="party-mods">
        {jars.map((m) => (
          <div key={m.sha512} className="party-mod bad">
            <span className="party-mod-name">{m.name}</span>
            <span className="meta">{t('Свой мод автора') + ' · ' + fmtSize(m.size)}</span>
          </div>
        ))}
        <label className="party-mod">
          <span className="party-mod-name">{t('Доверяю автору, поставить его моды')}</span>
          <input type="checkbox" checked={trusted} onChange={(e) => onTrusted(e.target.checked)} />
        </label>
      </div>
    </>
  )
}
