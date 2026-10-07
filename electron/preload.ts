import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Chrome real para cadastro
  openChromeSignup: (data: any) => ipcRenderer.send('open-chrome-signup', data),
  chromeInjectCredentials: (data: { email: string; pass: string; profileId: string }) =>
    ipcRenderer.send('chrome-inject-credentials', data),
  chromeInjectCode: (data: { code: string; profileId: string }) =>
    ipcRenderer.send('chrome-inject-code', data),
  closeChromeSession: (profileId: string) => ipcRenderer.send('close-chrome-session', profileId),
  preLoginGoogle: (data: { profileId: string; email: string; pass: string; partnerId?: string }) =>
    ipcRenderer.invoke('pre-login-google', data),

  // 2FA request relay: Chrome Real → Electron → React
  onChromeRequest2FA: (cb: (data: { profileId: string }) => void) =>
    ipcRenderer.on('chrome-request-2fa', (_e: Electron.IpcRendererEvent, data: { profileId: string }) => cb(data)),

  // Auth/connection status: Chrome Real → Electron → React
  onChromeAuthStatus: (cb: (data: { profileId: string; isLoggedIn: boolean }) => void) =>
    ipcRenderer.on('chrome-auth-status', (_e: Electron.IpcRendererEvent, data: { profileId: string; isLoggedIn: boolean }) => cb(data)),

  // Security audit: Redirecionamento de tentativas de acesso bloqueadas
  onChromeBlockedAttempt: (cb: (data: { profileId: string; url: string; redirectedTo: string; timestamp: string }) => void) =>
    ipcRenderer.on('chrome-blocked-attempt', (_e: Electron.IpcRendererEvent, data: { profileId: string; url: string; redirectedTo: string; timestamp: string }) => cb(data)),

  // Chrome events
  onChromeReady: (cb: (data: { profileId: string }) => void) =>
    ipcRenderer.on('chrome-ready', (_e: Electron.IpcRendererEvent, data: { profileId: string }) => cb(data)),
  onChromePageLoaded: (cb: (data: { profileId: string }) => void) =>
    ipcRenderer.on('chrome-page-loaded', (_e: Electron.IpcRendererEvent, data: { profileId: string }) => cb(data)),
  onChromeInjected: (cb: (data: { profileId: string; emailFilled: boolean; passFilled: boolean }) => void) =>
    ipcRenderer.on('chrome-injected', (_e: Electron.IpcRendererEvent, data: { profileId: string; emailFilled: boolean; passFilled: boolean }) => cb(data)),
  onChromeClosed: (cb: (data: { profileId: string }) => void) =>
    ipcRenderer.on('chrome-closed', (_e: Electron.IpcRendererEvent, data: { profileId: string }) => cb(data)),

  // Session management & duplicate protection
  getRunningChromeSessions: () => ipcRenderer.invoke('get-running-chrome-sessions'),
  onChromeAlreadyRunning: (cb: (data: { profileId: string }) => void) =>
    ipcRenderer.on('chrome-already-running', (_e: Electron.IpcRendererEvent, data: { profileId: string }) => cb(data)),
  onChromeSessionsUpdated: (cb: (activeProfileIds: string[]) => void) =>
    ipcRenderer.on('chrome-sessions-updated', (_e: Electron.IpcRendererEvent, activeProfileIds: string[]) => cb(activeProfileIds)),
  // Download e Publicação Automática em Segundo Plano (Cofre Seguro Criptografado)
  downloadVideo: (data: { videoUrl: string; profileName: string; filename: string }) =>
    ipcRenderer.invoke('download-video', data),
  autoPublishVideo: (data: {
    jobId: string;
    videoLocalPath: string;
    title: string;
    caption: string;
    hashtags: string[];
    platforms: Array<'tiktok' | 'youtube' | 'facebook' | 'instagram'>;
    accountCode?: string;
    partnerId?: string;
    pageUrl?: string;
    runInBackground?: boolean;
  }) => ipcRenderer.invoke('auto-publish-video', data),
  onPublishProgress: (cb: (data: {
    jobId: string;
    platform: string;
    status: 'uploading' | 'captioning' | 'publishing' | 'done' | 'error';
    progress: number;
    message: string;
  }) => void) =>
    ipcRenderer.on('publish-progress', (_e: Electron.IpcRendererEvent, data: any) => cb(data)),
  prepareManualVideo: (data: { vaultPath: string; filename?: string }) =>
    ipcRenderer.invoke('prepare-manual-video', data),
  cleanupManualVideo: (data: { tempPath: string }) =>
    ipcRenderer.invoke('cleanup-manual-video', data),
  showNotification: (data: { title?: string; body?: string }) =>
    ipcRenderer.send('show-notification', data),

  // Chrome check & External URL
  checkChromeInstalled: () => ipcRenderer.invoke('check-chrome-installed'),
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Webview legado (KioskModal)
  openTikTokSignup: (url: string) => ipcRenderer.send('open-tiktok-signup', url),
  injectCredentials: (data: { email: string; pass: string }) =>
    ipcRenderer.send('inject-credentials', data),
  injectVerificationCode: (code: string) =>
    ipcRenderer.send('inject-verification-code', code),
  closeTikTokSession: () => ipcRenderer.send('close-tiktok-session'),
});
