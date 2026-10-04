import { Button } from '@memorilo/ui'
import { Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type NoteExportFormat = 'pdf'

export function NoteExportMenu({
  exporting,
  onCancelExport,
  onExport,
}: {
  exporting: boolean
  onCancelExport: () => void
  onExport: (format: NoteExportFormat) => void
}) {
  const { t } = useTranslation(['editor', 'common'])
  return (
    <>
      <Button aria-busy={exporting} aria-label={t('exportPdf')} data-window-no-drag="" disabled={exporting} title={t('exportPdf')} variant="titlebar" onClick={() => onExport('pdf')}>
        <Download aria-hidden="true" size={17} strokeWidth={1.9} />
      </Button>
      {exporting
        ? (
            <Button aria-label={t('cancel', { ns: 'common' })} data-window-no-drag="" title={t('cancel', { ns: 'common' })} variant="titlebar" onClick={onCancelExport}>
              <X aria-hidden="true" size={16} strokeWidth={1.9} />
            </Button>
          )
        : null}
    </>
  )
}
