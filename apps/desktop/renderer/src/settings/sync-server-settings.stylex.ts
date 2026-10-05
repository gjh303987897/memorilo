import * as stylex from '@stylexjs/stylex'

export const syncServerSettingsStyles = stylex.create({
  root: {
    display: 'grid',
    gap: 16,
    marginBottom: 16,
  },
  section: {
    display: 'grid',
    gap: 12,
  },
  feedback: {
    minHeight: 22,
    paddingInline: 4,
    fontSize: 12,
    lineHeight: '16px',
  },
})
