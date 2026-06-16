interface SparkLineProps {
  values: (number | null)[]
  height?: number
}

// Gráfica de tendencia tipo línea con punto en el último valor.
// Escala min–max: el primer valor queda abajo y el máximo arriba, de modo
// que una serie acumulativa se ve siempre subiendo (o plana si no hay cambio).
export function SparkLine({ values, height = 18 }: SparkLineProps) {
  if (!values || values.length === 0) return null
  const points = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null && p.v !== undefined)
  if (points.length === 0) return null

  const width = Math.min(Math.max(values.length * 9, 56), 110)
  const pad = 3
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const max = Math.max(...points.map(p => p.v))
  const min = Math.min(...points.map(p => p.v))
  const range = max - min

  const x = (i: number) =>
    values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * innerW
  const y = (v: number) =>
    range === 0 ? height / 2 : pad + innerH - ((v - min) / range) * innerH

  const last = points[points.length - 1]

  // Con un solo dato (cuenta sin histórico todavía) se dibuja una línea plana
  // para que la gráfica siempre sea visible.
  const single = points.length === 1
  const coords = single
    ? [`${pad},${(height / 2).toFixed(1)}`, `${(width - pad).toFixed(1)},${(height / 2).toFixed(1)}`]
    : points.map(p => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
  const dotX = single ? width - pad : x(last.i)
  const dotY = single ? height / 2 : y(last.v)

  return (
    <svg
      className="spark-line"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <polyline
        points={coords.join(' ')}
        fill="none"
        style={{ stroke: 'var(--ink-500)', strokeWidth: 1.5, opacity: single ? 0.55 : 0.9 }}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={dotX}
        cy={dotY}
        r={2}
        style={{ fill: 'var(--ink-500)' }}
      />
    </svg>
  )
}
