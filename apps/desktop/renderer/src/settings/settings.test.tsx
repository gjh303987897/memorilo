import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DesktopConfigurationEnvironment } from '../app/configuration/configuration-environment'
import { createRendererConfigurationStore } from '../app/configuration/configuration-store'
import { Settings } from './settings'

describe('settings renderer', () => {
  it('renders the configuration prototype and updates it without Electron', async () => {
    expect(window.desktop).toBeUndefined()

    const store = await createRendererConfigurationStore()
    const rendered = render(
      <DesktopConfigurationEnvironment store={store}>
        <Settings store={store} />
      </DesktopConfigurationEnvironment>,
    )

    expect(rendered.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    const contentScroll = rendered.container.querySelector('[data-settings-content-scroll]')
    expect(contentScroll).not.toBeNull()
    expect(getComputedStyle(contentScroll as HTMLElement).flexGrow).toBe('1')
    expect(getComputedStyle(rendered.getByRole('main')).height).toBe(`${window.innerHeight}px`)
    fireEvent.click(rendered.getByRole('radio', { name: 'Monday' }))
    await waitFor(() => expect(store.getSnapshot().weekStart).toBe('monday'))

    fireEvent.click(rendered.getByRole('button', { name: 'Calendar' }))
    expect(await rendered.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument()
    const blankTaskDuration = rendered.getByRole('spinbutton', { name: 'Empty slot task duration' })
    const workdayStart = rendered.getByLabelText('Timeline workday starts at')
    const workdayEnd = rendered.getByLabelText('Timeline workday ends at')
    fireEvent.change(blankTaskDuration, { target: { value: '45' } })
    fireEvent.blur(blankTaskDuration)
    await waitFor(() => expect(store.getSnapshot().todo.blankTaskDurationMinutes).toBe(45))
    fireEvent.change(workdayStart, { target: { value: '08:30' } })
    await waitFor(() => expect(store.getSnapshot().todo.timelineWorkdayStartMinutes).toBe(510))
    fireEvent.change(workdayEnd, { target: { value: '19:15' } })
    await waitFor(() => expect(store.getSnapshot().todo.timelineWorkdayEndMinutes).toBe(1_155))
    const recurringTaskCompletion = rendered.getByRole('combobox', { name: 'After completing a recurring task' })
    fireEvent.change(recurringTaskCompletion, { target: { value: 'move-next-to-due-date' } })
    await waitFor(() => expect(store.getSnapshot().todo.recurringTaskCompletionAction).toBe('move-next-to-due-date'))

    fireEvent.click(rendered.getByRole('button', { name: 'Sync' }))
    expect(await rendered.findByRole('heading', { name: 'Sync' })).toBeInTheDocument()
    expect(rendered.getByRole('heading', { name: 'Sync Server' })).toBeInTheDocument()
    expect(rendered.getByText('P2P sync')).toBeInTheDocument()
    expect(rendered.getByRole('button', { name: 'Allow discovery for 5 minutes' })).toBeDisabled()

    fireEvent.click(rendered.getByRole('button', { name: 'Notes & Editor' }))
    expect(await rendered.findByRole('heading', { name: 'Notes & Editor' })).toBeInTheDocument()

    fireEvent.click(rendered.getByRole('button', { name: 'Media & Storage' }))
    expect(await rendered.findByRole('heading', { name: 'Media & Storage' })).toBeInTheDocument()

    fireEvent.click(rendered.getByRole('button', { name: 'Reading' }))
    expect(await rendered.findByRole('heading', { name: 'Reading' })).toBeInTheDocument()
    fireEvent.click(rendered.getByRole('radio', { name: 'Single page' }))
    await waitFor(() => expect(store.getSnapshot().readerPageMode).toBe('single-page'))
    const copyFormat = rendered.getByRole('combobox', { name: 'Highlight copy format' })
    fireEvent.change(copyFormat, { target: { value: 'text-book-location' } })
    await waitFor(() => expect(store.getSnapshot().readerAnnotationCopyFormat).toBe('text-book-location'))

    fireEvent.click(rendered.getByRole('button', { name: 'MCP' }))
    expect(await rendered.findByRole('heading', { name: 'MCP' })).toBeInTheDocument()
    const accessToken = rendered.getByLabelText('MCP access token')
    expect(accessToken).toHaveAttribute('type', 'password')
    const token = '0123456789abcdef0123456789abcdef'
    fireEvent.change(accessToken, { target: { value: token } })
    fireEvent.blur(accessToken)
    await waitFor(() => expect(store.getSnapshot().mcp.accessToken).toBe(token))

    fireEvent.click(rendered.getByRole('switch', { name: 'Enable MCP server' }))
    await waitFor(() => expect(store.getSnapshot().mcp.enabled).toBe(true))

    fireEvent.click(rendered.getByRole('button', { name: 'General' }))
    await rendered.findByRole('heading', { name: 'General' })
    const localizedLanguage = rendered.getByRole('combobox', { name: 'Language' })
    fireEvent.change(localizedLanguage, { target: { value: 'zh-CN' } })
    await waitFor(() => expect(store.getSnapshot().language).toBe('zh-CN'))
    expect(document.documentElement.lang).toBe('zh-CN')

    fireEvent.click(rendered.getByRole('switch', { name: 'Reduce motion' }))
    await waitFor(() => expect(store.getSnapshot().reduceMotion).toBe(true))
    expect(document.documentElement).toHaveAttribute('data-reduce-motion', 'true')

    store.close()
  })
})
