import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import process from 'node:process'
import { BrowserWindow } from 'electron'

export interface SettingsWindowController {
  close: () => void
  show: () => void
}

export function createSettingsWindowController(mainDirectory: string): SettingsWindowController {
  let settingsWindow: BrowserWindow | null = null
  const shouldShowWindow = process.env.MEMORILO_E2E_HIDE_WINDOW !== '1'

  const show = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (settingsWindow.isMinimized())
        settingsWindow.restore()
      if (shouldShowWindow) {
        settingsWindow.show()
        settingsWindow.focus()
      }
      return
    }

    const macOSOptions: BrowserWindowConstructorOptions = process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 20, y: 20 },
        }
      : {}
    settingsWindow = new BrowserWindow({
      autoHideMenuBar: process.platform !== 'darwin',
      backgroundColor: '#ffffff',
      fullscreenable: false,
      height: 560,
      maximizable: false,
      minimizable: false,
      minHeight: 480,
      minWidth: 680,
      resizable: true,
      show: false,
      title: 'Memorilo Settings',
      width: 780,
      ...macOSOptions,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(mainDirectory, '../preload/index.cjs'),
        sandbox: true,
      },
    })

    if (shouldShowWindow)
      settingsWindow.once('ready-to-show', () => settingsWindow?.show())
    settingsWindow.on('closed', () => {
      settingsWindow = null
    })
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl) {
      const baseUrl = rendererUrl.endsWith('/') ? rendererUrl : `${rendererUrl}/`
      void settingsWindow.loadURL(new URL('settings.html', baseUrl).toString())
    }
    else {
      void settingsWindow.loadFile(join(mainDirectory, '../renderer/settings.html'))
    }
  }

  const close = (): void => {
    const current = settingsWindow
    settingsWindow = null
    if (current && !current.isDestroyed())
      current.destroy()
  }

  return { close, show }
}
