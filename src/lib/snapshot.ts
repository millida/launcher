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
  /** Честный онлайн (поля рейтинга): оценка Millida и признаки, логика как на millida.net/rating. */
  onlineReal?: number | null
  onlineSuspect?: boolean
  onlineVerified?: boolean
  votes?: number
  tags?: string[]
  createdAt?: string
  /** Промо-баллы (boostPoints): ракета рядом с именем. */
  boost?: number
  /** Первая строка MOTD с §-кодами, без эмодзи. */
  motdLine?: string
}
