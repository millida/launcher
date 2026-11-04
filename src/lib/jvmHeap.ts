// Memory from a build's own JVM arguments. Apart from ramPref, which is in the startup set: only
// the build page needs this.

/**
 * -Xmx of the build's own JVM arguments in MB, 0 without one. It stands right of the launcher's
 * and beats the slider (the JVM keeps the last one), so the build page shows it.
 * The JVM reads a size without a unit as bytes, which is an error rather than a heap: not counted.
 */
export function jvmHeapMb(args: string): number {
  const UNIT: Record<string, number> = { k: 1 / 1024, m: 1, g: 1024, t: 1024 * 1024 }
  let mb = 0
  for (const a of args.split(/\s+/)) {
    const m = /^-Xmx(\d+)([kKmMgGtT])$/.exec(a)
    if (m) mb = Math.floor(Number(m[1]) * UNIT[m[2]!.toLowerCase()]!)
  }
  return mb
}

/** JVM arguments without -Xmx and -Xms: the slider decides the memory again. */
export const withoutHeapArgs = (args: string) =>
  args
    .split(/\s+/)
    .filter((a) => a && !a.startsWith('-Xmx') && !a.startsWith('-Xms'))
    .join(' ')
