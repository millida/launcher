import { create } from 'zustand'
import type { Currency } from './locales'

/// Set from the account's price region: a proven foreign account sees dollars in every language,
/// since a ruble price would be refused at checkout. Null leaves the choice to the language.
/// `rubPerUsd` is the server's rate, for goods that only have a ruble price.
export const useCurrencyOverride = create<{ forced: Currency | null; rubPerUsd: number | null }>(() => ({ forced: null, rubPerUsd: null }))
