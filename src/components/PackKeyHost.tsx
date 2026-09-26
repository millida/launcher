import { usePackKey } from '../state/packKey'
import { PackKeyModal } from './PackKeyModal'

/// The access window for a paid pack reached outside its page: a deep link or
/// a launch the service refused. Mounted once for the whole app, so it opens
/// on whichever screen the player happens to be.
export function PackKeyHost() {
  const packKey = usePackKey()
  if (!packKey.slug) return null
  return (
    <PackKeyModal
      slug={packKey.slug}
      title={packKey.title}
      reason={packKey.reason}
      onClose={() => packKey.close()}
      onUnlocked={() => {
        const retry = packKey.retry
        packKey.close()
        retry?.()
      }}
    />
  )
}
