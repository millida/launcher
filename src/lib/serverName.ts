// Названия серверов рейтинга без эмодзи, адресов и рекламных хвостов: перенос cleanServerName с сайта
// (millida-web: src/components/rating/text-clean.ts, 23.11.2026), чтобы лаунчер и сайт писали одинаково.

export function stripMarkdown(input: string | null | undefined): string {
  if (!input) return '';
  return input
    // изображения ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // ссылки [текст](url) → текст
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // заголовки ## / ### в начале строки
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    // жирный/курсив **x** __x__ *x* _x_
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|[^_])_([^_]+)_($|[^_])/g, '$1$2$3')
    // инлайн-код `x`
    .replace(/`([^`]+)`/g, '$1')
    // маркеры списков в начале строки
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    // цитаты
    .replace(/^\s{0,3}>\s?/gm, '')
    // остаточные ** или ## без пары
    .replace(/\*\*/g, '')
    .replace(/#{2,}/g, '')
    // схлопнуть переносы/пробелы
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Эмодзи, пиктограммы, стрелки-декор, вариационные селекторы и флаги. */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2900}-\u{297F}\u{20E3}]/gu;

/** Убрать эмодзи и схлопнуть образовавшиеся пробелы. */
export function stripEmoji(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * MOTD сервера — контент сервера, §-коды цвета остаются, эмодзи вычищаем.
 * Переводы строк сохраняются (stripEmoji их схлопнул бы).
 */
export function stripMotdEmoji(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/* ===== Название сервера на показ (23.11.2026) =====
   Из мониторингов приходят адреса вместо названий («mc.hypemc.pro:25565»), заглушки («A Minecraft Server»),
   рекламные хвосты («mc.AnarhoPlay.top - АНАРХИЯ…»), КАПС и маты. Бренд берём из домена. */

const GENERIC_NAME =
  /^(a\s+)?(minecraft\s+)?(server|сервер)(\s+minecraft)?$|^(my|мой|наш|новый)\s+(minecraft\s+)?(server|сервер)$|^сервер\s+(майнкрафт|minecraft)$|^онлайн игроков$|^unknown$|^без названия$|^minecraft$|^майнкрафт$/i;
const PROFANITY =
  /(ху[йеёяию]|пизд|[её]б[аоуыл]н|[её]бат|[её]бал|[её]бну|бл[яе]д|блят|сука|суки|мудак|мудил|пид[оа]р|пидр|гонд[оа]н|залуп|жоп[аыуе]|шлюх|дроч|нахуй|говн|fuck|shit|nigg|cunt|bitch|dick)/i;
const FREE_HOST =
  /(aternos|ddns\.net|no-ip|exaroton|myserver\.gs|serv\.gs|minehut|playit|ply\.gg|joinserver|mcmcmc|chsrv|mahalox|duckdns|zapto|hopto|minecraft\.party|mcserv\.me|dynmc|pylex|falix|serv\.nu)/i;
const HOST_SUBS = new Set(['mc', 'play', 'join', 'go', 'minecraft', 'server', 'ru', 'www', 'hub', 'lobby', 'java', 'm', 'pe']);
const HOST_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?$/i;

/** Бренд из адреса: «mc.hypemc.pro:25565» → «Hypemc»; на бесплатном хостинге — первая метка («smpspirit.chsrv.pl» → «Smpspirit»). */
export function brandFromHost(host: string | null | undefined, preferCase?: string): string {
  const h = (host ?? '').trim().replace(/:\d+$/, '').replace(/^www\./i, '');
  if (!h) return '';
  const parts = h.split('.');
  if (parts.length < 2) return h;
  let label = parts[parts.length - 2]!;
  if (/^(co|com|net|org)$/i.test(label) && parts.length >= 3) label = parts[parts.length - 3]!;
  if (FREE_HOST.test(h)) {
    const own = parts.filter((p) => !HOST_SUBS.has(p.toLowerCase()))[0];
    if (own) label = own;
  }
  // Регистр из исходного названия, если там он был смешанным («AnarhoPlay»).
  if (preferCase) {
    const m = preferCase.match(new RegExp(label.replace(/[^a-z0-9]/gi, ''), 'i'));
    if (m && /[a-z]/.test(m[0]) && /[A-Z]/.test(m[0])) return m[0];
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function deCaps(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length < 5 || letters !== letters.toLocaleUpperCase()) return s;
  return s.replace(/\p{L}+/gu, (w) => (w.length <= 3 ? w : w.charAt(0) + w.slice(1).toLocaleLowerCase()));
}

/**
 * Название сервера на показ: без эмодзи, порта, рекламного хвоста, КАПСА и мата; вместо адреса или заглушки — бренд из домена.
 * `ip` — адрес карточки (запасной источник бренда).
 */
export function cleanServerName(name: string | null | undefined, ip?: string | null): string {
  let n = stripEmoji(stripMarkdown(name ?? '')).replace(/§./g, '').replace(/^[\s·•|—–\-:[\]()]+|[\s·•|—–\-:[\]()]+$/g, '');
  const ipBrand = brandFromHost(ip);
  if (!n) return ipBrand || (name ?? '').trim();
  // Рекламный хвост: «mc.AnarhoPlay.top - АНАРХИЯ…» → первая часть.
  const head = n.split(/\s+(?:[-–—|:·•»]+)\s+/)[0]!.trim();
  if (head && head.length >= 3 && head !== n) n = head;
  // Только адрес (с портом или без): бренд из домена.
  if (HOST_RE.test(n)) n = brandFromHost(n, n);
  else if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\s|$)/i.test(n)) n = brandFromHost(n.split(/\s/)[0], n);
  n = n.replace(/:\d{2,5}$/, '').trim();
  if (GENERIC_NAME.test(n) || PROFANITY.test(n)) return ipBrand || (PROFANITY.test(n) ? 'Minecraft' : n);
  n = deCaps(n).replace(/\s{2,}/g, ' ').trim();
  return n.length > 40 ? n.slice(0, 40).replace(/\s+\S*$/, '').trim() || n.slice(0, 40) : n;
}

