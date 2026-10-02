import type { DesktopApi, DesktopPlatform } from './contract'
import type { DesktopIpcClient } from './ipc-contract'

export function createDesktopApi(
  platform: DesktopPlatform,
  services: DesktopIpcClient,
  subscribeConfiguration: DesktopApi['subscribeConfiguration'],
  subscribeNoteSaveRequests: DesktopApi['subscribeNoteSaveRequests'],
  subscribeNoteUpdates: DesktopApi['subscribeNoteUpdates'],
  subscribeP2pStatus: DesktopApi['subscribeP2pStatus'] = () => () => undefined,
  subscribeLearningUpdates: DesktopApi['subscribeLearningUpdates'] = () => () => undefined,
  subscribeSyncServerEvents: DesktopApi['subscribeSyncServerEvents'] = () => () => undefined,
): DesktopApi {
  const p2p = services.p2p ?? {
    approvePairing: async () => { throw new Error('P2P sync is unavailable') },
    acceptInvitation: async () => { throw new Error('P2P sync is unavailable') },
    confirmPairing: async () => { throw new Error('P2P sync is unavailable') },
    completePairing: async () => { throw new Error('P2P sync is unavailable') },
    createInvitation: async () => { throw new Error('P2P sync is unavailable') },
    enableDiscovery: async () => { throw new Error('P2P sync is unavailable') },
    getLocalDevice: async () => { throw new Error('P2P sync is unavailable') },
    getPairingRequests: async () => { throw new Error('P2P sync is unavailable') },
    getServerStatus: async () => { throw new Error('Sync Server is unavailable') },
    getStatus: async () => { throw new Error('P2P sync is unavailable') },
    installServerCredential: async () => { throw new Error('Sync Server is unavailable') },
    listDevices: async () => { throw new Error('P2P sync is unavailable') },
    listDiscoveredPeers: async () => { throw new Error('P2P sync is unavailable') },
    requestPairing: async () => { throw new Error('P2P sync is unavailable') },
    removeDevice: async () => { throw new Error('P2P sync is unavailable') },
    updateDeviceName: async () => { throw new Error('P2P sync is unavailable') },
  }
  return {
    loadWhiteboardLibrary: () => services.whiteboardLibrary.load(),
    platform,
    request: request => services.transport.fetch(request),
    saveWhiteboardLibrary: data => services.whiteboardLibrary.save(data),
    p2p,
    subscribeConfiguration,
    subscribeLearningUpdates,
    subscribeNoteSaveRequests,
    subscribeNoteUpdates,
    subscribeP2pStatus,
    subscribeSyncServerEvents,
  }
}
