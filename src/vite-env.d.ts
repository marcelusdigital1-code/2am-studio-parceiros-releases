/// <reference types="vite/client" />

interface ElectronAPI {
  isElectron?: boolean;

  // Chrome real para cadastro
  openChromeSignup: (data: string | {
    url: string;
    profileId: string;
    email?: string;
    pass?: string;
    googleEmail?: string;
    googlePass?: string;
    tiktokPass?: string;
    birthDate?: string;
    partnerId?: string;
    accountId?: string;
    firstName?: string;
    lastName?: string;
    gender?: string;
    platform?: 'tiktok' | 'youtube' | 'facebook' | 'instagram';
    pageUrl?: string;
    runInBackground?: boolean;
  }) => void;
  chromeInjectCredentials: (data: {
    email: string;
    pass: string;
    profileId: string;
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    gender?: string;
  }) => void;
  chromeInjectCode: (data: { code: string; profileId: string }) => void;
  closeChromeSession: (profileId: string) => void;
  preLoginGoogle: (data: { profileId: string; email: string; pass: string; partnerId?: string }) => Promise<{ success: boolean }>;

  // Chrome events
  onChromeReady: (cb: (data: { profileId: string }) => void) => void;
  onChromePageLoaded: (cb: (data: { profileId: string }) => void) => void;
  onChromeInjected: (cb: (data: { profileId: string; emailFilled: boolean; passFilled: boolean }) => void) => void;
  onChromeClosed: (cb: (data: { profileId: string }) => void) => void;
  onChromeRequest2FA: (cb: (data: { profileId: string }) => void) => void;
  onTikTokQRStream?: (cb: (data: { profileId: string; qrDataUrl: string }) => void) => void;
  onChromeAuthStatus: (cb: (data: { profileId: string; isLoggedIn: boolean }) => void) => void;
  onChromeBlockedAttempt: (cb: (data: { profileId: string; url: string; redirectedTo: string; timestamp: string }) => void) => void;

  // Session management & duplicate protection
  getRunningChromeSessions: () => Promise<string[]>;
  onChromeAlreadyRunning: (cb: (data: { profileId: string }) => void) => void;
  onChromeSessionsUpdated: (cb: (activeProfileIds: string[]) => void) => void;

  // Download e Publicação Automática em Segundo Plano
  downloadVideo: (data: {
    videoUrl: string;
    profileName: string;
    filename: string;
  }) => Promise<{ success: boolean; localPath?: string; error?: string }>;
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
  }) => Promise<{
    success: boolean;
    error?: string;
    results: Record<string, { success: boolean; error?: string; postUrl?: string }>;
  }>;
  onPublishProgress: (cb: (data: {
    jobId: string;
    platform: string;
    status: 'uploading' | 'captioning' | 'publishing' | 'done' | 'error';
    progress: number;
    message: string;
  }) => void) => void;
  prepareManualVideo: (data: { vaultPath: string; filename?: string }) => Promise<{ success: boolean; tempPath?: string; error?: string }>;
  cleanupManualVideo: (data: { tempPath: string }) => Promise<{ success: boolean; error?: string }>;
  showNotification?: (data: { title?: string; body?: string }) => void;
  showChromeSession?: (accountCode: string) => Promise<{ success: boolean; error?: string }>;
  startRemoteStream?: (data: {
    accountCode: string;
    platform?: 'tiktok' | 'youtube' | 'facebook' | 'instagram';
    pageUrl?: string;
    partnerId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  stopRemoteStream?: (data: { accountCode: string }) => Promise<{ success: boolean; error?: string }>;
  sendRemoteInput?: (data: {
    accountCode: string;
    action: 'mouse' | 'key' | 'text' | 'navigate' | 'scroll';
    data: any;
  }) => Promise<{ success: boolean; error?: string }>;
  onRemoteScreencastFrame?: (cb: (data: {
    accountCode: string;
    frame: string;
    metadata: {
      offsetTop: number;
      pageScaleFactor: number;
      deviceWidth: number;
      deviceHeight: number;
      scrollOffsetX: number;
      scrollOffsetY: number;
      timestamp?: number;
    };
  }) => void) => void;
  checkChromeInstalled?: () => Promise<{ installed: boolean; path?: string }>;
  openExternalUrl?: (url: string) => Promise<void>;
  checkForUpdates?: () => Promise<{ success: boolean; message?: string }>;
  checkAccountAuth?: (data: {
    accountCode: string;
    accountId: string;
    platform: string;
    partnerId?: string;
  }) => Promise<boolean>;
  getProfilesAuthStatus?: (accounts: Array<{
    accountCode: string;
    accountId: string;
    platform: string;
    partnerId?: string;
  }>) => Promise<Record<string, boolean>>;

  // Webview legado
  openTikTokSignup: (url: string) => void;
  injectCredentials: (data: { email: string; pass: string }) => void;
  injectVerificationCode: (code: string) => void;
  closeTikTokSession: () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
