import type {
  DesktopNoteExportFormat,
  DesktopNoteTransferState,
} from '@memorilo/desktop-api'
import { desktopRequests } from '../../shared/desktop-requests'

const pollIntervalMs = 100

function isTerminal(state: DesktopNoteTransferState): boolean {
  return state.phase === 'saved'
    || state.phase === 'imported'
    || state.phase === 'markdown'
    || state.phase === 'cancelled'
    || state.phase === 'failed'
}

export async function waitForNoteTransfer(
  operationId: string,
  onState?: (state: DesktopNoteTransferState) => void,
  signal?: AbortSignal,
): Promise<DesktopNoteTransferState> {
  while (true) {
    signal?.throwIfAborted()
    const state = await desktopRequests.getNoteTransfer(operationId)
    onState?.(state)
    if (isTerminal(state))
      return state
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, pollIntervalMs)
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(signal.reason instanceof Error ? signal.reason : new Error('Note transfer cancelled'))
      }, { once: true })
    })
  }
}

export async function runNoteExport(
  format: DesktopNoteExportFormat,
  noteId: string,
  onState?: (state: DesktopNoteTransferState) => void,
  signal?: AbortSignal,
  onStart?: (operationId: string) => void,
): Promise<Extract<DesktopNoteTransferState, { kind: 'export' }>> {
  const started = await desktopRequests.startNoteExport({ format, noteId })
  onStart?.(started.operationId)
  const state = await waitForNoteTransfer(started.operationId, onState, signal)
  if (state.kind !== 'export')
    throw new Error('Note export operation returned an import state')
  return state
}

export async function prepareNoteImport(
  onState?: (state: DesktopNoteTransferState) => void,
  signal?: AbortSignal,
  onStart?: (operationId: string) => void,
): Promise<Extract<DesktopNoteTransferState, { kind: 'import' }>> {
  const started = await desktopRequests.prepareNoteImport()
  onStart?.(started.operationId)
  const state = await waitForNoteTransfer(started.operationId, onState, signal)
  if (state.kind !== 'import')
    throw new Error('Note import operation returned an export state')
  return state
}
