import { describe, expect, test } from 'bun:test'
import { NO_ART, artFromOriginal, artFromView } from './packArtPick'

const ICON = 'https://cdn.millida.trade/catalog/icons/7d9f675d.webp'
const COVER = 'https://cdn.millida.trade/catalog/covers/a.webp'
const SHOT = 'https://cdn.millida.trade/catalog/shots/1.webp'

describe('a pack tile without a cover still gets a picture', () => {
  const cases: { why: string; view: Parameters<typeof artFromView>[0]; want: ReturnType<typeof artFromView> }[] = [
    { why: 'no view: nothing to show yet', view: null, want: NO_ART },
    { why: 'the cover wins over everything', view: { cover: COVER, banner: SHOT, gallery: [SHOT], icon: ICON }, want: { cover: COVER, icon: ICON } },
    { why: 'no cover: the page banner is a wide picture too', view: { cover: null, banner: SHOT, icon: null }, want: { cover: SHOT, icon: null } },
    { why: 'no cover nor banner: the first gallery shot', view: { cover: null, gallery: [SHOT, COVER], icon: ICON }, want: { cover: SHOT, icon: ICON } },
    { why: 'ATM11 case: only an icon, it stays an icon and is not stretched into a cover', view: { cover: null, gallery: [], icon: ICON }, want: { cover: null, icon: ICON } },
    { why: 'a broken gallery entry is skipped, not rendered as an empty frame', view: { gallery: ['', null, 'javascript:alert(1)', SHOT] }, want: { cover: SHOT, icon: null } },
    { why: 'only https pictures: http and relative paths would break under the launcher CSP', view: { cover: 'http://x/a.png', icon: '/a.png' }, want: NO_ART },
    { why: 'a gallery that is not a list (old API) does not throw', view: { gallery: 'oops' }, want: NO_ART },
  ]
  for (const c of cases) test(c.why, () => expect(artFromView(c.view), c.why).toEqual(c.want))
})

describe('a translation draft borrows the pictures of its original', () => {
  const items = [
    { title: 'Create Prepare to Dye', cover: null, icon: ICON },
    { title: 'All the Mods 11 - ATM11', cover: null, icon: ICON },
    { title: 'Verity [ Horror ]', cover: COVER, icon: ICON },
    { title: 'Arcania Origins', cover: null, icon: null },
  ]
  const cases: { title: string; want: ReturnType<typeof artFromOriginal>; why: string }[] = [
    { title: 'Create: Prepare to Dye', want: { cover: null, icon: ICON }, why: 'punctuation differs between the draft and the original' },
    { title: 'All the Mods 11 - ATM11', want: { cover: null, icon: ICON }, why: 'the same title is the original' },
    { title: 'VERITY', want: NO_ART, why: 'a partial title must not borrow a different pack' },
    { title: 'Arcania Origins', want: NO_ART, why: 'an original without pictures gives nothing' },
    { title: '  ', want: NO_ART, why: 'an empty title matches nothing' },
  ]
  for (const c of cases) test(c.title || '(empty)', () => expect(artFromOriginal(c.title, items), c.why).toEqual(c.want))
})
