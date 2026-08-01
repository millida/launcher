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
    if (ac.grad) r.setProperty('--m-grad', ac.grad)
  }
} catch (e) {}
