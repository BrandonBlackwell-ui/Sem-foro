import { useApp } from './context/AppContext'
import { TopBar } from './components/layout/TopBar'
import { TabNav } from './components/layout/TabNav'
import { BriefingTab } from './components/tabs/BriefingTab'
import { TareasTab } from './components/tabs/TareasTab'
import { EquipoTab } from './components/tabs/EquipoTab'
import { MetodologiaTab } from './components/tabs/MetodologiaTab'
import { AuditoriaTab } from './components/tabs/AuditoriaTab'
import { ConfigDrawer } from './components/overlays/ConfigDrawer'
import { AccountModal } from './components/overlays/AccountModal'
import { TierEditor } from './components/overlays/TierEditor'
import { SplashScreen } from './components/overlays/SplashScreen'

function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        gap: '16px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--sans)',
          fontWeight: 900,
          letterSpacing: '-0.04em',
          fontSize: '48px',
          color: 'var(--ink-800)',
          lineHeight: 1,
        }}
      >
        Blackwell<span style={{ fontSize: '0.22em', fontWeight: 600, position: 'relative', top: '-1.1em', opacity: 0.85 }}>®</span>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--char)' }}>
        Cargando datos…
      </div>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '40px' }}>
      <div className="pane-card" style={{ maxWidth: '480px', width: '100%' }}>
        <div style={{ color: 'var(--crimson)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>Error al cargar datos</div>
        <p style={{ fontSize: '13px', color: 'var(--graphite)', lineHeight: 1.6 }}>{message}</p>
        <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '10px', fontFamily: 'var(--mono)' }}>
          Verifica que los archivos JSON estén en <code>public/data/</code> y recarga la página.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: '16px', background: 'var(--ink-800)', color: 'var(--paper-bright)', border: 'none', padding: '8px 14px', borderRadius: '2px', fontSize: '13px', cursor: 'pointer' }}
        >
          Recargar
        </button>
      </div>
    </div>
  )
}

function Dashboard() {
  const { currentTab, loading, dataError } = useApp()

  if (loading) return <LoadingScreen />
  if (dataError) return <ErrorScreen message={dataError} />

  return (
    <div
      style={{
        maxWidth: '1380px',
        margin: '0 auto',
        padding: '36px 48px 100px',
      }}
    >
      <TopBar />
      <TabNav />

      {currentTab === 'briefing'    && <BriefingTab />}
      {currentTab === 'tareas'      && <TareasTab />}
      {currentTab === 'equipo'      && <EquipoTab />}
      {currentTab === 'metodologia' && <MetodologiaTab />}
      {currentTab === 'auditoria'   && <AuditoriaTab />}

      {/* Footer */}
      <footer
        style={{
          marginTop: '32px',
          paddingTop: '18px',
          borderTop: '2px solid var(--ink-900)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          fontFamily: 'var(--mono)',
          fontSize: '10.5px',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--ink-700)',
        }}
      >
        <span>Proyecto Blackwell · v3.6</span>
        <span>BW · Doc · 05 · Semáforo</span>
      </footer>

      {/* Overlays */}
      <ConfigDrawer />
      <AccountModal />
      <TierEditor />
      <SplashScreen />
    </div>
  )
}

export default function App() {
  return <Dashboard />
}
