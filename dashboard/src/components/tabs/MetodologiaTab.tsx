export function MetodologiaTab() {
  return (
    <section className="pane-card">
      <h2 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--ink-900)', letterSpacing: '-0.01em', marginBottom: '16px' }}>
        Metodología — Playbook v1.0
      </h2>
      <p style={{ marginBottom: '16px', color: 'var(--graphite)', lineHeight: 1.6 }}>
        Drive es la fuente de verdad. Lo que no está en Drive no existió para el semáforo.
      </p>

      <div style={{ marginBottom: '20px' }}>
        <h3 className="section-label" style={{ marginBottom: '10px' }}>Fórmula del score</h3>
        <pre style={{ fontFamily: 'var(--mono)', background: 'var(--bg)', padding: '10px 14px', borderRadius: '4px', fontSize: '12.5px', overflowX: 'auto', color: 'var(--ink-900)' }}>
          Global = CO × 37.5% + PQ × 25% + SC × 37.5%
        </pre>
        <p style={{ marginTop: '8px', color: 'var(--graphite)', lineHeight: 1.6, fontSize: '13px' }}>
          El Playbook define <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px', borderRadius: '2px' }}>CO×30% + SF×20% + PQ×20% + SC×30%</code>. La Salud Financiera (SF) es responsabilidad exclusiva de dirección y queda fuera del semáforo de consultoría, así que se reparten esos tres ejes manteniendo su proporción 30 : 20 : 30 → 37.5% : 25% : 37.5%.
        </p>
        <p style={{ marginTop: '8px', color: 'var(--graphite)', lineHeight: 1.6, fontSize: '13px' }}>
          Cap rule: si <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px', borderRadius: '2px' }}>CO &lt; 45</code> o{' '}
          <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px', borderRadius: '2px' }}>SC &lt; 50</code>, el global se capa a 64 (naranja). Calidad sin cumplimiento es riesgo.
        </p>
        <p style={{ marginTop: '8px', color: 'var(--graphite)', lineHeight: 1.6, fontSize: '13px' }}>
          Si <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px', borderRadius: '2px' }}>01_Contrato_OC</code> está vacía, <strong>CO arranca en 0</strong> hasta que se suba el contrato, la OC o la propuesta aceptada: sin base no hay entregables comprometidos que medir.
        </p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3 className="section-label" style={{ marginBottom: '10px' }}>Indicadores</h3>
        <ul style={{ paddingLeft: '20px', lineHeight: 1.7, color: 'var(--graphite)', fontSize: '13px' }}>
          <li><strong>CO</strong> — Cumplimiento Operativo. Entregables a tiempo en 02_Entregables, contrato firmado en 01, agenda en 06.</li>
          <li><strong>PQ</strong> — Performance / Calidad. Tier de medio + narrativa + métricas. Depende sobre todo de 03_Reportes_Avance.</li>
          <li><strong>SC</strong> — Satisfacción del Cliente. Señales positivas vs negativas registradas. Fuente: 04_Conversaciones_WA + 05_Transcripciones.</li>
        </ul>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3 className="section-label" style={{ marginBottom: '10px' }}>Tier de medios</h3>
        <ul style={{ paddingLeft: '20px', lineHeight: 1.7, color: 'var(--graphite)', fontSize: '13px' }}>
          <li><strong>Tier 1:</strong> Reforma, El Universal, Milenio, Excélsior, El Financiero, La Razón, Animal Político, Aristegui, Proceso, Loret, López-Dóriga, Latinus, Forbes México</li>
          <li><strong>Tier 2:</strong> El Heraldo, La Jornada, Reporte Indigo, Político Mx, El Sol de México, La Crónica, regionales mayores</li>
          <li><strong>Tier 3:</strong> Trades verticales, portales secundarios, blogs</li>
        </ul>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3 className="section-label" style={{ marginBottom: '10px' }}>Reglas de exclusión del score</h3>
        <ul style={{ paddingLeft: '20px', lineHeight: 1.7, color: 'var(--graphite)', fontSize: '13px' }}>
          <li>Sufijo <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px' }}>/Proyecto concluido</code> → cuenta historical, fuera del score.</li>
          <li>Sufijo <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px' }}>/Pausa</code> o <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px' }}>/Detenido</code> → status paused, fuera del score.</li>
          <li>Sufijo <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px' }}>/Evento único</code> → trabajo discreto, fuera del score.</li>
          <li><code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px' }}>cadenceType: on-demand</code> → activa pero no se penaliza por baja cadencia semanal.</li>
        </ul>
      </div>

      <div>
        <h3 className="section-label" style={{ marginBottom: '10px' }}>Convención de nombres de archivo</h3>
        <pre style={{ fontFamily: 'var(--mono)', background: 'var(--bg)', padding: '10px 14px', borderRadius: '4px', fontSize: '12.5px', color: 'var(--ink-900)' }}>
          [CLIENTE]_[Tipo]_[YYYYMMDD].pdf
        </pre>
        <p style={{ marginTop: '8px', color: 'var(--graphite)', lineHeight: 1.6, fontSize: '13px' }}>
          Ejemplo: <code style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg)', padding: '1px 5px' }}>AZVI_Nota_20260418.pdf</code>. El validador en pestaña Equipo flagea archivos que se desvían.
        </p>
      </div>
    </section>
  )
}
