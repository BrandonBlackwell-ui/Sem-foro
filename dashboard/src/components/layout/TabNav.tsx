import { useApp } from '../../context/AppContext'
import type { TabId } from '../../types'

const TABS: { id: TabId; label: string }[] = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'tareas', label: 'Tareas' },
  { id: 'equipo', label: 'Equipo' },
  { id: 'metodologia', label: 'Metodología' },
  { id: 'auditoria', label: 'Auditoría' },
]

export function TabNav() {
  const { currentTab, setCurrentTab } = useApp()

  return (
    <nav
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--rule)',
        marginBottom: '24px',
      }}
    >
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => setCurrentTab(tab.id)}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: currentTab === tab.id ? '2px solid var(--ink-800)' : '2px solid transparent',
            padding: '12px 18px 10px',
            marginBottom: '-1px',
            fontFamily: 'var(--sans)',
            fontSize: '13px',
            fontWeight: 500,
            color: currentTab === tab.id ? 'var(--ink-900)' : 'var(--char)',
            letterSpacing: '0.02em',
            cursor: 'pointer',
            transition: 'color 0.12s, border-color 0.12s',
          }}
          onMouseEnter={e => {
            if (currentTab !== tab.id)
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-700)'
          }}
          onMouseLeave={e => {
            if (currentTab !== tab.id)
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--char)'
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
