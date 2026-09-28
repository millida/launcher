import { usePackCode } from '../state/packCode'
import { InstallByCodeModal } from './InstallByCodeModal'

/// The code window is opened from the Import window and from millida://pack
/// links, neither of which lives on one screen. Mounted once for the whole app,
/// so it opens on whichever screen the player happens to be.
export function PackCodeHost() {
  const packCode = usePackCode()
  if (!packCode.open) return null
  return <InstallByCodeModal initialCode={packCode.code} onClose={() => packCode.close()} />
}
