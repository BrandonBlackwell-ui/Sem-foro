import { useApp } from '../../context/AppContext'
import type { ThemeId, RoleId } from '../../types'

export function ConfigDrawer() {
  const { configOpen, closeConfig, theme, setTheme, currentRole, setCurrentRole, syncData, clearAllOverrides, openSplash } = useApp()

  const syncedAt = syncData.syncedAt
  const dt = syncedAt ? syncedAt.replace('T', ' ').slice(0, 16) : null

  function downloadOffline() {
    const a = document.createElement('a')
    a.href = '/'
    a.download = `blackwell-dashboard-${new Date().toISOString().slice(0, 10)}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <>
      {/* Backdrop */}
      {configOpen && (
        <div
          onClick={closeConfig}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(14,27,69,0.45)',
            zIndex: 60,
            backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Drawer */}
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(380px, 92vw)',
          background: 'var(--panel)',
          borderLeft: '1px solid var(--ink-800)',
          padding: '24px 28px',
          overflow: 'auto',
          zIndex: 65,
          transform: configOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <h2
          style={{
            fontSize: '22px',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--ink-900)',
            paddingBottom: '8px',
            borderBottom: '2px solid var(--ink-900)',
            marginBottom: '8px',
          }}
        >
          Configuración
        </h2>

        {/* Theme */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-700)', fontWeight: 600 }}>
            Tema
          </label>
          <select
            value={theme}
            onChange={e => setTheme(e.target.value as ThemeId)}
            style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '2px', padding: '8px 12px', fontSize: '13px', color: 'var(--ink-900)' }}
          >
            <option value="light">Claro</option>
            <option value="dark">Oscuro</option>
          </select>
        </div>

        {/* Role */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-700)', fontWeight: 600 }}>
            Vista
          </label>
          <select
            value={currentRole}
            onChange={e => setCurrentRole(e.target.value as RoleId)}
            style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule)', borderRadius: '2px', padding: '8px 12px', fontSize: '13px', color: 'var(--ink-900)' }}
          >
            <option value="leadership">Liderazgo (Daniel · Esteban)</option>
            <option value="management">Resumen ejecutivo (H · F)</option>
            <option value="consultor">Vista consultor</option>
          </select>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--char)', lineHeight: 1.5, letterSpacing: '0.02em' }}>
            Cambia las secciones visibles según el rol.
          </p>
        </div>

        {/* Sync info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-700)', fontWeight: 600 }}>
            Datos del sync
          </label>
          <button
            onClick={downloadOffline}
            style={{ background: 'var(--ink-800)', color: 'var(--paper-bright)', border: '1px solid var(--ink-800)', borderRadius: '2px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer' }}
          >
            Descargar versión offline
          </button>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--char)', lineHeight: 1.5, letterSpacing: '0.02em' }}>
            {dt ? `Último sync: ${dt} UTC · ${syncData.accounts.length} cuentas` : 'Sin sync disponible'}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-700)', fontWeight: 600 }}>
            Acciones
          </label>
          <button
            onClick={() => { openSplash(); closeConfig() }}
            style={{ background: 'var(--ink-800)', color: 'var(--paper-bright)', border: '1px solid var(--ink-800)', borderRadius: '2px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer' }}
          >
            Mostrar resumen del día
          </button>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--char)', lineHeight: 1.5, letterSpacing: '0.02em' }}>
            Vuelve a abrir el splash con el resumen del portafolio.
          </p>
          <button
            onClick={clearAllOverrides}
            style={{ marginTop: '8px', background: 'transparent', color: 'var(--crimson)', border: '1px solid rgba(180,58,58,0.35)', borderRadius: '2px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer' }}
          >
            Borrar todos los overrides locales
          </button>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--char)', lineHeight: 1.5, letterSpacing: '0.02em' }}>
            Remueve los overrides guardados en este navegador.
          </p>
        </div>

        {/* Version */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-700)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Versión
          </label>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--char)', lineHeight: 1.5, letterSpacing: '0.02em' }}>
            v3.6 · células A/B · splash diario · soporte active_litigation y active_new
          </p>
        </div>
      </aside>
    </>
  )
}
