import { afterEach, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { usePackCode } from '../state/packCode'

// Server rendering reads a store's initial snapshot, so the hook is pointed at the live state.
mock.module('../state/packCode', () => ({
  usePackCode: Object.assign(() => usePackCode.getState(), usePackCode),
}))

const { PackCodeHost } = await import('./PackCodeHost')

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const CODE_FIELD = 'placeholder="AB23-CD45"'

const renderHost = () => renderToStaticMarkup(<PackCodeHost />)

afterEach(() => usePackCode.getState().close())

describe('install by code window', () => {
  const cases: { name: string; why: string; open: () => void; field: boolean }[] = [
    {
      name: 'nothing asked',
      why: 'the host must stay invisible until someone asks for the code window',
      open: () => {},
      field: false,
    },
    {
      name: 'Import window, «По коду»',
      why: 'the button closed Import and nothing appeared: the window was mounted only on the Builds screen, not in the Library',
      open: () => usePackCode.getState().show(),
      field: true,
    },
    {
      name: 'millida://pack link',
      why: 'a link from a friend opens the window with the code already filled in',
      open: () => usePackCode.getState().show('AB23-CD45'),
      field: true,
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      c.open()
      const html = renderHost()
      expect(html.includes(CODE_FIELD), c.why).toBe(c.field)
    })
  }

  it('the Import button opens the code window through the shared store', () => {
    const imp = source('../modals/Import.tsx')
    const button = imp.slice(imp.lastIndexOf('<button', imp.indexOf('<b>По коду</b>')), imp.indexOf('<b>По коду</b>'))
    expect(button, '«По коду» must ask the app-wide host for the code window').toContain('usePackCode.getState().show()')
  })

  it('the host is mounted once for the whole app, outside any screen', () => {
    const app = source('../App.tsx')
    const at = app.indexOf('<PackCodeHost />')
    expect(at, 'without the app-wide host «По коду» opens nothing on screens other than Builds').toBeGreaterThan(-1)
    expect(at, 'mounted inside </main> it would again depend on the current screen').toBeGreaterThan(app.indexOf('</main>'))
  })

  it('no screen renders its own copy of the window', () => {
    expect(source('../screens/Builds.tsx'), 'a second copy on Builds would show two windows stacked there').not.toContain('InstallByCodeModal')
  })
})
