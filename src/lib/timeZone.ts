const IANA_ZONE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/

/// The same shape the site and the core accept, so all three agree on which clocks count.
export function validTimeZone(raw: string | null | undefined): string | null {
  const tz = raw?.trim()
  return tz && tz.length <= 64 && IANA_ZONE.test(tz) ? tz : null
}

/// The server picks the South Asian price region by the device clock, never by the address alone.
export function webviewTimeZone(): string | null {
  try {
    return validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return null
  }
}
