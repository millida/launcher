try {
  var t = localStorage.getItem('m-theme')
  var light = t === 'light' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches)
  if (light) document.documentElement.dataset.theme = 'light'
} catch (e) {}
try {
  var ac = JSON.parse(localStorage.getItem('m-accent') || 'null')
  if (ac) {
    var r = document.documentElement.style
    r.setProperty('--m-accent', ac.textC || ac.c)
    r.setProperty('--m-accent-hover', ac.h)
    r.setProperty('--m-accent-soft', ac.s)
    if (ac.fg) r.setProperty('--m-accent-fg', ac.fg)
    var hx = /^#?([0-9a-f]{6})$/i.exec(String(ac.c || ''))
    var rgb = ac.rgb
    if (!rgb && hx) {
      var n = parseInt(hx[1], 16)
      rgb = ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255)
    }
    if (rgb) r.setProperty('--m-accent-rgb', rgb)
    if (ac.grad) r.setProperty('--m-grad', ac.grad)
  }
} catch (e) {}
