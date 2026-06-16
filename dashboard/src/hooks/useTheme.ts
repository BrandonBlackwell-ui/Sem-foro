import { useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { ThemeId } from '../types'

export function useTheme() {
  const [theme, setTheme] = useLocalStorage<ThemeId>('v35:theme', 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return { theme, setTheme }
}
