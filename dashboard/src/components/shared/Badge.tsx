import type { AccountColor } from '../../types'

interface BadgeProps {
  variant?: AccountColor | 'litigio' | 'nueva' | 'ondemand' | 'concluido' | 'cell-a' | 'cell-b' | string
  children: React.ReactNode
  className?: string
}

export function Badge({ variant, children, className = '' }: BadgeProps) {
  return (
    <span className={`badge ${variant || ''} ${className}`}>
      {children}
    </span>
  )
}

interface StatusDotProps {
  color: AccountColor | string
  className?: string
}

export function StatusDot({ color, className = '' }: StatusDotProps) {
  return <span className={`dot ${color} ${className}`} />
}
