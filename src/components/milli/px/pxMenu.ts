/**
 * Значки меню чата: новая беседа (книга с пером), поддержка (колокол).
 * Формат — pxTypes.ts.
 */
import type { PxSprite } from './pxTypes'

/** «Новый чат»: книга с пером — кожаный переплёт, торец страниц, белое перо пишет вниз-влево. */
const BOOK_QUILL: PxSprite = {
  pal: {
    o: '#2e1709', S: '#5c2a1c', b: '#7a3a22', d: '#4a2219', H: '#b0703c', C: '#8c4a26', c: '#6e3520',
    P: '#f4e9c8', p: '#d6c398', q: '#ad9a72',
    k: '#34384c', W: '#ffffff', w: '#e2e5ed', g: '#a2a7ba', s: '#b3b7c6', r: '#efe6cf', n: '#16161f',
  },
  rows: [
    '..............kk',
    '.............kWk',
    'oooooooooookWWsk',
    'oSSHHHHHHHkWWswk',
    'obbHCCCCkWWWswk.',
    'oSSHCCCkWWWswgk.',
    'oSSHCCCCkWswgko.',
    'oSSHCCkWWswkPqo.',
    'oSSHCCkWsgkoPqo.',
    'oSSHCCkskCcoPqo.',
    'obbHCkrkCCcoPqo.',
    'oSSHknkccccoPqo.',
    'oooknoooooooPqo.',
    '.oddPPPPPPPPPqo.',
    '..oddppppppppqo.',
    '...oooooooooooo.',
  ],
}

/** «Поддержка»: золотой колокол на тёмной каменной перекладине, язычок снизу. */
const BELL: PxSprite = {
  pal: {
    z: '#1f1f26', L: '#7b7c86', M: '#5a5b66', m: '#43444f',
    o: '#5a3208', D: '#a0611a', d: '#c98a1e', Y: '#f0b82a', G: '#fcd95a', W: '#fff6c0',
    K: '#8a8b96', k: '#55566a', l: '#9a9ba6',
  },
  rows: [
    '..zzzzzzzzzzzz..',
    '..zlLLLLLLLLMz..',
    '..zMMMMMMMMMmz..',
    '..zzzzoooozzzz..',
    '.....oGWYdo.....',
    '....oGWYYYdo....',
    '....oGWYYdDo....',
    '....oGWYYdDo....',
    '....oGWYYdDo....',
    '...oGGWYYYdDo...',
    '..oGGWYYYYYdDo..',
    '.oGWWGGGGGGYdDo.',
    '.oGYYYYYYYYddDo.',
    '..oooooooooooo..',
    '......zKkz......',
    '.......zz.......',
  ],
}

export const PX_MENU = {
  book_quill: BOOK_QUILL,
  bell: BELL,
} satisfies Record<string, PxSprite>
