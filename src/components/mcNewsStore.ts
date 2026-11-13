import { create } from 'zustand'

export const useMcNews = create<{ open: boolean }>(() => ({ open: false }))
export const openMcNews = () => useMcNews.setState({ open: true })
