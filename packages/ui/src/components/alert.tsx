import type * as stylex from '@stylexjs/stylex'
import type { HTMLAttributes, ReactNode } from 'react'
import * as stylexRuntime from '@stylexjs/stylex'
import { alertStyles } from './alert.stylex'

export type AlertVariant = 'error' | 'info' | 'success' | 'warning'

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style'> {
  children?: ReactNode
  variant?: AlertVariant
  xstyle?: stylex.StyleXStyles
}

export function Alert({ children, role, variant = 'info', xstyle, ...props }: AlertProps) {
  return (
    <div
      {...props}
      {...stylexRuntime.props(alertStyles.root, alertStyles[variant], xstyle)}
      data-state={variant}
      data-ui="alert"
      role={role ?? (variant === 'error' ? 'alert' : 'status')}
    >
      {children}
    </div>
  )
}
