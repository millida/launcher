import { describe, expect, it } from 'bun:test'
import { backdropClose, rowClickOpens } from './dismiss'

type Handler = (e: { target: FakeNode; currentTarget: FakeNode }) => void

class FakeNode {
  dataset: Record<string, string> = {}
  handlers: Record<string, Handler> = {}
  constructor(
    readonly tag: string,
    readonly domParent: FakeNode | null,
    readonly reactParent: FakeNode | null = domParent,
  ) {}
  contains(other: FakeNode | null): boolean {
    for (let n = other; n; n = n.domParent) if (n === this) return true
    return false
  }
  closest(tag: string): FakeNode | null {
    for (let n: FakeNode | null = this; n; n = n.domParent) if (n.tag === tag) return n
    return null
  }
}

const dispatch = (type: 'onPointerDown' | 'onClick', target: FakeNode) => {
  for (let n: FakeNode | null = target; n; n = n.reactParent) n.handlers[type]?.({ target, currentTarget: n })
}

const catalogWithKeyWindow = () => {
  const body = new FakeNode('body', null)
  const row = new FakeNode('article', body)
  const rowTitle = new FakeNode('h3', row)
  const installButton = new FakeNode('button', row)
  const backdrop = new FakeNode('div', body, row)
  const dialog = new FakeNode('div', backdrop)
  const keyInput = new FakeNode('input', dialog)
  const activate = new FakeNode('button', dialog)
  const state = { closed: 0, opened: 0 }
  const bd = backdropClose(() => state.closed++)
  backdrop.handlers.onPointerDown = bd.onPointerDown as unknown as Handler
  backdrop.handlers.onClick = bd.onClick as unknown as Handler
  row.handlers.onClick = (e) => {
    if (rowClickOpens(e as never)) state.opened++
  }
  return { rowTitle, installButton, backdrop, keyInput, activate, state }
}

type Scene = ReturnType<typeof catalogWithKeyWindow>

const cases: { name: string; why: string; down: (s: Scene) => FakeNode; up: (s: Scene) => FakeNode; closed: number; opened: number }[] = [
  {
    name: 'click on the key field',
    why: 'players could not type an Arcania key: the click bubbled out of the portal and opened the pack page under the window',
    down: (s) => s.keyInput,
    up: (s) => s.keyInput,
    closed: 0,
    opened: 0,
  },
  {
    name: 'click on Activate',
    why: 'the redeem button must only redeem',
    down: (s) => s.activate,
    up: (s) => s.activate,
    closed: 0,
    opened: 0,
  },
  {
    name: 'click on the backdrop',
    why: 'the backdrop closes the window and must not open the row behind it',
    down: (s) => s.backdrop,
    up: (s) => s.backdrop,
    closed: 1,
    opened: 0,
  },
  {
    name: 'press in the field, release on the backdrop',
    why: 'selecting the typed key and overshooting the edge must not throw the key away',
    down: (s) => s.keyInput,
    up: (s) => s.backdrop,
    closed: 0,
    opened: 0,
  },
  {
    name: 'click on the row itself',
    why: 'the row still opens its pack when nothing is on top of it',
    down: (s) => s.rowTitle,
    up: (s) => s.rowTitle,
    closed: 0,
    opened: 1,
  },
  {
    name: 'click on the row install button',
    why: 'row buttons act on their own and must not also open the pack',
    down: (s) => s.installButton,
    up: (s) => s.installButton,
    closed: 0,
    opened: 0,
  },
]

describe('catalog row with a portaled key window', () => {
  for (const c of cases) {
    it(c.name, () => {
      const s = catalogWithKeyWindow()
      dispatch('onPointerDown', c.down(s))
      dispatch('onClick', c.up(s))
      expect(s.state.closed, `window closed ${s.state.closed}x, expected ${c.closed}: ${c.why}`).toBe(c.closed)
      expect(s.state.opened, `row opened ${s.state.opened}x, expected ${c.opened}: ${c.why}`).toBe(c.opened)
    })
  }
})
