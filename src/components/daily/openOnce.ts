type Answer = { ok: unknown } | { error: string }

export function createOpenOnce<A extends Answer>(openOne: (id: string) => Promise<A>) {
  const inflight = new Map<string, Promise<A>>()
  return (id: string, fresh = false): Promise<A> => {
    const known = fresh ? undefined : inflight.get(id)
    if (known) return known
    const sent = openOne(id)
    inflight.set(id, sent)
    // A late failure of a superseded attempt must not evict the retry that replaced it.
    void sent.then((a) => 'error' in a && inflight.get(id) === sent && inflight.delete(id))
    return sent
  }
}
