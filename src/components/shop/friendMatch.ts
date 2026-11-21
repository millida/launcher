import type { Friend } from '../../state/friends'

export function matchFriends(friends: Friend[], query: string): Friend[] {
  const q = query.trim().toLowerCase()
  const named = friends.filter((f) => !!f.nickname)
  return q ? named.filter((f) => f.nickname!.toLowerCase().includes(q)) : named
}
