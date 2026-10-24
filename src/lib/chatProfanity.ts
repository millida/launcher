// Masks obscene words in chat messages for the reader. The list is narrow on purpose: only words that are rude in
// any context, so «употреблять», «хлеб» or «скипидар» stay untouched and a mask never hides an ordinary sentence.

const ROOTS = ['хуй', 'хуе', 'хуё', 'хуя', 'хули', 'пизд', 'пезд', 'ебат', 'ебал', 'ебан', 'ебну', 'еблан', 'ебуч', 'ебл', 'заеб', 'наеб', 'выеб', 'съеб', 'уеб', 'долбоеб', 'бля', 'мудак', 'мудил', 'пидор', 'пидар', 'пидр', 'гандон', 'гондон', 'шлюх', 'залуп', 'сука', 'суки', 'сучк']
const LATIN = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'asshole', 'motherf']

/// Words that contain a root but are not swearing.
const SAFE = ['сукно', 'сукон', 'страхуй', 'застрахуй', 'хулиган', 'небля', 'употреб', 'скипидар']

const LOOKALIKE: Record<string, string> = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', h: 'н', b: 'в', t: 'т', '0': 'о', '3': 'з', '@': 'а' }

function fold(word: string): string {
  let out = ''
  for (const ch of word.toLowerCase().replace(/ё/g, 'е')) out += LOOKALIKE[ch] ?? ch
  return out.replace(/[^а-я]/g, '').replace(/(.)\1+/g, '$1')
}

export function isProfane(word: string): boolean {
  const lower = word.toLowerCase()
  if (SAFE.some((s) => lower.includes(s))) return false
  const latin = lower.replace(/[^a-z]/g, '')
  if (latin.length >= 4 && LATIN.some((r) => latin.includes(r))) return true
  const f = fold(word)
  return f.length >= 3 && ROOTS.some((r) => f.includes(r.replace(/ё/g, 'е')))
}

/// Keeps the first letter so the reader sees a word was there, the rest becomes asterisks.
export function maskProfanity(text: string): string {
  return text.replace(/[\p{L}\p{N}@]+/gu, (word) => (isProfane(word) ? word[0] + '*'.repeat(Math.max(2, word.length - 1)) : word))
}
