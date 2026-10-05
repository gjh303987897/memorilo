import * as stylex from '@stylexjs/stylex'
import { uiColors } from '../theme.stylex'

export const alertStyles = stylex.create({
  root: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: uiColors.controlRadius,
    paddingBlock: 10,
    paddingInline: 12,
    // Fluent 2 body-1 step; the ramp has no 13px rung.
    fontSize: 14,
    lineHeight: '20px',
  },
  info: {
    backgroundColor: uiColors.statusInfoSoft,
    color: uiColors.accent,
  },
  success: {
    backgroundColor: uiColors.statusSuccessSoft,
    color: uiColors.statusSuccess,
  },
  warning: {
    backgroundColor: uiColors.statusWarningSoft,
    color: uiColors.warning,
  },
  error: {
    backgroundColor: uiColors.statusDangerSoft,
    color: uiColors.danger,
  },
})
