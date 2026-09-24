// Предпросмотр в обычном браузере (только dev, в релиз не попадает):
// http://127.0.0.1:5173/?preview — API через прокси Vite и офлайн-ник, чтобы
// увидеть экраны без Tauri-входа. Подробно — docs/LOCAL-DEV.md.
//
// http://127.0.0.1:5173/?preview=user — то же плюс демо-вход: лаунчер считает,
// что человек вошёл в аккаунт Millida, и все экраны показывают залогиненный
// вид. Ответы «моих» ручек лежат в src/lib/demo.ts, публичные данные при этом
// остаются живыми. Всё под import.meta.env.DEV: в релизе ветки нет.
if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window) && new URLSearchParams(location.search).has('preview')) {
  const demo = new URLSearchParams(location.search).get('preview') === 'user'
  localStorage.setItem('m-api', '/papi/v2')

  // Засеянную запись переписываем, чужую (заведённую руками) не трогаем:
  // так переключение ?preview ↔ ?preview=user работает в обе стороны.
  const seeded = demo
    ? [{ id: 'demo-user', nick: 'SlavaMine', kind: 'millida', uuid: '8f3c1a0e2b7d4e6a9c05d31f7a2b8e44', balance: 148900 }]
    : [{ id: 'preview', nick: 'Steve', kind: 'offline' }]
  let current: { id?: string }[] = []
  try {
    const raw = JSON.parse(localStorage.getItem('m-accounts') || 'null')
    if (Array.isArray(raw)) current = raw
  } catch {}
  const ours = !current.length || current.every((a) => a && (a.id === 'preview' || a.id === 'demo-user'))
  if (ours) {
    localStorage.setItem('m-accounts', JSON.stringify(seeded))
    localStorage.setItem('m-active', seeded[0]!.id)
  }
  if (!demo) localStorage.removeItem('m-millida-uid')

  localStorage.setItem('m-mil-ever', '1')
  localStorage.setItem('m-onb-done', '1')

  // Видно, что это не настоящий вход: маленькая неяркая плашка в углу.
  if (demo) {
    const mark = () => {
      if (document.getElementById('demo-mark')) return
      const el = document.createElement('div')
      el.id = 'demo-mark'
      el.textContent = 'Демо-вход'
      el.style.cssText = [
        'position:fixed',
        'right:10px',
        'bottom:10px',
        'z-index:2147483647',
        'pointer-events:none',
        'padding:4px 9px',
        'font:500 11px/1 ui-sans-serif,system-ui,sans-serif',
        'letter-spacing:.02em',
        'color:rgba(255,255,255,.62)',
        'background:rgba(18,18,20,.72)',
        'clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)',
      ].join(';')
      document.body.appendChild(el)
    }
    if (document.body) mark()
    else document.addEventListener('DOMContentLoaded', mark, { once: true })
  }
}

// Тишина при разработке: VITE_NO_MUSIC=1 в .env.local выключает автозапуск
// плеера. Игрокам ничего не меняет — ветка есть только в dev.
if (import.meta.env.DEV && import.meta.env.VITE_NO_MUSIC === '1') {
  localStorage.setItem('m-mus-auto', '0')
}

export {}
