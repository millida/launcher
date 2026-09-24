export interface SnapshotServer {
  rank: number
  name: string
  slug: string
  desc: string
  ip: string
  online: number
  isOnline: boolean
  /** Онлайн не из живого пинга, а приблизительный: печатаем со знаком «~». */
  onlineApprox?: boolean
  banner?: string
  logo?: string
  versions: string[]
  cat: string
  motd: string
  lic: string
}
