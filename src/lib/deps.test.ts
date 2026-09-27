import { expect, test } from 'bun:test'
import { autoItems, depSummary, issueInstall, planItem, planNeedsPrompt } from './deps'
import type { AuditIssue, DepNode, DepPlan } from '../ipc/commands'

const node = (id: string, relation: string): DepNode => ({
  source: 'modrinth',
  project_id: id,
  version_id: 'v-' + id,
  title: id,
  icon: '',
  version_number: '1.0',
  file_name: id + '.jar',
  size: 0,
  relation,
  required_by: 'Root',
  problem: '',
})

const plan = (p: Partial<DepPlan>): DepPlan => ({
  title: 'Root',
  version_number: '1.0',
  mismatch: '',
  required: [],
  optional: [],
  missing: [],
  conflicts: [],
  truncated: false,
  ...p,
})

// input -> verdict. The window costs the user a click, so it may only open when
// there is something to decide or something to warn about.
const CASES: [string, DepPlan, boolean][] = [
  ['nothing to pull in stays one click', plan({}), false],
  ['a hard dependency is worth showing', plan({ required: [node('cloth-config', 'required')] }), true],
  ['an optional dependency is a choice', plan({ optional: [node('sodium', 'optional')] }), true],
  ['an unresolvable dependency is a warning', plan({ missing: [node('x', 'required')] }), true],
  [
    'a conflict must never install silently',
    plan({ conflicts: [{ title: 'JEI', file_name: 'jei.jar', with: 'REI', reason: '' }] }),
    true,
  ],
  [
    'a version mismatch belongs to the other confirmation, not this one',
    plan({ mismatch: '1.20.1', required: [node('cloth-config', 'required')] }),
    false,
  ],
]

test('the dependency window opens only when there is something to decide', () => {
  for (const [why, p, want] of CASES) {
    expect(planNeedsPrompt(p), why).toBe(want)
  }
  expect(planNeedsPrompt(null), 'a failed lookup must not block the install').toBe(false)
})

test('only hard dependencies are installed without asking', () => {
  const p = plan({ required: [node('cloth-config', 'required')], optional: [node('sodium', 'optional')] })
  expect(autoItems(p)).toEqual([
    { source: 'modrinth', project_id: 'cloth-config', version_id: 'v-cloth-config' },
  ])
  expect(planItem(node('rei', 'optional')).version_id).toBe('v-rei')
})

test('the summary names every kind of finding', () => {
  const p = plan({
    required: [node('a', 'required')],
    optional: [node('b', 'optional')],
    missing: [node('c', 'required')],
    conflicts: [{ title: 'JEI', file_name: 'jei.jar', with: 'REI', reason: '' }],
  })
  const s = depSummary(p)
  for (const part of ['зависимостей: 1', 'по желанию: 1', 'не найдено: 1', 'конфликтов: 1']) {
    expect(s, 'the header must not hide a finding').toContain(part)
  }
  expect(depSummary(plan({}))).toBe('')
})

test('one click on a missing dependency installs something real', () => {
  const issue = (over: Partial<AuditIssue>): AuditIssue => ({
    kind: 'missing',
    title: 'Lithium',
    detail: 'нужен мод «cloth-config», в сборке его нет',
    file_name: '',
    fix: null,
    ...over,
  })
  const cases: Array<[string, AuditIssue, ReturnType<typeof issueInstall>]> = [
    [
      'resolved fix installs the exact version the audit picked',
      issue({ fix: node('cloth', 'required') }),
      { source: 'modrinth', project_id: 'cloth', version_id: 'v-cloth' },
    ],
    [
      'no fix because the catalogue was down: the click looks the project up again',
      issue({ dep: 'cloth-config' }),
      { source: 'modrinth', project_id: 'cloth-config', version_id: '' },
    ],
    ['nothing to look up: no button, not a dead one', issue({}), null],
    ['a conflict is never "installed"', issue({ kind: 'conflict', dep: 'x' }), null],
  ]
  for (const [why, input, want] of cases) expect(issueInstall(input), why).toEqual(want)
})
