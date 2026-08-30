export interface SnapshotServer {
  rank: number
  name: string
  slug: string
  desc: string
  ip: string
  online: number
  isOnline: boolean
  banner?: string
  logo?: string
  versions: string[]
  cat: string
  motd: string
  lic: string
}
