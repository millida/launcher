const PATTERNS: RegExp[] = [
  /os error 112\b/i,
  /\bENOSPC\b/i,
  /недостаточно места на диске/i,
  /не хватает места на диске/i,
  /no space left on device/i,
  /0x80070070/i,
  /disk (is )?full/i,
  /os error 1223\b/i,
  /operation was canceled by the user/i,
  /os error 1450\b/i,
  /insufficient system resources/i,
  /os error 665\b/i,
  /the media is write protected/i,
  /os error 19\b/i,
  /\bEROFS\b/i,
  /read-only file system/i,
  /\bEDQUOT\b/i,
  /disk quota exceeded/i,
]

export function isUserEnvironmentError(text: string): boolean {
  return PATTERNS.some((p) => p.test(text))
}
