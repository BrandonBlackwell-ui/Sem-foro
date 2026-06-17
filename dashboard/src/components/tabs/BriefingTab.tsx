import { GaugeCard } from '../briefing/GaugeCard'
import { TopStrategicList } from '../briefing/TopStrategicList'
import { KpiStrip } from '../briefing/KpiStrip'
import { DecisionsBlock } from '../briefing/DecisionsBlock'
import { FilterChips } from '../briefing/FilterChips'
import { MasterTable } from '../briefing/MasterTable'
import { WhatsAppRadar } from '../briefing/WhatsAppRadar'

export function BriefingTab() {
  return (
    <section>
      {/* Zone A: Gauge + Top/Estratégicas */}
      <div
        className="zone-a-grid"
        style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '18px', marginBottom: '24px' }}
      >
        <GaugeCard />
        <TopStrategicList />
      </div>

      {/* Zone A2: Distribución del portafolio (columna completa) */}
      <div style={{ marginBottom: '24px' }}>
        <KpiStrip />
      </div>

      {/* Zone A3: Decisiones requeridas (columna completa) */}
      <div style={{ marginBottom: '24px' }}>
        <DecisionsBlock />
      </div>

      {/* Zone B: Master table */}
      <div style={{ marginBottom: '24px' }}>
        <FilterChips />
        <MasterTable />
      </div>

      {/* Zone B2: WhatsApp Radar */}
      <WhatsAppRadar />
    </section>
  )
}
