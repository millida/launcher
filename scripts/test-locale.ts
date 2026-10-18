for (const [key, value] of [['language', 'ru-RU'], ['languages', ['ru-RU']]] as const) {
  Object.defineProperty(globalThis.navigator, key, { value, configurable: true })
}
