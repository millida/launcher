import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const SRC = fileURLToPath(new URL('..', import.meta.url))

type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction

const isFn = (n: ts.Node): n is Fn => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)

const isHookName = (name: string) => /^use[A-Z0-9]/.test(name)

function calleeName(call: ts.CallExpression): string {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return ''
}

function hookCalls(node: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = []
  const walk = (n: ts.Node) => {
    if (ts.isFunctionLike(n)) return
    if (ts.isCallExpression(n) && isHookName(calleeName(n))) out.push(n)
    ts.forEachChild(n, walk)
  }
  walk(node)
  return out
}

function returnsEarly(stmt: ts.Statement): boolean {
  if (!ts.isIfStatement(stmt)) return false
  const has = (n: ts.Node): boolean => {
    if (ts.isFunctionLike(n)) return false
    if (ts.isReturnStatement(n)) return true
    return ts.forEachChild(n, has) || false
  }
  return has(stmt.thenStatement) || (!!stmt.elseStatement && has(stmt.elseStatement))
}

function ownerName(fn: Fn, sf: ts.SourceFile): string {
  if (fn.name) return fn.name.getText(sf)
  return ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText(sf) : ''
}

function hooksAfterEarlyReturn(text: string, file: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const visit = (n: ts.Node) => {
    if (isFn(n) && n.body && ts.isBlock(n.body)) {
      const name = ownerName(n, sf)
      if (/^[A-Z]/.test(name) || isHookName(name)) {
        let early = false
        for (const stmt of n.body.statements) {
          if (early) {
            for (const call of hookCalls(stmt)) {
              const line = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1
              found.push(file + ':' + line + ' ' + name + ' → ' + calleeName(call))
            }
          } else early = returnsEarly(stmt)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

const wrap = (body: string) => 'export function Card({ on }: { on: boolean }) {\n' + body + '\n}\n'

test('проверка порядка хуков отличает хук после раннего выхода от всего остального', () => {
  const cases: [string, string, number][] = [
    [
      'хук после условного return — число хуков зависит от условия, React роняет блок',
      wrap('const a = useState(0)\nif (!on) return null\nconst b = useStore((s) => s.x)\nreturn <i>{a}{b}</i>'),
      1,
    ],
    [
      'все хуки до условного return — порядок постоянный',
      wrap('const a = useState(0)\nconst b = useStore((s) => s.x)\nif (!on) return null\nreturn <i>{a}{b}</i>'),
      0,
    ],
    [
      'хранилище читается не хуком, а getState — это обычный вызов',
      wrap('const a = useState(0)\nif (!on) return null\nconst b = useStore.getState().x\nreturn <i>{a}{b}</i>'),
      0,
    ],
    [
      'хук во вложенной функции после return принадлежит ей, а не компоненту',
      wrap('const a = useState(0)\nif (!on) return null\nconst Inner = () => <i>{useStore((s) => s.x)}</i>\nreturn <Inner />'),
      0,
    ],
    [
      'свой хук подчиняется тому же правилу, что и компонент',
      'export function useThing(on: boolean) {\nif (!on) return null\nreturn useStore((s) => s.x)\n}\n',
      1,
    ],
  ]
  for (const [why, text, count] of cases) expect([why, hooksAfterEarlyReturn(text, 'case.tsx').length]).toEqual([why, count])
})

test('ни один компонент не вызывает хук после раннего выхода', async () => {
  const found: string[] = []
  for await (const file of new Bun.Glob('**/*.tsx').scan({ cwd: SRC })) {
    found.push(...hooksAfterEarlyReturn(readFileSync(SRC + '/' + file, 'utf8'), file.replaceAll('\\', '/')))
  }
  expect(
    found,
    'хук стоит после условного return: когда условие меняется на живом экране, React видит другое число хуков ' +
      'и снимает весь блок интерфейса вместе с соседями (так падало лобби целиком). Хук нужно поднять выше return',
  ).toEqual([])
})
