/// A failure nobody can act on is still written down with its place, never dropped silently: the rejection handler
/// for fire-and-forget promises (`.catch(noted('place'))`). The place is the module and the step, as in the logs.
export const noted =
  (where: string) =>
  (e: unknown): void => {
    console.warn(`[${where}]`, e)
  }
