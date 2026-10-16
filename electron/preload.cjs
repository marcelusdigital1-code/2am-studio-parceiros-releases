'use strict';

// ── STEALTH PATCH (Executa antes do JS da página para passar no teste de segurança da Google) ──
(function() {
  try {
    // 1. Remover flag webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete navigator.__proto__.webdriver;

    // 2. Emular navigator.userAgentData para passar no teste de High Entropy Values da Google
    const chromeBrands = [
      { brand: 'Google Chrome', version: '131' },
      { brand: 'Chromium', version: '131' },
      { brand: 'Not_A Brand', version: '24' }
    ];
    const fullBrands = [
      { brand: 'Google Chrome', version: '131.0.6778.109' },
      { brand: 'Chromium', version: '131.0.6778.109' },
      { brand: 'Not_A Brand', version: '24.0.0.0' }
    ];

    const uaData = {
      brands: chromeBrands,
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: async () => ({
        architecture: 'x86',
        bitness: '64',
        brands: fullBrands,
        fullVersionList: fullBrands,
        mobile: false,
        model: '',
        platform: 'Windows',
        platformVersion: '15.0.0',
        uaFullVersion: '131.0.6778.109'
      })
    };

    try {
      Object.defineProperty(navigator, 'userAgentData', { get: () => uaData });
    } catch(e) {}

    // 3. Emular objeto window.chrome completo
    if (!window.chrome) {
      window.chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'DISABLED', INSTALLED: 'INSTALLED', NOT_INSTALLED: 'NOT_INSTALLED' },
          RunningState: { CANNOT_RUN: 'CANNOT_RUN', READY_TO_RUN: 'READY_TO_RUN', RUNNING: 'RUNNING' }
        },
        runtime: {
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }
        },
        loadTimes: function() {},
        csi: function() {}
      };
    }

    // 4. Emular plugins do Chrome real
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ]
    });

    Object.defineProperty(navigator, 'languages', { get: () => ['pt-PT', 'pt', 'en-US', 'en'] });
  } catch (err) {}
})();

// ── Context Bridge para Render Process (React) ──────────────────────
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Chrome real para cadastro
  openChromeSignup: (data) => ipcRenderer.send('open-chrome-signup', data),
  chromeInjectCredentials: (data) => ipcRenderer.send('chrome-inject-credentials', data),
  chromeInjectCode: (data) => ipcRenderer.send('chrome-inject-code', data),
  closeChromeSession: (profileId) => ipcRenderer.send('close-chrome-session', profileId),
  preLoginGoogle: (data) => ipcRenderer.invoke('pre-login-google', data),

  // 2FA request relay: Chrome Real → Electron → React
  onChromeRequest2FA: (cb) =>
    ipcRenderer.on('chrome-request-2fa', (_e, data) => cb(data)),

  // TikTok QR stream relay: Chrome Real → Electron → React
  onTikTokQRStream: (cb) =>
    ipcRenderer.on('tiktok-qr-stream', (_e, data) => cb(data)),

  // Auth/connection status: Chrome Real → Electron → React
  onChromeAuthStatus: (cb) =>
    ipcRenderer.on('chrome-auth-status', (_e, data) => cb(data)),

  // Security audit: Redirecionamento de tentativas de acesso bloqueadas
  onChromeBlockedAttempt: (cb) =>
    ipcRenderer.on('chrome-blocked-attempt', (_e, data) => cb(data)),

  // Chrome events
  onChromeReady: (cb) =>
    ipcRenderer.on('chrome-ready', (_e, data) => cb(data)),
  onChromePageLoaded: (cb) =>
    ipcRenderer.on('chrome-page-loaded', (_e, data) => cb(data)),
  onChromeInjected: (cb) =>
    ipcRenderer.on('chrome-injected', (_e, data) => cb(data)),
  onChromeClosed: (cb) =>
    ipcRenderer.on('chrome-closed', (_e, data) => cb(data)),

  // Session management & duplicate protection
  getRunningChromeSessions: () => ipcRenderer.invoke('get-running-chrome-sessions'),
  onChromeAlreadyRunning: (cb) =>
    ipcRenderer.on('chrome-already-running', (_e, data) => cb(data)),
  onChromeSessionsUpdated: (cb) =>
    ipcRenderer.on('chrome-sessions-updated', (_e, activeProfileIds) => cb(activeProfileIds)),

  // Download e Publicação Automática em Segundo Plano (Cofre Seguro Criptografado)
  downloadVideo: (data) => ipcRenderer.invoke('download-video', data),
  autoPublishVideo: (data) => ipcRenderer.invoke('auto-publish-video', data),
  onPublishProgress: (cb) =>
    ipcRenderer.on('publish-progress', (_e, data) => cb(data)),
  prepareManualVideo: (data) => ipcRenderer.invoke('prepare-manual-video', data),
  cleanupManualVideo: (data) => ipcRenderer.invoke('cleanup-manual-video', data),
  showNotification: (data) => ipcRenderer.send('show-notification', data),
  showChromeSession: (accountCode) => ipcRenderer.invoke('show-chrome-session', accountCode),
  scrapeChannelMetrics: (data) => ipcRenderer.invoke('scrape-channel-metrics', data),
  resolvePublicProfileUrl: (data) => ipcRenderer.invoke('resolve-public-profile-url', data),

  // Acesso Remoto Seguro (Screencast CDP e Input Relay)
  startRemoteStream: (data) => ipcRenderer.invoke('start-remote-stream', data),
  stopRemoteStream: (data) => ipcRenderer.invoke('stop-remote-stream', data),
  sendRemoteInput: (data) => ipcRenderer.invoke('send-remote-input', data),
  onRemoteScreencastFrame: (cb) =>
    ipcRenderer.on('remote-screencast-frame', (_e, data) => cb(data)),
  onLoginMonitorEvent: (cb) => ipcRenderer.on('login-monitor-event', (_e, data) => cb(data)),
  onLoginScreencastFrame: (cb) => ipcRenderer.on('login-screencast-frame', (_e, data) => cb(data)),
  stopLoginScreencast: (data) => ipcRenderer.invoke('stop-login-screencast', data),

  // Chrome check & External URL
  checkChromeInstalled: () => ipcRenderer.invoke('check-chrome-installed'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  checkAccountAuth: (data) => ipcRenderer.invoke('check-account-auth', data),
  getProfilesAuthStatus: (accounts) => ipcRenderer.invoke('get-profiles-auth-status', accounts),

  // Webview legado (KioskModal)
  openTikTokSignup: (url) => ipcRenderer.send('open-tiktok-signup', url),
  injectCredentials: (data) => ipcRenderer.send('inject-credentials', data),
  injectVerificationCode: (code) => ipcRenderer.send('inject-verification-code', code),
  closeTikTokSession: () => ipcRenderer.send('close-tiktok-session'),
});

