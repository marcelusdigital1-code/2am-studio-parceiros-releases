import { buildChromeSecurityScript, POST_LOGIN_CSS, KEYBOARD_BLOCKER_SCRIPT, type ShieldOptions } from './shieldScript.js';
import { app, BrowserWindow, ipcMain, WebContentsView, Menu, Tray, nativeImage, Notification, shell } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const electronUpdater = require('electron-updater');
const autoUpdater: AppUpdater = electronUpdater.autoUpdater || electronUpdater.default?.autoUpdater || electronUpdater;
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import WebSocket from 'ws';
import crypto from 'crypto';
import http from 'http';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── COFRE DE VÍDEOS CRIPTOGRAFADO (ANTI-FURTO / ASSET PROTECTION) ──
const VAULT_SECRET = crypto.createHash('sha256').update('PARTNER_PROPRIETARY_VAULT_KEY_2026_AGY_SECURE').digest();

// ── ENCRIPTAÇÃO DE CREDENCIAIS (AES-256-GCM) ──────────────────────────
// Chave derivada por SHA-256 — mesma usada no painel de admin para encriptar antes de gravar no Supabase
const _CK = [0x50,0x52,0x4f,0x4a,0x5f,0x50,0x41,0x52,0x43,0x5f,0x56,0x41,0x55,0x4c,0x54,0x5f,0x41,0x47,0x45,0x4e,0x54,0x5f,0x32,0x30,0x32,0x36,0x5f,0x53,0x45,0x43,0x55,0x52,0x45];
const CRED_KEY = crypto.createHash('sha256').update(Buffer.from(_CK)).digest();

/**
 * Desencripta uma credencial encriptada pelo painel de admin (AES-256-GCM).
 * Se o valor não tiver o prefixo 'AGY1:' é texto legado — devolve tal e qual.
 * Nunca lança excepção: em caso de falha devolve o valor original.
 */
function decryptCred(value: string): string {
  if (!value || typeof value !== 'string' || !value.startsWith('AGY1:')) return value; // legado / texto claro
  try {
    const raw = Buffer.from(value.slice(5), 'base64');
    const iv  = raw.subarray(0, 12);
    // Web Crypto AES-GCM: últimos 16 bytes são o auth tag
    const tag  = raw.subarray(raw.length - 16);
    const ct   = raw.subarray(12, raw.length - 16);
    const dec  = crypto.createDecipheriv('aes-256-gcm', CRED_KEY, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
  } catch {
    return value; // fallback seguro: usar valor como está
  }
}
const VAULT_DIR = path.join(
  process.env.LOCALAPPDATA || process.env.APPDATA || path.join(process.env.USERPROFILE || '', '.agent_data'),
  '.agent_vault'
);
const TEMP_VAULT_DIR = path.join(
  process.env.TEMP || path.join(VAULT_DIR, 'tmp'),
  '.agent_ephemeral'
);

const activeManualCleanups = new Map<string, () => Promise<void>>();

function encryptVaultBuffer(buffer: Buffer): Buffer {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', VAULT_SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

function decryptVaultBuffer(encryptedBuffer: Buffer): Buffer {
  const iv = encryptedBuffer.subarray(0, 16);
  const data = encryptedBuffer.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', VAULT_SECRET, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function isValidVideoBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 32) return false;

  // Rejeita HTML ou texto claro
  const headAscii = buf.subarray(0, 150).toString('ascii').toLowerCase();
  if (
    headAscii.includes('<!doctype') ||
    headAscii.includes('<html') ||
    headAscii.includes('<?xml') ||
    headAscii.includes('{"error"') ||
    headAscii.includes('sign in - google') ||
    headAscii.includes('accounts.google')
  ) {
    return false;
  }

  // 1. MP4 / MOV / M4V / 3GP (ISO Base Media File Format)
  // Bytes 4 a 7 contêm marcas como 'ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'
  const brand = buf.subarray(4, 8).toString('ascii');
  if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(brand)) {
    return true;
  }

  // 2. WebM / MKV (Matroska Container): primeiros 4 bytes = 0x1A 0x45 0xDF 0xA3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return true;
  }

  // 3. AVI (RIFF ... AVI )
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'AVI ') {
    return true;
  }

  // 4. MPEG-TS (byte de sincronização 0x47)
  if (buf[0] === 0x47) {
    return true;
  }

  // 5. FLV
  if (buf.subarray(0, 3).toString('ascii') === 'FLV') {
    return true;
  }

  return false;
}

function resolveDirectDownloadUrl(rawUrl: string): string {
  let url = rawUrl.trim();

  // Converter links do Google Drive para download direto com confirmação de vírus
  const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    const fileId = driveMatch[1];
    return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  }

  // Dropbox dl=0 -> dl=1
  if (url.includes('dropbox.com') && url.includes('dl=0')) {
    return url.replace('dl=0', 'dl=1');
  }

  return url;
}

async function getEphemeralUploadPath(sourcePath: string, customFilename?: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  if (sourcePath.endsWith('.enc') || sourcePath.includes('.agent_vault')) {
    const encBuffer = await fs.readFile(sourcePath);
    const decryptedBuffer = decryptVaultBuffer(encBuffer);

    // Validação estrita: se não for um vídeo de verdade, remove do cofre para não persistir arquivo corrompido
    if (!isValidVideoBuffer(decryptedBuffer)) {
      try {
        await fs.unlink(sourcePath);
        console.warn(`[VAULT] Arquivo corrompido/HTML removido do cofre: ${sourcePath}`);
      } catch {}
      throw new Error(
        'O arquivo baixado no cofre local não é um vídeo válido (contém página de login ou erro). ' +
        'O arquivo corrompido foi removido. Se o vídeo veio do Google Drive, certifique-se de que o arquivo está compartilhado com "Qualquer pessoa com o link pode ver".'
      );
    }

    await fs.mkdir(TEMP_VAULT_DIR, { recursive: true });

    const cleanName = (customFilename || 'video_publicacao.mp4')
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .replace(/^\.+/, '') || 'video_publicacao.mp4';
    const safeName = cleanName.toLowerCase().endsWith('.mp4') ? cleanName : `${cleanName}.mp4`;

    const ephemeralPath = path.join(
      TEMP_VAULT_DIR,
      `upload_${Date.now()}_${safeName}`
    );
    await fs.writeFile(ephemeralPath, decryptedBuffer);

    return {
      path: ephemeralPath,
      cleanup: async () => {
        try {
          if (fsSync.existsSync(ephemeralPath)) {
            // Sobrescrever com zeros para inviabilizar recuperação forense antes de deletar
            await fs.writeFile(ephemeralPath, Buffer.alloc(Math.min(decryptedBuffer.length, 65536), 0));
            await fs.unlink(ephemeralPath);
            console.log(`[VAULT] Arquivo temporário efêmero destruído: ${ephemeralPath}`);
          }
        } catch (e) {
          console.error('[VAULT CLEANUP ERROR]:', e);
        }
      }
    };
  }

  // Caminho regular legado
  return {
    path: sourcePath,
    cleanup: async () => {}
  };
}

async function cleanupLegacyUnencryptedVideos() {
  try {
    const legacyDir = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Agent', 'Videos');
    if (fsSync.existsSync(legacyDir)) {
      const entries = await fs.readdir(legacyDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(legacyDir, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await fs.readdir(fullPath);
          for (const sub of subFiles) {
            if (sub.endsWith('.mp4') || sub.endsWith('.mov') || sub.endsWith('.avi')) {
              try {
                await fs.unlink(path.join(fullPath, sub));
                console.log(`[VAULT CLEANUP] Vídeo não criptografado legado removido: ${sub}`);
              } catch {}
            }
          }
        } else if (entry.isFile() && (entry.name.endsWith('.mp4') || entry.name.endsWith('.mov'))) {
          try {
            await fs.unlink(fullPath);
            console.log(`[VAULT CLEANUP] Vídeo não criptografado legado removido: ${entry.name}`);
          } catch {}
        }
      }
    }
  } catch (err) {
    console.error('[VAULT CLEANUP LEGACY ERROR]:', err);
  }
}

let mainWindow: BrowserWindow | null = null;
let tiktokView: WebContentsView | null = null;
let globalCdpId = 0;
let tray: Tray | null = null;
let isQuitting = false;
let hasShownTrayNotification = false;

function dispatch2FARequest(payload: any, fallbackSender?: Electron.WebContents) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('chrome-request-2fa', payload);
  } else if (fallbackSender && !fallbackSender.isDestroyed()) {
    fallbackSender.send('chrome-request-2fa', payload);
  }
}

// ── Chrome Real Management ──────────────────────────────────────────
interface ChromeSession {
  process: ChildProcess;
  profileDir: string;
  ws: WebSocket | null;
  debugPort: number;
  email?: string;
  googleEmail?: string;
  pass?: string;
  birthDate?: string;
  partnerId?: string;
  accountId?: string;
  lastCode?: string;
  isLoggedIn?: boolean;
  isStudioSession?: boolean;
  firstName?: string;
  lastName?: string;
  gender?: string;
  platform?: 'tiktok' | 'youtube' | 'facebook' | 'instagram';
  pageUrl?: string;
  mainTargetId?: string;
  isSignup?: boolean;
  profileId?: string;
  runInBackground?: boolean;
  isQueueLogin?: boolean;
  launchedAt?: number;
  isPublishing?: boolean;
}

const chromeSessions = new Map<string, ChromeSession>();

// ── Sessões Ativas de Screencast CDP (Acesso Remoto Seguro pelo ADM) ──
interface ActiveScreencast {
  accountCode: string;
  session: ChromeSession;
  listener: (raw: WebSocket.Data) => void;
  lastFrameTime: number;
}
const activeScreencasts = new Map<string, ActiveScreencast>();

// ── Monitoramento Remoto de Login (ADM pode ver e intervir durante auto-login) ──
interface ActiveLoginScreencast {
  accountCode: string;
  platform: string;
  session: ChromeSession;
  listener: (raw: WebSocket.Data) => void;
  stuckTimer: NodeJS.Timeout | null;
  lastProgressTime: number;
}
const activeLoginScreencasts = new Map<string, ActiveLoginScreencast>();

/**
 * Envia evento de monitoramento de login para o renderer (que retransmite ao ADM via Supabase Realtime).
 * Tipos: login_started, login_progress, login_success, login_error, login_stuck
 */
function broadcastLoginEvent(
  partnerId: string,
  eventData: {
    type: 'login_started' | 'login_progress' | 'login_success' | 'login_error' | 'login_stuck';
    platform: string;
    accountCode: string;
    email?: string;
    detail?: string;
  }
) {
  try {
    const payload = { partnerId, timestamp: Date.now(), ...eventData };
    console.log(`[LOGIN-MONITOR] ${eventData.type.toUpperCase()}: ${eventData.platform}/@${eventData.accountCode} — ${eventData.detail || ''}`);
    mainWindow?.webContents.send('login-monitor-event', payload);
  } catch (e) {
    console.warn('[LOGIN-MONITOR] Erro ao enviar evento:', e);
  }
}

/**
 * Inicia screencast automático durante auto-login para que o ADM possa monitorar e intervir.
 * Frames são enviados via IPC para o renderer, que retransmite via Supabase Realtime.
 * Retorna função cleanup para parar o screencast.
 */
function startLoginScreencast(
  session: ChromeSession,
  accountCode: string,
  platform: string,
  partnerId: string
): (() => void) | null {
  try {
    const ws = session.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return null;

    // Limpar screencast anterior se existir
    if (activeLoginScreencasts.has(accountCode)) {
      const prev = activeLoginScreencasts.get(accountCode)!;
      try {
        prev.session.ws?.removeListener('message', prev.listener);
        cdpSend(prev.session.ws!, 'Page.stopScreencast').catch(() => {});
        if (prev.stuckTimer) clearInterval(prev.stuckTimer);
      } catch {}
      activeLoginScreencasts.delete(accountCode);
    }

    const listener = (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'Page.screencastFrame') {
          const { data, metadata, sessionId } = msg.params;

          // Enviar frame ao renderer para relay via Supabase
          mainWindow?.webContents.send('login-screencast-frame', {
            accountCode,
            platform,
            partnerId,
            frame: data,
            metadata,
          });

          // Atualizar timestamp de progresso
          const active = activeLoginScreencasts.get(accountCode);
          if (active) active.lastProgressTime = Date.now();

          // ACK com throttle de 300ms
          setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  id: ++globalCdpId,
                  method: 'Page.screencastFrameAck',
                  params: { sessionId }
                }));
              } catch {}
            }
          }, 300);
        }
      } catch {}
    };

    ws.on('message', listener);

    // Timer de detecção de login travado (60s sem progresso na página)
    const stuckTimer = setInterval(() => {
      const active = activeLoginScreencasts.get(accountCode);
      if (!active) return;
      const elapsed = Date.now() - active.lastProgressTime;
      if (elapsed > 60000) {
        broadcastLoginEvent(partnerId, {
          type: 'login_stuck',
          platform,
          accountCode,
          detail: `Login sem progresso há ${Math.round(elapsed / 1000)}s — intervenção ADM recomendada`,
        });
      }
    }, 30000);

    activeLoginScreencasts.set(accountCode, {
      accountCode,
      platform,
      session,
      listener,
      stuckTimer,
      lastProgressTime: Date.now(),
    });

    // Iniciar screencast CDP (qualidade menor para login — economia de banda)
    cdpSend(ws, 'Page.startScreencast', {
      format: 'jpeg',
      quality: 40,
      maxWidth: 900,
      maxHeight: 560,
      everyNthFrame: 2
    }).then(() => {
      console.log(`[LOGIN-MONITOR] Screencast iniciado para @${accountCode} (${platform})`);
    }).catch((err) => {
      console.warn(`[LOGIN-MONITOR] Falha ao iniciar screencast para @${accountCode}:`, err);
    });

    // Retornar função de cleanup
    return () => {
      try {
        ws.removeListener('message', listener);
        if (ws.readyState === WebSocket.OPEN) {
          cdpSend(ws, 'Page.stopScreencast').catch(() => {});
        }
        if (stuckTimer) clearInterval(stuckTimer);
        activeLoginScreencasts.delete(accountCode);
        console.log(`[LOGIN-MONITOR] Screencast encerrado para @${accountCode}`);
      } catch {}
    };
  } catch (err) {
    console.warn('[LOGIN-MONITOR] Erro ao iniciar screencast de login:', err);
    return null;
  }
}

function ensureSecurityExtension(): string {
  const extDir = path.join(app.getPath('userData'), 'security-extension');
  try {
    if (!fsSync.existsSync(extDir)) {
      fsSync.mkdirSync(extDir, { recursive: true });
    }

    const manifest = {
      manifest_version: 3,
      name: 'Partner Shield Native Layer',
      version: '1.0.0',
      description: 'Native UI Shield for Partner Chrome sessions',
      content_scripts: [
        {
          matches: [
            "*://*.tiktok.com/*",
            "*://*.youtube.com/*",
            "*://*.google.com/*",
            "*://*.facebook.com/*"
          ],
          css: ["shield.css"],
          run_at: "document_start"
        }
      ]
    };

    fsSync.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fsSync.writeFileSync(path.join(extDir, 'shield.css'), POST_LOGIN_CSS, 'utf8');
  } catch (err) {
    console.error('[SECURITY EXTENSION] Erro ao preparar extensão de segurança:', err);
  }
  return extDir;
}

function ensureProfilePreferences(profileDir: string) {
  try {
    const defaultDir = path.join(profileDir, 'Default');
    fsSync.mkdirSync(defaultDir, { recursive: true });
    const prefsPath = path.join(defaultDir, 'Preferences');
    let prefs: Record<string, any> = {};
    if (fsSync.existsSync(prefsPath)) {
      try {
        prefs = JSON.parse(fsSync.readFileSync(prefsPath, 'utf8'));
      } catch {
        prefs = {};
      }
    }
    if (!prefs.session) prefs.session = {};
    prefs.session.restore_on_startup = 1;

    if (!prefs.profile) prefs.profile = {};
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exited_cleanly = true;

    fsSync.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
  } catch (err) {
    console.warn('[PREFERENCES] Erro ao gravar Preferences:', err);
  }
}

async function saveTikTokCookies(ws: WebSocket, profileDir: string): Promise<boolean> {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    await cdpSend(ws, 'Network.enable').catch(() => {});
    const cookieRes = (await cdpSend(ws, 'Network.getCookies', {
      urls: [
        'https://www.tiktok.com',
        'https://www.tiktok.com/',
        'https://tiktok.com',
        'https://studio.tiktok.com',
        'https://www.tiktok.com/tiktokstudio',
        'https://accounts.google.com',
        'https://google.com'
      ]
    }).catch(() => null)) as { cookies?: Array<any> } | null;

    let cookies = cookieRes?.cookies || [];

    // Fallback: se nenhum cookie de sessão vier na lista de URLs, buscar globalmente
    if (!cookies.some((c) => (c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'sid_tt') && c.value && c.value.length > 10)) {
      const allCookiesRes = (await cdpSend(ws, 'Network.getCookies', {}).catch(() => null)) as { cookies?: Array<any> } | null;
      if (allCookiesRes?.cookies && allCookiesRes.cookies.length > 0) {
        cookies = allCookiesRes.cookies;
      }
    }

    const hasSessionCookie = cookies.some(
      (c) => (c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'sid_tt') && c.value && c.value.length > 10
    );

    if (!hasSessionCookie) {
      console.warn('[TIKTOK-COOKIES] Nenhum cookie de sessão TikTok encontrado para persistir.');
      return false;
    }

    // 1. Gravar em arquivo JSON local no diretório do perfil
    const cookiesFilePath = path.join(profileDir, 'tiktok_cookies.json');
    fsSync.mkdirSync(profileDir, { recursive: true });
    fsSync.writeFileSync(cookiesFilePath, JSON.stringify(cookies, null, 2), 'utf8');
    console.log(`[TIKTOK-COOKIES] ${cookies.length} cookies persistidos com sucesso em ${cookiesFilePath}`);

    // 2. Reforçar no próprio Chrome com expiração explícita de 1 ano para evitar descarte como sessão volátil
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);
    for (const c of cookies) {
      if (c.domain && c.name && c.value) {
        const cookieParams: any = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== undefined ? c.secure : true,
          httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
          expires: oneYearFromNow
        };
        if (c.sameSite) {
          cookieParams.sameSite = c.sameSite;
        }
        await cdpSend(ws, 'Network.setCookie', cookieParams).catch(() => {});
      }
    }

    return true;
  } catch (err) {
    console.error('[TIKTOK-COOKIES] Erro ao salvar cookies do TikTok:', err);
    return false;
  }
}

async function restoreTikTokCookies(ws: WebSocket, profileDir: string): Promise<boolean> {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const cookiesFilePath = path.join(profileDir, 'tiktok_cookies.json');
    if (!fsSync.existsSync(cookiesFilePath)) {
      return false;
    }
    const raw = fsSync.readFileSync(cookiesFilePath, 'utf8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return false;

    console.log(`[TIKTOK-COOKIES] Restaurando ${cookies.length} cookies para a sessão em ${profileDir}...`);
    await cdpSend(ws, 'Network.enable').catch(() => {});
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);
    for (const c of cookies) {
      if (c.domain && c.name && c.value) {
        const cookieParams: any = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== undefined ? c.secure : true,
          httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
          expires: oneYearFromNow
        };
        if (c.sameSite) {
          cookieParams.sameSite = c.sameSite;
        }
        await cdpSend(ws, 'Network.setCookie', cookieParams).catch(() => {});
      }
    }
    console.log(`[TIKTOK-COOKIES] ✅ ${cookies.length} cookies restaurados com sucesso via CDP!`);
    return true;
  } catch (err) {
    console.error('[TIKTOK-COOKIES] Erro ao restaurar cookies do TikTok:', err);
    return false;
  }
}

async function saveYouTubeCookies(ws: WebSocket, profileDir: string): Promise<boolean> {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    await cdpSend(ws, 'Network.enable').catch(() => {});

    // Obter todos os cookies da sessão inteira do Chrome (YouTube + Google)
    const allCookiesRes = (await cdpSend(ws, 'Network.getCookies', {}).catch(() => null)) as { cookies?: Array<any> } | null;
    let cookies = allCookiesRes?.cookies || [];

    if (!cookies || cookies.length === 0) {
      const cookieRes = (await cdpSend(ws, 'Network.getCookies', {
        urls: [
          'https://www.youtube.com',
          'https://studio.youtube.com',
          'https://accounts.google.com',
          'https://google.com',
          'https://myaccount.google.com'
        ]
      }).catch(() => null)) as { cookies?: Array<any> } | null;
      cookies = cookieRes?.cookies || [];
    }

    const hasAuth = cookies.some((c) =>
      (c.name === 'LOGIN_INFO' || c.name === 'SAPISID' || c.name === 'SID' || c.name === 'SSID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID') &&
      c.value && c.value.length > 10
    );

    if (!hasAuth) {
      console.warn('[YOUTUBE-COOKIES] Nenhum cookie de autenticação YouTube encontrado para persistir.');
      return false;
    }

    const cookiesFilePath = path.join(profileDir, 'youtube_cookies.json');
    fsSync.mkdirSync(profileDir, { recursive: true });
    fsSync.writeFileSync(cookiesFilePath, JSON.stringify(cookies, null, 2), 'utf8');
    console.log(`[YOUTUBE-COOKIES] ${cookies.length} cookies completos de autenticação salvos em ${cookiesFilePath}`);
    return true;
  } catch (err) {
    console.error('[YOUTUBE-COOKIES] Erro ao salvar cookies do YouTube:', err);
    return false;
  }
}

async function restoreYouTubeCookies(ws: WebSocket, profileDir: string): Promise<boolean> {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const cookiesFilePath = path.join(profileDir, 'youtube_cookies.json');
    if (!fsSync.existsSync(cookiesFilePath)) {
      return false;
    }
    const raw = fsSync.readFileSync(cookiesFilePath, 'utf8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return false;

    console.log(`[YOUTUBE-COOKIES] Restaurando ${cookies.length} cookies para a sessão em ${profileDir}...`);
    await cdpSend(ws, 'Network.enable').catch(() => {});
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);

    for (const c of cookies) {
      if (c.domain && c.name && c.value) {
        const cookieParams: any = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== undefined ? c.secure : true,
          httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
          expires: c.expires && c.expires > 0 ? c.expires : oneYearFromNow,
        };
        if (c.sameSite) {
          cookieParams.sameSite = c.sameSite;
        }
        await cdpSend(ws, 'Network.setCookie', cookieParams).catch(() => {});
      }
    }
    return true;
  } catch (err) {
    console.error('[YOUTUBE-COOKIES] Erro ao restaurar cookies do YouTube:', err);
    return false;
  }
}

async function saveInstagramCookies(ws: WebSocket, profileDir: string): Promise<boolean> {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    await cdpSend(ws, 'Network.enable').catch(() => {});

    // Obter todos os cookies da sessão inteira do Chrome (Instagram + domínios associados)
    const allCookiesRes = (await cdpSend(ws, 'Network.getCookies', {}).catch(() => null)) as { cookies?: Array<any> } | null;
    let cookies = allCookiesRes?.cookies || [];

    if (!cookies || cookies.length === 0) {
      const cookieRes = (await cdpSend(ws, 'Network.getCookies', {
        urls: [
          'https://www.instagram.com',
          'https://www.instagram.com/',
          'https://instagram.com',
          'https://i.instagram.com',
          'https://graph.instagram.com'
        ]
      }).catch(() => null)) as { cookies?: Array<any> } | null;
      cookies = cookieRes?.cookies || [];
    }

    const hasAuth = cookies.some((c) =>
      (c.name === 'sessionid' || c.name === 'ds_user_id') && c.value && c.value.length > 5
    );

    if (!hasAuth) {
      console.warn('[INSTAGRAM-COOKIES] Nenhum cookie de autenticação Instagram (sessionid/ds_user_id) encontrado para persistir.');
      return false;
    }

    const cookiesFilePath = path.join(profileDir, 'instagram_cookies.json');
    fsSync.mkdirSync(profileDir, { recursive: true });
    fsSync.writeFileSync(cookiesFilePath, JSON.stringify(cookies, null, 2), 'utf8');
    console.log(`[INSTAGRAM-COOKIES] ${cookies.length} cookies completos de autenticação salvos em ${cookiesFilePath}`);

    // Reforçar no próprio Chrome com expiração explícita de 1 ano para evitar descarte como sessão volátil
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);
    for (const c of cookies) {
      if (c.domain && c.name && c.value) {
        const cookieParams: any = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== undefined ? c.secure : true,
          httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
          expires: c.expires && c.expires > 0 ? c.expires : oneYearFromNow,
        };
        if (c.sameSite) {
          cookieParams.sameSite = c.sameSite;
        }
        await cdpSend(ws, 'Network.setCookie', cookieParams).catch(() => {});
      }
    }
    return true;
  } catch (err) {
    console.error('[INSTAGRAM-COOKIES] Erro ao salvar cookies do Instagram:', err);
    return false;
  }
}

async function restoreInstagramCookies(ws: WebSocket, profileDir: string): Promise<boolean> {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const cookiesFilePath = path.join(profileDir, 'instagram_cookies.json');
    if (!fsSync.existsSync(cookiesFilePath)) {
      return false;
    }
    const raw = fsSync.readFileSync(cookiesFilePath, 'utf8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return false;

    console.log(`[INSTAGRAM-COOKIES] Restaurando ${cookies.length} cookies para a sessão em ${profileDir}...`);
    await cdpSend(ws, 'Network.enable').catch(() => {});
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);

    for (const c of cookies) {
      if (c.domain && c.name && c.value) {
        const cookieParams: any = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== undefined ? c.secure : true,
          httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
          expires: c.expires && c.expires > 0 ? c.expires : oneYearFromNow,
        };
        if (c.sameSite) {
          cookieParams.sameSite = c.sameSite;
        }
        await cdpSend(ws, 'Network.setCookie', cookieParams).catch(() => {});
      }
    }
    console.log(`[INSTAGRAM-COOKIES] ✅ ${cookies.length} cookies restaurados com sucesso via CDP!`);
    return true;
  } catch (err) {
    console.error('[INSTAGRAM-COOKIES] Erro ao restaurar cookies do Instagram:', err);
    return false;
  }
}



async function saveFacebookCookies(ws: WebSocket, profileDir: string): Promise<boolean> {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    await cdpSend(ws, 'Network.enable').catch(() => {});

    const allCookiesRes = (await cdpSend(ws, 'Network.getCookies', {}).catch(() => null)) as { cookies?: Array<any> } | null;
    let cookies = allCookiesRes?.cookies || [];

    if (!cookies || cookies.length === 0) {
      const cookieRes = (await cdpSend(ws, 'Network.getCookies', {
        urls: [
          'https://www.facebook.com',
          'https://www.facebook.com/',
          'https://web.facebook.com',
          'https://web.facebook.com/',
          'https://facebook.com',
          'https://m.facebook.com',
          'https://business.facebook.com'
        ]
      }).catch(() => null)) as { cookies?: Array<any> } | null;
      cookies = cookieRes?.cookies || [];
    }

    const hasAuth = cookies.some((c) =>
      (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
    );

    if (!hasAuth) {
      console.warn('[FACEBOOK-COOKIES] Nenhum cookie de autenticação Facebook (c_user/xs) encontrado para persistir.');
      return false;
    }

    const cookiesFilePath = path.join(profileDir, 'facebook_cookies.json');
    fsSync.mkdirSync(profileDir, { recursive: true });
    fsSync.writeFileSync(cookiesFilePath, JSON.stringify(cookies, null, 2), 'utf8');
    console.log(`[FACEBOOK-COOKIES] ${cookies.length} cookies completos de autenticação salvos em ${cookiesFilePath}`);

    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);
    for (const c of cookies) {
      if (c.domain && c.name && c.value) {
        const cookieParams: any = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== undefined ? c.secure : true,
          httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
          expires: c.expires && c.expires > 0 ? c.expires : oneYearFromNow,
        };
        if (c.sameSite) {
          cookieParams.sameSite = c.sameSite;
        }
        await cdpSend(ws, 'Network.setCookie', cookieParams).catch(() => {});
      }
    }
    return true;
  } catch (err) {
    console.error('[FACEBOOK-COOKIES] Erro ao salvar cookies do Facebook:', err);
    return false;
  }
}

async function restoreFacebookCookies(ws: WebSocket, profileDir: string): Promise<boolean> {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const cookiesFilePath = path.join(profileDir, 'facebook_cookies.json');
    if (!fsSync.existsSync(cookiesFilePath)) {
      return false;
    }
    const raw = fsSync.readFileSync(cookiesFilePath, 'utf8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return false;

    console.log(`[FACEBOOK-COOKIES] Restaurando ${cookies.length} cookies para a sessão em ${profileDir}...`);
    await cdpSend(ws, 'Network.enable').catch(() => {});
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);

    for (const c of cookies) {
      if (c.domain && c.name && c.value) {
        const cookieParams: any = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== undefined ? c.secure : true,
          httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
          expires: c.expires && c.expires > 0 ? c.expires : oneYearFromNow,
        };
        if (c.sameSite) {
          cookieParams.sameSite = c.sameSite;
        }
        await cdpSend(ws, 'Network.setCookie', cookieParams).catch(() => {});
      }
    }
    console.log(`[FACEBOOK-COOKIES] ✅ ${cookies.length} cookies do Facebook restaurados com sucesso via CDP!`);
    return true;
  } catch (err) {
    console.error('[FACEBOOK-COOKIES] Erro ao restaurar cookies do Facebook:', err);
    return false;
  }
}

async function closeChromeSessionGracefully(session: ChromeSession, profileId: string, eventSender?: any) {
  // Salvar cookies do Facebook antes de qualquer fechamento do WebSocket e processo
  if (session.platform === 'facebook' && session.ws && session.ws.readyState === WebSocket.OPEN) {
    try {
      console.log(`[FACEBOOK] Salvando cookies antes do encerramento para ${session.profileDir}...`);
      await saveFacebookCookies(session.ws, session.profileDir);
    } catch (e) {
      console.warn('[FACEBOOK] Erro ao salvar cookies em closeChromeSessionGracefully:', e);
    }
  }

  try {
    if (session.debugPort) {
      // Enviar Browser.close para o target Browser oficial (/json/version) para checkpoint do SQLite e flush dos cookies
      const http = await import('http');
      await new Promise<void>((resolve) => {
        const req = http.default.get(`http://127.0.0.1:${session.debugPort}/json/version`, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const info = JSON.parse(data);
              if (info.webSocketDebuggerUrl) {
                const bWs = new WebSocket(info.webSocketDebuggerUrl);
                bWs.on('open', () => {
                  bWs.send(JSON.stringify({ id: 99999, method: 'Browser.close' }));
                  setTimeout(() => {
                    try { bWs.close(); } catch (_) {}
                    resolve();
                  }, 400);
                });
                bWs.on('error', () => resolve());
              } else {
                resolve();
              }
            } catch (_) { resolve(); }
          });
        });
        req.on('error', () => resolve());
        req.setTimeout(2500, () => { req.destroy(); resolve(); });
      });
    }
  } catch {}

  const pid = session.process?.pid;
  if (session.process && !session.process.killed && pid) {
    let alive = true;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
        break;
      }
    }
    if (alive) {
      console.log(`[CHROME] Processo ${pid} ainda vivo após 5s — forçando encerramento.`);
      try {
        session.process.kill();
      } catch {}
    } else {
      console.log(`[CHROME] Processo ${pid} encerrou graciosamente. Cookies salvos com sucesso.`);
    }
  }

  if (session.platform === 'facebook') {
    const partnerFbKeys: string[] = [];
    for (const [k, s] of chromeSessions.entries()) {
      if (s === session || (s.platform === 'facebook' && s.partnerId === session.partnerId)) {
        partnerFbKeys.push(k);
      }
    }
    for (const k of partnerFbKeys) {
      chromeSessions.delete(k);
      eventSender?.send('chrome-closed', { profileId: k });
      mainWindow?.webContents.send('chrome-closed', { profileId: k });
    }
  } else {
    chromeSessions.delete(profileId);
    eventSender?.send('chrome-closed', { profileId });
    mainWindow?.webContents.send('chrome-closed', { profileId });
  }
  const activeKeys = Array.from(chromeSessions.keys());
  eventSender?.send('chrome-sessions-updated', activeKeys);
  mainWindow?.webContents.send('chrome-sessions-updated', activeKeys);
}

function ensureLoginHelperExtension(profileId: string, gEmail: string, gPass: string): string {
  // Salvar em LOCALAPPDATA para garantir caminho sem espaços
  const baseDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
  const extDir = path.join(baseDir, 'agent-login-ext', profileId);
  try {
    if (!fsSync.existsSync(extDir)) {
      fsSync.mkdirSync(extDir, { recursive: true });
    }

    const manifest = {
      manifest_version: 3,
      name: 'Agent Automation Helper',
      version: '1.0.0',
      description: 'Native Helper para Login TikTok e Google',
      permissions: ['storage'],
      host_permissions: [
        '*://*.tiktok.com/*',
        '*://tiktok.com/*',
        '*://*.google.com/*',
        '*://google.com/*',
        '*://accounts.google.com/*'
      ],
      content_scripts: [
        {
          matches: [
            '*://*.tiktok.com/*',
            '*://tiktok.com/*'
          ],
          js: ['config.js', 'tiktok.js'],
          run_at: 'document_start'
        },
        {
          matches: [
            '*://accounts.google.com/*',
            '*://*.google.com/*',
            '*://google.com/*'
          ],
          js: ['config.js', 'google.js'],
          run_at: 'document_start'
        }
      ]
    };

    fsSync.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const configJS = `
      window.__LOGIN_HELPER__ = {
        email: ${JSON.stringify(gEmail)},
        pass: ${JSON.stringify(gPass)}
      };
    `;
    fsSync.writeFileSync(path.join(extDir, 'config.js'), configJS, 'utf8');

    const tiktokJS = `
      (function() {
        console.log('[AGENT-HELPER] Extensão TikTok carregada!');

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        function setBadge(msg, color) {
          try {
            let b = document.getElementById('__agent_helper_badge__');
            if (!b && document.body) {
              b = document.createElement('div');
              b.id = '__agent_helper_badge__';
              b.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#0f172a;color:#38bdf8;padding:12px 22px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:bold;box-shadow:0 8px 30px rgba(0,0,0,0.6);border:2px solid #38bdf8;pointer-events:none;display:flex;align-items:center;gap:8px;';
              document.body.appendChild(b);
            }
            if (b) {
              if (color) b.style.borderColor = color;
              b.innerHTML = '🤖 <span>' + msg + '</span>';
            }
          } catch(_) {}
        }

        async function startHelper() {
          for (let sec = 0; sec < 180; sec++) {
            if (!document.body) {
              await sleep(200);
              continue;
            }

            setBadge('Automação Ativa: Conectando via Google...');

            // 1. Fechar banner de cookies se existir
            const cookieBtn = document.querySelector('button[data-e2e="cookie-banner-decline"], button[data-e2e="cookie-banner-accept"]');
            if (cookieBtn) {
              cookieBtn.click();
            }

            // 2. Procurar botão de login com o Google
            const googleBtn = document.querySelector('div[data-e2e="channel-item-google"], div.channel-item-wrapper-google, [data-e2e="channel-item-google"]');
            if (googleBtn && googleBtn.offsetHeight > 0) {
              setBadge('Clicando em "Continuar com o Google"...', '#22c55e');
              await sleep(400);
              const clickable = googleBtn.closest('a, div[role="button"], div') || googleBtn;
              clickable.click();
              return;
            }

            // Procurar por texto
            const allElements = Array.from(document.querySelectorAll('div, p, span, a, button'));
            const googleTextEl = allElements.find(el => {
              const t = (el.textContent || '').trim().toLowerCase();
              return (t === 'continuar com o google' || t === 'continue with google') && el.offsetHeight > 0;
            });
            if (googleTextEl) {
              setBadge('Clicando em "Continuar com o Google"...', '#22c55e');
              await sleep(400);
              const clickable = googleTextEl.closest('a, div[role="button"], div') || googleTextEl;
              clickable.click();
              return;
            }

            // 3. Se estiver na home e após 3 segundos não abriu o login, clica no botão "Entrar"
            if (sec >= 3 && !window.location.pathname.includes('/login')) {
              const topLoginBtn = document.querySelector('button[data-e2e="top-login-button"], #header-login-button, a[href*="/login"], button[data-testid="tux-web-button"]');
              if (topLoginBtn && topLoginBtn.offsetHeight > 0) {
                setBadge('Clicando em "Entrar" no topo...');
                topLoginBtn.click();
                await sleep(1500);
                continue;
              }

              const loginTextBtn = allElements.find(el => {
                const t = (el.textContent || '').trim().toLowerCase();
                return (t === 'entrar' || t === 'log in' || t === 'iniciar sessão') && el.offsetHeight > 0;
              });
              if (loginTextBtn) {
                setBadge('Clicando em "Entrar"...');
                loginTextBtn.click();
                await sleep(1500);
                continue;
              }

              // Se após 6 segundos o clique não abrir o modal, navega direto para /login
              if (sec >= 6) {
                setBadge('Abrindo página de login do TikTok...');
                window.location.href = 'https://www.tiktok.com/login';
                return;
              }
            }

            await sleep(500);
          }
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', startHelper);
        } else {
          startHelper();
        }
      })();
    `;
    fsSync.writeFileSync(path.join(extDir, 'tiktok.js'), tiktokJS, 'utf8');

    const googleJS = `
      (function() {
        console.log('[AGENT-HELPER] Extensão Google carregada!');

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        function setBadge(msg, color) {
          try {
            let b = document.getElementById('__agent_helper_badge__');
            if (!b && document.body) {
              b = document.createElement('div');
              b.id = '__agent_helper_badge__';
              b.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#0f172a;color:#38bdf8;padding:12px 22px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:bold;box-shadow:0 8px 30px rgba(0,0,0,0.6);border:2px solid #38bdf8;pointer-events:none;display:flex;align-items:center;gap:8px;';
              document.body.appendChild(b);
            }
            if (b) {
              if (color) b.style.borderColor = color;
              b.innerHTML = '🤖 <span>' + msg + '</span>';
            }
          } catch(_) {}
        }

        function fillInput(input, value) {
          input.focus();
          input.value = '';
          try {
            document.execCommand('insertText', false, value);
          } catch(e) {}
          if (!input.value) {
            input.value = value;
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const email = (window.__LOGIN_HELPER__?.email || '').trim();
        const pass = (window.__LOGIN_HELPER__?.pass || '').trim();

        async function startGoogleHelper() {
          let emailDone = false;
          let passDone = false;

          for (let sec = 0; sec < 180; sec++) {
            if (!document.body) {
              await sleep(200);
              continue;
            }

            setBadge('Automação Google Ativa: Identificando campos...');

            // 1. Etapa do E-mail
            if (!emailDone && email) {
              const emailInput = document.querySelector('input[type="email"], #identifierId');
              if (emailInput && emailInput.offsetHeight > 0 && !emailInput.disabled) {
                setBadge('Preenchendo E-mail Google...');
                await sleep(800);
                fillInput(emailInput, email);
                await sleep(500);
                const nextBtn = document.querySelector('#identifierNext button, #identifierNext, button[data-idom-class*="nCP5yc"]');
                if (nextBtn) {
                  setBadge('Avançando para a senha...', '#22c55e');
                  nextBtn.click();
                  emailDone = true;
                  await sleep(2000);
                  continue;
                }
              }
            }

            // 2. Etapa da Senha
            if (emailDone && !passDone && pass) {
              const passInput = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"]');
              if (passInput && passInput.offsetHeight > 0 && !passInput.disabled) {
                setBadge('Preenchendo Senha...');
                await sleep(1000);
                fillInput(passInput, pass);
                await sleep(500);
                const nextBtn = document.querySelector('#passwordNext button, #passwordNext, button[data-idom-class*="nCP5yc"]');
                if (nextBtn) {
                  setBadge('Concluindo Login Google...', '#22c55e');
                  nextBtn.click();
                  passDone = true;
                  await sleep(2000);
                  break;
                }
              }
            }

            await sleep(600);
          }
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', startGoogleHelper);
        } else {
          startGoogleHelper();
        }
      })();
    `;
    fsSync.writeFileSync(path.join(extDir, 'google.js'), googleJS, 'utf8');

  } catch (err) {
    console.error('[LOGIN EXTENSION] Erro:', err);
  }
  return extDir;
}

async function injectSecurityShieldToSession(
  ws: WebSocket,
  options: ShieldOptions = {}
): Promise<void> {
  try {
    await cdpSend(ws, 'Page.enable');
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'DOM.enable');
    await cdpSend(ws, 'Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }).catch(() => {});
    await cdpSend(ws, 'Target.setDiscoverTargets', {
      discover: true,
    }).catch(() => {});
    await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', {
      source: `try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch(_) {}`,
    }).catch(() => {});

    const shieldScript = buildChromeSecurityScript(options);
    await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', {
      source: shieldScript,
    });
    await cdpSend(ws, 'Runtime.evaluate', {
      expression: shieldScript,
    });
    console.log('[SECURITY SHIELD] Blindagem geral estrita ativada com sucesso');
  } catch (err) {
    console.error('[SECURITY SHIELD] Falha ao ativar blindagem:', err);
  }
}

function attachSecurityListenersToWs(
  ws: WebSocket,
  session: ChromeSession,
  platform: 'tiktok' | 'youtube' | 'facebook' | 'instagram'
) {
  ws.on('message', (raw: WebSocket.Data) => {
    try {
      const msg = JSON.parse(raw.toString());
      // 1. Fechar popups externos não autorizados (exceto Google OAuth para TikTok)
      if (msg.method === 'Target.targetCreated' || msg.method === 'Target.attachedToTarget') {
        const targetInfo = msg.params?.targetInfo;
        if (targetInfo && targetInfo.type === 'page' && targetInfo.targetId && targetInfo.targetId !== session.mainTargetId) {
          const popupUrl = (targetInfo.url || '').toLowerCase();
          // Para TikTok, permitir popup do Google OAuth APENAS durante o fluxo inicial de autenticação
          if (platform === 'tiktok' && !session.isLoggedIn) {
            const isAllowedTikTokPopup = !popupUrl || popupUrl === 'about:blank' || popupUrl.includes('google') || popupUrl.includes('tiktok');
            if (isAllowedTikTokPopup) {
              console.log(`[TIKTOK] Popup permitido para fluxo de autenticação: ${targetInfo.url || 'about:blank'}`);
              return;
            }
          }
          console.log(`[SECURITY] Fechando popup externo não autorizado: ${targetInfo.url || ''}`);
          cdpSend(ws, 'Target.closeTarget', { targetId: targetInfo.targetId }).catch(() => {});
        }
      }

      // 2. Redirecionar em caso de navegação proibida
      if (msg.method === 'Page.frameNavigated') {
        if (msg.params?.frame?.parentId) return;
        const navUrl = (msg.params?.frame?.url || '').toLowerCase();
        // Re-injetar imediatamente na nova página com os dados reais da sessão
        const shield = buildChromeSecurityScript({
          isSignup: Boolean(session.isSignup),
          email: session.email,
          pass: session.pass,
          birthDate: session.birthDate,
          firstName: session.firstName,
          lastName: session.lastName,
          gender: session.gender,
          lastCode: session.lastCode,
          pageUrl: session.pageUrl || '',
          isPublishing: Boolean(session.isPublishing),
        });
        cdpSend(ws, 'Runtime.evaluate', { expression: shield }).catch(() => {});

        if (platform === 'tiktok') {
          const isStudio = navUrl.includes('studio.tiktok.com') || navUrl.includes('/tiktokstudio');
          if (session.isLoggedIn) {
            // BLINDAGEM ESTREITA ANTI-FURTO: Bloquear Gmail, Google Account ou qualquer domínio externo
            if (navUrl.includes('google.com') || navUrl.includes('gmail.com') || !navUrl.includes('tiktok.com')) {
              console.log(`[SECURITY] Acesso a Google/Gmail proibido para o parceiro (${navUrl}) -> Redirecionando para Studio`);
              cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/' }).catch(() => {});
              return;
            }

            if (isStudio) {
              const isStudioAllowed =
                navUrl.startsWith('https://studio.tiktok.com') ||
                navUrl.startsWith('https://www.tiktok.com/tiktokstudio') ||
                navUrl.startsWith('https://tiktok.com/tiktokstudio') ||
                navUrl.includes('/upload') ||
                navUrl.includes('/content') ||
                navUrl.includes('/manage') ||
                navUrl.includes('/analytics') ||
                navUrl.includes('/comments') ||
                navUrl.includes('/home') ||
                navUrl.includes('/overview');
              if (!isStudioAllowed && !session.isSignup) {
                console.log(`[SECURITY] TikTok Studio URL proibida (${navUrl}) -> Redirecionando para Studio`);
                cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/' }).catch(() => {});
              }
            } else if (
              navUrl.includes('tiktok.com') &&
              !navUrl.includes('/upload') &&
              !session.isSignup
            ) {
              console.log(`[SECURITY] TikTok Web URL proibida após autenticação (${navUrl}) -> Redirecionando para Studio`);
              cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/' }).catch(() => {});
            }
          } else {
            // Sessão NÃO logada: permitir tiktok.com/, modals de login, passport, phone/email sem redirecionar
            // Isso permite que o feed do TikTok carregue vídeos, telemetria de bot e o modal de login normalmente
          }
          // Permitir navegação para accounts.google.com durante o login TikTok via Google
          if (navUrl.includes('accounts.google.com') && platform === 'tiktok') {
            // Não bloquear — runGoogleAutoLogin() no shieldScript trata o login automaticamente
          }
        } else if (platform === 'youtube') {
          if ((navUrl.includes('/monetization') || navUrl.includes('/earn') || navUrl.includes('/settings') || navUrl.includes('/copyright') || navUrl.includes('myaccount.google.com')) && !session.isSignup) {
            console.log(`[SECURITY] YouTube Studio URL proibida (${navUrl}) -> Redirecionando para Studio`);
            cdpSend(ws, 'Page.navigate', { url: 'https://studio.youtube.com' }).catch(() => {});
          }
        } else if (platform === 'facebook') {
          const safeFb = (session.pageUrl && session.pageUrl.trim()) ? session.pageUrl.trim() : 'https://www.facebook.com/pages/';
          // Nunca redirecionar URLs de autenticação Facebook
          const isFbAuthUrl =
            navUrl.includes('/login') || navUrl.includes('/checkpoint') ||
            navUrl.includes('/two_factor') || navUrl.includes('/recover') ||
            navUrl.includes('/help') || navUrl.includes('/r.php') ||
            navUrl.includes('/dialog/') || navUrl.includes('/oauth');
          if (isFbAuthUrl) {
            // Deixar fluir normalmente (login automático vai tratar)
          } else {
            const isFbRestricted =
              navUrl.includes('/monetization') || navUrl.includes('/payouts') ||
              navUrl.includes('/billing') || navUrl.includes('/settings') ||
              navUrl.includes('accountscenter') ||
              navUrl.includes('/security') || navUrl.includes('/privacy');
            // Só redirecionar se o usuário já estiver logado (evita loop infinito de redirecionamentos)
            if (isFbRestricted && session.isLoggedIn && !session.isSignup) {
              console.log(`[SECURITY] Facebook URL proibida (${navUrl}) -> Redirecionando para ${safeFb}`);
              cdpSend(ws, 'Page.navigate', { url: safeFb }).catch(() => {});
            }
          }
        } else if (platform === 'instagram') {
          // Permitir sempre URLs de autenticação
          const isIgAuth =
            navUrl.includes('/accounts/login') || navUrl.includes('/accounts/emailsignup') ||
            navUrl.includes('/challenge/') || navUrl.includes('/two_factor') ||
            navUrl.includes('/accounts/professional_account');
          if (isIgAuth) return;
          // Bloquear configurações, DMs, ads (Explorar é permitido)
          const isIgRestricted =
            (navUrl.includes('/accounts/') && !navUrl.includes('/accounts/professional_account')) ||
            navUrl.includes('/direct/') ||
            navUrl.includes('/ads/') ||
            navUrl.includes('/shop/') ||
            navUrl.includes('/shopping/');
          if (isIgRestricted && !session.isSignup) {
            console.log(`[SECURITY] Instagram URL proibida (${navUrl}) → Redirecionando para feed`);
            cdpSend(ws, 'Page.navigate', { url: 'https://www.instagram.com/' }).catch(() => {});
          }
        }
      }
    } catch {}
  });
}


let nextDebugPort = 9300;
function getNextDebugPort(): number {
  nextDebugPort = nextDebugPort >= 9800 ? 9300 : nextDebugPort + 1;
  return nextDebugPort;
}

function isChromeInstalled(): { installed: boolean; path?: string } {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ]
    : [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
      ];
  for (const p of candidates) {
    try {
      fsSync.accessSync(p);
      return { installed: true, path: p };
    } catch {}
  }
  return { installed: false };
}

function findChromePath(): string {
  const check = isChromeInstalled();
  if (check.installed && check.path) {
    return check.path;
  }
  return process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chrome';
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function cdpSend(
  ws: WebSocket,
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string,
  customTimeoutMs?: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error(`CDP socket is not open (readyState: ${ws ? ws.readyState : 'null'})`));
    }
    const id = ++globalCdpId;
    const timeoutDuration = customTimeoutMs || 25000;
    let timeout: NodeJS.Timeout | null = null;
    const handler = (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === id) {
          if (timeout) clearTimeout(timeout);
          ws.removeListener('message', handler);
          if (msg.error) {
            reject(new Error(msg.error.message || 'CDP error'));
          } else {
            resolve(msg.result);
          }
        }
      } catch {}
    };
    timeout = setTimeout(() => {
      try { ws.removeListener('message', handler); } catch (_) {}
      reject(new Error(`CDP timeout: ${method}`));
    }, timeoutDuration);

    ws.on('message', handler);
    try {
      const payload: Record<string, unknown> = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    } catch (err) {
      if (timeout) clearTimeout(timeout);
      try { ws.removeListener('message', handler); } catch (_) {}
      reject(err);
    }
  });
}

// IPC legado mantido para compatibilidade
ipcMain.handle('pre-login-google', async () => {
  return { success: true };
});

// ── Helper: Observador de Popups Externos Autorizados (ex: Google OAuth no TikTok) ──
function startPopupWatcher(session: ChromeSession) {
  const activePopupWs = new Map<string, WebSocket>();
  let isScanning = false;

  const popupInterval = setInterval(async () => {
    if (!session.process || session.process.killed || (session.ws && session.ws.readyState !== WebSocket.OPEN && session.ws.readyState !== WebSocket.CONNECTING)) {
      activePopupWs.forEach((pWs) => {
        try { pWs.close(); } catch (_) {}
      });
      activePopupWs.clear();
      clearInterval(popupInterval);
      return;
    }

    if (isScanning) return;
    isScanning = true;

    try {
      const http = await import('http');
      const tabs = await new Promise<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string; title?: string }>>((resolve, reject) => {
        const req = http.default.get(`http://127.0.0.1:${session.debugPort}/json/list`, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.setTimeout(2500, () => { req.destroy(); reject(new Error('timeout')); });
      });

      const currentPopupIds = new Set<string>();

      for (const tab of tabs) {
        if (!tab.id || tab.id === session.mainTargetId) continue;
        if (tab.type !== 'page' && tab.type !== 'app') continue;

        const tabUrl = (tab.url || '').toLowerCase();
        const tabTitle = (tab.title || '').toLowerCase();

        // NUNCA fechar popups de autenticação Google ou páginas em transição OAuth
        const isGooglePopup =
          tabUrl.includes('accounts.google.') ||
          tabUrl.includes('google.com') ||
          tabUrl.includes('oauth') ||
          tabTitle.includes('google') ||
          tabTitle.includes('contas') ||
          tabTitle.includes('iniciar sessão') ||
          tabTitle.includes('fazer login') ||
          tabTitle.includes('sign in') ||
          tabUrl === 'about:blank' ||
          tabUrl === '';

        if (isGooglePopup) {
          currentPopupIds.add(tab.id);
          continue;
        }

        // Fechar apenas popups não autorizados que não sejam do Google
        console.warn(`[POPUP WATCHER] Fechando popup externo nao autorizado: ${tab.url || tab.title}`);
        http.default.get(`http://127.0.0.1:${session.debugPort}/json/close/${tab.id}`).on('error', () => {});
      }

      for (const [pId, pWs] of activePopupWs.entries()) {
        if (!currentPopupIds.has(pId)) {
          try { pWs.close(); } catch (_) {}
          activePopupWs.delete(pId);
          if (session.platform === 'tiktok') {
            console.log('[POPUP WATCHER] Popup fechado após login — aguardando confirmação da sessão na aba principal...');
            // Polling seguro: aguarda a escrita real do cookie de sessão (sessionid)
            // sem nunca abortar a requisição de login em andamento
            let checkAttempts = 0;
            const sessionCheckInterval = setInterval(async () => {
              checkAttempts++;
              if (checkAttempts > 20 || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
                clearInterval(sessionCheckInterval);
                return;
              }
              try {
                const evalRes = (await cdpSend(session.ws, 'Runtime.evaluate', {
                  expression: `(function() {
                    var c = document.cookie || '';
                    var hasC = c.includes('sessionid=') || c.includes('sessionid_ss=') || c.includes('sid_tt=');
                    var hasNav = !window.location.href.includes('/login') && !window.location.href.includes('/signup');
                    return hasC || hasNav;
                  })()`,
                  returnByValue: true,
                })) as { result?: { value?: boolean } };

                if (evalRes?.result?.value) {
                  clearInterval(sessionCheckInterval);
                  session.isLoggedIn = true;
                  console.log('[TIKTOK] Sessão confirmada com sucesso! Navegando para TikTok Studio...');
                  if (session.profileId) {
                    mainWindow?.webContents.send('chrome-auth-status', { profileId: session.profileId, isLoggedIn: true });
                  }
                  setTimeout(async () => {
                    try {
                      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                        await cdpSend(session.ws, 'Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/' });
                      }
                    } catch (_) {}
                  }, 800);
                }
              } catch (_) {}
            }, 1000);
          }
        }
      }
    } catch (_) {
    } finally {
      isScanning = false;
    }
  }, 1000);
}


// ── Helper: Obter caminho físico e executável para scripts PowerShell (extrai de app.asar se necessário) ──
function getExecutableScriptPath(scriptName: string): string | null {
  const candidates = [
    path.join(__dirname, scriptName),
    path.join(__dirname, '../electron', scriptName),
    path.join(process.resourcesPath || '', scriptName),
    path.join(process.resourcesPath || '', 'app.asar.unpacked/dist-electron', scriptName),
  ];
  for (const cand of candidates) {
    try {
      if (fsSync.existsSync(cand)) {
        // Se estiver dentro de um arquivo .asar, extrair para userData para o powershell.exe conseguir ler do disco físico
        if (cand.includes('.asar')) {
          const content = fsSync.readFileSync(cand, 'utf8');
          const dest = path.join(app.getPath('userData'), scriptName);
          fsSync.writeFileSync(dest, content, 'utf8');
          return dest;
        }
        return cand;
      }
    } catch {}
  }
  return null;
}

// ── Helper: Ocultar / Mostrar processo do Chrome na Barra de Tarefas (Windows) ou Dock (macOS) ──
function setProcessTaskbarVisibility(pid?: number, show: boolean = false) {
  if (!pid) return;
  if (process.platform === 'win32') {
    const targetScript = getExecutableScriptPath('hideTaskbar.ps1');
    if (targetScript) {
      try {
        const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', targetScript, '-TargetPid', String(pid)];
        if (show) args.push('-Show');
        spawn('powershell.exe', args, {
          windowsHide: true,
          stdio: 'ignore',
          detached: true,
        }).unref();
      } catch {}
    }
  } else if (process.platform === 'darwin') {
    // No macOS: ocultar/mostrar Chrome via AppleScript
    try {
      const script = show
        ? 'tell application "System Events" to set visible of process "Google Chrome" to true'
        : 'tell application "System Events" to set visible of process "Google Chrome" to false';
      spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
    } catch {}
  }
}

// ── Helper: Garantir que qualquer janela ou popup do Chrome permaneça fora da tela em segundo plano ──
function startBackgroundWindowKeeper(pid?: number) {
  if (!pid) return;
  if (process.platform === 'win32') {
    const targetScript = getExecutableScriptPath('backgroundWindowKeeper.ps1');
    if (targetScript) {
      try {
        const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', targetScript, '-TargetPid', String(pid)];
        spawn('powershell.exe', args, {
          windowsHide: true,
          stdio: 'ignore',
          detached: true,
        }).unref();
        console.log(`[BACKGROUND] backgroundWindowKeeper iniciado para PID ${pid}`);
      } catch (e) {
        console.warn('[BACKGROUND] Erro ao iniciar backgroundWindowKeeper:', e);
      }
    }
  } else if (process.platform === 'darwin') {
    // No macOS: periodicamente ocultar Chrome (a cada 3s por 30s)
    let count = 0;
    const interval = setInterval(() => {
      if (count++ >= 10) { clearInterval(interval); return; }
      try {
        spawn('osascript', ['-e',
          'tell application "System Events" to set visible of process "Google Chrome" to false'
        ], { stdio: 'ignore', detached: true }).unref();
      } catch {}
    }, 3000);
    console.log(`[BACKGROUND] backgroundWindowKeeper (macOS) iniciado para PID ${pid}`);
  }
}

// ── Helper: Manter foco em segundo plano sem exibir janela física na tela ──
async function bringChromeToForegroundBriefly(pid?: number, ws?: WebSocket) {
  // Mantém o Chrome 100% invisível em segundo plano — NÃO move nem restaura a janela física na tela
  if (ws && ws.readyState === WebSocket.OPEN) {
    await cdpSend(ws, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  }
}

// ── Helper: Retornar foco ao app principal sem alterar posição da janela do Chrome ──
async function returnChromeToBackground(pid?: number) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }
}

function createTray() {
  if (tray) return;

  const candidatePaths = [
    path.join(__dirname, '../public/tray-icon.png'),
    path.join(__dirname, '../dist/tray-icon.png'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../dist/icon.ico'),
    path.join(__dirname, '../public/logo.png'),
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, 'tray-icon.png'),
  ];

  let iconPath = '';
  for (const p of candidatePaths) {
    if (fsSync.existsSync(p)) {
      iconPath = p;
      break;
    }
  }

  let trayIcon: Electron.NativeImage;
  if (iconPath) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    trayIcon = getAppIcon();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('2AM Studio Parceiros — Ativo em Segundo Plano');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir 2AM Studio Parceiros',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      },
    },
    {
      label: 'Status: Online (Segundo Plano)',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Sair do Aplicativo',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createMainWindow();
    }
  });

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createMainWindow();
    }
  });
}

function getAppIcon(): Electron.NativeImage {
  const candidatePaths = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../dist/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, '../public/logo.png'),
    path.join(__dirname, '../dist/logo.png'),
    path.join(__dirname, 'icon.ico'),
  ];
  for (const p of candidatePaths) {
    if (fsSync.existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img;
      } catch (_) {}
    }
  }
  return nativeImage.createEmpty();
}

function createMainWindow() {
  Menu.setApplicationMenu(null);
  const appIcon = getAppIcon();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: !appIcon.isEmpty() ? appIcon : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
    title: '2AM Studio Parceiros',
    backgroundColor: '#141210',
    show: false,
  });
  mainWindow.setMenu(null);
  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

  // Abertura segura de links externos no navegador padrão do sistema operacional
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();

      if (!hasShownTrayNotification) {
        hasShownTrayNotification = true;
        if (process.platform === 'win32' && tray && typeof tray.displayBalloon === 'function') {
          tray.displayBalloon({
            title: '2AM Studio Parceiros',
            content: 'O 2AM Studio Parceiros continua ativo em segundo plano para publicações e sincronização.',
            iconType: 'info',
          });
        } else if (Notification.isSupported()) {
          new Notification({
            title: '2AM Studio Parceiros',
            body: 'O 2AM Studio Parceiros continua ativo em segundo plano para publicações e sincronização.',
          }).show();
        }
      }
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (tiktokView) {
      tiktokView = null;
    }
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[AUTO-UPDATER] Modo desenvolvimento: ignorando checagem de atualizações.');
    return;
  }

  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      console.log('[AUTO-UPDATER] Verificando se há atualizações disponíveis...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[AUTO-UPDATER] Atualização encontrada:', info.version);
      if (Notification.isSupported()) {
        new Notification({
          title: '2AM Studio Parceiros',
          body: `Nova versão (${info.version}) disponível! O download foi iniciado em segundo plano.`,
        }).show();
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AUTO-UPDATER] Atualização baixada com sucesso:', info.version);
      if (Notification.isSupported()) {
        new Notification({
          title: '2AM Studio Parceiros — Atualização Pronta',
          body: `A versão ${info.version} foi baixada e será instalada automaticamente ao reiniciar o aplicativo.`,
        }).show();
      }
    });

    autoUpdater.on('error', (err) => {
      console.warn('[AUTO-UPDATER] Erro na checagem de atualizações:', err?.message || err);
    });

    // Checagem inicial após 12 segundos da inicialização
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.warn('[AUTO-UPDATER] Erro na checagem inicial:', err?.message || err);
      });
    }, 12000);

    // Checagem periódica a cada 4 horas
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.warn('[AUTO-UPDATER] Erro na checagem periódica:', err?.message || err);
      });
    }, 4 * 60 * 60 * 1000);
  } catch (e) {
    console.warn('[AUTO-UPDATER] Falha ao configurar autoUpdater:', e);
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.twodam.studio.parceiros');
  }
  createMainWindow();
  createTray();
  setupAutoUpdater();
  cleanupLegacyUnencryptedVideos().catch(console.error);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

// ── Anti-Detecção de Automação: ocultar navigator.webdriver do TikTok e outras plataformas ──
// Page.addScriptToEvaluateOnNewDocument via CDP roda ANTES de qualquer script da página.
app.on('web-contents-created', (_event, contents) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wc = contents as any;
  if (typeof wc.getType === 'function' && wc.getType() === 'webview') {
    wc.on('did-attach', () => {
      try { wc.debugger.attach('1.3'); } catch { /* already attached */ }
      try {
        wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: [
            '(function(){',
            '  try{ Object.defineProperty(navigator,"webdriver",{get:()=>undefined,configurable:true}); }catch(e){}',
            '  try{',
            '    var orig=navigator.permissions&&navigator.permissions.query&&navigator.permissions.query.bind(navigator.permissions);',
            '    if(orig){ Object.defineProperty(navigator.permissions,"query",{ value:function(p){ return p.name==="notifications"?Promise.resolve({state:Notification.permission}):orig(p); }, configurable:true }); }',
            '  }catch(e){}',
            '  try{ if(!window.chrome){ Object.defineProperty(window,"chrome",{value:{runtime:{}},configurable:true}); } }catch(e){}',
            '})();',
          ].join('\n'),
        });
      } catch { /* CDP unavailable */ }
    });
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Permanece em execução em segundo plano no Tray
});

ipcMain.on('show-notification', (_event, { title, body }: { title?: string; body?: string }) => {
  if (Notification.isSupported()) {
    const candidatePaths = [
      path.join(__dirname, '../dist/tray-icon.png'),
      path.join(__dirname, '../public/tray-icon.png'),
    ];
    let iconPath: string | undefined = undefined;
    for (const p of candidatePaths) {
      if (fsSync.existsSync(p)) {
        iconPath = p;
        break;
      }
    }

    new Notification({
      title: title || '2AM Studio Parceiros',
      body: body || '',
      icon: iconPath,
    }).show();
  }
});

// IPC: Mostrar sessão Chrome ao parceiro (bloqueado: publicação executada estritamente em segundo plano)
ipcMain.handle('show-chrome-session', async (_event, _accountCode: string) => {
  console.log(`[SHOW CHROME] Pré-visualização desativada: publicação executada estritamente em segundo plano.`);
  return { success: false, error: 'A publicação automática é executada estritamente em segundo plano. Pré-visualização de janela desativada.' };
});

// ── IPC: Iniciar Transmissão de Tela em Tempo Real (CDP Screencast) ──
ipcMain.handle('start-remote-stream', async (event, {
  accountCode,
  platform,
  pageUrl,
  partnerId
}: {
  accountCode: string;
  platform?: 'tiktok' | 'youtube' | 'facebook' | 'instagram';
  pageUrl?: string;
  partnerId?: string;
}) => {
  try {
    console.log(`[REMOTE STREAM] Solicitação de acesso remoto recebida para @${accountCode} (${platform || 'youtube'})`);
    
    // 1. Localizar sessão Chrome existente ou lançar se ainda não estiver aberta
    let session: ChromeSession | null | undefined = chromeSessions.get(accountCode);
    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
      // Procurar por correspondência parcial
      for (const [key, s] of chromeSessions.entries()) {
        if ((key.includes(accountCode) || accountCode.includes(key)) && s.ws && s.ws.readyState === WebSocket.OPEN) {
          session = s;
          break;
        }
      }
    }

    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
      console.log(`[REMOTE STREAM] Sessão não aberta. Lançando Chrome automaticamente para ${accountCode}...`);
      session = await launchChromeForAccount(
        accountCode,
        platform || 'youtube',
        true, // Abre em segundo plano (invisível em -32000,-32000 no PC do parceiro)
        partnerId,
        pageUrl
      );
    }

    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'Não foi possível estabelecer conexão CDP com o Chrome.' };
    }

    // Se já havia um screencast ativo para esta conta, limpar listener anterior
    if (activeScreencasts.has(accountCode)) {
      const prev = activeScreencasts.get(accountCode)!;
      try {
        prev.session.ws?.removeListener('message', prev.listener);
        await cdpSend(prev.session.ws!, 'Page.stopScreencast');
      } catch {}
      activeScreencasts.delete(accountCode);
    }

    const ws = session.ws;
    const targetAccountCode = accountCode;

    const listener = (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'Page.screencastFrame') {
          const { data, metadata, sessionId } = msg.params;

          if (!event.sender.isDestroyed()) {
            event.sender.send('remote-screencast-frame', {
              accountCode: targetAccountCode,
              frame: data,
              metadata,
            });
          }

          // Throttle natural: esperar 200ms antes de confirmar frame
          // Garante fluxo suave de ~5 FPS sem sobrecarregar WebSocket ou CPU
          setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  id: ++globalCdpId,
                  method: 'Page.screencastFrameAck',
                  params: { sessionId }
                }));
              } catch {}
            }
          }, 200);
        }
      } catch {}
    };

    ws.on('message', listener);
    activeScreencasts.set(accountCode, {
      accountCode,
      session,
      listener,
      lastFrameTime: Date.now(),
    });

    // Iniciar screencast no Chrome via CDP
    await cdpSend(ws, 'Page.startScreencast', {
      format: 'jpeg',
      quality: 50,
      maxWidth: 1024,
      maxHeight: 640,
      everyNthFrame: 1
    });

    console.log(`[REMOTE STREAM] Transmissão CDP iniciada com sucesso para @${accountCode}`);
    return { success: true };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Erro ao iniciar transmissão remota';
    console.error('[REMOTE STREAM ERROR]:', errMsg);
    return { success: false, error: errMsg };
  }
});

// ── IPC: Encerrar Transmissão de Tela e Fechar Janela do Chrome no Parceiro ──
ipcMain.handle('stop-remote-stream', async (event, { accountCode }: { accountCode: string }) => {
  try {
    const active = activeScreencasts.get(accountCode);
    if (active) {
      if (active.session.ws && active.session.ws.readyState === WebSocket.OPEN) {
        try {
          active.session.ws.removeListener('message', active.listener);
          await cdpSend(active.session.ws, 'Page.stopScreencast');
        } catch {}
      }
      activeScreencasts.delete(accountCode);
    }

    // Encerrar e fechar completamente o processo do Chrome no PC do parceiro
    let session = chromeSessions.get(accountCode);
    if (!session) {
      for (const [key, s] of chromeSessions.entries()) {
        if (key.includes(accountCode) || accountCode.includes(key)) {
          session = s;
          break;
        }
      }
    }

    if (session) {
      console.log(`[REMOTE STREAM] Encerrando Chrome de ${accountCode} a pedido do ADM...`);
      const pid = session.process?.pid;

      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        try {
          await cdpSend(session.ws, 'Browser.close');
        } catch {}
        try { session.ws.close(); } catch {}
      }

      if (session.process && !session.process.killed) {
        try { session.process.kill(); } catch {}
      }

      // Garantir que toda a árvore de processos do Chrome é finalizada
      if (pid) {
        try {
          const { execSync } = await import('child_process');
          if (process.platform === 'win32') {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
          } else {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          }
        } catch {}
      }

      for (const [k, s] of chromeSessions.entries()) {
        if (s === session || k === accountCode || k.includes(accountCode) || accountCode.includes(k)) {
          chromeSessions.delete(k);
        }
      }
      event.sender.send('chrome-closed', { profileId: accountCode });
      event.sender.send('chrome-sessions-updated', Array.from(chromeSessions.keys()));
    }

    console.log(`[REMOTE STREAM] Transmissão e janela do Chrome encerradas com sucesso para @${accountCode}`);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao parar transmissão' };
  }
});

// ── IPC: Encerrar Screencast de Monitoramento de Login ──
ipcMain.handle('stop-login-screencast', async (_event, { accountCode }: { accountCode: string }) => {
  try {
    const active = activeLoginScreencasts.get(accountCode);
    if (active) {
      if (active.session.ws && active.session.ws.readyState === WebSocket.OPEN) {
        try {
          active.session.ws.removeListener('message', active.listener);
          await cdpSend(active.session.ws, 'Page.stopScreencast');
        } catch {}
      }
      if (active.stuckTimer) clearInterval(active.stuckTimer);
      activeLoginScreencasts.delete(accountCode);
      console.log(`[LOGIN-MONITOR] Screencast de login encerrado para @${accountCode} (via IPC)`);
    }
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao parar screencast de login' };
  }
});

// ── IPC: Executar Comandos de Input Remoto no Chrome via CDP (Clique, Digitação, Teclas) ──
ipcMain.handle('send-remote-input', async (_event, {
  accountCode,
  action,
  data
}: {
  accountCode: string;
  action: 'mouse' | 'key' | 'text' | 'navigate' | 'scroll';
  data: any;
}) => {
  let session = chromeSessions.get(accountCode);
  if (!session) {
    for (const [key, s] of chromeSessions.entries()) {
      if (key.includes(accountCode) || accountCode.includes(key)) {
        session = s;
        break;
      }
    }
  }

  if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
    return { success: false, error: 'Sessão Chrome não está conectada via CDP' };
  }

  try {
    const ws = session.ws;
    if (action === 'mouse') {
      const isWheel = data.type === 'mouseWheel';
      // Dispara evento físico de mouse no Chrome
      await cdpSend(ws, 'Input.dispatchMouseEvent', {
        type: data.type, // 'mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel'
        x: Math.round(Number(data.x) || 0),
        y: Math.round(Number(data.y) || 0),
        button: isWheel ? 'none' : (data.button || 'left'),
        clickCount: isWheel ? 0 : (data.clickCount ?? 1),
        deltaX: isWheel ? Math.round(Number(data.deltaX) || 0) : 0,
        deltaY: isWheel ? Math.round(Number(data.deltaY) || 0) : 0,
      });
    } else if (action === 'scroll') {
      // Ação dedicada de rolagem
      const deltaX = Math.round(Number(data.deltaX) || 0);
      const deltaY = Math.round(Number(data.deltaY) || 0);
      const x = Math.round(Number(data.x) || 600);
      const y = Math.round(Number(data.y) || 400);

      await cdpSend(ws, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        button: 'none',
        clickCount: 0,
        deltaX,
        deltaY,
      });
    } else if (action === 'key') {
      // Dispara tecla física (Enter, Tab, Backspace, etc.)
      await cdpSend(ws, 'Input.dispatchKeyEvent', {
        type: data.type, // 'rawKeyDown', 'keyUp', 'char'
        key: data.key,
        code: data.code,
        text: data.text,
        windowsVirtualKeyCode: data.windowsVirtualKeyCode,
      });
    } else if (action === 'text') {
      // Inserção direta de texto no campo ativo (senhas, emails, código de verificação)
      await cdpSend(ws, 'Input.insertText', {
        text: data.text || ''
      });
    } else if (action === 'navigate') {
      if (data.url) {
        await cdpSend(ws, 'Page.navigate', {
          url: data.url
        });
      }
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao executar input' };
  }
});

// IPC: Verificação rigorosa se o Google Chrome está instalado na máquina
ipcMain.handle('check-chrome-installed', async () => {
  return isChromeInstalled();
});

// IPC: Abertura segura de links externos no navegador padrão do usuário
ipcMain.handle('open-external-url', async (_event, url: string) => {
  if (url && typeof url === 'string') {
    await shell.openExternal(url);
  }
});

// IPC: Checagem manual de atualizações do aplicativo
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { success: false, message: 'Modo desenvolvimento não checa atualizações.' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, message: result ? 'Checagem concluída' : 'Nenhuma atualização disponível' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Erro ao checar atualizações' };
  }
});

// IPC: Verificar se uma conta específica possui flag de autenticação confirmada no disco
ipcMain.handle('check-account-auth', async (_event, { accountCode, accountId, platform, partnerId }: { accountCode: string; accountId: string; platform: string; partnerId?: string }) => {
  try {
    const baseProfileDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
    const profileDirName = (platform === 'facebook')
      ? `partner-${partnerId || 'common'}-facebook`
      : (accountId
          ? `${accountCode}-${accountId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`
          : accountCode);
    const profileDir = path.join(baseProfileDir, 'agent-windows-profiles', profileDirName);
    const flagName = platform === 'tiktok' ? 'tt_authenticated.flag'
      : platform === 'youtube' ? 'yt_authenticated.flag'
      : platform === 'instagram' ? 'ig_authenticated.flag'
      : 'fb_authenticated.flag';
    const flagExists = fsSync.existsSync(path.join(profileDir, flagName));
    if (!flagExists) return false;

    // Para Instagram, garantir que existem cookies válidos (sessionid/ds_user_id)
    if (platform === 'instagram') {
      const ckFile = path.join(profileDir, 'instagram_cookies.json');
      if (!fsSync.existsSync(ckFile)) {
        // Sem ficheiro de cookies → sessão não foi persistida correctamente → apagar flag e forçar re-login
        try { fsSync.unlinkSync(path.join(profileDir, flagName)); } catch (_) {}
        return false;
      }
      try {
        const raw = fsSync.readFileSync(ckFile, 'utf8');
        const cks = JSON.parse(raw);
        const hasAuth = Array.isArray(cks) && cks.some((c: any) =>
          (c.name === 'sessionid' || c.name === 'ds_user_id') && c.value && c.value.length > 5
        );
        if (!hasAuth) {
          try { fsSync.unlinkSync(path.join(profileDir, flagName)); } catch (_) {}
          return false;
        }
      } catch {
        return false;
      }
    }

    // Para YouTube, garantir que existem cookies válidos, senão limpar flag falsa de versões anteriores
    if (platform === 'youtube') {
      const ckFile = path.join(profileDir, 'youtube_cookies.json');
      if (!fsSync.existsSync(ckFile)) {
        try { fsSync.unlinkSync(path.join(profileDir, flagName)); } catch (_) {}
        return false;
      }
      try {
        const raw = fsSync.readFileSync(ckFile, 'utf8');
        const cks = JSON.parse(raw);
        const hasAuth = Array.isArray(cks) && cks.some((c: any) =>
          (c.name === 'LOGIN_INFO' || c.name === 'SID' || c.name === 'SSID' || c.name === 'SAPISID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID') && c.value && c.value.length > 10
        );
        if (!hasAuth) {
          try { fsSync.unlinkSync(path.join(profileDir, flagName)); } catch (_) {}
          return false;
        }
      } catch {
        return false;
      }
    }

    // Para Facebook, garantir que existem cookies válidos (c_user/xs)
    if (platform === 'facebook') {
      const ckFile = path.join(profileDir, 'facebook_cookies.json');
      if (!fsSync.existsSync(ckFile)) {
        // Sem ficheiro de cookies → sessão não foi persistida correctamente → apagar flag e forçar re-login
        try { fsSync.unlinkSync(path.join(profileDir, flagName)); } catch (_) {}
        return false;
      }
      try {
        const raw = fsSync.readFileSync(ckFile, 'utf8');
        const cks = JSON.parse(raw);
        const hasAuth = Array.isArray(cks) && cks.some((c: any) =>
          (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
        );
        if (!hasAuth) {
          try { fsSync.unlinkSync(path.join(profileDir, flagName)); } catch (_) {}
          return false;
        }
        // Verificar se cookies não expiraram (c_user com expires no passado)
        const now = Math.floor(Date.now() / 1000);
        const expiredAuth = Array.isArray(cks) && cks.filter((c: any) =>
          (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
        ).every((c: any) => c.expires && c.expires > 0 && c.expires < now);
        if (expiredAuth) {
          console.log(`[FACEBOOK] Cookies de autenticação expirados para ${profileDirName}. Removendo flag e forçando re-login.`);
          try { fsSync.unlinkSync(path.join(profileDir, flagName)); } catch (_) {}
          try { fsSync.unlinkSync(ckFile); } catch (_) {}
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  } catch (err) {
    return false;
  }
});

// IPC: Retornar mapa de status de autenticação de todos os perfis no disco (para o auto-login pular contas já autenticadas)
ipcMain.handle('get-profiles-auth-status', async (_event, accounts: Array<{ accountCode: string; accountId: string; platform: string; partnerId?: string }>) => {
  const result: Record<string, boolean> = {};
  const baseProfileDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
  for (const acc of (accounts || [])) {
    try {
      const { accountCode, accountId, platform, partnerId } = acc;
      const profileDirName = (platform === 'facebook')
        ? `partner-${partnerId || 'common'}-facebook`
        : (accountId
            ? `${accountCode}-${accountId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`
            : accountCode);
      const profileDir = path.join(baseProfileDir, 'agent-windows-profiles', profileDirName);
      const flagName = platform === 'tiktok' ? 'tt_authenticated.flag'
        : platform === 'youtube' ? 'yt_authenticated.flag'
        : platform === 'instagram' ? 'ig_authenticated.flag'
        : 'fb_authenticated.flag';
      let flagExists = fsSync.existsSync(path.join(profileDir, flagName));
      // Para Instagram: validar também que existe instagram_cookies.json com cookies válidos
      if (flagExists && platform === 'instagram') {
        const ckFile = path.join(profileDir, 'instagram_cookies.json');
        if (!fsSync.existsSync(ckFile)) {
          flagExists = false; // Sem cookies → forçar re-login
        } else {
          try {
            const raw = fsSync.readFileSync(ckFile, 'utf8');
            const cks = JSON.parse(raw);
            flagExists = Array.isArray(cks) && cks.some((c: any) =>
              (c.name === 'sessionid' || c.name === 'ds_user_id') && c.value && c.value.length > 5
            );
          } catch { flagExists = false; }
        }
      }

      // Para YouTube: validar também que existe youtube_cookies.json com cookies válidos
      if (flagExists && platform === 'youtube') {
        const ckFile = path.join(profileDir, 'youtube_cookies.json');
        if (!fsSync.existsSync(ckFile)) {
          flagExists = false;
        } else {
          try {
            const raw = fsSync.readFileSync(ckFile, 'utf8');
            const cks = JSON.parse(raw);
            flagExists = Array.isArray(cks) && cks.some((c: any) =>
              (c.name === 'LOGIN_INFO' || c.name === 'SID' || c.name === 'SSID' || c.name === 'SAPISID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID') && c.value && c.value.length > 10
            );
          } catch { flagExists = false; }
        }
      }
      // Para Facebook: validar também que existe facebook_cookies.json com cookies válidos (c_user/xs)
      if (flagExists && platform === 'facebook') {
        const ckFile = path.join(profileDir, 'facebook_cookies.json');
        if (!fsSync.existsSync(ckFile)) {
          flagExists = false;
        } else {
          try {
            const raw = fsSync.readFileSync(ckFile, 'utf8');
            const cks = JSON.parse(raw);
            const hasAuth = Array.isArray(cks) && cks.some((c: any) =>
              (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
            );
            if (!hasAuth) {
              flagExists = false;
            } else {
              // Verificar expiração
              const now = Math.floor(Date.now() / 1000);
              const expiredAuth = cks.filter((c: any) =>
                (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
              ).every((c: any) => c.expires && c.expires > 0 && c.expires < now);
              if (expiredAuth) flagExists = false;
            }
          } catch { flagExists = false; }
        }
      }
      result[accountCode] = flagExists;
    } catch {
      result[acc.accountCode] = false;
    }
  }
  return result;
});

// ── IPC: Abrir Chrome REAL com Ponte CDP ➔ React para Pedido de 2FA Autenticado Sem Erros RLS ──
ipcMain.on('open-chrome-signup', async (event, payload: string | {
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
  isQueueLogin?: boolean;
}) => {
  let signupUrl = typeof payload === 'string' ? payload : payload.url;
  const profileId = typeof payload === 'string' ? generateId() : payload.profileId;
  const email = typeof payload === 'object' ? payload.email || '' : '';
  const pass = decryptCred(typeof payload === 'object' ? payload.pass || '' : '');
  const birthDate = typeof payload === 'object' ? payload.birthDate || '15/06/1998' : '15/06/1998';
  const partnerId = typeof payload === 'object' ? payload.partnerId || '' : '';
  const accountId = typeof payload === 'object' ? payload.accountId || '' : '';
  const firstName = typeof payload === 'object' ? payload.firstName || '' : '';
  const lastName = typeof payload === 'object' ? payload.lastName || '' : '';
  const gender = typeof payload === 'object' ? payload.gender || 'male' : 'male';
  const platform = typeof payload === 'object' ? payload.platform : undefined;
  const pageUrl = typeof payload === 'object' ? payload.pageUrl || '' : '';
  const requestedInBackground = typeof payload === 'object' ? !!payload.runInBackground : false;
  let runInBackground = requestedInBackground;
  const isQueueLogin = typeof payload === 'object' ? !!payload.isQueueLogin : false;

  const rawGoogleEmail = typeof payload === 'object' ? (payload.googleEmail || payload.email || '') : '';
  const rawGooglePass = typeof payload === 'object' ? (payload.googlePass || payload.pass || '') : '';
  const googleEmail = rawGoogleEmail.trim();
  const googlePass = decryptCred(rawGooglePass.trim());

  const rawTikTokPass = typeof payload === 'object' ? (payload.tiktokPass || '') : '';
  const tiktokPass = decryptCred(rawTikTokPass.trim()) || pass;

  // Isolamento estrito de perfis do Chrome
  // - Facebook: compartilha a sessão master do parceiro para gerenciar múltiplas páginas (intencional)
  // - TikTok / Instagram / YouTube: perfil 100% isolado por conta (usando accountId único para evitar qualquer colisão ou herança de contas apagadas)
  const baseProfileDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
  const profileDirName = (platform === 'facebook')
    ? `partner-${partnerId || 'common'}-facebook`
    : (accountId
        ? `${profileId}-${accountId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`
        : profileId);

  const profileDir = path.join(baseProfileDir, 'agent-windows-profiles', profileDirName);

  let isTikTokLogin = false;
  let hasAuthenticatedTt = false;
  let isInstagramLogin = false;
  let hasAuthenticatedIg = false;
  let isFacebookLogin = false;
  let hasAuthenticatedFb = false;
  let isYouTubeLogin = false;
  let hasAuthenticatedYt = false;
  if (!signupUrl) {
    signupUrl = googleEmail ? 'https://accounts.google.com/ServiceLogin' : 'https://www.tiktok.com/login';
  } else if (platform === 'tiktok' || signupUrl.includes('tiktok.com')) {
    const ttDir = profileDir;
    const ttAuthFlag = path.join(ttDir, 'tt_authenticated.flag');
    try {
      hasAuthenticatedTt = fsSync.existsSync(ttAuthFlag);
    } catch {
      hasAuthenticatedTt = false;
    }
    signupUrl = hasAuthenticatedTt
      ? 'https://www.tiktok.com/tiktokstudio/'
      : (googleEmail ? 'https://accounts.google.com/ServiceLogin' : 'https://www.tiktok.com/login');
    isTikTokLogin = !hasAuthenticatedTt;
  } else if (platform === 'facebook' || signupUrl.includes('facebook.com')) {
    const fbDir = profileDir;
    const fbAuthFlag = path.join(fbDir, 'fb_authenticated.flag');
    try {
      hasAuthenticatedFb = fsSync.existsSync(fbAuthFlag);
      // Validar que cookies do Facebook existem e são válidos (c_user/xs)
      if (hasAuthenticatedFb) {
        const fbCookiesFile = path.join(fbDir, 'facebook_cookies.json');
        if (!fsSync.existsSync(fbCookiesFile)) {
          console.log('[FACEBOOK] Flag existe mas facebook_cookies.json não encontrado. Forçando re-login.');
          hasAuthenticatedFb = false;
        } else {
          try {
            const raw = fsSync.readFileSync(fbCookiesFile, 'utf8');
            const cks = JSON.parse(raw);
            const hasValidCookies = Array.isArray(cks) && cks.some((c: any) =>
              (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
            );
            if (!hasValidCookies) {
              console.log('[FACEBOOK] Cookies salvos não contêm c_user/xs válidos. Forçando re-login.');
              hasAuthenticatedFb = false;
            } else {
              // Verificar expiração
              const now = Math.floor(Date.now() / 1000);
              const expiredAuth = cks.filter((c: any) =>
                (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
              ).every((c: any) => c.expires && c.expires > 0 && c.expires < now);
              if (expiredAuth) {
                console.log('[FACEBOOK] Cookies c_user/xs expirados. Forçando re-login.');
                hasAuthenticatedFb = false;
                try { fsSync.unlinkSync(fbAuthFlag); } catch (_) {}
              }
            }
          } catch {
            console.log('[FACEBOOK] Erro ao ler facebook_cookies.json. Forçando re-login.');
            hasAuthenticatedFb = false;
          }
        }
      }
    } catch {
      hasAuthenticatedFb = false;
    }
    let cleanFbPageUrl = (pageUrl || '').trim();
    if (cleanFbPageUrl) {
      if (!cleanFbPageUrl.startsWith('http://') && !cleanFbPageUrl.startsWith('https://')) {
        if (cleanFbPageUrl.startsWith('/')) {
          cleanFbPageUrl = `https://web.facebook.com${cleanFbPageUrl}`;
        } else if (!cleanFbPageUrl.includes('facebook.com')) {
          cleanFbPageUrl = `https://web.facebook.com/${cleanFbPageUrl.replace(/^@/, '')}`;
        } else {
          cleanFbPageUrl = `https://${cleanFbPageUrl}`;
        }
      }
    }
    signupUrl = hasAuthenticatedFb
      ? (cleanFbPageUrl || 'https://web.facebook.com/pages/')
      : 'https://web.facebook.com/login';
    isFacebookLogin = !hasAuthenticatedFb;
  } else if (platform === 'instagram' || signupUrl.includes('instagram.com')) {
    const igDir = profileDir;
    const igAuthFlag = path.join(igDir, 'ig_authenticated.flag');
    try {
      hasAuthenticatedIg = fsSync.existsSync(igAuthFlag);
    } catch { hasAuthenticatedIg = false; }
    // 1ª vez (sem sessão confirmada): ir para login de conta existente do ADM
    // Vez seguinte (flag existe): ir para feed (Chrome retoma sessão do perfil)
    signupUrl = hasAuthenticatedIg
      ? 'https://www.instagram.com/'
      : 'https://www.instagram.com/accounts/login/';
    isInstagramLogin = !hasAuthenticatedIg;
  } else if (platform === 'youtube' || signupUrl.includes('youtube.com') || signupUrl.includes('studio.youtube.com')) {
    const ytDir = profileDir;
    const ytAuthFlag = path.join(ytDir, 'yt_authenticated.flag');
    try {
      hasAuthenticatedYt = fsSync.existsSync(ytAuthFlag);
    } catch {
      hasAuthenticatedYt = false;
    }
    signupUrl = hasAuthenticatedYt
      ? 'https://studio.youtube.com/'
      : 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fstudio.youtube.com%2F';
    isYouTubeLogin = !hasAuthenticatedYt;
    // YouTube login agora executa em segundo plano com Emulation.setFocusEmulationEnabled
    // runInBackground mantém o valor solicitado (ou true por predefinição)
  }

  // 1. Impedir abertura duplicada se o perfil de conta atribuída já estiver em execução no Chrome Real
  let existingSession = chromeSessions.get(profileId);
  if (!existingSession && platform === 'facebook') {
    for (const [, s] of chromeSessions.entries()) {
      if (s.platform === 'facebook' && s.partnerId === partnerId) {
        existingSession = s;
        break;
      }
    }
  }

  if (existingSession) {
    let isProcessAlive = false;
    if (existingSession.process && !existingSession.process.killed && existingSession.process.pid) {
      try {
        process.kill(existingSession.process.pid, 0);
        isProcessAlive = true;
      } catch {
        isProcessAlive = false;
      }
    }

    if (isProcessAlive) {
      if (existingSession.ws && existingSession.ws.readyState === WebSocket.OPEN) {
        console.log(`[CHROME] Perfil ${profileId} (ou sessão mestre ${platform}) já se encontra aberto! Focando janela.`);
        const targetNavUrl = (platform === 'facebook')
          ? (pageUrl || (signupUrl && !signupUrl.includes('/login') ? signupUrl : 'https://web.facebook.com/pages/'))
          : signupUrl;
        if (targetNavUrl) {
          existingSession.pageUrl = targetNavUrl;
        }
        if (targetNavUrl) {
          try {
            if (platform === 'facebook') {
              const updatedShield = buildChromeSecurityScript({
                isSignup: false,
                pageUrl: targetNavUrl,
                email: existingSession.email,
                pass: existingSession.pass,
              });
              await cdpSend(existingSession.ws, 'Runtime.evaluate', { expression: updatedShield }).catch(() => {});
            }
            cdpSend(existingSession.ws, 'Page.navigate', { url: targetNavUrl });
          } catch (err) {
            console.error('Erro ao navegar Chrome via CDP:', err);
          }
        }
        if (!runInBackground) {
          try {
            cdpSend(existingSession.ws, 'Page.bringToFront');
          } catch (err) {
            console.error('Erro ao focar Chrome via CDP:', err);
          }
        } else {
          try {
            const winTarget: any = await cdpSend(existingSession.ws, 'Browser.getWindowForTarget', {}).catch(() => null);
            if (winTarget?.windowId != null) {
              await cdpSend(existingSession.ws, 'Browser.setWindowBounds', {
                windowId: winTarget.windowId,
                bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
              }).catch(() => {});
            }
          } catch (_) {}
          if (existingSession.process?.pid) {
            startBackgroundWindowKeeper(existingSession.process.pid);
            setProcessTaskbarVisibility(existingSession.process.pid, false);
          }
        }
        chromeSessions.set(profileId, existingSession);
        event.sender.send('chrome-already-running', { profileId });
        event.sender.send('chrome-ready', { profileId });
        event.sender.send('chrome-sessions-updated', Array.from(chromeSessions.keys()));
        mainWindow?.webContents.send('chrome-sessions-updated', Array.from(chromeSessions.keys()));
        if (existingSession.isLoggedIn || platform === 'facebook') {
          event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
          mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });
        }
        return;
      } else if (existingSession.debugPort) {
        // Processo vivo mas WS desconectado: tenta reconectar à porta existente antes de matar
        try {
          const http = await import('http');
          const tabs = await new Promise<Array<{ type: string; webSocketDebuggerUrl?: string; url: string }>>((resolve, reject) => {
            const req = http.default.get(`http://127.0.0.1:${existingSession.debugPort}/json/list`, (res) => {
              let data = '';
              res.on('data', (c) => (data += c));
              res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
              });
            });
            req.on('error', reject);
          });
          const targetTab = tabs.find((t) => (t.type === 'page' || t.type === 'app') && t.webSocketDebuggerUrl && !t.url.startsWith('chrome-'));
          if (targetTab && targetTab.webSocketDebuggerUrl) {
            const ws = new WebSocket(targetTab.webSocketDebuggerUrl);
            await new Promise<void>((resolve, reject) => {
              ws.once('open', () => resolve());
              ws.once('error', reject);
            });
            existingSession.ws = ws;
            try {
              cdpSend(ws, 'Page.enable');
              cdpSend(ws, 'Runtime.enable');
              cdpSend(ws, 'DOM.enable');
            } catch {}
            if (pageUrl) {
              existingSession.pageUrl = pageUrl;
            }
            const targetNavUrl = (platform === 'facebook' && (!signupUrl || signupUrl.includes('/r.php') || signupUrl === 'https://www.facebook.com/' || signupUrl === 'https://www.facebook.com'))
              ? (pageUrl || 'https://www.facebook.com/pages/')
              : signupUrl;
            if (targetNavUrl) {
              try { cdpSend(ws, 'Page.navigate', { url: targetNavUrl }); } catch {}
            }
            if (!runInBackground) {
              try { cdpSend(ws, 'Page.bringToFront'); } catch {}
            } else {
              try {
                const winTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                if (winTarget?.windowId != null) {
                  await cdpSend(ws, 'Browser.setWindowBounds', {
                    windowId: winTarget.windowId,
                    bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                  }).catch(() => {});
                }
              } catch (_) {}
              if (existingSession.process?.pid) {
                startBackgroundWindowKeeper(existingSession.process.pid);
                setProcessTaskbarVisibility(existingSession.process.pid, false);
              }
            }
            chromeSessions.set(profileId, existingSession);
            event.sender.send('chrome-already-running', { profileId });
            event.sender.send('chrome-ready', { profileId });
            event.sender.send('chrome-sessions-updated', Array.from(chromeSessions.keys()));
            if (existingSession.isLoggedIn) {
              event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
              mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });
            }
            return;
          }
        } catch (reconnectErr) {
          console.warn(`[CHROME] Falha ao reconectar WS para ${profileId}:`, reconnectErr);
        }
      }
    }

    console.log(`[CHROME] Sessão anterior de ${profileId} inativa ou sem conexão. Limpando antes de relançar...`);
    if (existingSession.ws) {
      try { existingSession.ws.close(); } catch {}
    }
    if (existingSession.process && !existingSession.process.killed && existingSession.process.pid) {
      try { existingSession.process.kill(); } catch {}
    }
    chromeSessions.delete(profileId);
  }

  console.log(`[CHROME-LAUNCH] Perfil isolado ativo: ${profileDirName} (${profileId}) em ${profileDir}`);

  const chromePath = findChromePath();
  const debugPort = getNextDebugPort();
  const extDir = ensureSecurityExtension();

  let loginExtDir = '';
  if (isTikTokLogin) {
    console.log(`[TIKTOK-LOGIN] Preparando automação CDP para perfil ${profileDirName} (${profileId})`);
    console.log(`[TIKTOK-LOGIN] E-mail Google: ${googleEmail || '(NÃO INFORMADO)'}`);
    console.log(`[TIKTOK-LOGIN] Senha Google: ${googlePass ? 'OK (' + googlePass.length + ' chars)' : '(NÃO INFORMADA)'}`);
    console.log(`[TIKTOK-LOGIN] Senha TikTok: ${tiktokPass ? 'OK (' + tiktokPass.length + ' chars)' : '(NÃO INFORMADA)'}`);

    loginExtDir = ensureLoginHelperExtension(profileDirName, googleEmail, googlePass);
  }


  const isTikTokWithGoogle = isTikTokLogin && Boolean(googleEmail);

  // Flags: Modo normal para login (TikTok sem Google, Instagram) ou Modo App com Blindagem para YouTube / TikTok com Google / perfis já autenticados / Facebook
  const args = ((isTikTokLogin && !isTikTokWithGoogle) || isInstagramLogin)
    ? [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--lang=pt-PT',
        ...(runInBackground
          ? [
              '--window-position=-32000,-32000',
              '--window-size=1280,850',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
            ]
          : ['--window-size=1280,850']),
        '--disk-cache-size=2147483648',
        '--media-cache-size=1073741824',
        '--enable-gpu-rasterization',
        '--hide-crash-restore-bubble',
        signupUrl,
      ]
    : [
        `--app=${signupUrl}`,
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        `--load-extension=${extDir}`,
        `--disable-extensions-except=${extDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-tools',
        '--disable-debugging-keyboard-shortcuts',
        '--lang=pt-PT',
        ...(runInBackground ? ['--window-position=-32000,-32000'] : []),
        '--window-size=1200,810',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disk-cache-size=2147483648',
        '--media-cache-size=1073741824',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--ignore-gpu-blocklist',
        '--enable-features=ParallelDownloading',
        '--hide-crash-restore-bubble',
      ];

  ensureProfilePreferences(profileDir);

  console.log(`[CHROME] Lançando Chrome Real para ${profileId} (${runInBackground ? 'segundo plano' : 'janela visível'}) na URL: ${signupUrl} ${isTikTokWithGoogle ? '(Login TikTok Google: Modo App protegido estilo YouTube)' : isTikTokLogin ? '(Login TikTok: navegador normal)' : ''}`);
  const chromeProcess = spawn(chromePath, args, {
    windowsHide: false,
    stdio: 'ignore',
  });

  if (runInBackground && chromeProcess.pid) {
    startBackgroundWindowKeeper(chromeProcess.pid);
    setTimeout(() => setProcessTaskbarVisibility(chromeProcess.pid, false), 800);
    setTimeout(() => setProcessTaskbarVisibility(chromeProcess.pid, false), 2000);
    setTimeout(() => setProcessTaskbarVisibility(chromeProcess.pid, false), 4000);
    // Manter a janela do aplicativo 2AM Studio Parceiros no topo para que o Chrome execute discretamente atrás sem roubar o foco do usuário
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      }
    }, 600);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      }
    }, 1800);
  }

  chromeProcess.on('error', (err) => {
    console.error(`[CHROME] Falha crítica ao iniciar Chrome (${profileId}):`, err);
  });

  const session: ChromeSession = {
    process: chromeProcess,
    profileDir,
    ws: null,
    debugPort,
    email,
    googleEmail,
    pass,
    birthDate,
    partnerId,
    accountId,
    firstName,
    lastName,
    gender,
    platform,
    pageUrl,
    isSignup: Boolean(isFacebookLogin || isTikTokLogin || isInstagramLogin || isYouTubeLogin),
    isLoggedIn: platform === 'tiktok' ? hasAuthenticatedTt : platform === 'facebook' ? hasAuthenticatedFb : platform === 'instagram' ? hasAuthenticatedIg : platform === 'youtube' ? hasAuthenticatedYt : false,
    profileId,
    runInBackground,
    isQueueLogin: isQueueLogin || (platform === 'youtube' && requestedInBackground),
    launchedAt: Date.now(),
  };

  chromeSessions.set(profileId, session);
  event.sender.send('chrome-ready', { profileId });
  event.sender.send('chrome-sessions-updated', Array.from(chromeSessions.keys()));

  // Ligar ao CDP do Chrome
  const MAX_RETRIES = 15;
  let retries = 0;

  function tryConnectCDP() {
    if (session.process && session.process.killed) return;
    if (retries >= MAX_RETRIES) {
      console.warn('Tentativa CDP excedeu limite temporário, agendando retry...');
      setTimeout(tryConnectCDP, 2000);
      return;
    }
    retries++;

    import('http').then((http) => {
      const req = http.default.get(
        `http://127.0.0.1:${debugPort}/json/list`,
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const tabs = JSON.parse(data) as Array<{
                id: string;
                webSocketDebuggerUrl: string;
                url: string;
                type: string;
              }>;
              const pageTab = tabs.find(
                (t) =>
                  (t.type === 'page' || t.type === 'app') &&
                  t.webSocketDebuggerUrl &&
                  !t.url.startsWith('chrome-')
              );

              if (!pageTab) {
                setTimeout(tryConnectCDP, 600);
                return;
              }

              session.mainTargetId = pageTab.id;
              const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
              session.ws = ws;

              ws.on('open', async () => {
                retries = 0;
                try {
                  if (runInBackground) {
                    try {
                      const winTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                      if (winTarget?.windowId != null) {
                        await cdpSend(ws, 'Browser.setWindowBounds', {
                          windowId: winTarget.windowId,
                          bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                        }).catch(() => {});
                      }
                    } catch (_) {}
                    if (session.process?.pid) {
                      startBackgroundWindowKeeper(session.process.pid);
                      setProcessTaskbarVisibility(session.process.pid, false);
                    }
                    await cdpSend(ws, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
                    await cdpSend(ws, 'DOM.enable').catch(() => {});
                  }

                  const isCleanLogin = isTikTokLogin || isInstagramLogin || isFacebookLogin || isYouTubeLogin;
                  if (!isCleanLogin) {
                    // Modo normal: ativar todos os protocolos CDP necessários para blindagem
                    await cdpSend(ws, 'Page.enable');
                    await cdpSend(ws, 'Runtime.enable');

                    await cdpSend(ws, 'Target.setAutoAttach', {
                      autoAttach: true,
                      waitForDebuggerOnStart: false,
                      flatten: true,
                    }).catch(() => {});

                    // Injectar anti-deteção em TODAS as páginas desta sessão (antes do JS delas)
                    // Remove navigator.webdriver, emula plugins/linguagens/userAgentData reais
                    await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', {
                      source: `(function(){
                        try {
                          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                          delete navigator.__proto__.webdriver;
                          Object.defineProperty(navigator, 'plugins', { get: () => [
                            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                          ]});
                          Object.defineProperty(navigator, 'languages', { get: () => ['pt-PT', 'pt', 'en-US', 'en'] });
                          const uaData = {
                            brands: [{ brand: 'Google Chrome', version: '131' }, { brand: 'Chromium', version: '131' }, { brand: 'Not_A Brand', version: '24' }],
                            mobile: false, platform: 'Windows',
                            getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '64', brands: [{ brand: 'Google Chrome', version: '131.0.6778.109' }], fullVersionList: [{ brand: 'Google Chrome', version: '131.0.6778.109' }], mobile: false, model: '', platform: 'Windows', platformVersion: '15.0.0', uaFullVersion: '131.0.6778.109' })
                          };
                          try { Object.defineProperty(navigator, 'userAgentData', { get: () => uaData }); } catch(e) {}
                        } catch(e) {}
                      })();`,
                    }).catch(() => {});

                    await injectSecurityShieldToSession(ws, {
                      isSignup: true,
                      email,
                      pass,
                      birthDate,
                      firstName,
                      lastName,
                      gender,
                      lastCode: session.lastCode || '',
                      pageUrl: session.pageUrl || pageUrl || '',
                    });
                    startPopupWatcher(session);

                    // Bloquear atalhos de teclado perigosos (Ctrl+T, Ctrl+N, Ctrl+R, Shift+Esc, F12, etc.)
                    // para impedir que o parceiro abra novas janelas, recarregue ou aceda ao gestor de tarefas
                    await cdpSend(ws, 'Runtime.evaluate', { expression: KEYBOARD_BLOCKER_SCRIPT }).catch(() => {});
                    await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: KEYBOARD_BLOCKER_SCRIPT }).catch(() => {});

                    // Se for TikTok, restaurar cookies salvos de tiktok_cookies.json para garantir persistência no modo --app
                    const currentTtDir = session.profileDir || profileDir;
                    if (platform === 'tiktok' || fsSync.existsSync(path.join(currentTtDir, 'tiktok_cookies.json'))) {
                      const restored = await restoreTikTokCookies(ws, currentTtDir);
                      if (restored) {
                        session.isLoggedIn = true;
                        console.log(`[TIKTOK-RESTORE] Cookies aplicados! Navegando de volta ao Studio para garantir visualização logada...`);
                        await cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/' }).catch(() => {});
                      }
                    }

                    // Se for YouTube, restaurar cookies salvos de youtube_cookies.json para garantir persistência
                    if (platform === 'youtube' || fsSync.existsSync(path.join(currentTtDir, 'youtube_cookies.json'))) {
                      const restored = await restoreYouTubeCookies(ws, currentTtDir);
                      if (restored) {
                        session.isLoggedIn = true;
                        console.log(`[YOUTUBE-RESTORE] Cookies aplicados! Navegando de volta ao YouTube Studio...`);
                        await cdpSend(ws, 'Page.navigate', { url: 'https://studio.youtube.com/' }).catch(() => {});
                      }
                    }

                    // Se for Instagram, restaurar cookies salvos de instagram_cookies.json para garantir persistência
                    const currentIgDir = session.profileDir || profileDir;
                    if (platform === 'instagram' || fsSync.existsSync(path.join(currentIgDir, 'instagram_cookies.json'))) {
                      const restored = await restoreInstagramCookies(ws, currentIgDir);
                      if (restored) {
                        session.isLoggedIn = true;
                        console.log(`[INSTAGRAM-RESTORE] Cookies aplicados! Navegando de volta ao Instagram...`);
                        await cdpSend(ws, 'Page.navigate', { url: 'https://www.instagram.com/' }).catch(() => {});
                      }
                    }

                    // Se for Facebook, restaurar cookies salvos de facebook_cookies.json para garantir persistência
                    const currentFbDir = session.profileDir || profileDir;
                    if (platform === 'facebook' || fsSync.existsSync(path.join(currentFbDir, 'facebook_cookies.json'))) {
                      const restored = await restoreFacebookCookies(ws, currentFbDir);
                      if (restored) {
                        session.isLoggedIn = true;
                        console.log(`[FACEBOOK-RESTORE] Cookies do Facebook restaurados com sucesso para ${profileDirName}!`);
                      }
                      if (restored || hasAuthenticatedFb) {
                        const targetFbUrl = (session.pageUrl && session.pageUrl.trim()) ? session.pageUrl.trim() : (signupUrl && !signupUrl.includes('/login') ? signupUrl : 'https://web.facebook.com/pages/');
                        console.log(`[FACEBOOK] Sessão autenticada / cookies restaurados. Navegando para página: ${targetFbUrl}`);
                        await cdpSend(ws, 'Page.navigate', { url: targetFbUrl }).catch(() => {});
                        event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                        mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });
                      }
                    }

                      // Auto-advance se o Google abrir na tela de Account Chooser / Confirmar conta
                      const ytEffUser = (googleEmail || email || '').trim();
                      if (ytEffUser) {
                        let ytChooserChecks = 0;
                        const ytChooserInterval = setInterval(async () => {
                          ytChooserChecks++;
                          if (ytChooserChecks > 20 || !session.process || session.process.killed) {
                            clearInterval(ytChooserInterval);
                            return;
                          }
                          try {
                            const urlRes: any = await cdpSend(ws, 'Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }).catch(() => null);
                            const curUrl = (urlRes?.result?.value || '').toLowerCase();
                            if (curUrl.includes('accounts.google.com') && (curUrl.includes('chooser') || curUrl.includes('select') || curUrl.includes('servicelogin') || curUrl.includes('identifier') || curUrl.includes('continue='))) {
                              console.log(`[YOUTUBE-AUTO-ADVANCE] Detectada tela Google Account Chooser: avançando automaticamente para ${ytEffUser}...`);
                              await cdpSend(ws, 'Runtime.evaluate', {
                                expression: `(function() {
                                  try {
                                    var eff = ${JSON.stringify(ytEffUser)}.toLowerCase();
                                    var effPart = eff.split('@')[0];
                                    var cards = Array.from(document.querySelectorAll('[data-identifier], div.VV3oRb, div.pGzURd, div.yAlK0b, li[role="listitem"], div[role="listitem"], .OVnw0d, div[data-email]'));
                                    var found = null;
                                    for (var i = 0; i < cards.length; i++) {
                                      var text = (cards[i].getAttribute('data-identifier') || cards[i].innerText || cards[i].textContent || '').toLowerCase();
                                      if (text.includes(eff) || (effPart && effPart.length >= 3 && text.includes(effPart))) {
                                        found = cards[i];
                                        break;
                                      }
                                    }
                                    if (found) {
                                      var target = found.closest('li, div[role="link"], div[role="button"]') || found;
                                      target.click();
                                      return true;
                                    }
                                    var nextBtn = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]')).find(function(el) {
                                      var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                      return t === 'continuar' || t === 'continue' || t === 'seguinte' || t === 'next' || t === 'avançar';
                                    });
                                    if (nextBtn) {
                                      nextBtn.click();
                                      return true;
                                    }
                                  } catch (_) {}
                                  return false;
                                })()`,
                                returnByValue: true
                              }).catch(() => null);
                            } else if (curUrl.includes('studio.youtube.com') || curUrl.includes('youtube.com')) {
                              clearInterval(ytChooserInterval);
                            }
                          } catch (_) {}
                        }, 800);
                      }
                  } else {
                    // ── MODO LOGIN LIMPO (TikTok / Instagram / Facebook): Navegador 100% autêntico ──
                    // Não chamamos Page.enable, Runtime.enable, Target.setAutoAttach nem injetamos scripts
                    // para não ativar os detectores de telemetria / anti-bot

                    if (isYouTubeLogin) {
                      // YouTube faz login diretamente na janela principal (Google OAuth inline),
                      // portanto precisa de CDP para detetar campos e interagir com o formulário.
                      // Network.enable é obrigatório para Network.getCookies confirmar a autenticação.
                      console.log(`[YOUTUBE] Modo login: ativando CDP mínimo para automação Google...`);
                      await cdpSend(ws, 'Page.enable').catch(() => {});
                      await cdpSend(ws, 'Runtime.enable').catch(() => {});
                      await cdpSend(ws, 'Network.enable').catch(() => {});
                      // Bloquear atalhos perigosos (Ctrl+T, Ctrl+N, Ctrl+R, Shift+Esc, etc.) — não interfere com automação CDP
                      await cdpSend(ws, 'Runtime.evaluate', { expression: KEYBOARD_BLOCKER_SCRIPT }).catch(() => {});
                      await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: KEYBOARD_BLOCKER_SCRIPT }).catch(() => {});
                      if (runInBackground) {
                        await cdpSend(ws, 'Target.setDiscoverTargets', { discover: true }).catch(() => {});
                      }
                    } else {
                      console.log(`[${isTikTokLogin ? 'TIKTOK' : isInstagramLogin ? 'INSTAGRAM' : 'FACEBOOK'}] Modo login iniciado para perfil ${profileId}. Navegador 100% limpo e autêntico.`);
                      if (isTikTokLogin) {
                        await cdpSend(ws, 'Page.enable').catch(() => {});
                        await cdpSend(ws, 'Runtime.enable').catch(() => {});
                        await cdpSend(ws, 'Network.enable').catch(() => {});
                        // Bloquear atalhos perigosos (Ctrl+T, Ctrl+N, Ctrl+R, Shift+Esc, etc.) — não afeta o popup OAuth Google
                        await cdpSend(ws, 'Runtime.evaluate', { expression: KEYBOARD_BLOCKER_SCRIPT }).catch(() => {});
                        await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: KEYBOARD_BLOCKER_SCRIPT }).catch(() => {});
                        // Ativar descoberta de targets para poder fechar novas janelas abertas pelo parceiro (ex: "Abrir janela do browser")
                        // sem afetar o popup Google OAuth que é aberto internamente pelo Chrome
                        await cdpSend(ws, 'Target.setDiscoverTargets', { discover: true }).catch(() => {});
                      } else if (runInBackground) {
                        // Para Facebook e Instagram em segundo plano:
                        // Ativar CDP essencial para bloqueio de novas janelas ("Abrir janela do browser") e atalhos de teclado
                        await cdpSend(ws, 'Page.enable').catch(() => {});
                        await cdpSend(ws, 'Runtime.enable').catch(() => {});
                        await cdpSend(ws, 'Network.enable').catch(() => {});
                        await cdpSend(ws, 'Runtime.evaluate', { expression: KEYBOARD_BLOCKER_SCRIPT }).catch(() => {});
                        await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: KEYBOARD_BLOCKER_SCRIPT }).catch(() => {});
                        await cdpSend(ws, 'Target.setDiscoverTargets', { discover: true }).catch(() => {});
                      }
                    }
                  }

                  let ttLoginDetected = false;
                  let googleLoginDone = false;
                  let googleLoginDoneAt = 0;
                  let ttCheckInterval: NodeJS.Timeout | null = null;
                  let ttCloseTimeout: NodeJS.Timeout | null = null;

                  // ── Monitoramento Remoto de Login (ADM) ──
                  let stopLoginScreencastFn: (() => void) | null = null;
                  if (runInBackground || isQueueLogin) {
                    broadcastLoginEvent(partnerId, {
                      type: 'login_started',
                      platform: 'tiktok',
                      accountCode: profileId,
                      email: email,
                      detail: 'Iniciando fluxo de auto-login TikTok',
                    });
                    stopLoginScreencastFn = startLoginScreencast(session, profileId, 'tiktok', partnerId);
                  }

                  const handleTikTokLoginSuccess = async () => {
                    if (ttLoginDetected) return;
                    ttLoginDetected = true;
                    if (ttCheckInterval) {
                      clearInterval(ttCheckInterval);
                      ttCheckInterval = null;
                    }

                    session.isLoggedIn = true;
                    console.log(`[TIKTOK] Login confirmado com sucesso para o perfil ${profileId}! Salvando cookies e gravando tt_authenticated.flag...`);

                    // Notificar ADM do sucesso e encerrar screencast de monitoramento
                    broadcastLoginEvent(partnerId, {
                      type: 'login_success',
                      platform: 'tiktok',
                      accountCode: profileId,
                      email: email,
                      detail: 'Login TikTok confirmado com sucesso',
                    });
                    if (stopLoginScreencastFn) { stopLoginScreencastFn(); stopLoginScreencastFn = null; }

                    const ttProfileDir = session.profileDir || profileDir;

                    // 1. Salvar TODOS os cookies do TikTok em tiktok_cookies.json e reforçar no Chrome via Network.setCookie
                    await saveTikTokCookies(ws, ttProfileDir);

                    // 2. Gravar flag de autenticação confirmada no diretório do perfil
                    try {
                      fsSync.mkdirSync(ttProfileDir, { recursive: true });
                      fsSync.writeFileSync(path.join(ttProfileDir, 'tt_authenticated.flag'), new Date().toISOString(), 'utf8');
                      console.log(`[TIKTOK] tt_authenticated.flag gravado para ${profileDirName} (${profileId})`);
                    } catch (errFlag) {
                      console.error('[TIKTOK] Erro ao gravar tt_authenticated.flag:', errFlag);
                    }

                    // 3. Notificar UI do Electron
                    event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                    mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });

                    // 4. Exibir banner visual no topo da página
                    cdpSend(ws, 'Runtime.enable').catch(() => {}).finally(() => {
                      cdpSend(ws, 'Runtime.evaluate', {
                        expression: `(function() {
                          try {
                            if (!document.getElementById('__agent_login_banner__')) {
                              var b = document.createElement('div');
                              b.id = '__agent_login_banner__';
                              b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#059669;color:#fff;padding:12px 20px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:bold;box-shadow:0 4px 20px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;gap:12px;';
                              b.innerHTML = '<span>✅ Login no TikTok concluído e sessão salva com sucesso!</span><span style="font-size:12px;opacity:0.95;font-weight:normal;">Fechando janela em 8 segundos para consolidar a sessão protegida...</span>';
                              document.body.appendChild(b);
                            }
                          } catch(_) {}
                        })()`
                      }).catch(() => {});
                    });

                    // 5. Aguardar 8 segundos, salvar cookies uma segunda vez e fechar gracioso
                    console.log(`[TIKTOK] Aguardando 8 segundos para consolidação final dos cookies antes de fechar o Chrome do perfil ${profileId}...`);
                    ttCloseTimeout = setTimeout(async () => {
                      console.log(`[TIKTOK] 8 segundos decorridos. Re-salvando cookies e fechando navegador do perfil ${profileId} de forma graciosa...`);
                      await saveTikTokCookies(ws, ttProfileDir);
                      await closeChromeSessionGracefully(session, profileId, event.sender);
                    }, 8000);
                  };

                  const setBadge = (msg: string, color: string = '#38bdf8', targetSessionId?: string) => {
                    cdpSend(ws, 'Runtime.evaluate', {
                      expression: `(function() {
                        try {
                          if (window.location.hostname.includes('google.') || window.location.hostname.includes('gstatic.')) return;
                          let b = document.getElementById('__agent_helper_badge__');
                          if (!b && document.body) {
                            b = document.createElement('div');
                            b.id = '__agent_helper_badge__';
                            b.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#0f172a;color:#38bdf8;padding:12px 22px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:bold;box-shadow:0 8px 30px rgba(0,0,0,0.6);border:2px solid #38bdf8;pointer-events:none;display:flex;align-items:center;gap:8px;';
                            document.body.appendChild(b);
                          }
                          if (b) {
                            b.style.borderColor = ${JSON.stringify(color)};
                            b.innerHTML = '🤖 <span>' + ${JSON.stringify(msg)} + '</span>';
                          }
                        } catch(_) {}
                      })()`
                    }, targetSessionId).catch(() => {});
                  };

                  const realClickAt = async (x: number, y: number, targetSessionId?: string, targetWs: WebSocket = ws): Promise<boolean> => {
                    try {
                      const rx = Math.round(x);
                      const ry = Math.round(y);
                      await cdpSend(targetWs, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, pointerType: 'mouse' }, targetSessionId).catch(() => {});
                      await new Promise(r => setTimeout(r, 60));
                      await cdpSend(targetWs, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'left', clickCount: 1, pointerType: 'mouse' }, targetSessionId).catch(() => {});
                      await new Promise(r => setTimeout(r, 80));
                      await cdpSend(targetWs, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'left', clickCount: 1, pointerType: 'mouse' }, targetSessionId).catch(() => {});
                      return true;
                    } catch {
                      return false;
                    }
                  };

                  const realClickElement = async (selector: string, targetSessionId?: string): Promise<boolean> => {
                    const expr = `(function() {
                      try {
                        const el = document.querySelector(${JSON.stringify(selector)});
                        if (!el || el.offsetHeight === 0 || el.offsetWidth === 0) return null;
                        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.height === 0) return null;
                        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                      } catch { return null; }
                    })()`;
                    const res: any = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }, targetSessionId).catch(() => null);
                    const coords = res?.result?.value;
                    if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return false;
                    return await realClickAt(coords.x, coords.y, targetSessionId);
                  };

                  const typeHuman = async (text: string, targetSessionId?: string, targetWs: WebSocket = ws): Promise<void> => {
                    for (const char of text) {
                      await cdpSend(targetWs, 'Input.insertText', { text: char }, targetSessionId).catch(() => {});
                      const delay = Math.floor(Math.random() * 30) + 25;
                      await new Promise(r => setTimeout(r, delay));
                    }
                  };

                  // ── Helpers de Automação Google Unificada (TikTok e YouTube) ──
                  const typeGoogleKeys = async (wsTarget: WebSocket, text: string) => {
                    for (const c of text) {
                      await cdpSend(wsTarget, 'Input.insertText', { text: c }).catch(() => {});
                      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 25) + 20));
                    }
                  };

                  const cdpClickCoords = async (wsTarget: WebSocket, x: number, y: number) => {
                    const rx = Math.round(x);
                    const ry = Math.round(y);
                    await cdpSend(wsTarget, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, pointerType: 'mouse' }).catch(() => {});
                    await new Promise(r => setTimeout(r, 60));
                    await cdpSend(wsTarget, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'left', clickCount: 1, pointerType: 'mouse' }).catch(() => {});
                    await new Promise(r => setTimeout(r, 70));
                    await cdpSend(wsTarget, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'left', clickCount: 1, pointerType: 'mouse' }).catch(() => {});
                  };

                  const pressEnterKey = async (wsTarget: WebSocket) => {
                    await cdpSend(wsTarget, 'Input.dispatchKeyEvent', {
                      type: 'rawKeyDown',
                      windowsVirtualKeyCode: 13,
                      key: 'Enter',
                      code: 'Enter'
                    }).catch(() => {});
                    await new Promise(r => setTimeout(r, 70));
                    await cdpSend(wsTarget, 'Input.dispatchKeyEvent', {
                      type: 'keyUp',
                      windowsVirtualKeyCode: 13,
                      key: 'Enter',
                      code: 'Enter'
                    }).catch(() => {});
                  };

                  const clickGoogleAccountChooser = async (email?: string, wsTarget: WebSocket = ws, targetSessionId?: string): Promise<boolean> => {
                    const cleanEmail = (email || '').toLowerCase().trim();
                    const expr = `(function() {
                      try {
                        const email = ${JSON.stringify(cleanEmail)};
                        const userPart = email ? email.split('@')[0] : '';
                        if (email) {
                          const byId = document.querySelector('[data-identifier*="' + email + '"], [data-email*="' + email + '"], [data-profile-identifier*="' + email + '"]');
                          if (byId) {
                            const btn = byId.closest('li, div[role="link"], div[role="button"], div.VV3oRb, div.pGzURd') || byId;
                            try { (btn.click ? btn : byId).click(); } catch(_) {}
                            const r = btn.getBoundingClientRect();
                            if (r.width > 20 && r.height > 20) {
                              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                            }
                          }
                          const allList = Array.from(document.querySelectorAll('div.VV3oRb, div.pGzURd, div.yAlK0b, li, [role="link"], [role="button"], div[data-identifier]'));
                          for (const el of allList) {
                            const t = (el.innerText || el.textContent || '').toLowerCase();
                            if (t.includes(email) || (userPart && userPart.length >= 3 && t.includes(userPart))) {
                              try { el.click(); } catch(_) {}
                              const r = el.getBoundingClientRect();
                              if (r.width > 20 && r.height > 20) {
                                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                              }
                            }
                          }
                        }

                        const accountItems = Array.from(document.querySelectorAll('div.VV3oRb, div.pGzURd, div.yAlK0b, [data-identifier], [data-email]'));
                        if (accountItems.length > 0) {
                          const first = accountItems[0];
                          const btn = first.closest('li, div[role="link"], div[role="button"], div.VV3oRb, div.pGzURd') || first;
                          try { (btn.click ? btn : first).click(); } catch(_) {}
                          const r = btn.getBoundingClientRect();
                          if (r.width > 20 && r.height > 20) {
                            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                          }
                        }
                        return null;
                      } catch { return null; }
                    })()`;
                    const res: any = await cdpSend(wsTarget, 'Runtime.evaluate', { expression: expr, returnByValue: true }, targetSessionId).catch(() => null);
                    const coords = res?.result?.value;
                    if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return false;
                    return await realClickAt(coords.x, coords.y, targetSessionId, wsTarget);
                  };

                  const clickGoogleConsent = async (wsTarget: WebSocket = ws, targetSessionId?: string): Promise<boolean> => {
                    const expr = `(function() {
                      try {
                        // 1. Marcar checkboxes de permissões se existirem e não estiverem marcados
                        const unchk = document.querySelector('input[type="checkbox"]:not(:checked)');
                        if (unchk) {
                          try { (unchk as any).click(); } catch(_) {}
                          const cr = unchk.getBoundingClientRect();
                          if (cr.width > 10 && cr.height > 10) {
                            return { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
                          }
                        }

                        // 2. Procurar botões de consentimento/continuação/pular verificação opcional
                        const btns = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], [role="link"], span'));
                        for (const rawBtn of btns) {
                          const btn = (rawBtn as any).closest('button, div[role="button"], a[role="button"], [role="link"]') || rawBtn;
                          const t = ((btn as any).innerText || (btn as any).textContent || '').trim().toLowerCase();
                          if (t.includes('não') && !t.includes('agora não') && !t.includes('não agora') && !t.includes('not now')) continue;
                          if (t.includes('nao') && !t.includes('agora nao') && !t.includes('nao agora') && !t.includes('not now')) continue;
                          if (t.includes('recusar') || t.includes('negar')) continue;
                          if (
                            t === 'continuar' || t === 'permitir' || t === 'aceder' || t === 'continue' || t === 'allow' ||
                            t === 'confirmar' || t === 'aceitar' || t === 'concordo' || t === 'seguinte' || t === 'next' ||
                            t === 'avançar' || t === 'agora não' || t === 'agora nao' || t === 'não agora' || t === 'nao agora' ||
                            t === 'not now' || t === 'skip' || t === 'ignorar' || t === 'talvez mais tarde' || t === 'ahora no' ||
                            t.includes('continuar') || t.includes('permitir') || t.includes('aceder') ||
                            t.includes('continue') || t.includes('allow') || t.includes('concordo') ||
                            t.includes('agora não') || t.includes('agora nao') || t.includes('not now')
                          ) {
                            try { (btn as any).click(); } catch(_) {}
                            const r = (btn as any).getBoundingClientRect();
                            if (r.width > 10 && r.height > 10) {
                              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                            }
                          }
                        }

                        // 3. Seletores diretos clássicos do Google OAuth
                        const direct = document.querySelector('#submit_approve_access, button[data-idom-class*="consent"], #confirm, button[jsname="LgbsSe"], div[jsname="LgbsSe"], button[type="submit"]');
                        if (direct) {
                          const dt = (direct.innerText || direct.textContent || '').toLowerCase();
                          if (!dt.includes('cancel') && !dt.includes('não') && !dt.includes('recusar')) {
                            try { (direct as any).click(); } catch(_) {}
                            const r = direct.getBoundingClientRect();
                            if (r.width > 20 && r.height > 15) {
                              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                            }
                          }
                        }
                        return null;
                      } catch { return null; }
                    })()`;
                    const res: any = await cdpSend(wsTarget, 'Runtime.evaluate', { expression: expr, returnByValue: true }, targetSessionId).catch(() => null);
                    const coords = res?.result?.value;
                    if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return false;
                    return await realClickAt(coords.x, coords.y, targetSessionId, wsTarget);
                  };

                  // ── Helper Global de Blindagem e Criptografia Visual ──
                  // Mascara inputs para bolinhas pretas disc e oculta visualmente qualquer exibição do e-mail na tela de login/senha.
                  // CRÍTICO: Não altera nós de texto do DOM nem atributos para não corromper o estado das requisições do Google.
                  const injectPrivacyShield = async (targetWs: WebSocket, userEmail?: string, targetSessionId?: string): Promise<void> => {
                    if (!targetWs || targetWs.readyState !== WebSocket.OPEN) return;

                    const shieldScript = `(function() {
                      try {
                        // Se não estiver em página do Google ou YouTube, limpar e não aplicar máscara disc
                        var host = (window.location.hostname || '').toLowerCase();
                        if (!host.includes('google.') && !host.includes('gstatic.') && !host.includes('youtube.')) {
                          var oldS = document.getElementById('__agent_privacy_shield_css__');
                          if (oldS && oldS.parentNode) oldS.parentNode.removeChild(oldS);
                          return;
                        }

                        // 1. Injetar Estilos CSS de Máscara Visual Segura (NÃO interfere no DOM nem em inputs)
                        if (!document.getElementById('__agent_privacy_shield_css__')) {
                          var style = document.createElement('style');
                          style.id = '__agent_privacy_shield_css__';
                          style.textContent = [
                            // Mascara os inputs de texto/e-mail para bolinhas pretas disc (igual senha)
                            'input[type="email"], input[name="identifier"], input[autocomplete="username"], #identifierId, input[name="username"], input[name="emailOrPhone"], input#email, input[name="email"] {',
                            '  -webkit-text-security: disc !important;',
                            '  letter-spacing: 2.5px !important;',
                            '}',
                            // Oculta/borra visualmente identificadores de conta na tela (ex: cabeçalho do Google na tela de senha)
                            '#profileIdentifier, [data-profile-identifier], .w1I7fb, div[jsname="w1I7fb"], [data-email] .OVnw0d, [data-email] .w1I7fb, div[data-identifier] .OVnw0d {',
                            '  filter: blur(10px) !important;',
                            '  user-select: none !important;',
                            '  -webkit-user-select: none !important;',
                            '  pointer-events: none !important;',
                            '}',
                            '[data-email] .OVnw0d, [data-email] .w1I7fb, div[data-identifier] .OVnw0d {',
                            '  filter: blur(10px) !important;',
                            '  user-select: none !important;',
                            '}'
                          ].join('\\n');
                          (document.head || document.documentElement).appendChild(style);
                        }

                        // 2. Proteção de Título
                        if (document.title && (document.title.includes('@') || document.title.toLowerCase().includes('google'))) {
                          document.title = '2AM Studio - Autenticação Segura';
                        }

                        // 3. Prevenir clique com botão direito e atalhos de desenvolvedor
                        if (!window.__agent_privacy_events_bound__) {
                          window.__agent_privacy_events_bound__ = true;
                          document.addEventListener('contextmenu', function(e) { e.preventDefault(); }, true);
                          document.addEventListener('copy', function(e) { e.preventDefault(); }, true);
                          document.addEventListener('cut', function(e) { e.preventDefault(); }, true);
                          document.addEventListener('keydown', function(e) {
                            if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) || (e.ctrlKey && e.keyCode === 85)) {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                          }, true);
                        }
                      } catch(_) {}
                    })();`;

                    await cdpSend(targetWs, 'Runtime.evaluate', { expression: shieldScript }, targetSessionId).catch(() => {});
                    await cdpSend(targetWs, 'Page.addScriptToEvaluateOnNewDocument', { source: shieldScript }, targetSessionId).catch(() => {});
                  };

                  // Executa todo o fluxo de preenchimento do Google OAuth diretamente num WebSocket
                  const executeGoogleLoginFlow = async (targetWs: WebSocket, email: string, pass: string) => {
                    let googleAccountChosen = false;
                    let googleEmailFilled = false;
                    let googlePassFilled = false;

                    console.log(`[GOOGLE-LOGIN] Iniciando preenchimento no Google. E-mail: "${email}", Senha: ${pass ? 'informada' : 'NÃO INFORMADA'}`);

                    try {
                      // Aguardo reativo inicial para o Google estar pronto (máximo 3.5s)
                      for (let w = 0; w < 18; w++) {
                        await new Promise(r => setTimeout(r, 200));
                        const readyRes: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                          expression: `document.readyState === 'complete' && (!!document.querySelector('input, #identifierId, [data-identifier], .OVnw0d') || window.location.href.includes('google.'))`,
                          returnByValue: true
                        }).catch(() => null);
                        if (readyRes?.result?.value) break;
                      }

                      for (let attempt = 0; attempt < 60; attempt++) {
                        if (targetWs.readyState !== WebSocket.OPEN) break;

                        // Aplicar blindagem de privacidade em cada iteração
                        await injectPrivacyShield(targetWs, email);

                        const urlCheckRes: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                          expression: 'window.location.href',
                          returnByValue: true
                        }).catch(() => null);
                        const curGoogleUrl = (urlCheckRes?.result?.value || '').toLowerCase();

                        if (curGoogleUrl.includes('/challenge/recaptcha')) {
                          console.log(`[GOOGLE-LOGIN] CAPTCHA na URL: ${curGoogleUrl} — aguardando...`);
                          await new Promise(r => setTimeout(r, 3000));
                          continue;
                        }

                        const isStillInGoogleAuth =
                          curGoogleUrl.includes('accounts.google.') ||
                          curGoogleUrl.includes('/signin/') ||
                          curGoogleUrl.includes('/challenge/') ||
                          curGoogleUrl.includes('/speedbump/');

                        if (!isStillInGoogleAuth) {
                          const isGooglePostLogin =
                            curGoogleUrl.includes('studio.youtube.com') ||
                            curGoogleUrl.includes('youtube.com') ||
                            curGoogleUrl.includes('myaccount.google.com') ||
                            curGoogleUrl.includes('google.com/intl') ||
                            curGoogleUrl.includes('mail.google.com') ||
                            (curGoogleUrl.startsWith('https://www.google.') && !curGoogleUrl.includes('accounts.google.'));

                          if (isGooglePostLogin) {
                            console.log(`[GOOGLE-LOGIN] Login Google confirmado: URL pós-autenticação = ${curGoogleUrl}`);
                            break;
                          }
                        }

                        const consentClicked = await clickGoogleConsent(targetWs);
                        if (consentClicked) {
                          console.log('[GOOGLE-LOGIN] Botão de consentimento/continuação clicado!');
                          // Aguardo reativo de transição de tela após consentimento (máx 3s)
                          for (let cw = 0; cw < 15; cw++) {
                            await new Promise(r => setTimeout(r, 200));
                            if (targetWs.readyState !== WebSocket.OPEN) break;
                          }
                          continue;
                        }

                        if (!googleAccountChosen) {
                          const chosen = await clickGoogleAccountChooser(email, targetWs);
                          if (chosen) {
                            googleAccountChosen = true;
                            console.log('[GOOGLE-LOGIN] Conta selecionada no Account Chooser! Aguardando próxima tela...');
                            for (let acw = 0; acw < 15; acw++) {
                              await new Promise(r => setTimeout(r, 200));
                              const hasPassOrNext: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: `!!document.querySelector('input[type="password"]') || !window.location.href.includes('accountchooser')`,
                                returnByValue: true
                              }).catch(() => null);
                              if (hasPassOrNext?.result?.value) break;
                            }
                            continue;
                          }
                        }

                        if (!googleEmailFilled) {
                          const emailFieldRes: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                            expression: `(function() {
                              const el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                              if (!el || el.offsetParent === null) return null;
                              el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                              const r = el.getBoundingClientRect();
                              return { x: r.left + r.width / 2, y: r.top + r.height / 2, val: el.value || '' };
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          if (emailFieldRes?.result?.value) {
                            if (!email) {
                              console.warn('[GOOGLE-LOGIN] Campo de e-mail visível, mas credencial está vazia!');
                              await new Promise(r => setTimeout(r, 2000));
                              continue;
                            }

                            // ── Em segundo plano, assegurar foco silencioso via CDP sem exibir a janela física ──
                            if (runInBackground && chromeProcess?.pid) {
                              console.log('[GOOGLE-LOGIN] ⚡ Foco silencioso em segundo plano para e-mail...');
                              await bringChromeToForegroundBriefly(chromeProcess.pid, targetWs);
                              await new Promise(r => setTimeout(r, 100));
                            }

                            const { x, y } = emailFieldRes.result.value;
                            console.log(`[GOOGLE-LOGIN] Focando campo de e-mail em (${x}, ${y})...`);
                            await cdpSend(targetWs, 'Runtime.evaluate', {
                              expression: `(function() {
                                const el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                                if (el) { el.focus(); el.click(); el.value = ''; }
                              })()`
                            }).catch(() => {});
                            await cdpClickCoords(targetWs, x, y);
                            await new Promise(r => setTimeout(r, 200));

                            // Limpeza universal do campo via Ctrl+A + Backspace nativo
                            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 50));
                            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 100));

                            console.log(`[GOOGLE-LOGIN] Digitando e-mail naturalmente: ${email.split('@')[0]}...`);
                      if (runInBackground || isQueueLogin) broadcastLoginEvent(partnerId, { type: 'login_progress', platform: platform || 'youtube', accountCode: profileId, email, detail: 'Digitando e-mail Google' });
                            await typeGoogleKeys(targetWs, email);
                            await new Promise(r => setTimeout(r, 250));

                            // ── VERIFICAÇÃO CRÍTICA: confirmar que o valor foi realmente inserido com 100% de precisão ──
                            const getEmailVal = async (): Promise<string> => {
                              const vRes: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: `(function() {
                                  const el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                                  return el ? el.value.trim() : '';
                                })()`,
                                returnByValue: true
                              }).catch(() => null);
                              return (vRes?.result?.value || '') as string;
                            };

                            let typedEmailVal = await getEmailVal();
                            if (typedEmailVal !== email) {
                              console.warn(`[GOOGLE-LOGIN] Campo mostra "${typedEmailVal}" (esperado: "${email}") — corrigindo via Input.insertText...`);
                              await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: `(function() {
                                  const el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                                  if (el) { el.focus(); el.value = ''; }
                                })()`
                              }).catch(() => {});
                              await cdpSend(targetWs, 'Input.insertText', { text: email }).catch(() => {});
                              await new Promise(r => setTimeout(r, 150));
                              typedEmailVal = await getEmailVal();
                            }

                            if (typedEmailVal !== email) {
                              console.warn(`[GOOGLE-LOGIN] Tentando atribuição direta no DOM com eventos...`);
                              await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: `(function() {
                                  const el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                                  if (el) {
                                    el.focus();
                                    el.value = ${JSON.stringify(email)};
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                })()`
                              }).catch(() => {});
                              await new Promise(r => setTimeout(r, 150));
                              typedEmailVal = await getEmailVal();
                            }

                            console.log(`[GOOGLE-LOGIN] E-mail confirmado no campo: "${typedEmailVal}" (sucesso: ${typedEmailVal === email})`);

                            await new Promise(r => setTimeout(r, 300));
                            console.log('[GOOGLE-LOGIN] Submetendo e-mail...');
                            const emailSubmitBtn: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                              expression: `(function() {
                                const selList = ['#identifierNext button', '#identifierNext', 'button[jsname="LgbsSe"]', 'div[jsname="LgbsSe"]'];
                                for (const s of selList) {
                                  const b = document.querySelector(s);
                                  if (b) {
                                    const r = b.getBoundingClientRect();
                                    if (r.width > 20 && r.height > 20) {
                                      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                                    }
                                  }
                                }
                                return null;
                              })()`,
                              returnByValue: true
                            }).catch(() => null);

                            if (emailSubmitBtn?.result?.value) {
                              const { x: nx, y: ny } = emailSubmitBtn.result.value;
                              console.log('[GOOGLE-LOGIN] Pressionando botão Seguinte do e-mail...');
                              await cdpClickCoords(targetWs, nx, ny);
                            } else {
                              console.log('[GOOGLE-LOGIN] Submetendo e-mail via tecla Enter...');
                              await pressEnterKey(targetWs);
                            }

                            // ── Retornar imediatamente para segundo plano após submeter e-mail ──
                            if (runInBackground && chromeProcess?.pid) {
                              console.log('[GOOGLE-LOGIN] ⚡ Retornando janela para segundo plano...');
                              await returnChromeToBackground(chromeProcess.pid);
                            }

                            console.log('[GOOGLE-LOGIN] E-mail submetido! Aguardando próxima tela...');
                            let advancedPastEmail = false;
                            // Polling reativo a cada 200ms para a próxima tela
                            for (let pw = 0; pw < 30; pw++) {
                              await new Promise(r => setTimeout(r, 200));
                              const hasNext: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: `(function() {
                                  const hasPass = !!document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"]');
                                  const isChallenge = window.location.href.includes('/challenge') || window.location.href.includes('/speedbump');
                                  const emailStillVisible = !!document.querySelector('input[type="email"], #identifierId');
                                  return { hasPass, isChallenge, emailStillVisible };
                                })()`,
                                returnByValue: true
                              }).catch(() => null);
                              const navState = hasNext?.result?.value;
                              if (navState?.hasPass || navState?.isChallenge || !navState?.emailStillVisible) {
                                console.log(`[GOOGLE-LOGIN] Campo de senha/próxima tela pronto em ${(pw + 1) * 200}ms!`);
                                advancedPastEmail = true;
                                break;
                              }
                            }
                            if (advancedPastEmail) {
                              googleEmailFilled = true;
                            } else {
                              console.warn('[GOOGLE-LOGIN] Tela de e-mail ainda visível após submissão.');
                            }
                            continue;
                          }
                        }

                        if (!googlePassFilled) {
                          const passFieldRes: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                            expression: `(function() {
                              const el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                              if (!el) return null;
                              el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                              const r = el.getBoundingClientRect();
                              if (r.width > 20 && r.height > 15) {
                                return { x: r.left + r.width / 2, y: r.top + r.height / 2, val: el.value || '' };
                              }
                              return null;
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          if (passFieldRes?.result?.value) {
                            if (!pass) {
                              console.warn('[GOOGLE-LOGIN] Campo de senha visível, mas senha está vazia!');
                              await new Promise(r => setTimeout(r, 2000));
                              continue;
                            }

                            // ── Em segundo plano, assegurar foco silencioso via CDP sem exibir a janela física ──
                            if (runInBackground && chromeProcess?.pid) {
                              console.log('[GOOGLE-LOGIN] ⚡ Foco silencioso em segundo plano para senha...');
                              await bringChromeToForegroundBriefly(chromeProcess.pid, targetWs);
                              await new Promise(r => setTimeout(r, 100));
                            }

                            const { x, y } = passFieldRes.result.value;
                            console.log(`[GOOGLE-LOGIN] Campo de senha detectado! Focando em (${x}, ${y})...`);
                            await cdpSend(targetWs, 'Runtime.evaluate', {
                              expression: `(function() {
                                const el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                                if (el) { el.focus(); el.click(); el.value = ''; }
                              })()`
                            }).catch(() => {});
                            await cdpClickCoords(targetWs, x, y);
                            await new Promise(r => setTimeout(r, 200));

                            // Limpeza universal do campo de senha via Ctrl+A + Backspace nativo
                            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 50));
                            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 100));

                            console.log(`[GOOGLE-LOGIN] Digitando senha naturalmente (${pass.length} caracteres)...`);
                      if (runInBackground || isQueueLogin) broadcastLoginEvent(partnerId, { type: 'login_progress', platform: platform || 'youtube', accountCode: profileId, email, detail: 'Digitando senha Google' });
                            await typeGoogleKeys(targetWs, pass);
                            await new Promise(r => setTimeout(r, 250));

                            // Verificação rigorosa da senha inserida
                            const getPassVal = async (): Promise<string> => {
                              const vRes: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: `(function() {
                                  const el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                                  return el ? el.value : '';
                                })()`,
                                returnByValue: true
                              }).catch(() => null);
                              return (vRes?.result?.value || '') as string;
                            };

                            let typedPassVal = await getPassVal();
                            if (typedPassVal !== pass) {
                              console.warn(`[GOOGLE-LOGIN] Senha não confere (${typedPassVal.length} vs ${pass.length}) — aplicando Input.insertText...`);
                              await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: `(function() {
                                  const el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                                  if (el) { el.focus(); el.value = ''; }
                                })()`
                              }).catch(() => {});
                              await cdpSend(targetWs, 'Input.insertText', { text: pass }).catch(() => {});
                              await new Promise(r => setTimeout(r, 150));
                              typedPassVal = await getPassVal();
                            }

                            if (typedPassVal !== pass) {
                              console.warn(`[GOOGLE-LOGIN] Tentando atribuição direta da senha no DOM com eventos...`);
                              await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: `(function() {
                                  const el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                                  if (el) {
                                    el.focus();
                                    el.value = ${JSON.stringify(pass)};
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                })()`
                              }).catch(() => {});
                              await new Promise(r => setTimeout(r, 150));
                              typedPassVal = await getPassVal();
                            }

                            console.log(`[GOOGLE-LOGIN] Senha confirmada no campo (${typedPassVal.length} caracteres). Submetendo...`);
                            await new Promise(r => setTimeout(r, 300));

                            const passSubmitBtn: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                              expression: `(function() {
                                const selList = ['#passwordNext button', '#passwordNext', 'button[jsname="LgbsSe"]', 'div[jsname="LgbsSe"]'];
                                for (const s of selList) {
                                  const b = document.querySelector(s);
                                  if (b) {
                                    const r = b.getBoundingClientRect();
                                    if (r.width > 20 && r.height > 20) {
                                      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                                    }
                                  }
                                }
                                return null;
                              })()`,
                              returnByValue: true
                            }).catch(() => null);

                            if (passSubmitBtn?.result?.value) {
                              const { x: bx, y: by } = passSubmitBtn.result.value;
                              console.log('[GOOGLE-LOGIN] Clicando no botão Seguinte da senha via CDP...');
                              await cdpClickCoords(targetWs, bx, by);
                            } else {
                              console.log('[GOOGLE-LOGIN] Submetendo senha via tecla Enter nativa...');
                              await pressEnterKey(targetWs);
                            }

                            // ── Retornar imediatamente para segundo plano após submeter senha ──
                            if (runInBackground && chromeProcess?.pid) {
                              console.log('[GOOGLE-LOGIN] ⚡ Retornando janela para segundo plano...');
                              await returnChromeToBackground(chromeProcess.pid);
                            }

                            googlePassFilled = true;
                            console.log('[GOOGLE-LOGIN] Senha submetida! Aguardando confirmação e redirecionamento...');
                            // Polling reativo a cada 200ms para pós-login ou desafio
                            for (let pw = 0; pw < 25; pw++) {
                              await new Promise(r => setTimeout(r, 200));
                              const curUrl: any = await cdpSend(targetWs, 'Runtime.evaluate', {
                                expression: 'window.location.href',
                                returnByValue: true
                              }).catch(() => null);
                              const u = (curUrl?.result?.value || '').toLowerCase();
                              if (!u.includes('accounts.google.com') || u.includes('/challenge') || u.includes('consent') || u.includes('oauth')) {
                                console.log(`[GOOGLE-LOGIN] Etapa pós-senha detectada em ${(pw + 1) * 200}ms!`);
                                break;
                              }
                            }
                            continue;
                          }
                        }

                        await new Promise(r => setTimeout(r, 2000));
                      }
                    } catch (err) {
                      console.error('[GOOGLE-LOGIN] Erro no fluxo do Google:', err);
                    }
                  };

                  if (isTikTokLogin) {

                    // Localizar e clicar no botão "Entrar" (cabeçalho ou barra lateral, ignorando vídeos do feed)
                    const clickTikTokLoginButton = async (targetSessionId?: string): Promise<boolean> => {
                      const expr = `(function() {
                        try {
                          // 1. Seletores diretos conhecidos (topo e barra lateral)
                          const directSelectors = [
                            '#header-login-button',
                            'button[data-e2e="top-login-button"]',
                            'button[data-e2e="sidebar-login-button"]',
                            'button[data-key-interaction="nav_login"]',
                            'header a[href*="/login"]',
                            'nav a[href*="/login"]',
                            'aside a[href*="/login"]',
                            'a[href*="tiktok.com/login"]',
                            'button.TUXButton--primary',
                            'button.TUXButton'
                          ];
                          for (const sel of directSelectors) {
                            const el = document.querySelector(sel);
                            if (el) {
                              const r = el.getBoundingClientRect();
                              if (r.width > 20 && r.height > 15) {
                                el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                const r2 = el.getBoundingClientRect();
                                return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, name: sel };
                              }
                            }
                          }

                          // 2. Busca abrangente por texto "Entrar" / "Log in" excluindo vídeos e feed
                          const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], div.TUXButton-label, div[class*="Button"]'));
                          for (const el of candidates) {
                            // Ignorar completamente itens dentro de players ou cartões de vídeo
                            if (el.closest('[data-e2e="recommend-list-item-container"], .video-card-container, [data-e2e="feed-video"], [class*="FeedVideo"], [class*="DivVideoFeed"]')) {
                              continue;
                            }
                            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                            if (text === 'entrar' || text === 'log in' || text === 'login' || text === 'fazer login' || (text.startsWith('entrar') && text.length < 15)) {
                              const btn = el.closest('button, a, [role="button"]') || el;
                              const r = btn.getBoundingClientRect();
                              if (r.width > 20 && r.height > 15) {
                                btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                const r2 = btn.getBoundingClientRect();
                                return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, name: text };
                              }
                            }
                          }
                          return null;
                        } catch { return null; }
                      })()`;
                      const res: any = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }, targetSessionId).catch(() => null);
                      const coords = res?.result?.value;
                      if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return false;
                      console.log('[TIKTOK-LOGIN] Botão de login encontrado (' + coords.name + ') em (' + coords.x + ', ' + coords.y + ')');
                      return await realClickAt(coords.x, coords.y, targetSessionId);
                    };

                    // Localizar e clicar no botão "Continuar com o Google"
                    const clickTikTokGoogleButton = async (targetSessionId?: string): Promise<boolean> => {
                      const expr = `(function() {
                        try {
                          // 1. Procurar direto nos channel-items do TikTok (tanto na página /login como em modais)
                          const channelItems = Array.from(document.querySelectorAll('[data-e2e="channel-item"], div.eu18umb0, div[role="link"], button, [role="button"]'));
                          for (const item of channelItems) {
                            if (item.children.length > 3) continue;
                            const text = (item.innerText || item.textContent || '').trim().toLowerCase();
                            if (text.includes('google') && !text.includes('facebook') && !text.includes('apple') && !text.includes('twitter')) {
                              const btn = item.closest('[data-e2e="channel-item"], div.eu18umb0, [role="link"], [role="button"], button') || item;
                              const r = btn.getBoundingClientRect();
                              if (r.width > 20 && r.height > 15) {
                                btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                const r2 = btn.getBoundingClientRect();
                                return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, name: text };
                              }
                            }
                          }

                          // 2. Procurar dentro de modais de login ou containers específicos
                          const containers = Array.from(document.querySelectorAll('#loginContainer, [id*="loginContainer"], [data-e2e="login-container"], div[role="dialog"], [role="dialog"], div[class*="DivLoginContainer"]'));
                          for (const container of containers) {
                            const items = Array.from(container.querySelectorAll('[data-e2e="channel-item"], [role="link"], [role="button"], a, button, div'));
                            for (const item of items) {
                              const text = (item.innerText || item.textContent || '').trim().toLowerCase();
                              if (text.includes('google') && !text.includes('facebook') && !text.includes('apple') && !text.includes('twitter')) {
                                const btn = item.closest('[data-e2e="channel-item"], [role="link"], [role="button"], a, button') || item;
                                const r = btn.getBoundingClientRect();
                                if (r.width > 30 && r.height > 20) {
                                  btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                  const r2 = btn.getBoundingClientRect();
                                  return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, name: text };
                                }
                              }
                            }
                          }

                          // 3. Seletor direto por atributo ou ícone
                          const direct = document.querySelector('[data-e2e="channel-item-google"], a[href*="google"], [data-e2e="channel-item"] svg[data-e2e="google-icon"]');
                          if (direct) {
                            const btn = direct.closest('[data-e2e="channel-item"], div.eu18umb0, div[role="button"], [role="link"], a, button') || direct;
                            const r = btn.getBoundingClientRect();
                            if (r.width > 30 && r.height > 20) {
                              btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                              const r2 = btn.getBoundingClientRect();
                              return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, name: 'direct-google' };
                            }
                          }

                          // 4. Fallback: procurar por textos folha "Continuar com Google"
                          const candidates = Array.from(document.querySelectorAll('div, a, button, [role="link"], [role="button"], p, span'));
                          for (const el of candidates) {
                            if (el.tagName === 'VIDEO' || el.closest('[data-e2e="recommend-list-item-container"], .video-card-container')) continue;
                            const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                            if (t === 'continuar com google' || t === 'continuar com o google' || t === 'continue with google' || t === 'usar o google') {
                              const btn = el.closest('[data-e2e="channel-item"], div.eu18umb0, div[role="button"], [role="link"], a, button') || el;
                              const r = btn.getBoundingClientRect();
                              if (r.width > 30 && r.height > 20) {
                                btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                const r2 = btn.getBoundingClientRect();
                                return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, name: t };
                              }
                            }
                          }

                          return null;
                        } catch { return null; }
                      })()`;
                      const res: any = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }, targetSessionId).catch(() => null);
                      const coords = res?.result?.value;
                      if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return false;
                      console.log('[TIKTOK-LOGIN] Botão Continuar com Google encontrado (' + coords.name + ') em (' + coords.x + ', ' + coords.y + ')');
                      return await realClickAt(coords.x, coords.y, targetSessionId);
                    };

                    // Localizar e fechar o tutorial / aviso de boas-vindas inicial ("Entendido", "Got it")
                    const dismissTikTokTutorial = async (targetSessionId?: string): Promise<boolean> => {
                      const expr = `(function() {
                        try {
                          const candidates = Array.from(document.querySelectorAll('button, div[role="button"], div.TUXButton-label, div[class*="Button"], div, span, a, p'));
                          for (const el of candidates) {
                            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                            if (text === 'entendido' || text === 'got it' || text === 'entendi' || text === 'compreendi' || text === 'ok, entendi') {
                              const btn = el.closest('button, [role="button"], div[class*="Button"]') || el;
                              const r = btn.getBoundingClientRect();
                              if (r.width > 20 && r.height > 15) {
                                btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                const r2 = btn.getBoundingClientRect();
                                return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, name: text };
                              }
                            }
                          }
                          return null;
                        } catch { return null; }
                      })()`;
                      const res: any = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }, targetSessionId).catch(() => null);
                      const coords = res?.result?.value;
                      if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return false;
                      console.log('[TIKTOK-LOGIN] Aviso inicial / tutorial encontrado (' + coords.name + '). Clicando para remover...');
                      return await realClickAt(coords.x, coords.y, targetSessionId);
                    };

                    // ── Automação da etapa de verificação de identidade do TikTok: "Verifica que és mesmo tu" ──
                    let lastTikTok2FANotifTime = 0;

                    const handleTikTokVerificationModal = async (targetSessionId?: string): Promise<'clicked_option' | 'typed_password' | 'waiting_code' | 'typed_code' | 'waiting_manual' | 'not_present'> => {
                      try {
                        const exprCheck = `(function() {
                          try {
                            const allText = (document.body ? (document.body.innerText || document.body.textContent || '') : '') || '';
                            const isVerifyScreen = /verifica que és mesmo tu|verifica quem tu és|verifica a tua identidade|verifique sua identidade|verify it's you|verify your identity/i.test(allText);

                            // 1. Verificar se o campo de input de senha da verificação já está visível
                            const pwdInput = document.querySelector('input[type="password"]');
                            if (pwdInput) {
                              const r = pwdInput.getBoundingClientRect();
                              if (r.width > 20 && r.height > 15) {
                                pwdInput.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                const r2 = pwdInput.getBoundingClientRect();
                                return { step: 'password_input', x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 };
                              }
                            }

                            // 2. Verificar se estamos na tela de inserção de código de verificação (6 dígitos enviado por e-mail)
                            const isCodeScreen = /código de verificação|codigo de verificacao|código de 6 dígitos|codigo de 6 digitos|insira o código|introduz o código|enter 6-digit code|verification code|enter the code|code sent to|código enviado para|reenviar código|resend code/i.test(allText);

                            const digitInputs = Array.from(document.querySelectorAll('input')).filter(function(inp) {
                              const r = inp.getBoundingClientRect();
                              return r.width > 12 && r.height > 12 && (inp.getAttribute('maxlength') === '1' || inp.getAttribute('data-e2e')?.indexOf('digit') > -1 || inp.className.indexOf('digit') > -1);
                            });

                            const singleCodeInput = document.querySelector('input[data-e2e="verify-input"], input[name*="code" i], input[placeholder*="code" i], input[placeholder*="código" i], input[autocomplete="one-time-code"], input[maxlength="6"], input[type="tel"]');

                            if (digitInputs.length >= 4 || (singleCodeInput && isCodeScreen)) {
                              const targetInput = digitInputs.length > 0 ? digitInputs[0] : singleCodeInput;
                              const r = targetInput.getBoundingClientRect();
                              return {
                                step: 'code_input',
                                x: r.left + r.width / 2,
                                y: r.top + r.height / 2,
                                isDigits: digitInputs.length >= 4,
                                digitCount: digitInputs.length
                              };
                            }

                            if (!isVerifyScreen) return { step: 'not_found' };

                            // 3. Procurar o botão/opção "Palavra-passe" na lista de opções (1ª prioridade)
                            const candidates = Array.from(document.querySelectorAll('div, button, li, p, span, a'));
                            for (const el of candidates) {
                              const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                              if (t === 'palavra-passe' || t === 'password' || t === 'senha' || (t.startsWith('palavra-passe') && t.length < 25) || (t.startsWith('senha') && t.length < 20)) {
                                const clickTarget = el.closest('button, [role="button"], div[class*="item"], div[class*="Item"], div[class*="card"], li') || el;
                                const r = clickTarget.getBoundingClientRect();
                                if (r.width > 20 && r.height > 15) {
                                  clickTarget.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                  const r2 = clickTarget.getBoundingClientRect();
                                  return { step: 'click_option', x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, text: t, isEmail: false };
                                }
                              }
                            }

                            // 4. Se não houver "Palavra-passe", procurar a opção "E-mail" (2ª prioridade / quando é a única opção)
                            for (const el of candidates) {
                              const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                              if (t === 'e-mail' || t === 'email' || (t.startsWith('e-mail') && t.length < 25) || (t.startsWith('email') && t.length < 25) || /\w+[\*@]+\w+/.test(t) || /@\w+\.\w+/.test(t)) {
                                const clickTarget = el.closest('button, [role="button"], div[class*="item"], div[class*="Item"], div[class*="card"], div[class*="Card"], li') || el;
                                const r = clickTarget.getBoundingClientRect();
                                if (r.width > 20 && r.height > 15) {
                                  clickTarget.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                  const r2 = clickTarget.getBoundingClientRect();
                                  return { step: 'click_option', x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, text: t, isEmail: true };
                                }
                              }
                            }

                            // 5. Fallback: se é tela de verificação e há apenas um card/item de método clicável no modal
                            const modalBox = document.querySelector('div[class*="modal"], div[class*="Modal"], div[role="dialog"]') || document.body;
                            const methodCards = Array.from(modalBox.querySelectorAll('div[class*="item"], div[class*="Item"], div[class*="card"], div[class*="Card"], [role="button"], button, li')).filter(function(el) {
                              const r = el.getBoundingClientRect();
                              const txt = (el.innerText || el.textContent || '').trim();
                              return r.width > 80 && r.height > 25 && r.height < 120 && txt.length > 2 && !txt.includes('Verifica que') && !txt.includes('Antes de');
                            });
                            if (methodCards.length > 0) {
                              const firstCard = methodCards[0];
                              const r = firstCard.getBoundingClientRect();
                              return { step: 'click_option', x: r.left + r.width / 2, y: r.top + r.height / 2, text: 'single_method', isEmail: true };
                            }

                            return { step: 'modal_waiting' };
                          } catch { return { step: 'not_found' }; }
                        })()`;

                        const res: any = await cdpSend(ws, 'Runtime.evaluate', { expression: exprCheck, returnByValue: true }, targetSessionId).catch(() => null);
                        const data = res?.result?.value;
                        if (!data || data.step === 'not_found') return 'not_present';

                        if (data.step === 'click_option') {
                          const optName = data.isEmail ? 'E-mail' : 'Palavra-passe';
                          setBadge(`Modal "Verifica que és mesmo tu": selecionando opção ${optName}...`, '#f59e0b');
                          console.log(`[TIKTOK-VERIFY] Modal "Verifica que és mesmo tu" detectado! Clicando em "${optName}" em (${data.x}, ${data.y})...`);
                          await realClickAt(data.x, data.y, targetSessionId);
                          await new Promise(r => setTimeout(r, 2500));
                          return 'clicked_option';
                        }

                        if (data.step === 'code_input') {
                          const nowTs = Date.now();
                          if (nowTs - lastTikTok2FANotifTime > 45000) {
                            lastTikTok2FANotifTime = nowTs;
                            console.log('[TIKTOK-VERIFY] Tela de código de verificação detectada! Disparando chrome-request-2fa (e-mail) para o ADM...');
                            dispatch2FARequest({ profileId, partnerId, platform: 'tiktok', codeType: 'email_code', accountId: session.accountId, email: session.email }, event.sender);
                          }

                          const incomingCode = (session.lastCode || '').trim();
                          if (incomingCode && incomingCode.length >= 4) {
                            setBadge(`Injetando código de verificação (${incomingCode})...`, '#22c55e');
                            console.log(`[TIKTOK-VERIFY] Código 2FA recebido do ADM: ${incomingCode}. Injetando no TikTok...`);

                            const exprInjectCode = `(function() {
                              try {
                                var codeVal = ${JSON.stringify(incomingCode)};
                                function fireEvents(el) {
                                  ['focus','input','change','blur','keyup','keydown','keypress'].forEach(function(evt) {
                                    try { el.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true })); } catch(e) {}
                                  });
                                }
                                function setSingleVal(el, val) {
                                  if (!el) return false;
                                  try {
                                    var last = el.value;
                                    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                                                 Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
                                    if (setter) setter.call(el, val); else el.value = val;
                                    var t = el._valueTracker; if (t) t.setValue(last);
                                  } catch(e) { el.value = val; }
                                  fireEvents(el);
                                  return true;
                                }

                                // 1. Procurar inputs de dígitos individuais (maxlength=1)
                                var digitInputs = Array.from(document.querySelectorAll('input')).filter(function(inp) {
                                  var r = inp.getBoundingClientRect();
                                  return r.width > 12 && r.height > 12 && (inp.getAttribute('maxlength') === '1' || inp.getAttribute('data-e2e')?.indexOf('digit') > -1 || inp.className.indexOf('digit') > -1);
                                });

                                if (digitInputs.length >= codeVal.length) {
                                  for (var i = 0; i < codeVal.length; i++) {
                                    digitInputs[i].focus();
                                    setSingleVal(digitInputs[i], codeVal[i]);
                                  }
                                  // Verificar se os valores foram aplicados
                                  var allFilled = true;
                                  for (var j = 0; j < codeVal.length; j++) {
                                    if (digitInputs[j].value !== codeVal[j]) { allFilled = false; break; }
                                  }
                                  return { success: true, count: digitInputs.length, type: 'digits', allFilled: allFilled };
                                }

                                // 2. Procurar input único
                                var singleSelectors = [
                                  'input[data-e2e="verify-input"]',
                                  'input[name*="code" i]',
                                  'input[placeholder*="code" i]',
                                  'input[placeholder*="código" i]',
                                  'input[autocomplete="one-time-code"]',
                                  'input[maxlength="6"]',
                                  'input[type="number"][maxlength="6"]',
                                  'input[type="tel"]'
                                ];
                                for (var s = 0; s < singleSelectors.length; s++) {
                                  var inp = document.querySelector(singleSelectors[s]);
                                  if (inp) {
                                    var r = inp.getBoundingClientRect();
                                    if (r.width > 20 && r.height > 15) {
                                      inp.focus();
                                      setSingleVal(inp, codeVal);
                                      return { success: inp.value === codeVal, type: 'single', actualLen: inp.value.length };
                                    }
                                  }
                                }
                                return { success: false };
                              } catch(e) { return { success: false, err: e.message }; }
                            })()`;

                            const injectRes: any = await cdpSend(ws, 'Runtime.evaluate', { expression: exprInjectCode, returnByValue: true }, targetSessionId).catch(() => null);
                            const injectData = injectRes?.result?.value;
                            console.log(`[TIKTOK-VERIFY] Resultado da injeção de código:`, JSON.stringify(injectData));

                            // Se a injeção não preencheu completamente, usar Input.insertText via CDP como fallback
                            if (!injectData?.success || injectData?.allFilled === false) {
                              console.warn('[TIKTOK-VERIFY] Injeção via setter não preencheu totalmente. Usando Input.insertText CDP como fallback...');
                              // Focar o primeiro input de código e usar insertText
                              await cdpSend(ws, 'Runtime.evaluate', {
                                expression: `(function() {
                                  var digitInputs = Array.from(document.querySelectorAll('input')).filter(function(inp) {
                                    var r = inp.getBoundingClientRect();
                                    return r.width > 12 && r.height > 12 && (inp.getAttribute('maxlength') === '1' || inp.getAttribute('data-e2e')?.indexOf('digit') > -1 || inp.className.indexOf('digit') > -1);
                                  });
                                  if (digitInputs.length > 0) {
                                    // Limpar todos os inputs de dígitos
                                    digitInputs.forEach(function(inp) { inp.value = ''; });
                                    digitInputs[0].focus();
                                    return { type: 'digits', count: digitInputs.length };
                                  }
                                  var single = document.querySelector('input[data-e2e="verify-input"], input[name*="code" i], input[placeholder*="code" i], input[autocomplete="one-time-code"], input[maxlength="6"], input[type="tel"]');
                                  if (single) {
                                    single.value = '';
                                    single.focus();
                                    single.select();
                                    return { type: 'single' };
                                  }
                                  return null;
                                })()`
                              }, targetSessionId).catch(() => {});
                              await new Promise(r => setTimeout(r, 300));
                              // Digitar código via CDP Input.insertText char a char
                              for (const digit of incomingCode) {
                                await cdpSend(ws, 'Input.insertText', { text: digit }, targetSessionId).catch(() => {});
                                await new Promise(r => setTimeout(r, 120 + Math.random() * 80));
                              }
                            }
                            await new Promise(r => setTimeout(r, 600));

                            // Submeter código — usar coordenadas reais com scrollIntoView + realClickAt + element.click()
                            const exprSubmitCodeBtn = `(function() {
                              try {
                                var targetTexts = ['avan\\u00e7ar', 'avancar', 'log in', 'iniciar sess\\u00e3o', 'entrar', 'seguinte', 'next', 'confirmar', 'submit', 'sign in', 'verificar', 'verify'];
                                var btns = Array.from(document.querySelectorAll('button, button[type="submit"], div[role="button"], input[type="submit"]'));
                                for (var bi = 0; bi < btns.length; bi++) {
                                  var b = btns[bi];
                                  var t = (b.innerText || b.textContent || '').trim().toLowerCase();
                                  for (var ti = 0; ti < targetTexts.length; ti++) {
                                    if (t === targetTexts[ti] || t.indexOf(targetTexts[ti]) === 0) {
                                      var r = b.getBoundingClientRect();
                                      if (r.width > 20 && r.height > 15 && !b.disabled) {
                                        b.scrollIntoView({ block: 'center', behavior: 'instant' });
                                        var r2 = b.getBoundingClientRect();
                                        try { b.click(); } catch(e) {}
                                        try { b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch(e) {}
                                        return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, text: t };
                                      }
                                    }
                                  }
                                }
                                // Fallback: form.submit()
                                var anyInput = document.querySelector('input[data-e2e="verify-input"], input[maxlength="1"], input[maxlength="6"], input[type="tel"]');
                                if (anyInput) {
                                  var form = anyInput.closest('form');
                                  if (form) { try { form.submit(); } catch(e) {} return { x: 0, y: 0, text: 'form-submit' }; }
                                }
                                return null;
                              } catch(e) { return null; }
                            })()`;
                            const submitCodeRes: any = await cdpSend(ws, 'Runtime.evaluate', { expression: exprSubmitCodeBtn, returnByValue: true }, targetSessionId).catch(() => null);
                            if (submitCodeRes?.result?.value && submitCodeRes.result.value.x > 0) {
                              console.log(`[TIKTOK-VERIFY] Botão de envio de código clicado ("${submitCodeRes.result.value.text}"). Reforçando com realClickAt...`);
                              await realClickAt(submitCodeRes.result.value.x, submitCodeRes.result.value.y, targetSessionId);
                            } else if (!submitCodeRes?.result?.value) {
                              console.log('[TIKTOK-VERIFY] Botão de confirmação de código não encontrado, pressionando Enter...');
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }, targetSessionId).catch(() => {});
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }, targetSessionId).catch(() => {});
                            }

                            session.lastCode = '';
                            await new Promise(r => setTimeout(r, 3000));

                            // 🔍 Requisito: Verificar se o TikTok acusou código incorreto ou expirado
                            const checkTtCodeError: any = await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                try {
                                  var ttErrorPhrases = [
                                    'código de verificação incorreto',
                                    'incorrect verification code',
                                    'código incorreto',
                                    'código inválido',
                                    'invalid code',
                                    'código expirado',
                                    'code expired',
                                    'código de verificação expirou',
                                    'máximo de tentativas excedido',
                                    'too many attempts'
                                  ];
                                  var isTtError = false;
                                  var ttErrMsg = '';
                                  var allText = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                                  for (var t = 0; t < ttErrorPhrases.length; t++) {
                                    if (allText.includes(ttErrorPhrases[t])) {
                                      isTtError = true;
                                      ttErrMsg = ttErrorPhrases[t];
                                      break;
                                    }
                                  }

                                  var alertEl = document.querySelector('[role="alert"], div[class*="error" i], p[class*="error" i]');
                                  if (alertEl) {
                                    var alertTxt = (alertEl.innerText || '').toLowerCase();
                                    for (var t = 0; t < ttErrorPhrases.length; t++) {
                                      if (alertTxt.includes(ttErrorPhrases[t])) {
                                        isTtError = true;
                                        ttErrMsg = alertEl.innerText;
                                        break;
                                      }
                                    }
                                  }

                                  var inputStillPresent = !!document.querySelector('input[data-e2e="verify-input"], input[name*="code" i], input[maxlength="1"]');
                                  if (isTtError && inputStillPresent) {
                                    return { isError: true, message: ttErrMsg || 'Código de verificação incorreto ou expirado no TikTok' };
                                  }
                                  return { isError: false };
                                } catch(e) { return { isError: false }; }
                              })()`,
                              returnByValue: true
                            }, targetSessionId).catch(() => null);

                            if (checkTtCodeError?.result?.value?.isError) {
                              const errMsg = checkTtCodeError.result.value.message || 'Código de verificação incorreto ou expirado no TikTok';
                              console.warn(`[TIKTOK-VERIFY] ❌ Código incorreto detectado: "${errMsg}". Re-notificando ADM imediatamente...`);
                              setBadge('⚠️ Código 2FA incorreto! Solicitando novo código ao ADM...', '#ef4444');
                              session.lastCode = '';
                              // Limpar campos de input
                              await cdpSend(ws, 'Runtime.evaluate', {
                                expression: `(function() {
                                  try {
                                    var inputs = document.querySelectorAll('input');
                                    inputs.forEach(function(inp) {
                                      try {
                                        inp.value = '';
                                        var t = inp._valueTracker; if (t) t.setValue('');
                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                                      } catch(_) {}
                                    });
                                  } catch(_) {}
                                })()`
                              }, targetSessionId).catch(() => null);
                              lastTikTok2FANotifTime = 0; // Resetar throttle
                              dispatch2FARequest({ profileId, partnerId, platform: 'tiktok', codeType: 'email_code', isRetry: true, errorMessage: errMsg, accountId: session.accountId, email: session.email }, event.sender);
                              return 'waiting_code';
                            }

                            return 'typed_code';
                          }

                          setBadge('🔑 Código de verificação TikTok enviado ao e-mail! Aguardando código do ADM...', '#f59e0b');
                          return 'waiting_code';
                        }

                        if (data.step === 'password_input') {
                          if (!tiktokPass) {
                            setBadge('⚠️ Etapa "Palavra-passe" aberta no TikTok! Cadastre a senha da conta no ADM ou digite manualmente.', '#ef4444');
                            console.warn('[TIKTOK-VERIFY] Campo de senha da conta TikTok visível, mas tiktokPass não configurado.');
                            return 'waiting_manual';
                          }

                          setBadge('Digitando palavra-passe da conta TikTok...', '#38bdf8');
                          console.log(`[TIKTOK-VERIFY] Focando campo de senha do TikTok e inserindo credencial (${tiktokPass.length} caracteres)...`);
                    if (runInBackground || isQueueLogin) broadcastLoginEvent(partnerId, { type: 'login_progress', platform: 'tiktok', accountCode: profileId, email, detail: 'Digitando senha TikTok' });

                          // 1. Focar o campo de senha via CDP + click real
                          await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              var el = document.querySelector('input[type="password"]');
                              if (el) { el.focus(); el.select(); }
                            })()`
                          }, targetSessionId).catch(() => {});
                          await realClickAt(data.x, data.y, targetSessionId);
                          await new Promise(r => setTimeout(r, 600));

                          // 2. Limpar campo (Ctrl+A + Backspace)
                          await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }, targetSessionId).catch(() => {});
                          await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }, targetSessionId).catch(() => {});
                          await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }, targetSessionId).catch(() => {});
                          await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }, targetSessionId).catch(() => {});
                          await new Promise(r => setTimeout(r, 200));

                          // 3. Digitar a senha com Input.insertText (método confiável para campos React/TikTok)
                          for (const char of tiktokPass) {
                            await cdpSend(ws, 'Input.insertText', { text: char }, targetSessionId).catch(() => {});
                            await new Promise(r => setTimeout(r, 45 + Math.random() * 45));
                          }
                          await new Promise(r => setTimeout(r, 800));

                          // 4. Verificar se a senha foi realmente digitada no campo
                          const checkPwdFilled: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              var el = document.querySelector('input[type="password"]');
                              return el ? el.value.length : 0;
                            })()`,
                            returnByValue: true
                          }, targetSessionId).catch(() => null);
                          const pwdLen = checkPwdFilled?.result?.value || 0;
                          console.log(`[TIKTOK-VERIFY] Verificação pós-digitação: campo tem ${pwdLen} caracteres (esperado: ${tiktokPass.length})`);

                          // 5. Se o campo não preencheu, usar fallback com setter nativo do React
                          if (pwdLen < tiktokPass.length) {
                            console.warn('[TIKTOK-VERIFY] Campo de senha vazio após Input.insertText! Aplicando fallback com setter nativo...');
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="password"]');
                                if (!el) return false;
                                el.focus();
                                var lastVal = el.value;
                                var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                if (setter) { setter.call(el, ${JSON.stringify(tiktokPass)}); } else { el.value = ${JSON.stringify(tiktokPass)}; }
                                var tracker = el._valueTracker; if (tracker) tracker.setValue(lastVal);
                                el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                                el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
                                return true;
                              })()`
                            }, targetSessionId).catch(() => {});
                            await new Promise(r => setTimeout(r, 500));

                            // Se o setter também falhou, tentar execCommand
                            const check2: any = await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() { var el = document.querySelector('input[type="password"]'); return el ? el.value.length : 0; })()`,
                              returnByValue: true
                            }, targetSessionId).catch(() => null);
                            if ((check2?.result?.value || 0) < tiktokPass.length) {
                              console.warn('[TIKTOK-VERIFY] Setter nativo também falhou! Tentando execCommand + insertText CDP em bloco...');
                              await cdpSend(ws, 'Runtime.evaluate', {
                                expression: `(function() {
                                  var el = document.querySelector('input[type="password"]');
                                  if (el) { el.focus(); el.value = ''; document.execCommand('insertText', false, ${JSON.stringify(tiktokPass)}); }
                                })()`
                              }, targetSessionId).catch(() => {});
                              await new Promise(r => setTimeout(r, 300));
                              // Último recurso: Input.insertText em bloco
                              await cdpSend(ws, 'Runtime.evaluate', {
                                expression: `(function() { var el = document.querySelector('input[type="password"]'); if (el) { el.focus(); el.select(); } })()`
                              }, targetSessionId).catch(() => {});
                              await cdpSend(ws, 'Input.insertText', { text: tiktokPass }, targetSessionId).catch(() => {});
                              await new Promise(r => setTimeout(r, 500));
                            }
                          }
                          await new Promise(r => setTimeout(r, 500));

                          // 6. Submeter: primeiro tenta clicar o botão Avançar / Log in via coordenadas reais (CDP mouse events)
                          setBadge('Submetendo palavra-passe do TikTok...', '#22c55e');
                          console.log('[TIKTOK-VERIFY] Procurando botao Avancar/Log in para clicar...');

                          // Tentar submissão até 3 vezes (botão pode demorar a ativar)
                          let submitSuccess = false;
                          for (let submitAttempt = 0; submitAttempt < 3 && !submitSuccess; submitAttempt++) {
                            const exprSubmitBtn = `(function() {
                              try {
                                var targetTexts = ['avan\\u00e7ar', 'avancar', 'log in', 'iniciar sess\\u00e3o', 'entrar', 'seguinte', 'next', 'confirmar', 'submit', 'sign in', 'logar'];
                                var btns = Array.from(document.querySelectorAll('button, button[type="submit"], div[role="button"], input[type="submit"]'));
                                for (var bi = 0; bi < btns.length; bi++) {
                                  var b = btns[bi];
                                  var t = (b.innerText || b.textContent || '').trim().toLowerCase();
                                  for (var ti = 0; ti < targetTexts.length; ti++) {
                                    if (t === targetTexts[ti] || t.indexOf(targetTexts[ti]) === 0) {
                                      var r = b.getBoundingClientRect();
                                      if (r.width > 20 && r.height > 15 && !b.disabled) {
                                        b.scrollIntoView({ block: 'center', behavior: 'instant' });
                                        var r2 = b.getBoundingClientRect();
                                        return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, text: t };
                                      }
                                    }
                                  }
                                }
                                var pwdInput = document.querySelector('input[type="password"]');
                                if (pwdInput) {
                                  var container = pwdInput.closest('form, div[class*="modal"], div[class*="Modal"], div[class*="container"], div[class*="Container"]') || document.body;
                                  var allBtns = Array.from(container.querySelectorAll('button, button[type="submit"], div[role="button"], input[type="submit"]'));
                                  for (var fi = 0; fi < allBtns.length; fi++) {
                                    var fb = allBtns[fi];
                                    var fr = fb.getBoundingClientRect();
                                    if (fr.width > 50 && fr.height > 25 && !fb.disabled) {
                                      var fStyle = window.getComputedStyle(fb);
                                      var fbg = fStyle.backgroundColor || '';
                                      var fcn = fb.className ? fb.className.toLowerCase() : '';
                                      if (fbg.includes('254') || fbg.includes('255, 0') || fbg.includes('fe2c') || fcn.includes('primary') || fcn.includes('submit') || fcn.includes('confirm') || fcn.includes('btn-red') || fcn.includes('login')) {
                                        fb.scrollIntoView({ block: 'center', behavior: 'instant' });
                                        var fr2 = fb.getBoundingClientRect();
                                        return { x: fr2.left + fr2.width / 2, y: fr2.top + fr2.height / 2, text: 'primary-btn' };
                                      }
                                    }
                                  }
                                  // Último recurso: qualquer botão grande visível no container
                                  for (var gi = 0; gi < allBtns.length; gi++) {
                                    var gb = allBtns[gi];
                                    var gr = gb.getBoundingClientRect();
                                    if (gr.width > 80 && gr.height > 30 && !gb.disabled) {
                                      gb.scrollIntoView({ block: 'center', behavior: 'instant' });
                                      var gr2 = gb.getBoundingClientRect();
                                      return { x: gr2.left + gr2.width / 2, y: gr2.top + gr2.height / 2, text: 'container-btn' };
                                    }
                                  }
                                }
                                return null;
                              } catch(e) { return null; }
                            })()`;
                            const submitRes: any = await cdpSend(ws, 'Runtime.evaluate', { expression: exprSubmitBtn, returnByValue: true }, targetSessionId).catch(() => null);
                            if (submitRes?.result?.value) {
                              console.log(`[TIKTOK-VERIFY] Clicando botão de submit "${submitRes.result.value.text}" em (${submitRes.result.value.x}, ${submitRes.result.value.y}) [tentativa ${submitAttempt + 1}]...`);
                              await realClickAt(submitRes.result.value.x, submitRes.result.value.y, targetSessionId);
                              await new Promise(r => setTimeout(r, 800));
                              // Confirmar clique também via element.click() no JS para máxima compatibilidade
                              await cdpSend(ws, 'Runtime.evaluate', {
                                expression: `(function() {
                                  var targetTexts = ['avan\\u00e7ar', 'avancar', 'log in', 'iniciar sess\\u00e3o', 'entrar', 'seguinte', 'next', 'confirmar', 'submit', 'sign in', 'logar'];
                                  var btns = Array.from(document.querySelectorAll('button, button[type="submit"], div[role="button"]'));
                                  for (var bi = 0; bi < btns.length; bi++) {
                                    var b = btns[bi];
                                    var t = (b.innerText || b.textContent || '').trim().toLowerCase();
                                    for (var ti = 0; ti < targetTexts.length; ti++) {
                                      if (t === targetTexts[ti] || t.indexOf(targetTexts[ti]) === 0) {
                                        try { b.click(); } catch(e) {}
                                        try { b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch(e) {}
                                        return true;
                                      }
                                    }
                                  }
                                  // Fallback: submit o form inteiro
                                  var pwdInput = document.querySelector('input[type="password"]');
                                  if (pwdInput) {
                                    var form = pwdInput.closest('form');
                                    if (form) { try { form.submit(); } catch(e) {} return true; }
                                  }
                                  return false;
                                })()`
                              }, targetSessionId).catch(() => {});
                              submitSuccess = true;
                            } else {
                              if (submitAttempt < 2) {
                                console.log(`[TIKTOK-VERIFY] Botão não encontrado na tentativa ${submitAttempt + 1}, aguardando...`);
                                await new Promise(r => setTimeout(r, 1500));
                              }
                            }
                          }

                          if (!submitSuccess) {
                            // Fallback final: Enter e form.submit()
                            console.log('[TIKTOK-VERIFY] Nenhum botão encontrado após 3 tentativas. Usando Enter + form.submit()...');
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var pwdInput = document.querySelector('input[type="password"]');
                                if (pwdInput) {
                                  var form = pwdInput.closest('form');
                                  if (form) { try { form.submit(); } catch(e) {} return 'form'; }
                                  try { pwdInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); } catch(e) {}
                                  return 'keydown';
                                }
                                return 'none';
                              })()`
                            }, targetSessionId).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }, targetSessionId).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }, targetSessionId).catch(() => {});
                          }

                          await new Promise(r => setTimeout(r, 4000));
                          return 'typed_password';
                        }

                        return 'not_present';
                      } catch (err) {
                        console.warn('[TIKTOK-VERIFY] Erro ao tratar modal de verificação:', err);
                        return 'not_present';
                      }
                    };

                    const activePopupIds = new Set<string>();

                    // ── Polling direto no endpoint HTTP /json/list do Chrome ──
                    // Permite descobrir qualquer popup/janela externa criada para o Google OAuth
                    const pollForGooglePopup = async (): Promise<{ id: string; url: string; webSocketDebuggerUrl: string } | null> => {
                      return new Promise((resolve) => {
                        const req = http.get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
                          let data = '';
                          res.on('data', (c) => (data += c));
                          res.on('end', () => {
                            try {
                              const tabs = JSON.parse(data) as Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string; title?: string }>;
                              for (const tab of tabs) {
                                if (!tab.id || tab.id === session.mainTargetId) continue;
                                if (!tab.webSocketDebuggerUrl) continue;
                                const tabUrl = (tab.url || '').toLowerCase();
                                const tabTitle = (tab.title || '').toLowerCase();
                                if (
                                  tabUrl.includes('accounts.google.') ||
                                  tabUrl.includes('google.com/signin') ||
                                  tabUrl.includes('google.com/o/oauth2') ||
                                  tabUrl.includes('google.com') ||
                                  tabUrl.includes('oauth') ||
                                  tabTitle.includes('contas google') ||
                                  tabTitle.includes('iniciar sessão') ||
                                  tabTitle.includes('fazer login') ||
                                  tabTitle.includes('sign in') ||
                                  tabTitle.includes('google')
                                ) {
                                  resolve({ id: tab.id, url: tab.url, webSocketDebuggerUrl: tab.webSocketDebuggerUrl });
                                  return;
                                }
                              }
                              resolve(null);
                            } catch {
                              resolve(null);
                            }
                          });
                        });
                        req.on('error', () => resolve(null));
                        req.setTimeout(2000, () => { req.destroy(); resolve(null); });
                      });
                    };


                    // ── Utilitário: aguardar página carregar completamente 100% ──
                    const waitPageReady = async (timeoutMs = 6000): Promise<boolean> => {
                      const start = Date.now();
                      while (Date.now() - start < timeoutMs) {
                        const r: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            if (document.readyState !== 'complete' && document.readyState !== 'interactive') return false;
                            if (!document.body || document.body.childElementCount === 0) return false;
                            return !!document.querySelector('header, nav, aside, main, #header-login-button, button, [role="button"]');
                          })()`,
                          returnByValue: true
                        }).catch(() => null);
                        if (r?.result?.value) {
                          await new Promise(r2 => setTimeout(r2, 600));
                          return true;
                        }
                        await new Promise(r2 => setTimeout(r2, 300));
                      }
                      return false;
                    };

                    // ── Automação Google Unificada Estilo YouTube para TikTok (Foco Humano + Blindagens) ──
                    const runGoogleLoginForTikTok = async (wsTarget: WebSocket, email: string, pass: string): Promise<boolean> => {
                      console.log(`[TIKTOK-GOOGLE-LOGIN] Iniciando automação Google estilo YouTube para ${email}...`);
                      setBadge('Aguardando carregamento do Google...', '#38bdf8');

                      // Ativar protocolos CDP no alvo (idêntico ao YouTube)
                      await cdpSend(wsTarget, 'Page.enable').catch(() => {});
                      await cdpSend(wsTarget, 'Runtime.enable').catch(() => {});
                      await cdpSend(wsTarget, 'DOM.enable').catch(() => {});
                      await cdpSend(wsTarget, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
                      if (!runInBackground) {
                        await cdpSend(wsTarget, 'Page.bringToFront').catch(() => {});
                      } else {
                        try {
                          const winForTarget: any = await cdpSend(wsTarget, 'Browser.getWindowForTarget', {}).catch(() => null);
                          if (winForTarget?.windowId != null) {
                            await cdpSend(wsTarget, 'Browser.setWindowBounds', {
                              windowId: winForTarget.windowId,
                              bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                            }).catch(() => {});
                          }
                        } catch (_) {}
                        if (session.process?.pid) {
                          startBackgroundWindowKeeper(session.process.pid);
                          setProcessTaskbarVisibility(session.process.pid, false);
                        }
                      }

                      // Aguardo reativo inicial (máx 3.5s)
                      for (let gw = 0; gw < 18; gw++) {
                        await new Promise(r => setTimeout(r, 200));
                        const readyCheck: any = await cdpSend(wsTarget, 'Runtime.evaluate', {
                          expression: `document.readyState === 'complete' && (!!document.querySelector('input, #identifierId, [data-identifier]') || window.location.href.includes('google.'))`,
                          returnByValue: true
                        }).catch(() => null);
                        if (readyCheck?.result?.value) break;
                      }

                      const effUser = (email || googleEmail || session.email || '').trim();
                      const effPass = (pass || googlePass || session.pass || '').trim();

                      // Log dos valores efetivos (diagnóstico em produção)
                      try {
                        const logPathInner = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), '2am-login-debug.log');
                        const tsInner = new Date().toISOString();
                        fsSync.appendFileSync(logPathInner, `[${tsInner}] [TIKTOK-GOOGLE-FN] effUser="${effUser}" effPass=${effPass ? 'OK(' + effPass.length + ')' : '(vazio)'}\n`, 'utf8');
                      } catch (_) {}

                      let emailSubmitted = false;
                      let passSubmitted = false;
                      let lastNotifTime = 0;

                      // 1. Injetar Privacy Shield inicial (mascara inputs com bolinhas pretas disc, censura exibição do e-mail)
                      await injectPrivacyShield(wsTarget, effUser);

                      for (let sec = 0; sec < 180; sec++) {
                        if (!session.process || session.process.killed) break;

                        // Re-injetar Privacy Shield em cada navegação de página do Google
                        await injectPrivacyShield(wsTarget, effUser);

                        // Checar URL atual
                        const urlRes: any = await cdpSend(wsTarget, 'Runtime.evaluate', {
                          expression: 'window.location.href',
                          returnByValue: true
                        }).catch(() => null);
                        const curUrl = (urlRes?.result?.value || '').toLowerCase();

                        // ── 1. Sucesso: Chegou fora de accounts.google.com ou cookies confirmados ──
                        const isGoogleAuth = curUrl.includes('accounts.google.') || curUrl.includes('/signin') || curUrl.includes('/servicelogin') || curUrl.includes('/challenge') || curUrl.includes('/speedbump');

                        if (!isGoogleAuth && (curUrl.includes('myaccount.google.com') || curUrl.includes('google.com') || curUrl.includes('tiktok.com'))) {
                          console.log(`[TIKTOK-GOOGLE-LOGIN] ✅ URL fora de accounts.google detectada: ${curUrl}`);
                          return true;
                        }

                        // Checar cookies de autenticação Google completa (SID, SSID)
                        const cookieRes: any = await cdpSend(wsTarget, 'Network.getCookies', {
                          urls: ['https://accounts.google.com', 'https://google.com', 'https://myaccount.google.com']
                        }).catch(() => null);
                        const cookies = cookieRes?.cookies || [];
                        const hasSid = cookies.some((c: any) => c.name === 'SID' && c.value && c.value.length > 20);
                        const hasSsid = cookies.some((c: any) => c.name === 'SSID' && c.value && c.value.length > 20);

                        if (hasSid && hasSsid && !curUrl.includes('accounts.google.') && !curUrl.includes('/signin') && !curUrl.includes('/servicelogin') && !curUrl.includes('/challenge')) {
                          console.log('[TIKTOK-GOOGLE-LOGIN] ✅ Sessão Google confirmada via cookies SID+SSID fora de accounts.google!');
                          return true;
                        }

                        // ── 2. Avaliar Estado da Página com Coordenadas Humanas (Loop YouTube) ──
                        const pageAction: any = await cdpSend(wsTarget, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              var url = window.location.href.toLowerCase();
                              var body = document.body;
                              var bodyText = (body ? (body.innerText || body.textContent || '') : '').toLowerCase().replace(/\\s+/g,' ');

                              // Cookie Consent
                              var cookieBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(function(el) {
                                var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                return t.includes('accept all') || t.includes('aceitar tudo') || t.includes('i agree') || t.includes('concordo') || t.includes('agree') || t.includes('accept');
                              });
                              if (cookieBtn) {
                                var cbr = cookieBtn.getBoundingClientRect();
                                if (cbr.width > 20 && cbr.height > 15) return { action: 'cookie_consent', coords: { x: cbr.left + cbr.width/2, y: cbr.top + cbr.height/2 } };
                              }

                              // Account Chooser
                              // Ativa apenas se a URL ou o texto indicar explicitamente seleção de contas
                              var hasEmailInput = !!document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                              var isChooser = !hasEmailInput && (
                                url.includes('/accountchooser') || url.includes('chooseaccount') ||
                                url.includes('selectaccount') ||
                                bodyText.includes('choose an account') || bodyText.includes('escolher uma conta') ||
                                bodyText.includes('escolha uma conta') || bodyText.includes('select an account')
                              );
                              if (isChooser) {
                                var effClean = (${JSON.stringify(effUser)} || '').toLowerCase();
                                var effUserPart = effClean ? effClean.split('@')[0] : '';
                                var accts = Array.from(document.querySelectorAll('[data-identifier], div.VV3oRb, div.pGzURd, div.yAlK0b, li[role="listitem"], div[role="listitem"], .OVnw0d, div[data-email]'));
                                var matched = null;
                                for (var i = 0; i < accts.length; i++) {
                                  var at = (accts[i].getAttribute('data-identifier') || accts[i].innerText || accts[i].textContent || '').toLowerCase();
                                  if (effClean && at.includes(effClean)) { matched = accts[i]; break; }
                                  if (effUserPart && effUserPart.length >= 3 && at.includes(effUserPart)) { matched = accts[i]; break; }
                                }
                                if (!matched && accts.length > 0) {
                                  for (var j = 0; j < accts.length; j++) {
                                    var jt = (accts[j].innerText || accts[j].textContent || '').toLowerCase();
                                    if (jt.includes('@') || jt.includes('gmail')) { matched = accts[j]; break; }
                                  }
                                  if (!matched) matched = accts[0];
                                }
                                if (matched) {
                                  var targetCard = matched.closest('li, div[role="link"], div[role="button"], div.VV3oRb, div.pGzURd') || matched;
                                  var ar = targetCard.getBoundingClientRect();
                                  if (ar.width > 20 && ar.height > 15) return { action: 'choose_account', coords: { x: ar.left + ar.width/2, y: ar.top + ar.height/2 } };
                                }
                                var anotherBtn = Array.from(document.querySelectorAll('li, div[role="button"], button')).find(function(el) {
                                  var t = (el.innerText || el.textContent || '').toLowerCase();
                                  return t.includes('use another account') || t.includes('utilizar outra conta') || t.includes('add account');
                                });
                                if (anotherBtn) {
                                  var abr = anotherBtn.getBoundingClientRect();
                                  if (abr.width > 20 && abr.height > 15) return { action: 'choose_account', coords: { x: abr.left + abr.width/2, y: abr.top + abr.height/2 } };
                                }
                              }

                              // Campo de E-mail
                              var emailInput = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                              if (emailInput && !emailInput.disabled && (emailInput.offsetParent !== null || emailInput.getClientRects().length > 0)) {
                                var r = emailInput.getBoundingClientRect();
                                if (r.width > 30 && r.height > 15) {
                                  var nextBtn = document.querySelector('#identifierNext button, #identifierNext, button[jsname="LgbsSe"], div[jsname="LgbsSe"], button[type="submit"]');
                                  var nb = nextBtn ? nextBtn.getBoundingClientRect() : null;
                                  return {
                                    action: 'email_field',
                                    inputCoords: { x: r.left + r.width/2, y: r.top + r.height/2 },
                                    btnCoords: nb && nb.width > 10 ? { x: nb.left + nb.width/2, y: nb.top + nb.height/2 } : null,
                                    currentValue: emailInput.value || ''
                                  };
                                }
                              }

                              // Campo de Senha
                              var passInput = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                              if (passInput && !passInput.disabled && passInput.offsetParent !== null) {
                                var pr = passInput.getBoundingClientRect();
                                if (pr.width > 30 && pr.height > 15) {
                                  var pwBtn = document.querySelector('#passwordNext button, #passwordNext, button[jsname="LgbsSe"], div[jsname="LgbsSe"], button[type="submit"]');
                                  var pb = pwBtn ? pwBtn.getBoundingClientRect() : null;
                                  return {
                                    action: 'pass_field',
                                    inputCoords: { x: pr.left + pr.width/2, y: pr.top + pr.height/2 },
                                    btnCoords: pb && pb.width > 10 ? { x: pb.left + pb.width/2, y: pb.top + pb.height/2 } : null,
                                    currentValue: passInput.value || ''
                                  };
                                }
                              }

                              // ── Selfie / Vídeo do rosto: Google pede selfie para verificação → clicar "Agora não" para pular ──
                              var bodyClean = (document.body ? (document.body.innerText || document.body.textContent || '') : '').toLowerCase();
                              var isSelfieScreen = bodyClean.includes('selfie') || bodyClean.includes('breve vídeo') || bodyClean.includes('breve video') ||
                                bodyClean.includes('grave um') || bodyClean.includes('adicione uma selfie') || bodyClean.includes('add a selfie') ||
                                bodyClean.includes('record a short video') || bodyClean.includes('gravar um vídeo') || bodyClean.includes('gravar um video') ||
                                bodyClean.includes('vídeo da sua cara') || bodyClean.includes('video da sua cara') ||
                                url.includes('/speedbump/') || url.includes('/signinanswer') || url.includes('/challenge/ipp') || url.includes('/challenge/iap');
                              if (isSelfieScreen) {
                                var allCandidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], span, div'));
                                var skipSelfieBtn = null;
                                for (var sbi = 0; sbi < allCandidates.length; sbi++) {
                                  var rawBtn = allCandidates[sbi];
                                  var btnEl = rawBtn.closest('button, a, [role="button"], [role="link"]') || rawBtn;
                                  var bt = (btnEl.innerText || btnEl.textContent || '').trim().toLowerCase();
                                  if (!bt || bt.length > 50) continue;
                                  if (
                                    bt === 'agora não' || bt === 'agora nao' || bt === 'not now' || bt === 'skip' ||
                                    bt === 'ignorar' || bt === 'talvez mais tarde' || bt === 'maybe later' ||
                                    bt === 'não agora' || bt === 'nao agora' || bt === 'ahora no' ||
                                    bt === 'não, obrigado' || bt === 'nao, obrigado' || bt === 'no thanks' ||
                                    bt === 'cancelar' || bt === 'cancel' ||
                                    bt.includes('agora não') || bt.includes('agora nao') || bt.includes('not now') || bt.includes('ahora no')
                                  ) {
                                    var sbr = btnEl.getBoundingClientRect();
                                    if (sbr.width > 5 && sbr.height > 5 && sbr.width < 500 && sbr.height < 150) {
                                      skipSelfieBtn = btnEl;
                                      break;
                                    }
                                  }
                                }
                                if (skipSelfieBtn) {
                                  try { skipSelfieBtn.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(_) {}
                                  try { skipSelfieBtn.focus(); } catch(_) {}
                                  try { skipSelfieBtn.click(); } catch(_) {}
                                  var ssr = skipSelfieBtn.getBoundingClientRect();
                                  if (ssr.width > 5 && ssr.height > 5) {
                                    return { action: 'selfie_skip', coords: { x: ssr.left + ssr.width/2, y: ssr.top + ssr.height/2 } };
                                  }
                                }
                              }

                              // Consentimento / Not Now / Continuar / Confirmar / Permitir
                              // NUNCA disparar consent em páginas de challenge — isAnyChallengePage trata-as
                              if (!url.includes('/challenge')) {
                                var unchk = document.querySelector('input[type="checkbox"]:not(:checked)');
                                if (unchk) {
                                  try { unchk.click(); } catch(_) {}
                                  var cr = unchk.getBoundingClientRect();
                                  if (cr.width > 10 && cr.height > 10) return { action: 'consent_click', coords: { x: cr.left + cr.width/2, y: cr.top + cr.height/2 } };
                                }

                                var consentBtn = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]')).find(function(el) {
                                  var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                  if (t.includes('não') && !t.includes('agora não') && !t.includes('not now')) return false;
                                  if (t.includes('cancel') || t.includes('recusar') || t.includes('negar')) return false;
                                  return t === 'agora não' || t === 'não agora' || t === 'not now' ||
                                         t === 'continuar' || t === 'continue' ||
                                         t === 'permitir' || t === 'allow' ||
                                         t === 'aceder' || t === 'access' ||
                                         t === 'confirmar' || t === 'aceitar' || t === 'concordo' ||
                                         t === 'seguinte' || t === 'next' || t === 'avançar' ||
                                         t.includes('continuar') || t.includes('permitir') || t.includes('aceder') ||
                                         t.includes('continue') || t.includes('allow') || t.includes('concordo');
                                });
                                if (consentBtn) {
                                  try { consentBtn.click(); } catch(_) {}
                                  var cbr2 = consentBtn.getBoundingClientRect();
                                  if (cbr2.width > 20 && cbr2.height > 15) return { action: 'consent_click', coords: { x: cbr2.left + cbr2.width/2, y: cbr2.top + cbr2.height/2 } };
                                }

                                var directConsent = document.querySelector('#submit_approve_access, button[data-idom-class*="consent"], #confirm, button[jsname="LgbsSe"], div[jsname="LgbsSe"], button[type="submit"]');
                                if (directConsent) {
                                  var dt = (directConsent.innerText || directConsent.textContent || '').toLowerCase();
                                  if (!dt.includes('cancel') && !dt.includes('não') && !dt.includes('recusar')) {
                                    try { directConsent.click(); } catch(_) {}
                                    var dcr = directConsent.getBoundingClientRect();
                                    if (dcr.width > 20 && dcr.height > 15) return { action: 'consent_click', coords: { x: dcr.left + dcr.width/2, y: dcr.top + dcr.height/2 } };
                                  }
                                }
                              }

                              // ══════════════════════════════════════════════════════════════════
                              // LÓGICA UNIFICADA: QUALQUER ecrã de verificação → SEMPRE navegar
                              // para o método de código offline (telemóvel/tablet).
                              // O bot NUNCA aceita passkey, notificação push, número de telefone, etc.
                              // Só entra o código quando JÁ estiver no ecrã de código offline.
                              // ══════════════════════════════════════════════════════════════════

                              // URLs conhecidas de qualquer ecrã de verificação/desafio do Google
                              var isAnyChallengePage = url.includes('/challenge') || url.includes('/signin/v2/challenge') ||
                                url.includes('/signin/challenge');

                              if (isAnyChallengePage) {
                                // Helper: encontrar botão pelo texto, suportando BUTTON Material e LI
                                var findBtnByText = function(texts) {
                                  var allEls = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], li, span'));
                                  var candidates = [];
                                  for (var bi = 0; bi < allEls.length; bi++) {
                                    var rawEl = allEls[bi];
                                    var el = rawEl.closest('button, a, [role="button"], [role="link"], li') || rawEl;
                                    var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                    if (!t || t.length > 100) continue;
                                    for (var ti = 0; ti < texts.length; ti++) {
                                      if (t.includes(texts[ti])) {
                                        var r = el.getBoundingClientRect();
                                        if (r.width > 5 && r.height > 5 && r.width < 600 && r.height < 150) {
                                          candidates.push({ el: el, tLen: t.length });
                                          break;
                                        }
                                      }
                                    }
                                  }
                                  if (candidates.length === 0) {
                                    for (var bi2 = 0; bi2 < allEls.length; bi2++) {
                                      var rawEl2 = allEls[bi2];
                                      var el2 = rawEl2.closest('button, a, [role="button"], [role="link"], li') || rawEl2;
                                      var t2 = (el2.innerText || el2.textContent || '').trim().toLowerCase();
                                      if (!t2 || t2.length > 100) continue;
                                      for (var ti2 = 0; ti2 < texts.length; ti2++) {
                                        if (t2.includes(texts[ti2])) {
                                          candidates.push({ el: el2, tLen: t2.length });
                                          break;
                                        }
                                      }
                                    }
                                  }
                                  if (candidates.length === 0) return null;
                                  candidates.sort(function(a, b) { return a.tLen - b.tLen; });
                                  return candidates[0].el;
                                };

                                // ── PRIORIDADE 1: Opção de código offline já visível na lista? ──
                                // (DEVE ser sempre verificada ANTES de qualquer outra coisa)
                                var offlineBtn = findBtnByText([
                                  'usar o telemóvel ou o tablet para obter um código de segurança',
                                  'use your phone or tablet to get a security code',
                                  'usar o telemóvel', 'usar o tablet', 'usar o smartphone',
                                  'use phone or tablet', 'sem ligação', 'sin conexión',
                                  'get a security code', 'obter um código'
                                ]);
                                if (offlineBtn) {
                                  var ot = (offlineBtn.innerText || '').toLowerCase();
                                  var isReallyOffline = (ot.includes('offline') || ot.includes('sem ligação') || ot.includes('sin conexión') ||
                                    ((ot.includes('código') || ot.includes('code')) && (ot.includes('telemóvel') || ot.includes('tablet') || ot.includes('phone') || ot.includes('offline'))) ||
                                    (ot.includes('usar o telemóvel') || ot.includes('usar o tablet')));
                                  if (!isReallyOffline) offlineBtn = null;
                                }
                                if (offlineBtn) {
                                  try { offlineBtn.click(); } catch(_) {}
                                  var obr = offlineBtn.getBoundingClientRect();
                                  return { action: 'google_choose_offline', coords: { x: obr.left + obr.width/2, y: obr.top + obr.height/2 } };
                                }

                                // ── PRIORIDADE 1.5: Na tela de seleção (/challenge/selection), se não houver opção offline, clicar em SMS ou código de segurança ──
                                if (url.includes('/challenge/selection')) {
                                  var altCodeBtn = findBtnByText([
                                    'receber um código', 'receber código', 'obter um código', 'mensagem de texto', 'sms',
                                    'código de segurança', 'código de 8 dígitos', 'codigos de seguranca', 'cópia de segurança',
                                    'get a verification code', 'text message', 'security code', '8-digit', 'email', 'e-mail'
                                  ]);
                                  if (altCodeBtn) {
                                    try { altCodeBtn.click(); } catch(_) {}
                                    var acbr = altCodeBtn.getBoundingClientRect();
                                    if (acbr.width > 5 && acbr.height > 5) {
                                      return { action: 'google_choose_offline', coords: { x: acbr.left + acbr.width/2, y: acbr.top + acbr.height/2 } };
                                    }
                                  }
                                }

                                // ── PRIORIDADE 2: Clicar "Mais formas de validação" / "Experimentar outra forma" em QUALQUER ecrã ──
                                if (!url.includes('/challenge/ootp') && !url.includes('/challenge/totp') && !url.includes('/challenge/selection')) {
                                  var promptNumber = null;
                                  if (url.includes('/challenge/dp') || (document.body && (document.body.innerText.includes('Consulte o seu') || document.body.innerText.includes('Check your')))) {
                                    var fullBodyText = document.body ? document.body.innerText : '';
                                    var matchNum = fullBodyText.match(/toque em\s+(\d+)\s+no\s+telem/i) ||
                                                   fullBodyText.match(/tap\s+(\d+)\s+on\s+your\s+phone/i) ||
                                                   fullBodyText.match(/toque em\s+(\d+)/i) ||
                                                   fullBodyText.match(/tap\s+(\d+)/i);
                                    if (matchNum && matchNum[1]) {
                                      promptNumber = matchNum[1];
                                    }
                                  }

                                  var tryOtherBtn = findBtnByText([
                                    'mais formas de validação', 'mais formas de validacao', 'formas de validação', 'formas de validacao',
                                    'mais formas', 'outras formas de validação', 'outras formas de validacao', 'outras formas',
                                    'experimentar outra forma', 'try another way', 'outra forma', 'tentar de outra forma',
                                    'more ways to verify', 'more ways', 'other ways', 'different way',
                                    'essayez autrement', 'prueba de otra forma', 'andere methode',
                                    'try a different', 'more options', 'mais opções', 'mais opcoes', 'another way', 'another method'
                                  ]);
                                  if (tryOtherBtn) {
                                    try { tryOtherBtn.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(_) {}
                                    try { tryOtherBtn.focus(); } catch(_) {}
                                    try { tryOtherBtn.click(); } catch(_) {}
                                    var ctbr = tryOtherBtn.getBoundingClientRect();
                                    return {
                                      action: 'google_phone_try_other',
                                      coords: ctbr.width > 2 ? { x: ctbr.left + ctbr.width/2, y: ctbr.top + ctbr.height/2 } : { x: 948, y: 604 },
                                      promptNumber: promptNumber
                                    };
                                  }
                                }

                                // ── PRIORIDADE 3 (ÚLTIMA): Campo de código offline ──
                                // SÓ ativar em páginas de introdução de código — NUNCA em /challenge/selection
                                var isCodePage = !url.includes('/challenge/selection') && !url.includes('/challenge/iap') &&
                                  !url.includes('/challenge/dp') && !url.includes('/challenge/pk/') && !url.includes('/challenge/ipp');
                                if (isCodePage) {
                                  var codeInput2 = document.querySelector('input[autocomplete="one-time-code"], input[name="totpPin"], input[name="code"], input[name="Pin"], #totpPin, #idvPin') ||
                                    Array.from(document.querySelectorAll('input[type="tel"], input[type="text"], input[inputmode="numeric"]')).find(function(el2) {
                                      if (el2.disabled || el2.type === 'hidden' || el2.offsetParent === null) return false;
                                      var r2 = el2.getBoundingClientRect();
                                      if (r2.width <= 20 || r2.height <= 10) return false;
                                      var n2 = (el2.name || el2.id || el2.getAttribute('aria-label') || el2.placeholder || '').toLowerCase();
                                      return !n2.includes('phone') && !n2.includes('telefone') && !n2.includes('email') && !n2.includes('telemóvel') && !n2.includes('número');
                                    }) || null;
                                  if (codeInput2) {
                                    var ci2 = codeInput2.getBoundingClientRect();
                                    if (ci2.width > 20 && ci2.height > 10) {
                                      var submitBtn3 = document.querySelector('#totpNext button, #totpNext, button[jsname="LgbsSe"], button[type="submit"]') ||
                                        Array.from(document.querySelectorAll('button')).find(function(el3) {
                                          var t3 = (el3.innerText || el3.textContent || '').toLowerCase();
                                          return t3.includes('seguinte') || t3.includes('next') || t3.includes('confirm') || t3.includes('enviar') || t3.includes('verify');
                                        });
                                      var sb3 = submitBtn3 ? submitBtn3.getBoundingClientRect() : null;
                                      return {
                                        action: 'google_2fa',
                                        inputCoords: { x: ci2.left + ci2.width/2, y: ci2.top + ci2.height/2 },
                                        btnCoords: sb3 && sb3.width > 10 ? { x: sb3.left + sb3.width/2, y: sb3.top + sb3.height/2 } : null
                                      };
                                    }
                                  }
                                }
                              }

                              return { action: 'none' };
                            } catch(e) { return { action: 'error' }; }
                          })()`,
                          returnByValue: true
                        }).catch(() => null);

                        const pa = pageAction?.result?.value;
                        console.log(`[TIKTOK-GOOGLE-LOOP] sec=${sec} action=${pa?.action} url=${curUrl.substring(0, 70)}`);
                        try {
                          const _logP = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), '2am-login-debug.log');
                          fsSync.appendFileSync(_logP, `[${new Date().toISOString()}] [TIKTOK-GOOGLE-FN] sec=${sec} action=${pa?.action} url=${curUrl.substring(0, 100)}\n`, 'utf8');
                        } catch (_) {}

                        // A. Cookie Consent
                        if (pa?.action === 'cookie_consent' && pa.coords) {
                          console.log('[TIKTOK-GOOGLE-LOGIN] Aceitando cookies...');
                          await realClickAt(pa.coords.x, pa.coords.y, undefined, wsTarget);
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // B. Account Chooser
                        if (pa?.action === 'choose_account' && pa.coords) {
                          console.log('[TIKTOK-GOOGLE-LOGIN] Selecionando conta no chooser...');
                          setBadge('A selecionar conta Google...', '#38bdf8');
                          await realClickAt(pa.coords.x, pa.coords.y, undefined, wsTarget);
                          await new Promise(r => setTimeout(r, 2500));
                          continue;
                        }

                        // C. Campo de E-mail
                        if (pa?.action === 'email_field' && effUser) {
                          if (emailSubmitted && (pa.currentValue || '').toLowerCase().includes(effUser.split('@')[0].toLowerCase())) {
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                          }
                          console.log('[TIKTOK-GOOGLE-LOGIN] Campo de e-mail localizado. Preenchendo com padrão YouTube...');
                          setBadge('Preenchendo e-mail protegido...', '#38bdf8');

                          if (pa.inputCoords) {
                            // Assegurar foco no elemento
                            await cdpSend(wsTarget, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                                if (el) { el.focus(); }
                              })()`
                            }).catch(() => {});

                            await realClickAt(pa.inputCoords.x, pa.inputCoords.y, undefined, wsTarget);
                            await new Promise(r => setTimeout(r, 400));

                            // Limpar campo via Ctrl+A + Backspace
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 150));

                            // Digitar via typeHuman idêntico ao YouTube (sem interferir no DOM)
                            await typeHuman(effUser, undefined, wsTarget);
                            await new Promise(r => setTimeout(r, 500));

                            // Garantir preenchimento seguro mesmo em segundo plano
                            await cdpSend(wsTarget, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                                if (el && (!el.value || el.value.trim().length === 0)) {
                                  el.focus();
                                  document.execCommand('insertText', false, ${JSON.stringify(effUser)});
                                  if (!el.value) {
                                    el.value = ${JSON.stringify(effUser)};
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                }
                              })()`
                            }).catch(() => {});
                          }

                          if (pa.btnCoords) {
                            await realClickAt(pa.btnCoords.x, pa.btnCoords.y, undefined, wsTarget);
                          } else {
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                          }
                          emailSubmitted = true;
                          console.log('[TIKTOK-GOOGLE-LOGIN] E-mail submetido! Aguardando próxima tela...');
                          for (let pw = 0; pw < 20; pw++) {
                            await new Promise(r => setTimeout(r, 200));
                            const hasNext: any = await cdpSend(wsTarget, 'Runtime.evaluate', {
                              expression: `!!document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"]') || window.location.href.includes('/challenge')`,
                              returnByValue: true
                            }).catch(() => null);
                            if (hasNext?.result?.value) break;
                          }
                          continue;
                        }

                        // D. Campo de Senha
                        if (pa?.action === 'pass_field' && effPass) {
                          if (passSubmitted) {
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                          }
                          console.log('[TIKTOK-GOOGLE-LOGIN] Campo de senha localizado. Preenchendo com padrão YouTube...');
                          setBadge('Preenchendo senha protegida...', '#38bdf8');

                          if (pa.inputCoords) {
                            // Assegurar foco no elemento de senha
                            await cdpSend(wsTarget, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                                if (el) { el.focus(); }
                              })()`
                            }).catch(() => {});

                            await realClickAt(pa.inputCoords.x, pa.inputCoords.y, undefined, wsTarget);
                            await new Promise(r => setTimeout(r, 400));

                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 150));

                            // Digitar via typeHuman idêntico ao YouTube
                            await typeHuman(effPass, undefined, wsTarget);
                            await new Promise(r => setTimeout(r, 500));

                            // Garantir preenchimento seguro de senha mesmo em segundo plano
                            await cdpSend(wsTarget, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                                if (el && (!el.value || el.value.trim().length === 0)) {
                                  el.focus();
                                  document.execCommand('insertText', false, ${JSON.stringify(effPass)});
                                  if (!el.value) {
                                    el.value = ${JSON.stringify(effPass)};
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                }
                              })()`
                            }).catch(() => {});
                          }

                          if (pa.btnCoords) {
                            await realClickAt(pa.btnCoords.x, pa.btnCoords.y, undefined, wsTarget);
                          } else {
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                          }
                          passSubmitted = true;
                          console.log('[TIKTOK-GOOGLE-LOGIN] Senha submetida! Aguardando autenticação Google...');
                          setBadge('Autenticando no Google...', '#38bdf8');
                          for (let pw = 0; pw < 25; pw++) {
                            await new Promise(r => setTimeout(r, 200));
                            const curUrlRes: any = await cdpSend(wsTarget, 'Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }).catch(() => null);
                            const u = (curUrlRes?.result?.value || '').toLowerCase();
                            if (u.includes('tiktok.com') || u.includes('/challenge') || !u.includes('accounts.google.com')) break;
                          }
                          continue;
                        }

                        // E. Consentimento / Not Now / Continuar / Pular Selfie
                        if ((pa?.action === 'consent_click' || pa?.action === 'selfie_skip') && pa.coords) {
                          const isSelfie = pa.action === 'selfie_skip';
                          console.log(`[TIKTOK-GOOGLE-LOGIN] Clicando em ${isSelfie ? 'Agora não (Pular verificação de selfie)' : 'Continuar/Agora não'}...`);
                          setBadge(isSelfie ? '📸 Pulando verificação de selfie...' : 'Confirmando consentimento...', '#38bdf8');
                          await realClickAt(pa.coords.x, pa.coords.y, undefined, wsTarget);
                          await new Promise(r => setTimeout(r, 2500));
                          continue;
                        }

                        // E2. Página pede número de telemóvel → clicar "Experimentar outra forma" / "Mais formas de validação"
                        if (pa?.action === 'google_phone_try_other') {
                          if (pa.promptNumber) {
                            console.log(`[TIKTOK-GOOGLE-LOGIN] Número de confirmação no celular detectado: ${pa.promptNumber}. Clicando "Mais formas de validação"...`);
                            setBadge(`📱 Toque no nº ${pa.promptNumber} no telemóvel ou alternando...`, '#38bdf8');
                          } else {
                            console.log('[TIKTOK-GOOGLE-LOGIN] Página pede desafio de telemóvel → clicando "Mais formas de validação"...');
                            setBadge('🔐 Escolhendo método alternativo de verificação...', '#f59e0b');
                          }
                          // Log inline (fileLog não está no scope aqui — é declarado mais abaixo)
                          const dpLogPath = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), '2am-login-debug.log');
                          const dpLog = (msg: string) => { try { fsSync.appendFileSync(dpLogPath, `[${new Date().toISOString()}] [DP-HANDLER] ${msg}\n`, 'utf8'); } catch(_){} };
                          dpLog(`INÍCIO sec=${sec} coords=${JSON.stringify(pa.coords)}`);

                          // Fechar diálogo nativo WebAuthn/Passkey do Windows com Escape (se estiver aberto)
                          await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }).catch(() => {});
                          await new Promise(r => setTimeout(r, 300));
                          await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }).catch(() => {});
                          await new Promise(r => setTimeout(r, 500));

                          // Obter coords reais do botão "Mais formas de validação" de forma silenciosa (sem mover janela)
                          const dpCoordsRes: any = await cdpSend(wsTarget, 'Runtime.evaluate', {
                            expression: `(function() {
                              try {
                                var texts = ['mais formas de validação','mais formas de validacao','formas de validação','mais formas',
                                             'outras formas','experimentar outra forma','try another way','outra forma',
                                             'more ways to verify','more ways','other ways','another way','try a different'];
                                var all = Array.from(document.querySelectorAll('button, a, [role="button"], span'));
                                var candidates = [];
                                for (var i = 0; i < all.length; i++) {
                                  var el = all[i].closest('button, a, [role="button"]') || all[i];
                                  var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                  if (!t || t.length > 100) continue;
                                  for (var j = 0; j < texts.length; j++) {
                                    if (t.includes(texts[j])) {
                                      var r = el.getBoundingClientRect();
                                      if (r.width > 5 && r.height > 5 && r.width < 500 && r.height < 120) {
                                        candidates.push({ el: el, tLen: t.length });
                                        break;
                                      }
                                    }
                                  }
                                }
                                if (candidates.length === 0) return null;
                                candidates.sort(function(a, b) { return a.tLen - b.tLen; });
                                var best = candidates[0].el;
                                try { best.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(_) {}
                                try { best.focus(); } catch(_) {}
                                try { best.click(); } catch(_) {}
                                var br = best.getBoundingClientRect();
                                return { x: br.left + br.width/2, y: br.top + br.height/2, w: br.width, h: br.height };
                              } catch(e) { return { error: String(e) }; }
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          const dpCoords = dpCoordsRes?.result?.value;
                          dpLog(`dpCoordsRes: ${JSON.stringify(dpCoords)}`);

                          if (dpCoords && !dpCoords.error && dpCoords.x > 0) {
                            console.log(`[TIKTOK-GOOGLE-LOGIN] Coords reais do "Mais formas": x=${dpCoords.x} y=${dpCoords.y}`);
                            dpLog(`realClickAt x=${dpCoords.x} y=${dpCoords.y}`);
                            await realClickAt(dpCoords.x, dpCoords.y, undefined, wsTarget);
                          } else {
                            const fx = (pa.coords && pa.coords.x > 5 && pa.coords.x < 1150) ? pa.coords.x : 948;
                            const fy = (pa.coords && pa.coords.y > 5 && pa.coords.y < 750) ? pa.coords.y : 604;
                            dpLog(`notFound/error → fallback fixo (${fx},${fy})`);
                            console.log(`[TIKTOK-GOOGLE-LOGIN] Fallback fixo: clique em (${fx}, ${fy})`);
                            await realClickAt(fx, fy, undefined, wsTarget);
                          }
                          await new Promise(r => setTimeout(r, 2000));

                          // Verificar URL após clique
                          const dpUrlFinal: any = await cdpSend(wsTarget, 'Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }).catch(() => null);
                          dpLog(`URL após clique: ${dpUrlFinal?.result?.value || 'N/A'}`);

                          continue;
                        }

                        // E3. Menu de escolha → clicar opção offline (telemóvel/tablet sem internet)
                        if (pa?.action === 'google_choose_offline' && pa.coords) {
                          console.log('[TIKTOK-GOOGLE-LOGIN] Menu de verificação → escolhendo opção offline (telemóvel/tablet)...');
                          setBadge('📱 Selecionando verificação offline...', '#f59e0b');
                          await realClickAt(pa.coords.x, pa.coords.y, undefined, wsTarget);
                          await new Promise(r => setTimeout(r, 2500));
                          // NÃO notificar aqui — a notificação só deve ser disparada quando já estiver no ecrã de código (google_2fa)
                          continue;
                        }

                        // F. 2FA
                        if (pa?.action === 'google_2fa') {
                          sec = 0; // 🛑 Requisito: Espera infinita enquanto aguarda código do ADM (sem timeout)
                          setBadge('🔑 Aguardando código 2FA do Administrador...', '#f59e0b');
                          const nowTs = Date.now();
                          if (nowTs - lastNotifTime > 60000) {
                            lastNotifTime = nowTs;
                            dispatch2FARequest({ profileId, partnerId, platform: 'tiktok', codeType: 'google_totp', accountId: session.accountId, email: googleEmail || session.email }, event.sender);
                          }
                          const incomingCode = (session.lastCode || '').trim();
                          if (incomingCode && incomingCode.length >= 4) {
                            setBadge(`Injetando código 2FA (${incomingCode})...`, '#22c55e');
                            if (pa.inputCoords) {
                              await realClickAt(pa.inputCoords.x, pa.inputCoords.y, undefined, wsTarget);
                              await new Promise(r => setTimeout(r, 300));
                              await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                              await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                              for (const char of incomingCode) {
                                await cdpSend(wsTarget, 'Input.insertText', { text: char }).catch(() => {});
                                await new Promise(r => setTimeout(r, 30));
                              }
                              await new Promise(r => setTimeout(r, 300));
                            }
                            session.lastCode = '';
                            if (pa.btnCoords) {
                              await realClickAt(pa.btnCoords.x, pa.btnCoords.y, undefined, wsTarget);
                            } else {
                              await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                              await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            }
                            await new Promise(r => setTimeout(r, 4000));

                            // 🔍 Requisito: Verificar se o Google acusou código 2FA incorreto ou expirado
                            const checkGoogleCodeError: any = await cdpSend(wsTarget, 'Runtime.evaluate', {
                              expression: `(function() {
                                try {
                                  var errorPhrases = [
                                    'código incorreto',
                                    'código de verificação incorreto',
                                    'código errado',
                                    'wrong code',
                                    'incorrect code',
                                    'não foi possível verificar seu código',
                                    "couldn't verify your code",
                                    'muitas tentativas',
                                    'too many attempts',
                                    'código expirado',
                                    'code expired'
                                  ];
                                  var isCodeError = false;
                                  var errMsg = '';

                                  var explicitErrorEl = document.querySelector('#error, .o6cuMc, [jsname="B34EJ"]');
                                  var liveEl = document.querySelector('[aria-live="assertive"]');
                                  var checkTxt = ((explicitErrorEl ? (explicitErrorEl.innerText || '') : '') + ' ' + (liveEl ? (liveEl.innerText || '') : '')).toLowerCase();

                                  for (var ep = 0; ep < errorPhrases.length; ep++) {
                                    if (checkTxt.includes(errorPhrases[ep])) {
                                      isCodeError = true;
                                      errMsg = errorPhrases[ep];
                                      break;
                                    }
                                  }

                                  if (!isCodeError) {
                                    var allText = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                                    for (var ep = 0; ep < errorPhrases.length; ep++) {
                                      if (allText.includes(errorPhrases[ep])) {
                                        isCodeError = true;
                                        errMsg = errorPhrases[ep];
                                        break;
                                      }
                                    }
                                  }

                                  var hasInputStillVisible = !!document.querySelector('input[type="tel"], input[name*="code" i], #idvPin, #totpPin');
                                  if (isCodeError && hasInputStillVisible) {
                                    return { isError: true, message: errMsg || 'Código 2FA incorreto ou expirado' };
                                  }
                                  return { isError: false };
                                } catch(e) { return { isError: false }; }
                              })()`,
                              returnByValue: true
                            }).catch(() => null);

                            if (checkGoogleCodeError?.result?.value?.isError) {
                              const errMsg = checkGoogleCodeError.result.value.message || 'Código 2FA incorreto ou expirado';
                              console.warn(`[TIKTOK-GOOGLE-2FA] ❌ Código 2FA incorreto detectado: "${errMsg}". Re-notificando ADM imediatamente...`);
                              setBadge('⚠️ Código 2FA incorreto! Solicitando novo código ao ADM...', '#ef4444');
                              session.lastCode = '';
                              if (pa.inputCoords) {
                                await realClickAt(pa.inputCoords.x, pa.inputCoords.y, undefined, wsTarget);
                                await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                                await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                                await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                                await cdpSend(wsTarget, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                              }
                              lastNotifTime = Date.now();
                              dispatch2FARequest({ profileId, partnerId, platform: 'tiktok', codeType: 'google_totp', isRetry: true, errorMessage: errMsg, accountId: session.accountId, email: googleEmail || session.email }, event.sender);
                              continue;
                            }

                            continue;
                          }
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // Reiniciar se email voltou vazio após submit
                        if (emailSubmitted && pa?.action === 'email_field' && !(pa?.currentValue || '').includes((effUser || '').split('@')[0])) {
                          emailSubmitted = false;
                          passSubmitted = false;
                        }

                        await new Promise(r => setTimeout(r, 2000));
                      }

                      return false;
                    };

                    // ── Orquestrador de Automação do TikTok com Google Oficial ──
                    const runTikTokAutomation = async () => {
                      let googleClicked = false;
                      let loginFlowStarted = false;
                      googleLoginDone = false;
                      googleLoginDoneAt = 0;

                      // ── Garantir foco emulado e janela oculta para execução 100% em segundo plano ──
                      await cdpSend(ws, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
                      await cdpSend(ws, 'DOM.enable').catch(() => {});

                      if (runInBackground) {
                        try {
                          const winTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                          if (winTarget?.windowId != null) {
                            await cdpSend(ws, 'Browser.setWindowBounds', {
                              windowId: winTarget.windowId,
                              bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                            }).catch(() => {});
                          }
                        } catch (_) {}
                        if (session.process?.pid) {
                          startBackgroundWindowKeeper(session.process.pid);
                          setProcessTaskbarVisibility(session.process.pid, false);
                        }
                      }

                      // ══════════════════════════════════════════════════════════════════
                      // FASE 1: AUTENTICAÇÃO DA CONTA GOOGLE NO SITE OFICIAL
                      // ══════════════════════════════════════════════════════════════════
                      // Se houver googleEmail informado, autenticar primeiro no site oficial do Google
                      if (googleEmail) {
                        console.log('[TIKTOK-LOGIN] Fase 1: Verificando/realizando autenticação no site oficial do Google...');

                        // Polling reativo: aguardar Google estabilizar (max ~2.6s em vez de 8s fixo)
                        for (let _gw = 0; _gw < 13; _gw++) {
                          await new Promise(r => setTimeout(r, 200));
                          const _gReady: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: "document.readyState === 'complete' && (!!document.querySelector('input, #identifierId') || window.location.href.includes('google.'))",
                            returnByValue: true
                          }).catch(() => null);
                          if (_gReady?.result?.value) break;
                        }

                        // Logging persistente para diagnóstico em produção
                        const logPath = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), '2am-login-debug.log');
                        const fileLog = (msg: string) => {
                          try {
                            const ts = new Date().toISOString();
                            fsSync.appendFileSync(logPath, `[${ts}] [TIKTOK-GOOGLE] ${msg}\n`, 'utf8');
                          } catch (_) {}
                        };

                        fileLog(`=== INÍCIO FASE 1 ===`);
                        fileLog(`profileId=${profileId} googleEmail=${googleEmail || '(vazio)'} email=${email || '(vazio)'}`);
                        fileLog(`googlePass=${googlePass ? 'OK(' + googlePass.length + ')' : '(vazio)'}`);
                        fileLog(`runInBackground=${runInBackground}`);

                        // Função para verificar se a conta Google já está autenticada no perfil
                        const checkGoogleLoggedIn = async (): Promise<boolean> => {
                          try {
                            const urlRes: any = await cdpSend(ws, 'Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }).catch(() => null);
                            const curUrl = (urlRes?.result?.value || '').toLowerCase();

                            fileLog(`checkGoogleLoggedIn: curUrl="${curUrl.substring(0, 100)}"`);

                            // URL vazia, about:blank ou chrome: NUNCA está logado (página ainda não carregou)
                            if (!curUrl || curUrl === '' || curUrl.startsWith('about:') || curUrl.startsWith('chrome:') || curUrl === 'null') {
                              fileLog(`checkGoogleLoggedIn: URL vazia ou blank → false`);
                              return false;
                            }

                            // Se ainda estiver na tela de login, desafio, verificação ou em accounts.google.com, NUNCA está logado!
                            if (
                              curUrl.includes('accounts.google.') ||
                              curUrl.includes('/signin') ||
                              curUrl.includes('/servicelogin') ||
                              curUrl.includes('/challenge') ||
                              curUrl.includes('/speedbump') ||
                              curUrl.includes('/identifier')
                            ) {
                              fileLog(`checkGoogleLoggedIn: em página Google de login → false`);
                              return false;
                            }

                            // 1. Checar URL pós-login no ecossistema Google
                            if (
                              curUrl.includes('myaccount.google.com') ||
                              curUrl.includes('google.com/intl') ||
                              curUrl.includes('mail.google.com') ||
                              (curUrl.startsWith('https://www.google.') && !curUrl.includes('accounts.google.'))
                            ) {
                              console.log(`[TIKTOK-LOGIN] URL pós-login detectada: ${curUrl}`);
                              return true;
                            }

                            // 2. Checar cookies de sessão completa (SID, SSID, HSID) no domínio google.com
                            const cookieRes: any = await cdpSend(ws, 'Network.getCookies', {
                              urls: ['https://accounts.google.com', 'https://google.com', 'https://myaccount.google.com']
                            }).catch(() => null);
                            const cookies = cookieRes?.cookies || [];
                            const hasSid = cookies.some((c: any) =>
                              c.name === 'SID' &&
                              c.domain.includes('google.com') &&
                              typeof c.value === 'string' &&
                              c.value.trim().length > 20
                            );
                            const hasSsid = cookies.some((c: any) =>
                              c.name === 'SSID' &&
                              c.domain.includes('google.com') &&
                              typeof c.value === 'string' &&
                              c.value.trim().length > 20
                            );
                            if (hasSid && hasSsid && !curUrl.includes('accounts.google.')) {
                              console.log('[TIKTOK-LOGIN] Sessão completa Google (SID+SSID) detectada fora de accounts.google.com.');
                              return true;
                            }

                            // 3. Checar elemento exclusivo de usuário logado no DOM
                            const avatarRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                return !!document.querySelector('a[href*="SignOutOptions"], a[aria-label*="Conta Google:"], a[aria-label*="Google Account:"]');
                              })()`,
                              returnByValue: true
                            }).catch(() => null);
                            if (avatarRes?.result?.value) {
                              console.log('[TIKTOK-LOGIN] Perfil autenticado detectado no DOM.');
                              return true;
                            }
                          } catch (_) {}
                          return false;
                        };

                        const alreadyGoogleLogged = await checkGoogleLoggedIn();
                        fileLog(`alreadyGoogleLogged=${alreadyGoogleLogged}`);
                        if (alreadyGoogleLogged) {
                          console.log('[TIKTOK-LOGIN] Conta Google já autenticada no perfil!');
                          fileLog('Pulando runGoogleLoginForTikTok: já logado');
                          await new Promise(r => setTimeout(r, 2000));
                        } else {
                          console.log('[TIKTOK-LOGIN] Executando automação Google estilo YouTube para TikTok...');
                          fileLog('Chamando runGoogleLoginForTikTok...');

                          if (!runInBackground) {
                            try {
                              const winForTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                              if (winForTarget?.windowId != null) {
                                await cdpSend(ws, 'Browser.setWindowBounds', {
                                  windowId: winForTarget.windowId,
                                  bounds: { left: 50, top: 50, width: 1280, height: 850, windowState: 'normal' }
                                }).catch(() => {});
                              }
                            } catch (_) {}
                            await cdpSend(ws, 'Page.bringToFront').catch(() => {});
                          } else {
                            try {
                              const winForTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                              if (winForTarget?.windowId != null) {
                                await cdpSend(ws, 'Browser.setWindowBounds', {
                                  windowId: winForTarget.windowId,
                                  bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                                }).catch(() => {});
                              }
                            } catch (_) {}
                            if (session.process?.pid) {
                              startBackgroundWindowKeeper(session.process.pid);
                              setProcessTaskbarVisibility(session.process.pid, false);
                            }
                          }

                          const gLoginOk = await runGoogleLoginForTikTok(ws, googleEmail || email, googlePass || pass);
                          fileLog(`runGoogleLoginForTikTok retornou: ${gLoginOk}`);

                          if (gLoginOk) {
                            console.log('[TIKTOK-LOGIN] ✅ Login no Google concluído com sucesso!');
                            await new Promise(r => setTimeout(r, 2000));
                          } else {
                            // Se não retornou true de imediato, aguardar brevemente caso o usuário tenha completado 2FA manual
                            console.log('[TIKTOK-LOGIN] Aguardando confirmação final de login do Google...');
                            const startGoogleWait = Date.now();
                            while (Date.now() - startGoogleWait < 30000) {
                              if (ttLoginDetected || !session.process || session.process.killed) break;
                              const isLogged = await checkGoogleLoggedIn();
                              if (isLogged) {
                                console.log('[TIKTOK-LOGIN] ✅ Login no Google concluído com sucesso!');
                                await new Promise(r => setTimeout(r, 2000));
                                break;
                              }
                              await new Promise(r => setTimeout(r, 2000));
                            }
                          }
                        }

                        // ── PÓS-LOGIN GOOGLE: Limpar bloqueios e voltar ao segundo plano no tiktok.com ──
                        console.log('[TIKTOK-LOGIN] Removendo bloqueios da tela Google para retornar ao normal no TikTok...');
                        await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              var s = document.getElementById('__agent_privacy_shield_css__');
                              if (s && s.parentNode) s.parentNode.removeChild(s);
                              var b = document.getElementById('__agent_helper_badge__');
                              if (b && b.parentNode) b.parentNode.removeChild(b);
                              window.__agent_privacy_events_bound__ = false;
                            } catch(_) {}
                          })()`
                        }).catch(() => {});

                        if (runInBackground && session.process?.pid) {
                          console.log('[TIKTOK-LOGIN] Retornando navegador para segundo plano no tiktok.com...');
                          try {
                            const winTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                            if (winTarget?.windowId != null) {
                              await cdpSend(ws, 'Browser.setWindowBounds', {
                                windowId: winTarget.windowId,
                                bounds: { left: -32000, top: -32000, width: 1280, height: 850, windowState: 'normal' }
                              }).catch(() => {});
                            }
                          } catch (_) {}

                          setProcessTaskbarVisibility(session.process.pid, false);
                          await returnChromeToBackground(session.process.pid);
                          startBackgroundWindowKeeper(session.process.pid);

                          if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.focus();
                          }
                        }

                        // Navegar agora para o TikTok já com a sessão Google 100% pronta e memorizada
                        console.log('[TIKTOK-LOGIN] Redirecionando janela principal para https://www.tiktok.com/login em segundo plano...');
                        setBadge('Acessando o TikTok com a conta Google conectada...', '#38bdf8');
                        await cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/login' }).catch(() => {});
                      }

                      // ══════════════════════════════════════════════════════════════════
                      // FASE 2: AUTOMAÇÃO NO TIKTOK (CONTA GOOGLE JÁ CONECTADA NO NAVEGADOR)
                      // ══════════════════════════════════════════════════════════════════
                      // Monitor de popups do Google OAuth via /json/list (pesquisa ultra-rápida a cada 200ms)
                      const popupPollInterval = setInterval(async () => {
                        if (ttLoginDetected || !session.process || session.process.killed) {
                          clearInterval(popupPollInterval);
                          return;
                        }
                        const popup = await pollForGooglePopup();
                        if (popup && !activePopupIds.has(popup.id)) {
                          activePopupIds.add(popup.id);
                          loginFlowStarted = true;
                          console.log(`[TIKTOK-LOGIN] Popup do Google detectado via /json/list: ${popup.url} (id: ${popup.id})`);

                          const pWs = new WebSocket(popup.webSocketDebuggerUrl);
                          pWs.on('open', async () => {
                            console.log(`[TIKTOK-LOGIN] WebSocket conectado ao popup Google com sucesso! (ID: ${popup.id})`);

                            // 1. Ativar protocolos CDP no popup
                            await cdpSend(pWs, 'Page.enable').catch(() => {});
                            await cdpSend(pWs, 'Runtime.enable').catch(() => {});
                            await cdpSend(pWs, 'Network.enable').catch(() => {});
                            await cdpSend(pWs, 'DOM.enable').catch(() => {});
                            await cdpSend(pWs, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

                            // Mover popup para segundo plano (fora do ecrã) imediatamente
                            try {
                              const popupWin: any = await cdpSend(pWs, 'Browser.getWindowForTarget', {}).catch(() => null);
                              if (popupWin?.windowId != null) {
                                await cdpSend(pWs, 'Browser.setWindowBounds', {
                                  windowId: popupWin.windowId,
                                  bounds: { left: -32000, top: -32000, width: 1280, height: 850, windowState: 'normal' }
                                }).catch(() => {});
                              }
                            } catch (_) {}
                            if (session.process?.pid) {
                              startBackgroundWindowKeeper(session.process.pid);
                              setProcessTaskbarVisibility(session.process.pid, false);
                              await returnChromeToBackground(session.process.pid);
                            }
                            if (mainWindow && !mainWindow.isDestroyed()) {
                              mainWindow.focus();
                            }

                            // 2. Aguardo reativo para a página do popup navegar e estabilizar (máx ~4s)
                            for (let pw = 0; pw < 20; pw++) {
                              await new Promise(r => setTimeout(r, 200));
                              const pCheck: any = await cdpSend(pWs, 'Runtime.evaluate', {
                                expression: `(function() {
                                  var h = window.location.href;
                                  return (h.includes('google.') || h.includes('oauth') || h.includes('tiktok.')) && (document.readyState === 'complete' || document.readyState === 'interactive');
                                })()`,
                                returnByValue: true
                              }).catch(() => null);
                              if (pCheck?.result?.value) break;
                            }

                            // 3. Blindagem de privacidade instantânea dentro do popup
                            await injectPrivacyShield(pWs, googleEmail);

                            // 4. Executar o fluxo comprovado do Google (Loop YouTube adaptado com proteção)
                            console.log('[TIKTOK-LOGIN] Executando automação Google no popup...');
                            await runGoogleLoginForTikTok(pWs, googleEmail, googlePass);
                            googleLoginDone = true;
                            googleLoginDoneAt = Date.now();
                            console.log('[TIKTOK-LOGIN] Fluxo de autorização Google no popup concluído. Aguardando redirect do TikTok...');
                          });
                          pWs.on('close', () => {
                            console.log(`[TIKTOK-LOGIN] Popup do Google foi fechado.`);
                            activePopupIds.delete(popup.id);
                            if (!googleLoginDone) {
                              googleLoginDone = true;
                              googleLoginDoneAt = Date.now();
                            }
                          });
                          pWs.on('error', (e) => {
                            console.warn(`[TIKTOK-LOGIN] Erro no WebSocket do popup Google:`, e);
                            activePopupIds.delete(popup.id);
                          });
                        }
                      }, 200);

                      // Carregamento reativo inicial do TikTok
                      setBadge('Aguardando carregamento do TikTok...', '#38bdf8');
                      for (let waitSec = 0; waitSec < 20; waitSec++) {
                        await new Promise(r => setTimeout(r, 250));
                        const checkReady: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `document.readyState === 'complete' && (window.location.href.includes('tiktok.com') || !!document.body)`,
                          returnByValue: true
                        }).catch(() => null);
                        if (checkReady?.result?.value) {
                          console.log(`[TIKTOK-LOGIN] TikTok pronto em ${(waitSec + 1) * 250}ms!`);
                          break;
                        }
                      }

                      // Verificar se a página do TikTok carregou ou se precisa de recarregamento
                      const checkTtUrl: any = await cdpSend(ws, 'Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }).catch(() => null);
                      const ttUrl = (checkTtUrl?.result?.value || '').toLowerCase();
                      if (!ttUrl.includes('tiktok.com') || ttUrl.includes('about:blank')) {
                        console.log('[TIKTOK-LOGIN] TikTok em branco ou não carregou de primeira, recarregando https://www.tiktok.com/login...');
                        await cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/login' }).catch(() => {});
                        for (let rw = 0; rw < 15; rw++) {
                          await new Promise(r => setTimeout(r, 200));
                          const cr: any = await cdpSend(ws, 'Runtime.evaluate', { expression: `document.readyState === 'complete'`, returnByValue: true }).catch(() => null);
                          if (cr?.result?.value) break;
                        }
                      }

                      for (let sec = 0; sec < 180; sec++) {
                        if (ttLoginDetected) {
                          clearInterval(popupPollInterval);
                          break;
                        }

                        // ── DETECÇÃO PRIORITÁRIA: Modal "Verifica que és mesmo tu" / Palavra-passe / Código ──
                        const verifyAction = await handleTikTokVerificationModal();
                        if (verifyAction === 'clicked_option') {
                          sec = 0;
                          await new Promise(r => setTimeout(r, 1000));
                          continue;
                        } else if (verifyAction === 'typed_password') {
                          sec = 0;
                          setBadge('Palavra-passe enviada! Aguardando confirmação do TikTok...', '#22c55e');
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        } else if (verifyAction === 'typed_code') {
                          sec = 0;
                          setBadge('Código de verificação enviado! Aguardando confirmação do TikTok...', '#22c55e');
                          await new Promise(r => setTimeout(r, 3000));
                          continue;
                        } else if (verifyAction === 'waiting_code') {
                          sec = 0; // 🛑 Requisito: Espera infinita enquanto aguarda código do ADM (sem timeout)
                          await new Promise(r => setTimeout(r, 1500));
                          continue;
                        } else if (verifyAction === 'waiting_manual') {
                          sec = 0;
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // ── MODO PASSIVO: popup do Google ativo — ZERO interação na aba do TikTok ──
                        if (loginFlowStarted && !googleLoginDone) {
                          sec = 0; // 🛑 Requisito: Espera infinita enquanto autoriza popup Google
                          setBadge('Aguardando autorização no popup Google...', '#f59e0b');
                          await new Promise(r => setTimeout(r, 1500));
                          continue;
                        }

                        // ── MODO PÓS-LOGIN: Google fechou, checagem imediata de redirect do TikTok ──
                        if (googleLoginDone) {
                          const checkUserLogged: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              const url = window.location.href.toLowerCase();
                              if (!url.includes('tiktok.com') || url.includes('/login') || url.includes('google.com')) return false;
                              return !!(
                                document.querySelector('[data-e2e="profile-icon"], [data-e2e="user-avatar"], [data-e2e="inbox-icon"], [data-e2e="upload-icon"], a[href*="/@"], header img[class*="avatar"]') ||
                                document.cookie.includes('sessionid=') ||
                                document.cookie.includes('sid_tt=')
                              );
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          if (checkUserLogged?.result?.value) {
                            console.log('[TIKTOK-LOGIN] ✅ Utilizador autenticado no TikTok após login Google!');
                            clearInterval(popupPollInterval);
                            handleTikTokLoginSuccess();
                            break;
                          }

                          const elapsed = Date.now() - googleLoginDoneAt;
                          if (elapsed < 8000) {
                            setBadge('Aguardando TikTok estabilizar sessão...', '#22c55e');
                            await new Promise(r => setTimeout(r, 1000));
                            continue;
                          }
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // ── MODO ATIVO: navegar com calma humana no TikTok ──

                        // Esperar página pronta
                        await waitPageReady(3000);

                        // Verificar URL atual da aba principal
                        const urlRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: 'window.location.href',
                          returnByValue: true
                        }).catch(() => null);
                        const currentUrl = (urlRes?.result?.value || '').toLowerCase();

                        // Se o TikTok redirecionou a própria aba principal para o Google
                        if (currentUrl.includes('accounts.google.com') || currentUrl.includes('google.com/signin')) {
                          loginFlowStarted = true;
                          await runGoogleLoginForTikTok(ws, googleEmail, googlePass);
                          await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              try {
                                var s = document.getElementById('__agent_privacy_shield_css__');
                                if (s && s.parentNode) s.parentNode.removeChild(s);
                                var b = document.getElementById('__agent_helper_badge__');
                                if (b && b.parentNode) b.parentNode.removeChild(b);
                                window.__agent_privacy_events_bound__ = false;
                              } catch(_) {}
                            })()`
                          }).catch(() => {});
                          await new Promise(r => setTimeout(r, 1500));
                          continue;
                        }

                        // 1. FECHAR TUTORIAL / AVISO INICIAL ("Entendido", "Got it")
                        const dismissedTutorial = await dismissTikTokTutorial();
                        if (dismissedTutorial) {
                          setBadge('Aviso inicial "Entendido" fechado.', '#38bdf8');
                          console.log('[TIKTOK-LOGIN] Tutorial "Entendido" fechado.');
                          await new Promise(r => setTimeout(r, 800));
                          continue;
                        }

                        // 2. Fechar banner de cookies se existir
                        const dismissedCookie = await realClickElement('button[data-e2e="cookie-banner-decline"], button[data-e2e="cookie-banner-accept"], button#onetrust-accept-btn-handler');
                        if (dismissedCookie) {
                          setBadge('Banner de cookies fechado.', '#38bdf8');
                          console.log('[TIKTOK-LOGIN] Banner de cookies fechado.');
                          await new Promise(r => setTimeout(r, 800));
                          continue;
                        }

                        // 3. Tentar clicar em "Continuar com o Google" (se modal de login já estiver visível)
                        if (!googleClicked) {
                          const clickedGoogle = await clickTikTokGoogleButton();
                          if (clickedGoogle) {
                            googleClicked = true;
                            loginFlowStarted = true;
                            setBadge('Opção Google clicada! Detectando janela...', '#22c55e');
                            console.log('[TIKTOK-LOGIN] Botão "Continuar com Google" clicado!');
                            // Aguardar reativamente surgimento do popup (máx 3s)
                            for (let pw = 0; pw < 15; pw++) {
                              if (activePopupIds.size > 0 || loginFlowStarted) break;
                              await new Promise(r => setTimeout(r, 200));
                            }
                            continue;
                          }
                        }

                        // 4. Se modal ainda não abriu, clicar no botão de Login ("Entrar") no topo ou na barra lateral
                        if (!googleClicked) {
                          setBadge('Página pronta! Clicando em "Entrar"...', '#38bdf8');
                          const clickedLogin = await clickTikTokLoginButton();
                          if (clickedLogin) {
                            setBadge('Abrindo opções de login...', '#38bdf8');
                            console.log('[TIKTOK-LOGIN] Botão Entrar clicado! Aguardando modal...');
                            // Aguardar reativamente modal ou botão Google (máx 3s)
                            for (let mw = 0; mw < 15; mw++) {
                              await new Promise(r => setTimeout(r, 200));
                              const hasModal: any = await cdpSend(ws, 'Runtime.evaluate', {
                                expression: `!!document.querySelector('a[href*="google"], div[data-e2e="channel-item"]') || !!document.querySelector('div[class*="DivLoginContainer"]')`,
                                returnByValue: true
                              }).catch(() => null);
                              if (hasModal?.result?.value) break;
                            }
                            continue;
                          }
                        }

                        await new Promise(r => setTimeout(r, 1500));
                      }
                    };

                    setTimeout(runTikTokAutomation, 2000);

                    // Polling de cookies para confirmação de login (Google, QR Code ou manual)
                    ttCheckInterval = setInterval(async () => {
                      if (ttLoginDetected || !ws || ws.readyState !== WebSocket.OPEN) return;
                      try {
                        const cookieRes = (await cdpSend(ws, 'Network.getCookies', {
                          urls: ['https://www.tiktok.com', 'https://www.tiktok.com/', 'https://studio.tiktok.com', 'https://tiktok.com']
                        }).catch(() => null)) as { cookies?: Array<{ name: string; value: string }> } | null;

                        let cookies = cookieRes?.cookies || [];
                        let hasSessionCookie = cookies.some(
                          (c) => (c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'sid_tt') && c.value && c.value.length > 10
                        );

                        if (!hasSessionCookie) {
                          const allCks = (await cdpSend(ws, 'Network.getCookies', {}).catch(() => null)) as { cookies?: Array<{ name: string; value: string }> } | null;
                          if (allCks?.cookies) {
                            hasSessionCookie = allCks.cookies.some(
                              (c) => (c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'sid_tt') && c.value && c.value.length > 10
                            );
                          }
                        }

                        if (hasSessionCookie) {
                          console.log('[TIKTOK-LOGIN] Cookies de sessão válidos detectados!');
                          handleTikTokLoginSuccess();
                        }
                      } catch (_) {}
                    }, 3000);

                    chromeProcess.on('exit', () => {
                      if (ttCheckInterval) clearInterval(ttCheckInterval);
                      if (ttCloseTimeout) clearTimeout(ttCloseTimeout);
                    });
                  }

                  if (isInstagramLogin) {
                    let igLoginDetected = false;
                    let igCheckInterval: NodeJS.Timeout | null = null;
                    let igCloseTimeout: NodeJS.Timeout | null = null;

                    // ── Monitoramento Remoto de Login (ADM) ──
                    let stopIgLoginScreencastFn: (() => void) | null = null;
                    if (runInBackground || isQueueLogin) {
                      broadcastLoginEvent(partnerId, {
                        type: 'login_started',
                        platform: 'instagram',
                        accountCode: profileId,
                        email: email,
                        detail: 'Iniciando fluxo de auto-login Instagram',
                      });
                      stopIgLoginScreencastFn = startLoginScreencast(session, profileId, 'instagram', partnerId);
                    }

                    const handleInstagramLoginSuccess = async () => {
                      if (igLoginDetected) return;
                      igLoginDetected = true;
                      if (igCheckInterval) {
                        clearInterval(igCheckInterval);
                        igCheckInterval = null;
                      }

                      session.isLoggedIn = true;
                      console.log(`[INSTAGRAM] Login confirmado com sucesso para o perfil ${profileId}! Gravando ig_authenticated.flag...`);

                      // Notificar ADM do sucesso e encerrar screencast de monitoramento
                      broadcastLoginEvent(partnerId, {
                        type: 'login_success',
                        platform: 'instagram',
                        accountCode: profileId,
                        email: email,
                        detail: 'Login Instagram confirmado com sucesso',
                      });
                      if (stopIgLoginScreencastFn) { stopIgLoginScreencastFn(); stopIgLoginScreencastFn = null; }

                      try {
                        const igProfileDir = profileDir;
                        fsSync.mkdirSync(igProfileDir, { recursive: true });
                        fsSync.writeFileSync(path.join(igProfileDir, 'ig_authenticated.flag'), new Date().toISOString(), 'utf8');
                        console.log(`[INSTAGRAM] ig_authenticated.flag gravado para ${profileDirName} (${profileId})`);
                        // Navegar para instagram.com para garantir que os cookies estejam presentes antes de guardar
                        try {
                          const curUrlRes: any = await cdpSend(ws, 'Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }).catch(() => null);
                          const curUrl = (curUrlRes?.result?.value || '').toLowerCase();
                          if (!curUrl.includes('instagram.com') || curUrl.includes('/accounts/login')) {
                            console.log('[INSTAGRAM-COOKIES] Navegando para instagram.com para carregar cookies...');
                            await cdpSend(ws, 'Page.navigate', { url: 'https://www.instagram.com/' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 4000));
                          } else {
                            await new Promise(r => setTimeout(r, 2000));
                          }
                        } catch(_) {}
                        // Tentativas de guardar cookies (retry até 3x)
                        let igSaved = false;
                        for (let igAttempt = 0; igAttempt < 3 && !igSaved; igAttempt++) {
                          igSaved = await saveInstagramCookies(ws, igProfileDir);
                          if (!igSaved && igAttempt < 2) {
                            console.log(`[INSTAGRAM-COOKIES] Tentativa ${igAttempt + 1} falhou, aguardando 3s...`);
                            await new Promise(r => setTimeout(r, 3000));
                          }
                        }
                        if (!igSaved) {
                          console.warn('[INSTAGRAM-COOKIES] ⚠️ Não foi possível guardar cookies após 3 tentativas.');
                        }
                      } catch (errFlag) {
                        console.error('[INSTAGRAM] Erro ao gravar ig_authenticated.flag:', errFlag);
                      }

                      event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                      mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });

                      cdpSend(ws, 'Runtime.enable').catch(() => {}).finally(() => {
                        cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              if (!document.getElementById('__agent_login_banner__')) {
                                var b = document.createElement('div');
                                b.id = '__agent_login_banner__';
                                b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#059669;color:#fff;padding:12px 20px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:bold;box-shadow:0 4px 20px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;gap:12px;';
                                b.innerHTML = '<span>✅ Login no Instagram concluído com sucesso!</span><span style="font-size:12px;opacity:0.95;font-weight:normal;">O navegador fechará automaticamente em 20 segundos para consolidar o perfil.</span>';
                                document.body.appendChild(b);
                              }
                            } catch(_) {}
                          })()`
                        }).catch(() => {});
                      });

                      console.log(`[INSTAGRAM] Aguardando consolidação antes de fechar o Chrome do perfil ${profileId}...`);
                      igCloseTimeout = setTimeout(async () => {
                        
                        try { await saveInstagramCookies(ws, session.profileDir || profileDir); } catch(_) {}
                        console.log(`[INSTAGRAM] Tempo de consolidação decorrido. Fechando navegador do perfil ${profileId} de forma graciosa...`);
                        await closeChromeSessionGracefully(session, profileId, event.sender);
                      }, runInBackground ? 18000 : 25000);
                    };

                    const runInstagramLoginAutomation = async () => {
                      console.log(`[INSTAGRAM-LOGIN] Iniciando automação suave e humana para o perfil ${profileId}...`);
                    if (runInBackground || isQueueLogin) broadcastLoginEvent(partnerId, { type: 'login_progress', platform: 'instagram', accountCode: profileId, email, detail: 'Iniciando automação de login Instagram' });
                      setBadge('Aguardando carregamento do Instagram...', '#38bdf8');

                      // ── Garantir foco emulado e janela oculta para execução 100% em segundo plano ──
                      await cdpSend(ws, 'Page.enable').catch(() => {});
                      await cdpSend(ws, 'Runtime.enable').catch(() => {});
                      await cdpSend(ws, 'DOM.enable').catch(() => {});
                      await cdpSend(ws, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

                      if (runInBackground) {
                        try {
                          const winTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                          if (winTarget?.windowId != null) {
                            await cdpSend(ws, 'Browser.setWindowBounds', {
                              windowId: winTarget.windowId,
                              bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                            }).catch(() => {});
                          }
                        } catch (_) {}
                        if (session.process?.pid) {
                          startBackgroundWindowKeeper(session.process.pid);
                          setProcessTaskbarVisibility(session.process.pid, false);
                        }
                      }

                      await new Promise(r => setTimeout(r, 6000));

                      let hasFilledCredentials = false;
                      let submitAttempted = false;

                      for (let sec = 0; sec < 120; sec++) {
                        if (igLoginDetected || !session.process || session.process.killed) break;

                        // 1. Checar URL atual
                        const urlRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: 'window.location.href',
                          returnByValue: true
                        }).catch(() => null);
                        const currentUrl = (urlRes?.result?.value || '').toLowerCase();

                        // Se redirecionou para fora de login e não está em desafio, checar login
                        if (
                          currentUrl.includes('instagram.com') &&
                          !currentUrl.includes('/accounts/login') &&
                          !currentUrl.includes('/challenge') &&
                          !currentUrl.includes('/two_factor') &&
                          !currentUrl.includes('/accounts/onetap')
                        ) {
                          const domLogged: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              return !!(document.querySelector('svg[aria-label="Início"], svg[aria-label="Home"], svg[aria-label="Página inicial"], a[href*="/direct/"], a[href*="/explore/"]') || (document.body && !document.querySelector('input[type="password"]')));
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          if (domLogged?.result?.value) {
                            console.log('[INSTAGRAM-LOGIN] Login confirmado via URL/DOM!');
                            handleInstagramLoginSuccess();
                            break;
                          }
                        }

                        // 2. Desafio / Verificação de segurança (2FA ou SMS/Email)
                        if (currentUrl.includes('/challenge') || currentUrl.includes('/two_factor')) {
                          setBadge('⚠️ Verificação de segurança / 2FA detectada! Conclua o desafio no navegador.', '#f59e0b');
                          await new Promise(r => setTimeout(r, 3000));
                          continue;
                        }

                        // 3. Modal "Guardar informações de início de sessão?" (onetap)
                        const onetapRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                              // Preferir guardar informações para manter sessão ativa
                              const saveBtn = buttons.find(function(b2) {
                                var tb = (b2.innerText || b2.textContent || '').trim().toLowerCase();
                                return tb === 'guardar informações' || tb === 'guardar informacoes' || tb === 'save info' || tb.includes('guardar info');
                              });
                              if (saveBtn) {
                                var rSave = saveBtn.getBoundingClientRect();
                                if (rSave.width > 20 && rSave.height > 15) return { x: rSave.left + rSave.width / 2, y: rSave.top + rSave.height / 2, text: 'save' };
                              }
                              const notNowBtn = buttons.find(function(b2) {
                                var tb = (b2.innerText || b2.textContent || '').trim().toLowerCase();
                                return tb === 'agora não' || tb === 'agora nao' || tb === 'not now';
                              });
                              if (notNowBtn) {
                                var rNot = notNowBtn.getBoundingClientRect();
                                if (rNot.width > 20 && rNot.height > 15) return { x: rNot.left + rNot.width / 2, y: rNot.top + rNot.height / 2, text: 'not now' };
                              }
                              return null;
                            } catch { return null; }
                          })()`,
                          returnByValue: true
                        }).catch(() => null);

                        if (onetapRes?.result?.value) {
                          console.log(`[INSTAGRAM-LOGIN] Modal "Guardar info" detectado ("${onetapRes.result.value.text}"). Clicando...`);
                          await realClickAt(onetapRes.result.value.x, onetapRes.result.value.y);
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // 4. Modal "Ativar notificações"
                        const notifRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              const allText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
                              if (/ativar notificações|turn on notifications/i.test(allText)) {
                                const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                                for (const b of buttons) {
                                  const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                                  if (t === 'agora não' || t === 'agora nao' || t === 'not now' || t === 'cancelar' || t === 'cancel') {
                                    const r = b.getBoundingClientRect();
                                    if (r.width > 20 && r.height > 15) {
                                      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                                    }
                                  }
                                }
                              }
                              return null;
                            } catch { return null; }
                          })()`,
                          returnByValue: true
                        }).catch(() => null);

                        if (notifRes?.result?.value) {
                          console.log('[INSTAGRAM-LOGIN] Modal de notificações detectado. Clicando em "Agora não"...');
                          await realClickAt(notifRes.result.value.x, notifRes.result.value.y);
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // 5. Banner de cookies do Instagram / Meta
                        const cookieRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                              for (const b of buttons) {
                                const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                                if (
                                  t.includes('permitir todos') ||
                                  t.includes('aceitar todos') ||
                                  t.includes('allow all') ||
                                  t.includes('accept all') ||
                                  t.includes('permitir apenas cookies essenciais') ||
                                  t.includes('only allow essential') ||
                                  t.includes('decline optional')
                                ) {
                                  const r = b.getBoundingClientRect();
                                  if (r.width > 20 && r.height > 15) {
                                    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                                  }
                                }
                              }
                              return null;
                            } catch { return null; }
                          })()`,
                          returnByValue: true
                        }).catch(() => null);

                        if (cookieRes?.result?.value) {
                          console.log('[INSTAGRAM-LOGIN] Banner de cookies detectado. Clicando...');
                          await realClickAt(cookieRes.result.value.x, cookieRes.result.value.y);
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // 6. Formulário de Login: Preenchimento de Utilizador e Senha via CDP
                        if (!hasFilledCredentials) {
                          const formCheck: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              try {
                                const userInput = document.querySelector('input[name="username"], input[name="emailOrPhone"], input[aria-label*="utilizador" i], input[aria-label*="username" i], input[type="text"]:not([aria-label*="pesquisa" i])');
                                const passInput = document.querySelector('input[name="password"], input[type="password"]');
                                if (userInput && passInput) {
                                  const ru = userInput.getBoundingClientRect();
                                  const rp = passInput.getBoundingClientRect();
                                  if (ru.width > 30 && rp.width > 30) {
                                    return {
                                      user: { x: ru.left + ru.width / 2, y: ru.top + ru.height / 2, val: userInput.value },
                                      pass: { x: rp.left + rp.width / 2, y: rp.top + rp.height / 2, val: passInput.value }
                                    };
                                  }
                                }
                                return null;
                              } catch { return null; }
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          const formInfo = formCheck?.result?.value;
                          if (formInfo) {
                            console.log(`[INSTAGRAM-LOGIN] Formulário de login localizado. Preenchendo credenciais via CDP...`);
                            setBadge('Inserindo utilizador do Instagram...', '#38bdf8');

                            // Injetar blindagem visual antes de digitar
                            await injectPrivacyShield(ws, email);

                            // Focar e digitar Username
                            await realClickAt(formInfo.user.x, formInfo.user.y);
                            await new Promise(r => setTimeout(r, 300));
                            // Selecionar tudo e limpar
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 150));

                            const effUser = email || '';
                            await typeHuman(effUser);
                            await new Promise(r => setTimeout(r, 600));

                            // Garantir preenchimento seguro de usuário mesmo em segundo plano
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[name="username"], input[name="emailOrPhone"], input[aria-label*="utilizador" i], input[aria-label*="username" i], input[type="text"]:not([aria-label*="pesquisa" i])');
                                if (el && (!el.value || el.value !== ${JSON.stringify(effUser)})) {
                                  el.focus();
                                  document.execCommand('insertText', false, ${JSON.stringify(effUser)});
                                }
                              })()`
                            }).catch(() => {});

                            // Focar e digitar Senha
                            setBadge('Inserindo senha do Instagram...', '#38bdf8');
                            await realClickAt(formInfo.pass.x, formInfo.pass.y);
                            await new Promise(r => setTimeout(r, 300));
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 150));

                            const effPass = pass || '';
                            await typeHuman(effPass);
                            await new Promise(r => setTimeout(r, 800));

                            // Garantir preenchimento seguro de senha mesmo em segundo plano
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[name="password"], input[type="password"]');
                                if (el && (!el.value || el.value !== ${JSON.stringify(effPass)})) {
                                  el.focus();
                                  document.execCommand('insertText', false, ${JSON.stringify(effPass)});
                                }
                              })()`
                            }).catch(() => {});

                            hasFilledCredentials = true;

                            // Submeter: Clicar no botão ou Enter
                            setBadge('Submetendo login no Instagram...', '#22c55e');
                            const submitCheck: any = await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                try {
                                  const btn = document.querySelector('button[type="submit"]');
                                  if (btn) {
                                    const r = btn.getBoundingClientRect();
                                    if (r.width > 20 && r.height > 15) {
                                      return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: btn.disabled };
                                    }
                                  }
                                  const allBtns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                                  for (const b of allBtns) {
                                    const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                                    if (t === 'iniciar sessão' || t === 'iniciar sessao' || t === 'entrar' || t === 'log in' || t === 'login') {
                                      const r = b.getBoundingClientRect();
                                      if (r.width > 20 && r.height > 15) {
                                        return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled || false };
                                      }
                                    }
                                  }
                                  return null;
                                } catch { return null; }
                              })()`,
                              returnByValue: true
                            }).catch(() => null);

                            const submitBtn = submitCheck?.result?.value;
                            if (submitBtn && !submitBtn.disabled) {
                              console.log(`[INSTAGRAM-LOGIN] Clicando no botão submit em (${submitBtn.x}, ${submitBtn.y})...`);
                              await realClickAt(submitBtn.x, submitBtn.y);
                            } else {
                              console.log('[INSTAGRAM-LOGIN] Botão desabilitado ou não encontrado, enviando Enter...');
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            }

                            submitAttempted = true;
                            await new Promise(r => setTimeout(r, 4000));
                            continue;
                          }
                        }

                        // 7. Checar se houve erro de credenciais incorretas
                        if (submitAttempted) {
                          const errCheck: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              const t = (document.body ? (document.body.innerText || document.body.textContent || '') : '').toLowerCase();
                              return t.includes('palavra-passe está incorreta') || t.includes('senha incorreta') || t.includes('password was incorrect') || t.includes('nome de utilizador não pertence');
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          if (errCheck?.result?.value) {
                            setBadge('❌ Palavra-passe ou utilizador incorretos no Instagram!', '#ef4444');
                          }
                        }

                        await new Promise(r => setTimeout(r, 2500));
                      }
                    };

                    setTimeout(runInstagramLoginAutomation, 2000);

                    igCheckInterval = setInterval(async () => {
                      if (igLoginDetected || !ws || ws.readyState !== WebSocket.OPEN) return;
                      try {
                        const cookieRes = (await cdpSend(ws, 'Network.getCookies', {
                          urls: ['https://www.instagram.com', 'https://www.instagram.com/']
                        }).catch(() => null)) as { cookies?: Array<{ name: string; value: string }> } | null;

                        const hasSessionCookie = cookieRes?.cookies?.some(
                          (c) => (c.name === 'sessionid' || c.name === 'ds_user_id') && c.value && c.value.length > 5
                        );

                        if (hasSessionCookie) {
                          const urlRes: any = await cdpSend(ws, 'Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }).catch(() => null);
                          const curUrl = (urlRes?.result?.value || '').toLowerCase();
                          if (!curUrl.includes('/accounts/login') && !curUrl.includes('/challenge') && !curUrl.includes('/two_factor')) {
                            console.log('[INSTAGRAM-LOGIN] Cookies de sessão válidos detectados (sessionid/ds_user_id)!');
                            await saveInstagramCookies(ws, session.profileDir || profileDir);
                            handleInstagramLoginSuccess();
                          }
                        }
                      } catch (_) {}
                    }, 4000);

                    chromeProcess.on('exit', () => {
                      if (igCheckInterval) clearInterval(igCheckInterval);
                      if (igCloseTimeout) clearTimeout(igCloseTimeout);
                    });
                  }

                  if (isFacebookLogin) {
                    let fbLoginDetected = false;
                    let fbCheckInterval: NodeJS.Timeout | null = null;
                    let fbCloseTimeout: NodeJS.Timeout | null = null;
                    let lastFb2FARequestTime = 0;

                    // ── Monitoramento Remoto de Login (ADM) ──
                    let stopFbLoginScreencastFn: (() => void) | null = null;
                    if (runInBackground || isQueueLogin) {
                      broadcastLoginEvent(partnerId, {
                        type: 'login_started',
                        platform: 'facebook',
                        accountCode: profileId,
                        email: email,
                        detail: 'Iniciando fluxo de auto-login Facebook',
                      });
                      stopFbLoginScreencastFn = startLoginScreencast(session, profileId, 'facebook', partnerId);
                    }

                    const handleFacebookLoginSuccess = async () => {
                      if (fbLoginDetected) return;
                      fbLoginDetected = true;
                      if (fbCheckInterval) {
                        clearInterval(fbCheckInterval);
                        fbCheckInterval = null;
                      }

                      session.isLoggedIn = true;
                      console.log(`[FACEBOOK] Login confirmado com sucesso para o parceiro ${partnerId || 'common'}! Gravando fb_authenticated.flag...`);

                      // Notificar ADM do sucesso e encerrar screencast de monitoramento
                      broadcastLoginEvent(partnerId, {
                        type: 'login_success',
                        platform: 'facebook',
                        accountCode: profileId,
                        email: email,
                        detail: 'Login Facebook confirmado com sucesso',
                      });
                      if (stopFbLoginScreencastFn) { stopFbLoginScreencastFn(); stopFbLoginScreencastFn = null; }

                      try {
                        const fbProfileDir = profileDir;
                        fsSync.mkdirSync(fbProfileDir, { recursive: true });
                        fsSync.writeFileSync(path.join(fbProfileDir, 'fb_authenticated.flag'), new Date().toISOString(), 'utf8');
                        console.log(`[FACEBOOK] fb_authenticated.flag gravado para ${profileDirName}`);
                      } catch (errFlag) {
                        console.error('[FACEBOOK] Erro ao gravar fb_authenticated.flag:', errFlag);
                      }

                      // Aguardar salvamento completo de cookies antes de agendar o fechamento
                      try {
                        await saveFacebookCookies(ws, profileDir);
                        console.log('[FACEBOOK] Cookies persistidos com sucesso após confirmação de login.');
                      } catch (e) {
                        console.warn('[FACEBOOK] Erro ao salvar cookies após login:', e);
                      }

                      event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                      mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });

                      cdpSend(ws, 'Runtime.enable').catch(() => {}).finally(() => {
                        cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              if (!document.getElementById('__agent_login_banner__')) {
                                var b = document.createElement('div');
                                b.id = '__agent_login_banner__';
                                b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#059669;color:#fff;padding:12px 20px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:bold;box-shadow:0 4px 20px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;gap:12px;';
                                b.innerHTML = '<span>✅ Login no Facebook concluído com sucesso!</span><span style="font-size:12px;opacity:0.95;font-weight:normal;">O navegador fechará automaticamente em 20 segundos para consolidar o perfil.</span>';
                                document.body.appendChild(b);
                              }
                            } catch(_) {}
                          })()`
                        }).catch(() => {});
                      });

                      console.log(`[FACEBOOK] Aguardando consolidação antes de fechar o Chrome do parceiro ${partnerId || 'common'}...`);
                      fbCloseTimeout = setTimeout(async () => {
                        console.log(`[FACEBOOK] Tempo de consolidação decorrido. Fechando navegador do parceiro ${partnerId || 'common'} de forma graciosa...`);
                        await closeChromeSessionGracefully(session, profileId, event.sender);
                      }, runInBackground ? 5000 : 8000);
                    };

                    const runFacebookLoginAutomation = async () => {
                      console.log(`[FACEBOOK-LOGIN] Iniciando automação unificada e inteligente para o parceiro ${partnerId || 'common'}...`);
                    if (runInBackground || isQueueLogin) broadcastLoginEvent(partnerId, { type: 'login_progress', platform: 'facebook', accountCode: profileId, email, detail: 'Iniciando automação de login Facebook' });
                      setBadge('Aguardando carregamento do Facebook...', '#38bdf8');

                      // ── Garantir foco emulado e janela oculta para execução 100% em segundo plano ──
                      await cdpSend(ws, 'Page.enable').catch(() => {});
                      await cdpSend(ws, 'Runtime.enable').catch(() => {});
                      await cdpSend(ws, 'DOM.enable').catch(() => {});
                      await cdpSend(ws, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

                      if (runInBackground) {
                        try {
                          const winTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                          if (winTarget?.windowId != null) {
                            await cdpSend(ws, 'Browser.setWindowBounds', {
                              windowId: winTarget.windowId,
                              bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                            }).catch(() => {});
                          }
                        } catch (_) {}
                        if (session.process?.pid) {
                          startBackgroundWindowKeeper(session.process.pid);
                          setProcessTaskbarVisibility(session.process.pid, false);
                        }
                      }

                      await new Promise(r => setTimeout(r, 6000));

                      let submitAttempted = false;

                      for (let sec = 0; sec < 120; sec++) {
                        if (fbLoginDetected || !session.process || session.process.killed) break;

                        // 1. Checar URL atual
                        const urlRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: 'window.location.href',
                          returnByValue: true
                        }).catch(() => null);
                        const currentUrl = (urlRes?.result?.value || '').toLowerCase();
                        console.log(`[FACEBOOK-LOOP] sec=${sec} URL=${currentUrl}`);

                        // Verificação proativa direta de cookies de sessão (c_user / xs)
                        try {
                          const ckProbe: any = await cdpSend(ws, 'Network.getCookies', {
                            urls: ['https://www.facebook.com', 'https://web.facebook.com', 'https://facebook.com', 'https://m.facebook.com']
                          }).catch(() => null);
                          const hasProbeCookie = ckProbe?.cookies?.some(
                            (c: any) => (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
                          );
                          if (hasProbeCookie && !currentUrl.includes('/login') && !currentUrl.includes('/checkpoint') && !currentUrl.includes('/auth_platform') && !currentUrl.includes('/recover') && !currentUrl.includes('/r.php')) {
                            console.log('[FACEBOOK-LOGIN] ✅ Sessão autenticada confirmada proativamente via cookies (c_user/xs)!');
                            handleFacebookLoginSuccess();
                            break;
                          }
                        } catch (_) {}

                        // 2. Banner de cookies do Facebook / Meta
                        const cookieRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              var cookieBtn = document.querySelector('[data-cookiebanner="accept_button"], [data-testid="cookie-policy-manage-dialog-accept-button"]');
                              if (cookieBtn) {
                                var r = cookieBtn.getBoundingClientRect();
                                if (r.width > 20 && r.height > 15) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                              }
                              var buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                              for (var i = 0; i < buttons.length; i++) {
                                var t = (buttons[i].innerText || buttons[i].textContent || '').trim().toLowerCase();
                                if (
                                  t.includes('permitir todos') ||
                                  t.includes('aceitar todos') ||
                                  t.includes('allow all') ||
                                  t.includes('accept all') ||
                                  t.includes('permitir apenas cookies essenciais') ||
                                  t.includes('recusar cookies opcionais') ||
                                  t.includes('only allow essential') ||
                                  t.includes('decline optional')
                                ) {
                                  var rect = buttons[i].getBoundingClientRect();
                                  if (rect.width > 20 && rect.height > 15) {
                                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                                  }
                                }
                              }
                              return null;
                            } catch(_) { return null; }
                          })()`,
                          returnByValue: true
                        }).catch(() => null);

                        if (cookieRes?.result?.value) {
                          console.log('[FACEBOOK-LOGIN] Banner de cookies detectado. Clicando...');
                          await realClickAt(cookieRes.result.value.x, cookieRes.result.value.y);
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // 3. Inspeção de 2FA / Checkpoints e Confirmação de Login no Facebook (Validado e Testado)
                        const cpActionRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              var curH = window.location.href.toLowerCase();
                              var body = document.body;
                              var bodyText = (body ? (body.innerText || body.textContent || '') : '').toLowerCase().replace(/\\s+/g, ' ');

                              // ── ETAPA 1: "Try another way" (Tela do número / aprovação no outro dispositivo) ──
                              var isAfadScreen = curH.includes('/auth_platform/afad') ||
                                                 curH.includes('/checkpoint') ||
                                                 bodyText.includes('check your other device') ||
                                                 bodyText.includes('waiting for approval') ||
                                                 bodyText.includes('notification on your') ||
                                                 bodyText.includes('open the notification') ||
                                                 bodyText.includes('aprovação');

                              if (isAfadScreen) {
                                // Buscar estritamente elementos interativos com role='button' ou button
                                var tryEl = Array.from(document.querySelectorAll('[role="button"], button')).find(function(el) {
                                  var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                  return t.includes('try another way') || t.includes('tentar de outra forma') || t.includes('outra forma');
                                });

                                if (!tryEl) {
                                  var allClickables = Array.from(document.querySelectorAll('a, [role="button"], button'));
                                  for (var i = 0; i < allClickables.length; i++) {
                                    var ct = (allClickables[i].innerText || allClickables[i].textContent || '').trim().toLowerCase();
                                    if (ct.includes('try another') || ct.includes('outra forma')) {
                                      tryEl = allClickables[i]; break;
                                    }
                                  }
                                }

                                if (tryEl) {
                                  tryEl.scrollIntoView({ block: 'center', inline: 'center' });
                                  try { tryEl.focus(); } catch(_) {}
                                  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                                    try { tryEl.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                                  });
                                  try { tryEl.click(); } catch(_) {}
                                  var tr = tryEl.getBoundingClientRect();
                                  return { action: 'try_another_way', coords: { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 } };
                                }
                              }

                              // ── ETAPA 2: "Choose a way to confirm" (Tela de opções: Dispositivo, Email, Google) ──
                              var isChooseScreen = curH.includes('/auth_platform/challengepicker') ||
                                                   bodyText.includes('choose a way to confirm') ||
                                                   bodyText.includes('escolhe uma forma') ||
                                                   bodyText.includes('confirm that it') ||
                                                   bodyText.includes('choose how') ||
                                                   bodyText.includes('choose a way');

                              if (isChooseScreen) {
                                var emailEl = Array.from(document.querySelectorAll('label, div[role="radio"], [role="button"], div, tr')).find(function(el) {
                                  var ot = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                                  return ot.length > 2 && ot.length < 120 && (ot.includes('email') || ot.includes('e-mail') || ot.includes('@') || ot.includes('enviar código'));
                                });

                                if (emailEl) {
                                  emailEl.scrollIntoView({ block: 'center', inline: 'center' });
                                  var rad = emailEl.querySelector('input[type="radio"]');
                                  if (rad) { try { rad.checked = true; rad.click(); } catch(_) {} }
                                  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                                    try { emailEl.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                                  });
                                  try { emailEl.click(); } catch(_) {}
                                }

                                var contBtn = Array.from(document.querySelectorAll('[role="button"], button')).find(function(el) {
                                  var ct = (el.innerText || el.textContent || '').trim().toLowerCase();
                                  return ct === 'continue' || ct === 'continuar';
                                });

                                var eCoords = null, cCoords = null;
                                if (emailEl) { var er = emailEl.getBoundingClientRect(); eCoords = { x: er.left + er.width/2, y: er.top + er.height/2 }; }
                                if (contBtn) { var cr = contBtn.getBoundingClientRect(); cCoords = { x: cr.left + cr.width/2, y: cr.top + cr.height/2 }; }
                                return { action: 'choose_email', emailCoords: eCoords, continueCoords: cCoords };
                              }

                              // ── ETAPA 3: Tela de Código de Verificação OTP (Check your email / Enter code) ──
                              var isCodeScreen = curH.includes('/auth_platform/codesubmit') ||
                                                 bodyText.includes('check your email') ||
                                                 bodyText.includes('enter the code') ||
                                                 bodyText.includes('enter code') ||
                                                 bodyText.includes('sent a code') ||
                                                 bodyText.includes('we sent') ||
                                                 bodyText.includes('introduz o código') ||
                                                 bodyText.includes('enviámos') ||
                                                 bodyText.includes('enviamos') ||
                                                 bodyText.includes('código de segurança') ||
                                                 bodyText.includes('verification code');

                              if (isCodeScreen) {
                                var codeInput = document.querySelector('input[type="text"], input[inputmode="numeric"], input');
                                var inpCoords = null;
                                if (codeInput) {
                                  codeInput.scrollIntoView({ block: 'center', inline: 'center' });
                                  var inr = codeInput.getBoundingClientRect();
                                  inpCoords = { x: inr.left + inr.width/2, y: inr.top + inr.height/2 };
                                }

                                var codeBtn = Array.from(document.querySelectorAll('[role="button"], button')).find(function(el) {
                                  var cbt = (el.innerText || el.textContent || '').trim().toLowerCase();
                                  return cbt === 'continue' || cbt === 'continuar' || cbt === 'submit' || cbt === 'submeter';
                                });

                                var btnCoords = null;
                                if (codeBtn) { var cbr3 = codeBtn.getBoundingClientRect(); btnCoords = { x: cbr3.left + cbr3.width/2, y: cbr3.top + cbr3.height/2 }; }
                                return { action: 'enter_code', inputCoords: inpCoords, btnCoords: btnCoords };
                              }

                              // ── ETAPA 4: "Save this browser" ──
                              if (
                                bodyText.includes('save this browser') || bodyText.includes('save browser') ||
                                bodyText.includes('guardar este navegador') || bodyText.includes('remember this browser')
                              ) {
                                var saveBtn = Array.from(document.querySelectorAll('[role="button"], button')).find(function(el) {
                                  var sbt = (el.innerText || el.textContent || '').trim().toLowerCase();
                                  return sbt === 'continue' || sbt === 'continuar' || sbt === 'ok';
                                });
                                if (saveBtn) {
                                  saveBtn.scrollIntoView({ block: 'center', inline: 'center' });
                                  try { saveBtn.click(); } catch(_) {}
                                  var sbr2 = saveBtn.getBoundingClientRect();
                                  return { action: 'save_browser', coords: { x: sbr2.left + sbr2.width/2, y: sbr2.top + sbr2.height/2 } };
                                }
                              }

                              // ── ETAPA 5: Checar se já logado (apenas se fora de auth/login e sem campos de senha) ──
                              var isAuthScreen = curH.includes('/auth_platform') || curH.includes('/login') || curH.includes('/checkpoint') || curH.includes('/recover') || curH.includes('/r.php');
                              var hasPassField = !!document.querySelector('input[type="password"], input[name="pass"], input[id="pass"]');
                              var has2FA = bodyText.includes('check your other device') || bodyText.includes('choose a way') || bodyText.includes('enter code') || bodyText.includes('introduz o código');

                              if (!isAuthScreen && !hasPassField && !has2FA) {
                                return { action: 'logged_in' };
                              }

                              return { action: 'none' };
                            } catch(e) { return { action: 'none' }; }
                          })()`,
                          returnByValue: true
                        }).catch(() => null);

                        const cpVal = cpActionRes?.result?.value;
                        console.log(`[FACEBOOK-LOOP] cpVal.action=${cpVal?.action} (sec=${sec})`);
                        if (cpVal?.action === 'try_another_way') {
                          sec = 0;
                          console.log('[FACEBOOK-2FA] "Try another way" localizado! Clicando via CDP...');
                          setBadge('Clicando em "Try another way"...', '#38bdf8');
                          if (cpVal.coords && typeof cpVal.coords.x === 'number') {
                            await realClickAt(cpVal.coords.x, cpVal.coords.y);
                            await new Promise(r => setTimeout(r, 100));
                            await realClickAt(cpVal.coords.x, cpVal.coords.y);
                          }
                          await new Promise(r => setTimeout(r, 3000));
                          continue;
                        }

                        if (cpVal?.action === 'choose_email') {
                          sec = 0;
                          console.log('[FACEBOOK-2FA] Tela de opções: Selecionando Email e clicando Continue...');
                          setBadge('A selecionar verificação por e-mail...', '#38bdf8');
                          if (cpVal.emailCoords) {
                            await realClickAt(cpVal.emailCoords.x, cpVal.emailCoords.y);
                            await new Promise(r => setTimeout(r, 600));
                          }
                          if (cpVal.continueCoords) {
                            await realClickAt(cpVal.continueCoords.x, cpVal.continueCoords.y);
                            await new Promise(r => setTimeout(r, 200));
                            await realClickAt(cpVal.continueCoords.x, cpVal.continueCoords.y);
                          }
                          await new Promise(r => setTimeout(r, 3000));
                          continue;
                        }

                        if (cpVal?.action === 'enter_code') {
                          sec = 0; // 🛑 Requisito: Espera infinita enquanto aguarda código do ADM (sem timeout)
                          console.log('[FACEBOOK-2FA] Tela de código OTP ativa.');
                          setBadge('🔑 Aguardando código do Administrador no painel...', '#f59e0b');
                          const nowTs = Date.now();
                          if (nowTs - lastFb2FARequestTime > 120000) {
                            lastFb2FARequestTime = nowTs;
                            dispatch2FARequest({ profileId, partnerId, platform: 'facebook', codeType: 'facebook_totp', accountId: session.accountId, email: session.email }, event.sender);
                          }
                          const incomingCode = (session.lastCode || '').trim();
                          if (incomingCode && incomingCode.length >= 4) {
                            setBadge(`Injetando código 2FA (${incomingCode})...`, '#22c55e');
                            if (cpVal.inputCoords) {
                              await realClickAt(cpVal.inputCoords.x, cpVal.inputCoords.y);
                              await new Promise(r => setTimeout(r, 300));
                              // Limpar campo
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp',   windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8,  key: 'Backspace', code: 'Backspace' }).catch(() => {});
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp',   windowsVirtualKeyCode: 8,  key: 'Backspace', code: 'Backspace' }).catch(() => {});
                              await typeHuman(incomingCode);
                              await new Promise(r => setTimeout(r, 400));
                              // Sincronizar React Tracker
                              await cdpSend(ws, 'Runtime.evaluate', { expression: `(function(){try{var el=document.querySelector('input[type="text"], input[inputmode="numeric"], input');if(el){var np=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');if(np&&np.set)np.set.call(el,${JSON.stringify(incomingCode)});var tr=el._valueTracker;if(tr)tr.setValue('');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}}catch(_){}})()`}).catch(() => null);
                            }
                            session.lastCode = '';
                            if (cpVal.btnCoords) {
                              await realClickAt(cpVal.btnCoords.x, cpVal.btnCoords.y);
                              await new Promise(r => setTimeout(r, 200));
                              await realClickAt(cpVal.btnCoords.x, cpVal.btnCoords.y);
                            }
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp',   windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            await new Promise(r => setTimeout(r, 4000));

                            // 🔍 Requisito: Verificar se o Facebook acusou código 2FA incorreto ou expirado
                            const checkFbCodeError: any = await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                try {
                                  var fbErrorPhrases = [
                                    'código que você inseriu está incorreto',
                                    'código que inseriu está incorreto',
                                    'o código inserido está incorreto',
                                    'o código que introduziu é inválido',
                                    'o código que introduziu está incorreto',
                                    'the code you entered is incorrect',
                                    'invalid verification code',
                                    'código de verificação inválido',
                                    'código 2fa incorreto',
                                    'código inválido',
                                    'código incorreto'
                                  ];

                                  var isFbError = false;
                                  var fbErrMsg = '';
                                  var allText = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                                  for (var f = 0; f < fbErrorPhrases.length; f++) {
                                    if (allText.includes(fbErrorPhrases[f])) {
                                      isFbError = true;
                                      fbErrMsg = fbErrorPhrases[f];
                                      break;
                                    }
                                  }

                                  var alertEl = document.querySelector('[role="alert"], .uiError');
                                  if (alertEl) {
                                    var alertTxt = (alertEl.innerText || '').toLowerCase();
                                    for (var f = 0; f < fbErrorPhrases.length; f++) {
                                      if (alertTxt.includes(fbErrorPhrases[f])) {
                                        isFbError = true;
                                        fbErrMsg = alertEl.innerText;
                                        break;
                                      }
                                    }
                                  }

                                  var inputStillPresent = !!document.querySelector('input[name="approvals_code"], input[name="verification_code"], input[id*="checkpoint" i], input[type="text"], input[inputmode="numeric"]');
                                  if (isFbError && inputStillPresent) {
                                    return { isError: true, message: fbErrMsg || 'Código 2FA incorreto ou expirado no Facebook' };
                                  }
                                  return { isError: false };
                                } catch(e) { return { isError: false }; }
                              })()`,
                              returnByValue: true
                            }).catch(() => null);

                            if (checkFbCodeError?.result?.value?.isError) {
                              const errMsg = checkFbCodeError.result.value.message || 'Código 2FA incorreto ou expirado no Facebook';
                              console.warn(`[FACEBOOK-2FA] ❌ Código incorreto detectado: "${errMsg}". Re-notificando ADM imediatamente...`);
                              setBadge('⚠️ Código 2FA incorreto! Solicitando novo código ao ADM...', '#ef4444');
                              session.lastCode = '';
                              if (cpVal.inputCoords) {
                                await realClickAt(cpVal.inputCoords.x, cpVal.inputCoords.y);
                                await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                                await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp',   windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                                await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8,  key: 'Backspace', code: 'Backspace' }).catch(() => {});
                                await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp',   windowsVirtualKeyCode: 8,  key: 'Backspace', code: 'Backspace' }).catch(() => {});
                              }
                              lastFb2FARequestTime = 0; // Resetar throttle
                              dispatch2FARequest({ profileId, partnerId, platform: 'facebook', codeType: 'facebook_totp', isRetry: true, errorMessage: errMsg, accountId: session.accountId, email: session.email }, event.sender);
                              continue;
                            }

                            continue;
                          }
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        if (cpVal?.action === 'save_browser') {
                          console.log('[FACEBOOK-2FA] "Save this browser". Confirmando...');
                          setBadge('Memorizando navegador no Facebook...', '#38bdf8');
                          if (cpVal.coords && typeof cpVal.coords.x === 'number') await realClickAt(cpVal.coords.x, cpVal.coords.y);
                          await new Promise(r => setTimeout(r, 2500));
                          continue;
                        }

                        if (cpVal?.action === 'logged_in') {
                          console.log('[FACEBOOK-LOGIN] Login confirmado via URL/DOM!');
                          handleFacebookLoginSuccess();
                          break;
                        }

                        // ── 5. FORMULÁRIO DE LOGIN FACEBOOK (Exatamente o fluxo funcional da v1.4.12 / v1.4.7) ──
                        const effUser = email || '';
                        const effPass = pass || '';

                        const formStatus: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              var userInput = document.querySelector('input#email, input[name="email"], input[type="text"]:not([aria-label*="pesquisa" i]):not([aria-label*="search" i])');
                              var passInput = document.querySelector('input#pass, input[name="pass"], input[type="password"]');
                              var submitBtn = document.querySelector('button#loginbutton, button[name="login"], button[type="submit"]');
                              if (!submitBtn) {
                                var all = Array.from(document.querySelectorAll('button, div[role="button"]'));
                                for (var i = 0; i < all.length; i++) {
                                  var t = (all[i].innerText || all[i].textContent || '').trim().toLowerCase();
                                  if (t === 'iniciar sessão' || t === 'iniciar sessao' || t === 'entrar' || t === 'log in' || t === 'login') {
                                    submitBtn = all[i];
                                    break;
                                  }
                                }
                              }

                              if (!userInput || !passInput) return { hasForm: false };

                              var uRect = userInput.getBoundingClientRect();
                              var pRect = passInput.getBoundingClientRect();

                              return {
                                hasForm: true,
                                userNeedsFill: userInput.value !== ${JSON.stringify(effUser)},
                                passNeedsFill: passInput.value !== ${JSON.stringify(effPass)},
                                userCoords: { x: uRect.left + uRect.width / 2, y: uRect.top + uRect.height / 2 },
                                passCoords: { x: pRect.left + pRect.width / 2, y: pRect.top + pRect.height / 2 },
                                btnFound: !!submitBtn
                              };
                            } catch(e) { return { hasForm: false }; }
                          })()`,
                          returnByValue: true
                        }).catch(() => null);

                        const fState = formStatus?.result?.value;
                        if (fState?.hasForm && (!submitAttempted || fState.userNeedsFill || fState.passNeedsFill)) {
                          console.log('[FACEBOOK-LOGIN] Formulário de login localizado. Preenchendo com ações humanas...');
                          setBadge('Preenchendo credenciais no Facebook...', '#38bdf8');

                          // Injetar blindagem visual no Facebook antes de digitar
                          await injectPrivacyShield(ws, effUser);

                          // A. Digitar Utilizador / E-mail
                          if (fState.userNeedsFill && effUser) {
                            console.log(`[FACEBOOK-LOGIN] Clicando no campo de e-mail (${fState.userCoords.x.toFixed(0)}, ${fState.userCoords.y.toFixed(0)})...`);
                            await realClickAt(fState.userCoords.x, fState.userCoords.y);
                            await new Promise(r => setTimeout(r, 350));

                            // Limpar campo se tiver resíduos
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});

                            await typeHuman(effUser);
                            await new Promise(r => setTimeout(r, 400));

                            // Garantir preenchimento seguro de usuário mesmo em segundo plano
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input#email, input[name="email"]') || document.querySelector('input[type="text"]:not([aria-label*="pesquisa" i]):not([aria-label*="search" i])');
                                if (el) {
                                  el.focus();
                                  document.execCommand('insertText', false, ${JSON.stringify(effUser)});
                                }
                              })()`
                            }).catch(() => {});

                            // Sincronizar React Tracker
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                try {
                                  var el = document.querySelector('input#email, input[name="email"]') || document.querySelector('input[type="text"]');
                                  if (el) {
                                    var nativeProto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                                    if (nativeProto && nativeProto.set) nativeProto.set.call(el, ${JSON.stringify(effUser)});
                                    var tracker = el._valueTracker; if (tracker) tracker.setValue('');
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                } catch(_) {}
                              })()`
                            }).catch(() => null);
                          }

                          // B. Digitar Senha
                          if (fState.passNeedsFill && effPass) {
                            console.log(`[FACEBOOK-LOGIN] Clicando no campo de senha (${fState.passCoords.x.toFixed(0)}, ${fState.passCoords.y.toFixed(0)})...`);
                            await realClickAt(fState.passCoords.x, fState.passCoords.y);
                            await new Promise(r => setTimeout(r, 350));

                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});

                            await typeHuman(effPass);
                            await new Promise(r => setTimeout(r, 500));

                            // Garantir preenchimento seguro de senha mesmo em segundo plano
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input#pass, input[name="pass"], input[type="password"]');
                                if (el) {
                                  el.focus();
                                  document.execCommand('insertText', false, ${JSON.stringify(effPass)});
                                }
                              })()`
                            }).catch(() => {});

                            // Sincronizar React Tracker da Senha
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                try {
                                  var el = document.querySelector('input#pass, input[name="pass"], input[type="password"]');
                                  if (el) {
                                    var nativeProto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                                    if (nativeProto && nativeProto.set) nativeProto.set.call(el, ${JSON.stringify(effPass)});
                                    var tracker = el._valueTracker; if (tracker) tracker.setValue('');
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                } catch(_) {}
                              })()`
                            }).catch(() => null);
                          }

                          // C. Submeter Login: Clicar no botão de login
                          setBadge('Submetendo login no Facebook...', '#22c55e');

                          const btnCoords: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              try {
                                var btn = document.querySelector('button#loginbutton, button[name="login"], button[type="submit"]');
                                if (!btn) {
                                  var allBtns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                                  for (var i = 0; i < allBtns.length; i++) {
                                    var t = (allBtns[i].innerText || allBtns[i].textContent || '').trim().toLowerCase();
                                    if (t === 'iniciar sessão' || t === 'iniciar sessao' || t === 'entrar' || t === 'log in' || t === 'login') {
                                      btn = allBtns[i];
                                      break;
                                    }
                                  }
                                }
                                if (!btn) return null;
                                btn.removeAttribute('disabled');
                                btn.disabled = false;
                                btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                                var r = btn.getBoundingClientRect();
                                if (r.width > 10 && r.height > 10) {
                                  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                                }
                                return null;
                              } catch(e) { return null; }
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          const targetCoords = btnCoords?.result?.value;
                          if (targetCoords && typeof targetCoords.x === 'number') {
                            console.log(`[FACEBOOK-LOGIN] Botão de login localizado em (${targetCoords.x.toFixed(0)}, ${targetCoords.y.toFixed(0)}). Clicando...`);
                            await realClickAt(targetCoords.x, targetCoords.y);
                            await new Promise(r => setTimeout(r, 500));
                            await realClickAt(targetCoords.x, targetCoords.y);
                            await new Promise(r => setTimeout(r, 300));
                          } else {
                            console.log('[FACEBOOK-LOGIN] Botão de login não localizado por coordenadas.');
                          }

                          // Pressionar Enter nativo via CDP como fallback garantido
                          await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                          await new Promise(r => setTimeout(r, 60));
                          await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});

                          submitAttempted = true;
                          await new Promise(r => setTimeout(r, 3500));
                          continue;
                        }

                        // 8. Checar se houve erro de credenciais incorretas no Facebook
                        if (submitAttempted) {
                          const errCheck: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              var t = (document.body ? (document.body.innerText || document.body.textContent || '') : '').toLowerCase();
                              return t.includes('palavra-passe que introduziste') || t.includes('senha incorreta') || t.includes('incorrect password') || t.includes('o e-mail que introduziste') || t.includes('invalid credentials');
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          if (errCheck?.result?.value) {
                            setBadge('❌ Palavra-passe ou e-mail incorretos no Facebook!', '#ef4444');
                          }
                        }

                        await new Promise(r => setTimeout(r, 2500));
                      }
                    };

                    setTimeout(runFacebookLoginAutomation, 2000);

                    fbCheckInterval = setInterval(async () => {
                      if (fbLoginDetected || !ws || ws.readyState !== WebSocket.OPEN) return;
                      try {
                        const cookieRes = (await cdpSend(ws, 'Network.getCookies', {
                          urls: ['https://www.facebook.com', 'https://www.facebook.com/', 'https://web.facebook.com', 'https://web.facebook.com/']
                        }).catch(() => null)) as { cookies?: Array<{ name: string; value: string }> } | null;

                        const hasSessionCookie = cookieRes?.cookies?.some(
                          (c) => (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3
                        );

                        if (hasSessionCookie) {
                          const isSafeIn: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              // Nunca confirmar login se estivermos na página de login
                              var href = window.location.href.toLowerCase();
                              if (href.includes('/login') || href.includes('/checkpoint') || href.includes('/two_step') || href.includes('/auth_platform') || href.includes('about:blank')) return false;
                              // Se os campos de login estiverem visíveis, NUNCA confirmar login!
                              if (document.querySelector('input[name="email"], input[id="email"], input[type="password"]')) return false;
                              var t = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                              var is2FA = t.includes('check your other device') ||
                                          t.includes('choose a way to confirm') ||
                                          t.includes('waiting for approval') ||
                                          t.includes('enter code') ||
                                          t.includes('introduz o código') ||
                                          t.includes('try another way') ||
                                          t.includes('tentar de outra forma') ||
                                          t.includes('save this browser') ||
                                          t.includes('guardar este navegador');
                              if (is2FA) return false;
                              return true;
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          if (isSafeIn?.result?.value) {
                            console.log('[FACEBOOK-LOGIN] Cookies de sessão válidos e DOM autenticado confirmado (c_user/xs)!');
                            saveFacebookCookies(ws, profileDir).catch(() => {});
                            handleFacebookLoginSuccess();
                          }
                        }
                      } catch (_) {}
                    }, 4000);

                    chromeProcess.on('exit', () => {
                      if (fbCheckInterval) clearInterval(fbCheckInterval);
                      if (fbCloseTimeout) clearTimeout(fbCloseTimeout);
                    });
                  }


                  let handleYouTubeLoginSuccess: (() => void) | null = null;

                  if (isYouTubeLogin) {
                    let ytLoginDetected = false;
                    let ytCloseTimeout: NodeJS.Timeout | null = null;

                    // ── Monitoramento Remoto de Login (ADM) ──
                    let stopYtLoginScreencastFn: (() => void) | null = null;
                    if (runInBackground || isQueueLogin) {
                      broadcastLoginEvent(partnerId, {
                        type: 'login_started',
                        platform: 'youtube',
                        accountCode: profileId,
                        email: googleEmail || email,
                        detail: 'Iniciando fluxo de auto-login YouTube/Google',
                      });
                      stopYtLoginScreencastFn = startLoginScreencast(session, profileId, 'youtube', partnerId);
                    }

                    handleYouTubeLoginSuccess = () => {
                      if (ytLoginDetected) return;
                      ytLoginDetected = true;

                      session.isLoggedIn = true;
                      console.log(`[YOUTUBE] Login confirmado com sucesso para ${partnerId || profileId}!`);

                      // Notificar ADM do sucesso e encerrar screencast de monitoramento
                      broadcastLoginEvent(partnerId, {
                        type: 'login_success',
                        platform: 'youtube',
                        accountCode: profileId,
                        email: googleEmail || email,
                        detail: 'Login YouTube/Google confirmado com sucesso',
                      });
                      if (stopYtLoginScreencastFn) { stopYtLoginScreencastFn(); stopYtLoginScreencastFn = null; }

                      try {
                        const ytProfileDir = session.profileDir || profileDir;
                        fsSync.mkdirSync(ytProfileDir, { recursive: true });
                        fsSync.writeFileSync(path.join(ytProfileDir, 'yt_authenticated.flag'), new Date().toISOString(), 'utf8');
                        console.log(`[YOUTUBE] yt_authenticated.flag gravado para ${profileDirName}`);
                      } catch (errFlag) {
                        console.error('[YOUTUBE] Erro ao gravar yt_authenticated.flag:', errFlag);
                      }

                      event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                      mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });

                      const isQueueRun = !!session.isQueueLogin;
                      cdpSend(ws, 'Runtime.enable').catch(() => {}).finally(() => {
                        cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              if (!document.getElementById('__agent_login_banner__')) {
                                var b = document.createElement('div');
                                b.id = '__agent_login_banner__';
                                b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#059669;color:#fff;padding:12px 20px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:bold;box-shadow:0 4px 20px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;gap:12px;';
                                b.innerHTML = ${isQueueRun
                                  ? `'<span>✅ Login no YouTube Studio concluído com sucesso!</span><span style="font-size:12px;opacity:0.95;font-weight:normal;">Salvando sessão e avançando fila em 4 segundos...</span>'`
                                  : `'<span>✅ Login no YouTube Studio concluído com sucesso!</span><span style="font-size:12px;opacity:0.95;font-weight:normal;">Sessão segura ativa. Bom trabalho!</span>'`
                                };
                                document.body.appendChild(b);
                                if (!${isQueueRun ? 'true' : 'false'}) {
                                  setTimeout(function() { if (b && b.parentNode) b.parentNode.removeChild(b); }, 6000);
                                }
                              }
                            } catch(_) {}
                          })()`
                        }).catch(() => {});
                      });

                      if (isQueueRun) {
                        ytCloseTimeout = setTimeout(async () => {
                          console.log(`[YOUTUBE] Fila de Login Geral: salvando backup informativo e avançando fila para perfil ${profileId}...`);
                          try {
                            const ytProfileDir = session.profileDir || profileDir;
                            await saveYouTubeCookies(ws, ytProfileDir);
                          } catch (errCk) {
                            console.warn('[YOUTUBE] Erro ao salvar cookies de backup:', errCk);
                          }
                          await closeChromeSessionGracefully(session, profileId, event.sender);
                        }, 4000);
                      } else {
                        console.log(`[YOUTUBE] Login interativo concluído com sucesso. Mantendo navegador aberto para o criador.`);
                        try {
                          const ytProfileDir = session.profileDir || profileDir;
                          saveYouTubeCookies(ws, ytProfileDir).catch(() => {});
                        } catch (_) {}
                      }
                    };

                    const runYouTubeLoginAutomation = async () => {
                      console.log(`[YOUTUBE-LOGIN] Iniciando automação Google/YouTube para ${partnerId || profileId}...`);
                      if (runInBackground || isQueueLogin) broadcastLoginEvent(partnerId, { type: 'login_progress', platform: 'youtube', accountCode: profileId, email: googleEmail || email, detail: 'Iniciando automação Google/YouTube' });
                      setBadge('Aguardando carregamento do Google...', '#38bdf8');

                      // ── Garantir foco emulado para que CDP Input funcione 100% em segundo plano ──
                      await cdpSend(ws, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
                      await cdpSend(ws, 'DOM.enable').catch(() => {});

                      // Forçar janela offscreen e ocultar da barra de tarefas imediatamente
                      try {
                        const winTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                        if (winTarget?.windowId != null) {
                          await cdpSend(ws, 'Browser.setWindowBounds', {
                            windowId: winTarget.windowId,
                            bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                          }).catch(() => {});
                        }
                      } catch (_) {}
                      if (session.process?.pid) {
                        startBackgroundWindowKeeper(session.process.pid);
                        setProcessTaskbarVisibility(session.process.pid, false);
                      }

                      // Aguardo reativo inicial (máx 3s)
                      for (let gw = 0; gw < 15; gw++) {
                        await new Promise(r => setTimeout(r, 200));
                        const readyCheck: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `document.readyState === 'complete' && (!!document.querySelector('input, #identifierId, [data-identifier]') || window.location.href.includes('google.'))`,
                          returnByValue: true
                        }).catch(() => null);
                        if (readyCheck?.result?.value) break;
                      }

                      const effUser = googleEmail || email || '';
                      const effPass = googlePass || pass || '';

                      let emailSubmitted = false;
                      let passSubmitted = false;
                      let lastNotifTime = 0;

                      // 1. Injetar Privacy Shield inicial (mascara inputs e censura exibição do e-mail)
                      await injectPrivacyShield(ws, effUser);

                      for (let sec = 0; sec < 180; sec++) {
                        if (ytLoginDetected || !session.process || session.process.killed) break;

                        // Re-injetar Privacy Shield em cada navegação de página do Google
                        await injectPrivacyShield(ws, effUser);

                        // Checar URL atual
                        const urlRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: 'window.location.href',
                          returnByValue: true
                        }).catch(() => null);
                        const curUrl = (urlRes?.result?.value || '').toLowerCase();

                        // Logging para diagnóstico (sempre escrever mesmo se url vazia)
                        try {
                          const _logP = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), '2am-login-debug.log');
                          fsSync.appendFileSync(_logP, `[${new Date().toISOString()}] [YOUTUBE-FN] sec=${sec} url=${curUrl.substring(0, 100)} wsState=${ws?.readyState}\n`, 'utf8');
                        } catch (_) {}

                        // ── 1. Sucesso: Chegou ao YouTube Studio ou YouTube fora de accounts.google.com ──
                        const isGoogleAuth = curUrl.includes('accounts.google.') || curUrl.includes('/signin') || curUrl.includes('/servicelogin') || curUrl.includes('/challenge');
                        if (!isGoogleAuth && (curUrl.includes('studio.youtube.com') || curUrl.includes('youtube.com'))) {
                          const ytProfileDir = session.profileDir || profileDir;
                          const savedCookies = await saveYouTubeCookies(ws, ytProfileDir);
                          if (savedCookies) {
                            console.log('[YOUTUBE-LOGIN] ✅ Chegou ao YouTube / Studio com cookies válidos — login confirmado!');
                            handleYouTubeLoginSuccess?.();
                            break;
                          }
                          await new Promise(r => setTimeout(r, 2500));
                          continue;
                        }

                        // ── 2. Avaliar Estado da Página com Coordenadas Humanas ──
                        const pageAction: any = await cdpSend(ws, 'Runtime.evaluate', {
                          expression: `(function() {
                            try {
                              var url = window.location.href.toLowerCase();
                              var body = document.body;
                              var bodyText = (body ? (body.innerText || body.textContent || '') : '').toLowerCase().replace(/\\s+/g,' ');

                              // Cookie Consent
                              var cookieBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(function(el) {
                                var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                return t.includes('accept all') || t.includes('aceitar tudo') || t.includes('i agree') || t.includes('concordo') || t.includes('agree') || t.includes('accept');
                              });
                              if (cookieBtn) {
                                var cbr = cookieBtn.getBoundingClientRect();
                                if (cbr.width > 20 && cbr.height > 15) return { action: 'cookie_consent', coords: { x: cbr.left + cbr.width/2, y: cbr.top + cbr.height/2 } };
                              }

                              // Account Chooser
                              if (url.includes('/accountchooser') || bodyText.includes('choose an account') || bodyText.includes('escolher uma conta')) {
                                var accts = Array.from(document.querySelectorAll('[data-identifier], li[role="listitem"], div[role="listitem"], .OVnw0d, div[data-email]'));
                                for (var i = 0; i < accts.length; i++) {
                                  var at = (accts[i].innerText || accts[i].textContent || '').toLowerCase();
                                  if (at.includes('@') || at.includes('gmail')) {
                                    var ar = accts[i].getBoundingClientRect();
                                    if (ar.width > 20 && ar.height > 15) return { action: 'choose_account', coords: { x: ar.left + ar.width/2, y: ar.top + ar.height/2 } };
                                  }
                                }
                                var anotherBtn = Array.from(document.querySelectorAll('li, div[role="button"], button')).find(function(el) {
                                  var t = (el.innerText || el.textContent || '').toLowerCase();
                                  return t.includes('use another account') || t.includes('utilizar outra conta') || t.includes('add account');
                                });
                                if (anotherBtn) {
                                  var abr = anotherBtn.getBoundingClientRect();
                                  if (abr.width > 20 && abr.height > 15) return { action: 'choose_account', coords: { x: abr.left + abr.width/2, y: abr.top + abr.height/2 } };
                                }
                              }

                              // Campo de E-mail
                              var emailInput = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                              if (emailInput && !emailInput.disabled && emailInput.offsetParent !== null) {
                                var r = emailInput.getBoundingClientRect();
                                if (r.width > 30 && r.height > 15) {
                                  var nextBtn = document.querySelector('#identifierNext button, #identifierNext, button[jsname="LgbsSe"], div[jsname="LgbsSe"], button[type="submit"]');
                                  var nb = nextBtn ? nextBtn.getBoundingClientRect() : null;
                                  return {
                                    action: 'email_field',
                                    inputCoords: { x: r.left + r.width/2, y: r.top + r.height/2 },
                                    btnCoords: nb && nb.width > 10 ? { x: nb.left + nb.width/2, y: nb.top + nb.height/2 } : null,
                                    currentValue: emailInput.value || ''
                                  };
                                }
                              }

                              // Campo de Senha
                              var passInput = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                              if (passInput && !passInput.disabled && passInput.offsetParent !== null) {
                                var pr = passInput.getBoundingClientRect();
                                if (pr.width > 30 && pr.height > 15) {
                                  var pwBtn = document.querySelector('#passwordNext button, #passwordNext, button[jsname="LgbsSe"], div[jsname="LgbsSe"], button[type="submit"]');
                                  var pb = pwBtn ? pwBtn.getBoundingClientRect() : null;
                                  return {
                                    action: 'pass_field',
                                    inputCoords: { x: pr.left + pr.width/2, y: pr.top + pr.height/2 },
                                    btnCoords: pb && pb.width > 10 ? { x: pb.left + pb.width/2, y: pb.top + pb.height/2 } : null
                                  };
                                }
                              }

                              // ── Selfie / Vídeo do rosto: Google pede selfie para verificação → clicar "Agora não" para pular ──
                              var bodyClean = (document.body ? (document.body.innerText || document.body.textContent || '') : '').toLowerCase();
                              var isSelfieScreen = bodyClean.includes('selfie') || bodyClean.includes('breve vídeo') || bodyClean.includes('breve video') ||
                                bodyClean.includes('grave um') || bodyClean.includes('adicione uma selfie') || bodyClean.includes('add a selfie') ||
                                bodyClean.includes('record a short video') || bodyClean.includes('gravar um vídeo') || bodyClean.includes('gravar um video') ||
                                bodyClean.includes('vídeo da sua cara') || bodyClean.includes('video da sua cara') ||
                                url.includes('/speedbump/') || url.includes('/signinanswer') || url.includes('/challenge/ipp') || url.includes('/challenge/iap');
                              if (isSelfieScreen) {
                                var allCandidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], span, div'));
                                var skipSelfieBtn = null;
                                for (var sbi = 0; sbi < allCandidates.length; sbi++) {
                                  var rawBtn = allCandidates[sbi];
                                  var btnEl = rawBtn.closest('button, a, [role="button"], [role="link"]') || rawBtn;
                                  var bt = (btnEl.innerText || btnEl.textContent || '').trim().toLowerCase();
                                  if (!bt || bt.length > 50) continue;
                                  if (
                                    bt === 'agora não' || bt === 'agora nao' || bt === 'not now' || bt === 'skip' ||
                                    bt === 'ignorar' || bt === 'talvez mais tarde' || bt === 'maybe later' ||
                                    bt === 'não agora' || bt === 'nao agora' || bt === 'ahora no' ||
                                    bt === 'não, obrigado' || bt === 'nao, obrigado' || bt === 'no thanks' ||
                                    bt === 'cancelar' || bt === 'cancel' ||
                                    bt.includes('agora não') || bt.includes('agora nao') || bt.includes('not now') || bt.includes('ahora no')
                                  ) {
                                    var sbr = btnEl.getBoundingClientRect();
                                    if (sbr.width > 5 && sbr.height > 5 && sbr.width < 500 && sbr.height < 150) {
                                      skipSelfieBtn = btnEl;
                                      break;
                                    }
                                  }
                                }
                                if (skipSelfieBtn) {
                                  try { skipSelfieBtn.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(_) {}
                                  try { skipSelfieBtn.focus(); } catch(_) {}
                                  try { skipSelfieBtn.click(); } catch(_) {}
                                  var ssr = skipSelfieBtn.getBoundingClientRect();
                                  if (ssr.width > 5 && ssr.height > 5) {
                                    return { action: 'selfie_skip', coords: { x: ssr.left + ssr.width/2, y: ssr.top + ssr.height/2 } };
                                  }
                                }
                              }

                              // Consentimento / Not Now / Continuar / Confirmar no YouTube
                              // NUNCA disparar consent em páginas de challenge — isAnyChallengePage trata-as
                              if (!url.includes('/challenge')) {
                                var consentBtn = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]')).find(function(el) {
                                  var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                  if (t.includes('não') && !t.includes('agora não') && !t.includes('not now')) return false;
                                  if (t.includes('cancel') || t.includes('recusar')) return false;
                                  return t === 'agora não' || t === 'não agora' || t === 'not now' || t === 'continuar' || t === 'continue' || t === 'confirmar' || t === 'aceitar';
                                });
                                if (consentBtn) {
                                  var cbr2 = consentBtn.getBoundingClientRect();
                                  if (cbr2.width > 20 && cbr2.height > 15) return { action: 'consent_click', coords: { x: cbr2.left + cbr2.width/2, y: cbr2.top + cbr2.height/2 } };
                                }
                              }

                              // ── ETAPA: Página pede número de telemóvel → clicar "Experimentar outra forma" ──
                              var phoneInput = document.querySelector('input[type="tel"][name="phoneNumber"], input[autocomplete="tel"], input[name="phoneNumber"]');
                              if (!phoneInput) {
                                var allTelInputs = Array.from(document.querySelectorAll('input[type="tel"]'));
                                phoneInput = allTelInputs.find(function(el) {
                                  var lbl = (el.getAttribute('aria-label') || el.placeholder || '').toLowerCase();
                                  return lbl.includes('telefone') || lbl.includes('phone') || lbl.includes('número') || lbl.includes('number') || lbl.includes('telemóvel') || lbl.includes('mobile');
                                }) || null;
                              }
                              // ══════════════════════════════════════════════════════════════════
                              // LÓGICA UNIFICADA: QUALQUER ecrã de verificação → SEMPRE navegar
                              // para o método de código offline (telemóvel/tablet).
                              // O bot NUNCA aceita passkey, notificação push, número de telefone, etc.
                              // Só entra o código quando JÁ estiver no ecrã de código offline.
                              // ══════════════════════════════════════════════════════════════════

                              var isAnyChallengePage = url.includes('/challenge') || url.includes('/signin/v2/challenge') ||
                                url.includes('/signin/challenge');

                              if (isAnyChallengePage) {
                                var findBtnByText = function(texts) {
                                  var allEls = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], li, span'));
                                  var candidates = [];
                                  for (var bi = 0; bi < allEls.length; bi++) {
                                    var rawEl = allEls[bi];
                                    var el = rawEl.closest('button, a, [role="button"], [role="link"], li') || rawEl;
                                    var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                    if (!t || t.length > 100) continue;
                                    for (var ti = 0; ti < texts.length; ti++) {
                                      if (t.includes(texts[ti])) {
                                        var r = el.getBoundingClientRect();
                                        if (r.width > 5 && r.height > 5 && r.width < 600 && r.height < 150) {
                                          candidates.push({ el: el, tLen: t.length });
                                          break;
                                        }
                                      }
                                    }
                                  }
                                  if (candidates.length === 0) {
                                    for (var bi2 = 0; bi2 < allEls.length; bi2++) {
                                      var rawEl2 = allEls[bi2];
                                      var el2 = rawEl2.closest('button, a, [role="button"], [role="link"], li') || rawEl2;
                                      var t2 = (el2.innerText || el2.textContent || '').trim().toLowerCase();
                                      if (!t2 || t2.length > 100) continue;
                                      for (var ti2 = 0; ti2 < texts.length; ti2++) {
                                        if (t2.includes(texts[ti2])) {
                                          candidates.push({ el: el2, tLen: t2.length });
                                          break;
                                        }
                                      }
                                    }
                                  }
                                  if (candidates.length === 0) return null;
                                  candidates.sort(function(a, b) { return a.tLen - b.tLen; });
                                  return candidates[0].el;
                                };

                                // ── PRIORIDADE 1: Opção de código offline já visível na lista? ──
                                var offlineBtn = findBtnByText([
                                  'usar o telemóvel ou o tablet para obter um código de segurança',
                                  'use your phone or tablet to get a security code',
                                  'usar o telemóvel', 'usar o tablet', 'usar o smartphone',
                                  'use phone or tablet', 'sem ligação', 'sin conexión',
                                  'get a security code', 'obter um código'
                                ]);
                                if (offlineBtn) {
                                  var ot = (offlineBtn.innerText || '').toLowerCase();
                                  var isReallyOffline = (ot.includes('offline') || ot.includes('sem ligação') || ot.includes('sin conexión') ||
                                    ((ot.includes('código') || ot.includes('code')) && (ot.includes('telemóvel') || ot.includes('tablet') || ot.includes('phone') || ot.includes('offline'))) ||
                                    (ot.includes('usar o telemóvel') || ot.includes('usar o tablet')));
                                  if (!isReallyOffline) offlineBtn = null;
                                }
                                if (offlineBtn) {
                                  try { offlineBtn.click(); } catch(_) {}
                                  var obr = offlineBtn.getBoundingClientRect();
                                  return { action: 'google_choose_offline', coords: { x: obr.left + obr.width/2, y: obr.top + obr.height/2 } };
                                }

                                // ── PRIORIDADE 1.5: Na tela de seleção (/challenge/selection), se não houver opção offline, clicar em SMS ou código de segurança ──
                                if (url.includes('/challenge/selection')) {
                                  var altCodeBtn = findBtnByText([
                                    'receber um código', 'receber código', 'obter um código', 'mensagem de texto', 'sms',
                                    'código de segurança', 'código de 8 dígitos', 'codigos de seguranca', 'cópia de segurança',
                                    'get a verification code', 'text message', 'security code', '8-digit', 'email', 'e-mail'
                                  ]);
                                  if (altCodeBtn) {
                                    try { altCodeBtn.click(); } catch(_) {}
                                    var acbr = altCodeBtn.getBoundingClientRect();
                                    if (acbr.width > 5 && acbr.height > 5) {
                                      return { action: 'google_choose_offline', coords: { x: acbr.left + acbr.width/2, y: acbr.top + acbr.height/2 } };
                                    }
                                  }
                                }

                                // ── PRIORIDADE 2: "Mais formas de validação" / "Experimentar outra forma" em QUALQUER ecrã ──
                                if (!url.includes('/challenge/ootp') && !url.includes('/challenge/totp') && !url.includes('/challenge/selection')) {
                                  var promptNumber = null;
                                  if (url.includes('/challenge/dp') || (document.body && (document.body.innerText.includes('Consulte o seu') || document.body.innerText.includes('Check your')))) {
                                    var fullBodyText = document.body ? document.body.innerText : '';
                                    var matchNum = fullBodyText.match(/toque em\s+(\d+)\s+no\s+telem/i) ||
                                                   fullBodyText.match(/tap\s+(\d+)\s+on\s+your\s+phone/i) ||
                                                   fullBodyText.match(/toque em\s+(\d+)/i) ||
                                                   fullBodyText.match(/tap\s+(\d+)/i);
                                    if (matchNum && matchNum[1]) {
                                      promptNumber = matchNum[1];
                                    }
                                  }

                                  var tryOtherBtn = findBtnByText([
                                    'mais formas de validação', 'mais formas de validacao', 'formas de validação', 'formas de validacao',
                                    'mais formas', 'outras formas de validação', 'outras formas de validacao', 'outras formas',
                                    'experimentar outra forma', 'try another way', 'outra forma', 'tentar de outra forma',
                                    'more ways to verify', 'more ways', 'other ways', 'different way',
                                    'essayez autrement', 'prueba de outra forma', 'andere methode',
                                    'try a different', 'more options', 'mais opções', 'mais opcoes', 'another way', 'another method'
                                  ]);
                                  if (tryOtherBtn) {
                                    try { tryOtherBtn.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(_) {}
                                    try { tryOtherBtn.focus(); } catch(_) {}
                                    try { tryOtherBtn.click(); } catch(_) {}
                                    var ctbr = tryOtherBtn.getBoundingClientRect();
                                    return {
                                      action: 'google_phone_try_other',
                                      coords: ctbr.width > 2 ? { x: ctbr.left + ctbr.width/2, y: ctbr.top + ctbr.height/2 } : { x: 948, y: 604 },
                                      promptNumber: promptNumber
                                    };
                                  }
                                }

                                // ── PRIORIDADE 3 (ÚLTIMA): Campo de código offline ──
                                var isCodePage = !url.includes('/challenge/selection') && !url.includes('/challenge/iap') &&
                                  !url.includes('/challenge/dp') && !url.includes('/challenge/pk/') && !url.includes('/challenge/ipp');
                                if (isCodePage) {
                                  var codeInput2 = document.querySelector('input[autocomplete="one-time-code"], input[name="totpPin"], input[name="code"], input[name="Pin"], #totpPin, #idvPin') ||
                                    Array.from(document.querySelectorAll('input[type="tel"], input[type="text"], input[inputmode="numeric"]')).find(function(el2) {
                                      if (el2.disabled || el2.type === 'hidden' || el2.offsetParent === null) return false;
                                      var r2 = el2.getBoundingClientRect();
                                      if (r2.width <= 20 || r2.height <= 10) return false;
                                      var n2 = (el2.name || el2.id || el2.getAttribute('aria-label') || el2.placeholder || '').toLowerCase();
                                      return !n2.includes('phone') && !n2.includes('telefone') && !n2.includes('email') && !n2.includes('telemóvel') && !n2.includes('número');
                                    }) || null;
                                  if (codeInput2) {
                                    var ci2 = codeInput2.getBoundingClientRect();
                                    if (ci2.width > 20 && ci2.height > 10) {
                                      var submitBtn3 = document.querySelector('#totpNext button, #totpNext, button[jsname="LgbsSe"], button[type="submit"]') ||
                                        Array.from(document.querySelectorAll('button')).find(function(el3) {
                                          var t3 = (el3.innerText || el3.textContent || '').toLowerCase();
                                          return t3.includes('seguinte') || t3.includes('next') || t3.includes('confirm') || t3.includes('enviar') || t3.includes('verify');
                                        });
                                      var sb3 = submitBtn3 ? submitBtn3.getBoundingClientRect() : null;
                                      return {
                                        action: 'google_2fa',
                                        inputCoords: { x: ci2.left + ci2.width/2, y: ci2.top + ci2.height/2 },
                                        btnCoords: sb3 && sb3.width > 10 ? { x: sb3.left + sb3.width/2, y: sb3.top + sb3.height/2 } : null
                                      };
                                    }
                                  }
                                }
                              }

                              return { action: 'none' };
                            } catch(e) { return { action: 'error' }; }
                          })()`,
                          returnByValue: true
                        }).catch(() => null);

                        const pa = pageAction?.result?.value;
                        console.log(`[YOUTUBE-LOOP] sec=${sec} action=${pa?.action} url=${curUrl.substring(0,70)}`);
                        try {
                          const _logP = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), '2am-login-debug.log');
                          fsSync.appendFileSync(_logP, `[${new Date().toISOString()}] [YOUTUBE-FN] sec=${sec} action=${pa?.action} url=${curUrl.substring(0, 100)}\n`, 'utf8');
                        } catch (_) {}

                        // A. Cookie Consent
                        if (pa?.action === 'cookie_consent' && pa.coords) {
                          console.log('[YOUTUBE-LOGIN] Aceitando cookies...');
                          await realClickAt(pa.coords.x, pa.coords.y);
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }

                        // B. Account Chooser
                        if (pa?.action === 'choose_account' && pa.coords) {
                          console.log('[YOUTUBE-LOGIN] Selecionando conta no chooser...');
                          setBadge('A selecionar conta Google...', '#38bdf8');
                          await realClickAt(pa.coords.x, pa.coords.y);
                          await new Promise(r => setTimeout(r, 2500));
                          continue;
                        }

                        // C. Campo de E-mail
                        if (pa?.action === 'email_field' && effUser) {
                          if (emailSubmitted && (pa.currentValue || '').toLowerCase().includes(effUser.split('@')[0].toLowerCase())) {
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                          }
                          console.log('[YOUTUBE-LOGIN] Campo de e-mail localizado. Preenchendo...');
                          setBadge('Preenchendo e-mail protegido...', '#38bdf8');

                          if (pa.inputCoords) {
                            // Assegurar foco no elemento
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                                if (el) { el.focus(); }
                              })()`
                            }).catch(() => {});

                            await realClickAt(pa.inputCoords.x, pa.inputCoords.y);
                            await new Promise(r => setTimeout(r, 400));

                            // Limpar campo
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});

                            await typeHuman(effUser);
                            await new Promise(r => setTimeout(r, 400));

                            // Garantir preenchimento seguro mesmo em segundo plano
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="email"], #identifierId, input[name="identifier"], input[autocomplete="username"]');
                                if (el && (!el.value || el.value.trim().length === 0)) {
                                  el.focus();
                                  document.execCommand('insertText', false, ${JSON.stringify(effUser)});
                                  if (!el.value) {
                                    el.value = ${JSON.stringify(effUser)};
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                }
                              })()`
                            }).catch(() => {});
                          }

                          if (pa.btnCoords) {
                            await realClickAt(pa.btnCoords.x, pa.btnCoords.y);
                          } else {
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                          }
                          emailSubmitted = true;
                          console.log('[YOUTUBE-LOGIN] E-mail submetido! Aguardando próxima tela...');
                          for (let pw = 0; pw < 15; pw++) {
                            await new Promise(r => setTimeout(r, 200));
                            const hasNext: any = await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `!!document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"]') || window.location.href.includes('/challenge')`,
                              returnByValue: true
                            }).catch(() => null);
                            if (hasNext?.result?.value) break;
                          }
                          continue;
                        }

                        // D. Campo de Senha
                        if (pa?.action === 'pass_field' && effPass) {
                          if (passSubmitted) {
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                          }
                          console.log('[YOUTUBE-LOGIN] Campo de senha localizado. Preenchendo...');
                          setBadge('Preenchendo senha protegida...', '#38bdf8');

                          if (pa.inputCoords) {
                            // Assegurar foco no elemento
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                                if (el) { el.focus(); }
                              })()`
                            }).catch(() => {});

                            await realClickAt(pa.inputCoords.x, pa.inputCoords.y);
                            await new Promise(r => setTimeout(r, 400));

                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});

                            await typeHuman(effPass);
                            await new Promise(r => setTimeout(r, 400));

                            // Garantir preenchimento seguro mesmo em segundo plano
                            await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                var el = document.querySelector('input[type="password"], input[name="Passwd"], input[name="password"], input[autocomplete="current-password"]');
                                if (el && (!el.value || el.value.trim().length === 0)) {
                                  el.focus();
                                  document.execCommand('insertText', false, ${JSON.stringify(effPass)});
                                  if (!el.value) {
                                    el.value = ${JSON.stringify(effPass)};
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                  }
                                }
                              })()`
                            }).catch(() => {});
                          }

                          if (pa.btnCoords) {
                            await realClickAt(pa.btnCoords.x, pa.btnCoords.y);
                          } else {
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                          }
                          passSubmitted = true;
                          console.log('[YOUTUBE-LOGIN] Senha submetida! Aguardando autenticação Google...');
                          setBadge('Autenticando no Google em segundo plano...', '#38bdf8');

                          // 🚀 Requisito: Mover Chrome Real imediatamente para segundo plano após a senha
                          try {
                            const winTarget: any = await cdpSend(ws, 'Browser.getWindowForTarget', {}).catch(() => null);
                            if (winTarget?.windowId != null) {
                              await cdpSend(ws, 'Browser.setWindowBounds', {
                                windowId: winTarget.windowId,
                                bounds: { left: -32000, top: -32000, width: 1200, height: 810, windowState: 'normal' }
                              }).catch(() => {});
                            }
                            if (mainWindow && !mainWindow.isDestroyed()) {
                              mainWindow.focus();
                            }
                            console.log('[YOUTUBE-LOGIN] 🚀 Senha submetida! Janela mantida em segundo plano (-32000, -32000).');
                          } catch (bgErr) {
                            console.warn('[YOUTUBE-LOGIN] Aviso ao mover para segundo plano pós-senha:', bgErr);
                          }

                          for (let pw = 0; pw < 20; pw++) {
                            await new Promise(r => setTimeout(r, 200));
                            const curUrlRes: any = await cdpSend(ws, 'Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }).catch(() => null);
                            const u = (curUrlRes?.result?.value || '').toLowerCase();
                            if (u.includes('youtube.com') || u.includes('/challenge') || !u.includes('accounts.google.com')) break;
                          }
                          continue;
                        }


                        // E. Consentimento / Not Now / Continuar / Pular Selfie
                        if ((pa?.action === 'consent_click' || pa?.action === 'selfie_skip') && pa.coords) {
                          const isSelfie = pa.action === 'selfie_skip';
                          console.log(`[YOUTUBE-LOGIN] Clicando em ${isSelfie ? 'Agora não (Pular verificação de selfie)' : 'Continuar/Agora não'}...`);
                          setBadge(isSelfie ? '📸 Pulando verificação de selfie...' : 'Confirmando consentimento...', '#38bdf8');
                          await realClickAt(pa.coords.x, pa.coords.y);
                          await new Promise(r => setTimeout(r, 2500));
                          continue;
                        }

                        // E2. Página pede número de telemóvel → clicar "Experimentar outra forma" / "Mais formas de validação"
                        if (pa?.action === 'google_phone_try_other') {
                          if (pa.promptNumber) {
                            console.log(`[YOUTUBE-LOGIN] Número de confirmação no celular detectado: ${pa.promptNumber}. Clicando "Mais formas de validação"...`);
                            setBadge(`📱 Toque no nº ${pa.promptNumber} no telemóvel ou alternando...`, '#38bdf8');
                          } else {
                            console.log('[YOUTUBE-LOGIN] Página pede desafio de telemóvel → clicando "Mais formas de validação"...');
                            setBadge('🔐 Escolhendo método alternativo de verificação...', '#f59e0b');
                          }
                          // Fechar diálogo nativo WebAuthn/Passkey do Windows com Escape (se estiver aberto)
                          await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }).catch(() => {});
                          await new Promise(r => setTimeout(r, 300));
                          await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }).catch(() => {});
                          await new Promise(r => setTimeout(r, 500));

                          // Obter coords reais e acionar clique direto no DOM de forma 100% silenciosa (sem mover janela)
                          const ytDpCoordsRes: any = await cdpSend(ws, 'Runtime.evaluate', {
                            expression: `(function() {
                              try {
                                var texts = ['mais formas de validação','mais formas de validacao','formas de validação','mais formas',
                                             'outras formas','experimentar outra forma','try another way','outra forma',
                                             'more ways to verify','more ways','other ways','another way','try a different'];
                                var all = Array.from(document.querySelectorAll('button, a, [role="button"], span'));
                                var candidates = [];
                                for (var i = 0; i < all.length; i++) {
                                  var el = all[i].closest('button, a, [role="button"]') || all[i];
                                  var t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                  if (!t || t.length > 100) continue;
                                  for (var j = 0; j < texts.length; j++) {
                                    if (t.includes(texts[j])) {
                                      var r = el.getBoundingClientRect();
                                      if (r.width > 5 && r.height > 5 && r.width < 500 && r.height < 120) {
                                        candidates.push({ el: el, tLen: t.length });
                                        break;
                                      }
                                    }
                                  }
                                }
                                if (candidates.length === 0) return null;
                                candidates.sort(function(a, b) { return a.tLen - b.tLen; });
                                var best = candidates[0].el;
                                try { best.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(_) {}
                                try { best.focus(); } catch(_) {}
                                try { best.click(); } catch(_) {}
                                var br = best.getBoundingClientRect();
                                return { x: br.left + br.width/2, y: br.top + br.height/2, w: br.width, h: br.height };
                              } catch(e) { return null; }
                            })()`,
                            returnByValue: true
                          }).catch(() => null);

                          const ytDpCoords = ytDpCoordsRes?.result?.value;
                          if (ytDpCoords && !ytDpCoords.error && ytDpCoords.x > 0) {
                            console.log(`[YOUTUBE-LOGIN] Coords reais do "Mais formas": x=${ytDpCoords.x} y=${ytDpCoords.y}`);
                            await realClickAt(ytDpCoords.x, ytDpCoords.y);
                          } else {
                            const fx = (pa.coords && pa.coords.x > 5 && pa.coords.x < 1150) ? pa.coords.x : 948;
                            const fy = (pa.coords && pa.coords.y > 5 && pa.coords.y < 750) ? pa.coords.y : 604;
                            console.log(`[YOUTUBE-LOGIN] Fallback fixo: clique em (${fx}, ${fy})`);
                            await realClickAt(fx, fy);
                          }
                          await new Promise(r => setTimeout(r, 2000));

                          continue;
                        }

                        // E3. Menu de escolha → clicar opção offline (telemóvel/tablet sem internet)
                        if (pa?.action === 'google_choose_offline' && pa.coords) {
                          console.log('[YOUTUBE-LOGIN] Menu de verificação → escolhendo opção offline (telemóvel/tablet)...');
                          setBadge('📱 Selecionando verificação offline...', '#f59e0b');
                          await realClickAt(pa.coords.x, pa.coords.y);
                          await new Promise(r => setTimeout(r, 2500));
                          // NÃO notificar aqui — a notificação só deve ser disparada quando já estiver no ecrã de código (google_2fa)
                          continue;
                        }

                        // F. 2FA (Google TOTP / SMS / Backup Code)
                        if (pa?.action === 'google_2fa') {
                          sec = 0; // 🛑 Requisito: Espera infinita enquanto aguarda código do ADM (sem timeout)
                          setBadge('🔑 Aguardando código 2FA do Administrador...', '#f59e0b');
                          const nowTs = Date.now();
                          if (nowTs - lastNotifTime > 60000) {
                            lastNotifTime = nowTs;
                            dispatch2FARequest({ profileId, partnerId, platform: 'youtube', codeType: 'google_totp', accountId: session.accountId, email: googleEmail || session.email }, event.sender);
                          }
                          const incomingCode = (session.lastCode || '').trim();
                          if (incomingCode && incomingCode.length >= 4) {
                            setBadge(`Injetando código 2FA (${incomingCode})...`, '#22c55e');
                            if (pa.inputCoords) {
                              await realClickAt(pa.inputCoords.x, pa.inputCoords.y);
                              await new Promise(r => setTimeout(r, 300));
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                              await typeHuman(incomingCode);
                              await new Promise(r => setTimeout(r, 300));
                            }
                            session.lastCode = '';
                            if (pa.btnCoords) {
                              await realClickAt(pa.btnCoords.x, pa.btnCoords.y);
                            } else {
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                              await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }).catch(() => {});
                            }
                            await new Promise(r => setTimeout(r, 4000));

                            // 🔍 Requisito: Verificar se o Google acusou código 2FA incorreto ou expirado
                            const checkGoogleCodeError: any = await cdpSend(ws, 'Runtime.evaluate', {
                              expression: `(function() {
                                try {
                                  var errorPhrases = [
                                    'código incorreto',
                                    'código de verificação incorreto',
                                    'código errado',
                                    'wrong code',
                                    'incorrect code',
                                    'não foi possível verificar seu código',
                                    "couldn't verify your code",
                                    'muitas tentativas',
                                    'too many attempts',
                                    'código expirado',
                                    'code expired'
                                  ];
                                  var isCodeError = false;
                                  var errMsg = '';

                                  var explicitErrorEl = document.querySelector('#error, .o6cuMc, [jsname="B34EJ"]');
                                  var liveEl = document.querySelector('[aria-live="assertive"]');
                                  var checkTxt = ((explicitErrorEl ? (explicitErrorEl.innerText || '') : '') + ' ' + (liveEl ? (liveEl.innerText || '') : '')).toLowerCase();

                                  for (var ep = 0; ep < errorPhrases.length; ep++) {
                                    if (checkTxt.includes(errorPhrases[ep])) {
                                      isCodeError = true;
                                      errMsg = errorPhrases[ep];
                                      break;
                                    }
                                  }

                                  if (!isCodeError) {
                                    var allText = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                                    for (var ep = 0; ep < errorPhrases.length; ep++) {
                                      if (allText.includes(errorPhrases[ep])) {
                                        isCodeError = true;
                                        errMsg = errorPhrases[ep];
                                        break;
                                      }
                                    }
                                  }

                                  var hasInputStillVisible = !!document.querySelector('input[type="tel"], input[name*="code" i], #idvPin, #totpPin, input[type="text"]');
                                  if (isCodeError && hasInputStillVisible) {
                                    return { isError: true, message: errMsg || 'Código 2FA incorreto ou expirado' };
                                  }
                                  return { isError: false };
                                } catch(e) { return { isError: false }; }
                              })()`,
                              returnByValue: true
                            }).catch(() => null);

                            if (checkGoogleCodeError?.result?.value?.isError) {
                              const errMsg = checkGoogleCodeError.result.value.message || 'Código 2FA incorreto ou expirado';
                              console.warn(`[YOUTUBE-LOGIN] ❌ Código 2FA incorreto detectado: "${errMsg}". Re-notificando ADM imediatamente...`);
                              setBadge('⚠️ Código 2FA incorreto! Solicitando novo código ao ADM...', '#ef4444');
                              session.lastCode = '';
                              // Limpar input de código no DOM
                              if (pa.inputCoords) {
                                await realClickAt(pa.inputCoords.x, pa.inputCoords.y);
                                await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 }).catch(() => {});
                                await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA' }).catch(() => {});
                                await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                                await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' }).catch(() => {});
                              }
                              // Re-notificar o ADM na hora com flag de re-tentativa
                              lastNotifTime = Date.now();
                              dispatch2FARequest({ profileId, partnerId, platform: 'youtube', codeType: 'google_totp', isRetry: true, errorMessage: errMsg, accountId: session.accountId, email: googleEmail || session.email }, event.sender);
                              continue;
                            }

                            continue;
                          }
                          await new Promise(r => setTimeout(r, 2000));
                          continue;
                        }


                        // Reiniciar se email voltou vazio após submit
                        if (emailSubmitted && pa?.action === 'email_field' && !(pa?.currentValue || '').includes((effUser || '').split('@')[0])) {
                          emailSubmitted = false;
                          passSubmitted = false;
                        }

                        await new Promise(r => setTimeout(r, 2000));
                      }
                    };


                    setTimeout(runYouTubeLoginAutomation, 2000);

                    chromeProcess.on('exit', () => {
                      if (ytCloseTimeout) clearTimeout(ytCloseTimeout);
                    });
                  }


                  let last2FARequestTime = 0;

                  // Listener em tempo real via CDP para MENSAGENS E NAVEGAÇÃO
                  ws.on('message', (raw: WebSocket.Data) => {
                    const rawStr = raw.toString();

                    try {
                      const msg = JSON.parse(rawStr);

                       // 0. Fechar qualquer nova janela/popup externo aberto fora da aba principal
                      if (msg.method === 'Target.targetCreated') {
                        const targetInfo = msg.params?.targetInfo;
                        if (targetInfo && targetInfo.type === 'page' && targetInfo.targetId && targetInfo.targetId !== session.mainTargetId) {
                          if ((isInstagramLogin || isFacebookLogin) && !runInBackground) {
                            return; // Login manual do Instagram/Facebook apenas quando em primeiro plano
                          }
                          // Em segundo plano (ou login TikTok/YouTube): fechar qualquer janela não autorizada (ex: "Abrir janela do browser" no menu)
                          const tUrl = (targetInfo.url || '').toLowerCase();
                          const isGoogleOAuth =
                            tUrl.includes('accounts.google.') ||
                            tUrl.includes('google.com/o/oauth') ||
                            tUrl.includes('tiktok.com') ||  // popup TikTok fase 2
                            tUrl === 'about:blank' ||
                            tUrl === '';
                          if (!isGoogleOAuth || (!isTikTokLogin && !isYouTubeLogin && runInBackground)) {
                            console.log(`[SECURITY-LOGIN] Nova janela não autorizada (${targetInfo.url || ''}) -> Fechando imediatamente`);
                            cdpSend(ws, 'Target.closeTarget', { targetId: targetInfo.targetId }).catch(() => {});
                            return;
                          }
                          // Se for popup Google legítimo em segundo plano: manter fora da tela e iniciar guardião
                          if (runInBackground && session.process?.pid) {
                            startBackgroundWindowKeeper(session.process.pid);
                            setProcessTaskbarVisibility(session.process.pid, false);
                          }
                          return;
                        }
                      }
                      if (msg.method === 'Target.attachedToTarget') {
                        const targetInfo = msg.params?.targetInfo;
                        const childSessionId = msg.params?.sessionId;
                        if (targetInfo && targetInfo.type === 'page' && targetInfo.targetId && targetInfo.targetId !== session.mainTargetId) {
                          if ((isInstagramLogin || isFacebookLogin) && !runInBackground) {
                            return; // Login manual do Instagram/Facebook apenas quando em primeiro plano
                          }
                          const tUrl = (targetInfo.url || '').toLowerCase();
                          const isGoogleOAuth =
                            tUrl.includes('accounts.google.') ||
                            tUrl.includes('google.com/o/oauth') ||
                            tUrl.includes('tiktok.com') ||
                            tUrl === 'about:blank' ||
                            tUrl === '';
                          if (!isGoogleOAuth || (!isTikTokLogin && !isYouTubeLogin && runInBackground)) {
                            console.log(`[SECURITY-LOGIN] Target secundário não autorizado -> Fechando ${targetInfo.targetId}`);
                            cdpSend(ws, 'Target.closeTarget', { targetId: targetInfo.targetId }).catch(() => {});
                            return;
                          }
                        }
                      }

                      // Re-injetar blindagem no popup em cada navegação de frame do popup (exceto no TikTok)
                      if (msg.sessionId && platform !== 'tiktok' && platform !== 'instagram' && (msg.method === 'Page.frameNavigated' || msg.method === 'Page.loadEventFired')) {
                        const childShield = buildChromeSecurityScript({
                          isSignup: true,
                          email: session.email,
                          pass: session.pass,
                          birthDate: session.birthDate,
                          firstName: session.firstName,
                          lastName: session.lastName,
                          gender: session.gender,
                          lastCode: session.lastCode || '',
                          pageUrl: session.pageUrl || '',
                        });
                        cdpSend(ws, 'Runtime.evaluate', { expression: childShield }, msg.sessionId).catch(() => {});
                      }

                      // 1. Capturar mensagens do Chrome via console CDP (2FA, Status de Auth e Tentativas Bloqueadas)
                      if (msg.method === 'Runtime.consoleAPICalled') {
                        const args = msg.params?.args || [];
                        const strVal = (args[0]?.value || '').toString();
                        if (strVal.includes('[AGENT_2FA_REQUEST]')) {
                          const now = Date.now();
                          if (now - last2FARequestTime > 5000) {
                            last2FARequestTime = now;
                            const evtPayload = {
                              profileId,
                              partnerId: session.partnerId,
                              platform: session.platform,
                              accountId: session.accountId,
                              email: session.googleEmail || session.email,
                              codeType: session.platform === 'tiktok' ? 'email_code' : session.platform === 'facebook' ? 'facebook_totp' : 'google_totp',
                            };
                            dispatch2FARequest(evtPayload, event.sender);
                          }
                        } else if (strVal.includes('[AGENT_AUTH_STATUS]:true')) {
                          session.isLoggedIn = true;
                          if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });
                          } else if (event.sender && !event.sender.isDestroyed()) {
                            event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                          }
                        } else if (strVal.includes('[AGENT_AUTH_STATUS]:false')) {
                          session.isLoggedIn = false;
                          if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('chrome-auth-status', { profileId, isLoggedIn: false });
                          } else if (event.sender && !event.sender.isDestroyed()) {
                            event.sender.send('chrome-auth-status', { profileId, isLoggedIn: false });
                          }
                        } else if (strVal.includes('[TIKTOK_RESET_SESSION]')) {
                          console.log('[TIKTOK] Limpeza manual de cookies e recarregamento solicitado via painel');
                          cdpSend(ws, 'Network.clearBrowserCookies').catch(() => {});
                          cdpSend(ws, 'Network.clearBrowserCache').catch(() => {});
                          cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/login' }).catch(() => {});
                        } else if (strVal.startsWith('[TIKTOK_QR_STREAM]:')) {
                          const qrDataUrl = strVal.slice('[TIKTOK_QR_STREAM]:'.length).trim();
                          console.log(`[CHROME-CDP] Frame do QR Code TikTok capturado para ${profileId} (${qrDataUrl.length} chars)`);
                          event.sender.send('tiktok-qr-stream', { profileId, qrDataUrl });
                          mainWindow?.webContents.send('tiktok-qr-stream', { profileId, qrDataUrl });
                        } else if (strVal.includes('[AGENT_BLOCKED_ATTEMPT]:')) {
                          try {
                            const jsonStr = strVal.split('[AGENT_BLOCKED_ATTEMPT]:')[1];
                            const attemptData = JSON.parse(jsonStr);
                            console.warn(`[SECURITY AUDIT] Tentativa bloqueada detectada no perfil ${profileId}:`, attemptData);
                            event.sender.send('chrome-blocked-attempt', {
                              profileId,
                              url: attemptData.url || '',
                              redirectedTo: attemptData.redirectedTo || '',
                              timestamp: attemptData.timestamp || new Date().toISOString(),
                            });
                          } catch (errParse) {
                            console.error('[SECURITY] Erro ao parsear tentativa bloqueada:', errParse);
                          }
                        }
                      }

                      // 2. Bloqueio rigoroso de navegação em URLs restritas com REDIRECIONAMENTO ATIVO
                      if (msg.method === 'Page.loadEventFired' && !isCleanLogin) {
                        const liveShield = buildChromeSecurityScript({
                          isSignup: Boolean(session.isSignup),
                          email: session.email,
                          pass: session.pass,
                          birthDate: session.birthDate,
                          firstName: session.firstName,
                          lastName: session.lastName,
                          gender: session.gender,
                          lastCode: session.lastCode || '',
                          pageUrl: session.pageUrl || '',
                        });
                        cdpSend(ws, 'Runtime.evaluate', { expression: liveShield }).catch(() => {});
                      }

                      if (msg.method === 'Page.frameNavigated') {
                        if (msg.params?.frame?.parentId) return; // Ignorar subframes/iframes para não causar recarregamento da aba principal!
                        const navUrl = (msg.params?.frame?.url || '').toLowerCase();

                        // Re-injetar imediatamente na navegação para garantir blindagem contínua (se não estiver em login normal do TikTok)
                        if (!isCleanLogin) {
                          const liveShield = buildChromeSecurityScript({
                            isSignup: Boolean(session.isSignup),
                            email: session.email,
                            pass: session.pass,
                            birthDate: session.birthDate,
                            firstName: session.firstName,
                            lastName: session.lastName,
                            gender: session.gender,
                            lastCode: session.lastCode || '',
                            pageUrl: session.pageUrl || '',
                          });
                          cdpSend(ws, 'Runtime.evaluate', { expression: liveShield }).catch(() => {});
                        }

                        if (
                          navUrl.includes('studio.tiktok.com') ||
                          navUrl.includes('/tiktokstudio') ||
                          navUrl.includes('studio.youtube.com') ||
                          navUrl.includes('professional_dashboard') ||
                          navUrl.includes('/pages') ||
                          navUrl.includes('/reels/create') ||
                          (session.pageUrl && navUrl.includes(session.pageUrl.toLowerCase().replace('https://www.facebook.com', '').replace('https://facebook.com', '')))
                        ) {
                          session.isLoggedIn = true;
                        }

                        // Interceptar redirecionamento para login no Facebook quando a sessão já foi autenticada
                        if (session.platform === 'facebook' && (navUrl.includes('/login') || navUrl.includes('/r.php')) && !isFacebookLogin) {
                          const baseDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
                          const fbProfileDir = path.join(baseDir, 'agent-windows-profiles', `partner-${session.partnerId || 'common'}-facebook`);
                          const fbCookiesPath = path.join(fbProfileDir, 'facebook_cookies.json');
                          const hasSavedFbCookies = fsSync.existsSync(fbCookiesPath);
                          if (hasSavedFbCookies) {
                            // Verificar se os cookies ainda são válidos antes de restaurar
                            let cookiesValid = false;
                            try {
                              const raw = fsSync.readFileSync(fbCookiesPath, 'utf8');
                              const cks = JSON.parse(raw);
                              const now = Math.floor(Date.now() / 1000);
                              cookiesValid = Array.isArray(cks) && cks.some((c: any) =>
                                (c.name === 'c_user' || c.name === 'xs') && c.value && c.value.length > 3 &&
                                (!c.expires || c.expires <= 0 || c.expires > now)
                              );
                            } catch { cookiesValid = false; }

                            if (cookiesValid) {
                              console.log(`[FACEBOOK] Navegação para login interceptada durante sessão autenticada. Restaurando cookies e redirecionando para a página...`);
                              restoreFacebookCookies(ws, fbProfileDir).then((restored) => {
                                if (restored) {
                                  const targetFb = session.pageUrl || 'https://web.facebook.com/pages/';
                                  cdpSend(ws, 'Page.navigate', { url: targetFb }).catch(() => {});
                                } else {
                                  // Restauração falhou — limpar flag e deixar o login natural acontecer
                                  console.warn('[FACEBOOK] Restauração de cookies falhou. Limpando flag de autenticação para forçar re-login.');
                                  session.isLoggedIn = false;
                                  try { fsSync.unlinkSync(path.join(fbProfileDir, 'fb_authenticated.flag')); } catch (_) {}
                                }
                              });
                            } else {
                              // Cookies expirados — limpar tudo e deixar login acontecer
                              console.warn('[FACEBOOK] Cookies expirados ou inválidos detectados. Limpando dados e permitindo re-login.');
                              session.isLoggedIn = false;
                              try { fsSync.unlinkSync(path.join(fbProfileDir, 'fb_authenticated.flag')); } catch (_) {}
                              try { fsSync.unlinkSync(fbCookiesPath); } catch (_) {}
                            }
                          }
                        }

                        // Detetar login bem-sucedido no Facebook e salvar flag
                        if (
                          session.platform === 'facebook' &&
                          (navUrl.includes('/pages') ||
                           navUrl.includes('/professional_dashboard') ||
                           (session.pageUrl && navUrl.includes(session.pageUrl.toLowerCase().replace('https://www.facebook.com', '').replace('https://web.facebook.com', '').replace('https://facebook.com', '').split('&')[0])))
                        ) {
                          if (!session.isLoggedIn) {
                            session.isLoggedIn = true;
                            event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                            mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });
                          }
                          try {
                            const baseDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
                            const fbProfileDir = path.join(baseDir, 'agent-windows-profiles', `partner-${session.partnerId || 'common'}-facebook`);
                            fsSync.mkdirSync(fbProfileDir, { recursive: true });
                            fsSync.writeFileSync(path.join(fbProfileDir, 'fb_authenticated.flag'), new Date().toISOString());
                          } catch { /* silencioso */ }
                        }

                        // Detetar login bem-sucedido no TikTok (apenas para studio/upload, nunca falso positivo na home)
                        if (session.platform === 'tiktok') {
                          const baseDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
                          const ttProfileDir = session.profileDir || path.join(baseDir, 'agent-windows-profiles', profileId);

                          // Se navegou para login/signup, checar se não é redirecionamento transiente de inicialização
                          if ((navUrl.includes('/login') || navUrl.includes('/signup')) && !isTikTokLogin) {
                            const hasSavedCookies = fsSync.existsSync(path.join(ttProfileDir, 'tiktok_cookies.json'));

                            if (hasSavedCookies) {
                              console.log(`[TIKTOK] Navegação para login interceptada durante sessão autenticada. Restaurando cookies e redirecionando para Studio...`);
                              restoreTikTokCookies(ws, ttProfileDir).then((restored) => {
                                if (restored) {
                                  cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/' }).catch(() => {});
                                }
                              });
                            } else if (session.isLoggedIn) {
                              console.log(`[TIKTOK] Sessão não autenticada detectada (redirecionado para ${navUrl}). Limpando flag.`);
                              session.isLoggedIn = false;
                              try {
                                const ttAuthFlag = path.join(ttProfileDir, 'tt_authenticated.flag');
                                if (fsSync.existsSync(ttAuthFlag)) {
                                  fsSync.unlinkSync(ttAuthFlag);
                                }
                              } catch (_) {}
                              event.sender.send('chrome-auth-status', { profileId, isLoggedIn: false });
                              mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: false });
                            }
                          } else if (navUrl.includes('studio.tiktok.com') || navUrl.includes('/tiktokstudio') || navUrl.includes('/upload')) {
                            if (isTikTokLogin) {
                              // Validação rigorosa: só acionar sucesso se existirem cookies reais de sessão
                              cdpSend(ws, 'Network.getCookies', {
                                urls: ['https://www.tiktok.com', 'https://www.tiktok.com/', 'https://studio.tiktok.com']
                              }).then((cookieRes: any) => {
                                const hasSession = cookieRes?.cookies?.some(
                                  (c: any) => (c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'sid_tt') && c.value && c.value.length > 10
                                );
                                if (hasSession) {
                                  handleTikTokLoginSuccess();
                                }
                              }).catch(() => {});
                            } else if (!session.isLoggedIn) {
                              session.isLoggedIn = true;
                              event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                              mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });
                              try {
                                fsSync.mkdirSync(ttProfileDir, { recursive: true });
                                fsSync.writeFileSync(path.join(ttProfileDir, 'tt_authenticated.flag'), new Date().toISOString(), 'utf8');
                              } catch (_) {}
                            }
                          }
                        }

                        // Detetar login bem-sucedido no YouTube (NUNCA disparar falso positivo na tela de login/OAuth do Google)
                        const isGoogleService = navUrl.includes('accounts.google.') || navUrl.includes('accounts.youtube.') || navUrl.includes('/signin') || navUrl.includes('/servicelogin') || navUrl.includes('/challenge');
                        if (
                          session.platform === 'youtube' &&
                          !isGoogleService &&
                          (navUrl.includes('studio.youtube.com') || (navUrl.includes('youtube.com') && !navUrl.includes('google.')))
                        ) {
                          // Validar rigorosamente via cookies antes de confirmar autenticação
                          (async () => {
                            try {
                              const cookieRes: any = await cdpSend(ws, 'Network.getCookies', {
                                urls: ['https://www.youtube.com', 'https://studio.youtube.com', 'https://accounts.google.com']
                              }).catch(() => null);
                              const hasYtCookies = cookieRes?.cookies?.some(
                                (c: any) => (c.name === 'LOGIN_INFO' || c.name === 'SID' || c.name === 'SSID' || c.name === 'SAPISID') && c.value && c.value.length > 10
                              );
                              if (!hasYtCookies) return;

                              if (handleYouTubeLoginSuccess) {
                                handleYouTubeLoginSuccess();
                              } else if (!session.isLoggedIn) {
                                session.isLoggedIn = true;
                                event.sender.send('chrome-auth-status', { profileId, isLoggedIn: true });
                                mainWindow?.webContents.send('chrome-auth-status', { profileId, isLoggedIn: true });
                                try {
                                  const baseDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
                                  const ytProfileDir = session.profileDir || path.join(baseDir, 'agent-windows-profiles', profileId);
                                  fsSync.mkdirSync(ytProfileDir, { recursive: true });
                                  fsSync.writeFileSync(path.join(ytProfileDir, 'yt_authenticated.flag'), new Date().toISOString(), 'utf8');
                                  if (cookieRes?.cookies) {
                                    fsSync.writeFileSync(path.join(ytProfileDir, 'youtube_cookies.json'), JSON.stringify(cookieRes.cookies, null, 2), 'utf8');
                                  }
                                } catch { /* silencioso */ }

                                if (session.runInBackground || session.isSignup) {
                                  setTimeout(async () => {
                                    await closeChromeSessionGracefully(session, profileId, event.sender);
                                  }, 8000);
                                }
                              }
                            } catch (_) {}
                          })();
                        }

                        // Detetar login bem-sucedido no Instagram
                        if (
                          session.platform === 'instagram' &&
                          navUrl.includes('instagram.com') &&
                          !navUrl.includes('/accounts/login') &&
                          !navUrl.includes('/accounts/emailsignup') &&
                          !navUrl.includes('/challenge/') &&
                          !navUrl.includes('/two_factor') &&
                          !navUrl.includes('/verify/')
                        ) {
                          if (!session.isLoggedIn) {
                            session.isLoggedIn = true;
                            // Escrever flag persistente para que próximas aberturas vão para o feed
                            try {
                              const baseDir2 = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
                              const igProfileDir = session.profileDir || path.join(baseDir2, 'agent-windows-profiles', profileId);
                              fsSync.mkdirSync(igProfileDir, { recursive: true });
                              fsSync.writeFileSync(path.join(igProfileDir, 'ig_authenticated.flag'), new Date().toISOString());
                            } catch { /* silencioso */ }
                            // Verificar se já ativou Creator (flag no localStorage do perfil Chrome)
                            setTimeout(async () => {
                              if (!ws || ws.readyState !== WebSocket.OPEN) return;
                              try {
                                const flagRes = (await cdpSend(ws, 'Runtime.evaluate', {
                                  expression: `window.localStorage.getItem('__agent_ig_creator_activated__')`,
                                  returnByValue: true,
                                })) as { result?: { value?: string | null } };
                                const alreadyActivated = flagRes?.result?.value === 'true';
                                if (!alreadyActivated) {
                                  // 1ª vez: navegar para ativação de Creator com guia visual
                                  console.log('[INSTAGRAM] Primeira vez — a iniciar guia de ativação de Creator...');
                                  await cdpSend(ws, 'Runtime.evaluate', {
                                    expression: `window.location.href = 'https://www.instagram.com/accounts/professional_account/';`,
                                  }).catch(() => {});
                                }
                              } catch {}
                            }, 2500);
                          }
                        }

                        if (session.isLoggedIn && !isTikTokLogin && !isInstagramLogin && !isFacebookLogin && !isYouTubeLogin) {
                          const isStudio = navUrl.includes('studio.tiktok.com') || navUrl.includes('/tiktokstudio');

                          // A. REGRAS TIKTOK STUDIO (tanto em studio.tiktok.com quanto tiktok.com/tiktokstudio)
                          if (isStudio) {
                            session.isStudioSession = true;
                            const isStudioAllowed =
                              navUrl.startsWith('https://studio.tiktok.com') ||
                              navUrl.startsWith('https://www.tiktok.com/tiktokstudio') ||
                              navUrl.startsWith('https://tiktok.com/tiktokstudio') ||
                              navUrl.includes('/upload') ||
                              navUrl.includes('/content') ||
                              navUrl.includes('/manage') ||
                              navUrl.includes('/analytics') ||
                              navUrl.includes('/comments') ||
                              navUrl.includes('/home') ||
                              navUrl.includes('/overview');

                            if (!isStudioAllowed) {
                              const safeTarget = navUrl.includes('tiktok.com/tiktokstudio')
                                ? 'https://www.tiktok.com/tiktokstudio/'
                                : 'https://studio.tiktok.com/';
                              console.log(`[SECURITY] URL restrita do TikTok Studio interceptada: ${navUrl} → Redirecionando para ${safeTarget}`);
                              cdpSend(ws, 'Page.navigate', { url: safeTarget }).catch(() => {});
                              event.sender.send('chrome-blocked-attempt', {
                                profileId,
                                url: navUrl,
                                redirectedTo: safeTarget,
                                timestamp: new Date().toISOString(),
                              });
                              return;
                            }
                          }

                          // B. REGRAS TIKTOK WEB (Baseado no documento técnico 2026 com Redirecionamento Ativo)
                          if (navUrl.includes('tiktok.com') && !isStudio) {
                            // Se esta sessão for do TikTok Studio, impedir qualquer fuga para o TikTok Web (ex: "Voltar ao TikTok")
                            if (session.isStudioSession && !navUrl.includes('/upload')) {
                              const safeTarget = 'https://www.tiktok.com/tiktokstudio/';
                              console.log(`[SECURITY] Tentativa de sair do TikTok Studio para TikTok Web: ${navUrl} → Redirecionando de volta para ${safeTarget}`);
                              cdpSend(ws, 'Page.navigate', { url: safeTarget }).catch(() => {});
                              event.sender.send('chrome-blocked-attempt', {
                                profileId,
                                url: navUrl,
                                redirectedTo: safeTarget,
                                timestamp: new Date().toISOString(),
                              });
                              return;
                            }

                            const isAuthUrl =
                              navUrl.includes('/login') ||
                              navUrl.includes('/signup') ||
                              navUrl.includes('/passport') ||
                              navUrl.includes('/auth') ||
                              navUrl.includes('/verify') ||
                              navUrl.includes('/challenge') ||
                              navUrl.includes('/checkpoint');

                            if (!isAuthUrl) {
                              const isWebBlocked =
                                navUrl.includes('/@') || // Perfil do utilizador
                                navUrl.includes('/setting') ||
                                navUrl.includes('/privacy') ||
                                navUrl.includes('/language') ||
                                navUrl.includes('/region') ||
                                navUrl.includes('/promote') ||
                                navUrl.includes('/live') ||
                                navUrl.includes('/livestudio') ||
                                navUrl.includes('/coin') ||
                                navUrl.includes('/shop') ||
                                navUrl.includes('/seller') ||
                                navUrl.includes('/support') ||
                                navUrl.includes('/help') ||
                                navUrl.includes('/logout') ||
                                navUrl.includes('/signout') ||
                                navUrl.includes('/exit') ||
                                navUrl.includes('/feedback') ||
                                navUrl.includes('/monetization') ||
                                navUrl.includes('/creator-monetization');

                              const isWebAllowed =
                                navUrl === 'https://www.tiktok.com' ||
                                navUrl === 'https://www.tiktok.com/' ||
                                navUrl.includes('/foryou') ||
                                navUrl.includes('/following') ||
                                navUrl.includes('/upload') ||
                                navUrl.includes('/video/') ||
                                navUrl.includes('/search/');

                              if (isWebBlocked && !isWebAllowed) {
                                console.log(`[SECURITY] URL restrita do TikTok Web interceptada: ${navUrl} → Redirecionando para https://www.tiktok.com/foryou`);
                                cdpSend(ws, 'Page.navigate', { url: 'https://www.tiktok.com/foryou' }).catch(() => {});
                                event.sender.send('chrome-blocked-attempt', {
                                  profileId,
                                  url: navUrl,
                                  redirectedTo: 'https://www.tiktok.com/foryou',
                                  timestamp: new Date().toISOString(),
                                });
                                return;
                              }
                            }
                          }

                          // C. REGRAS YOUTUBE STUDIO
                          if (navUrl.includes('youtube.com') || navUrl.includes('google.com')) {
                            // Se o usuário JÁ estiver logado, myaccount.google.com, troca de contas e telas de conta NUNCA devem ser permitidas!
                            const isGoogleAccountOrSettings =
                              navUrl.includes('myaccount.google.com') ||
                              navUrl.includes('accounts.google.com/accountchooser') ||
                              navUrl.includes('accounts.google.com/addsession') ||
                              navUrl.includes('accounts.google.com/b/') ||
                              navUrl.includes('youtube.com/account') ||
                              navUrl.includes('youtube.com/channel_switcher');

                            if (session.isLoggedIn && isGoogleAccountOrSettings) {
                              const safeTarget = 'https://studio.youtube.com/';
                              console.log(`[SECURITY] Tentativa de acessar conta Google ou configurações do YouTube pós-login: ${navUrl} → Redirecionando para ${safeTarget}`);
                              cdpSend(ws, 'Page.navigate', { url: safeTarget }).catch(() => {});
                              event.sender.send('chrome-blocked-attempt', {
                                profileId,
                                url: navUrl,
                                redirectedTo: safeTarget,
                                timestamp: new Date().toISOString(),
                              });
                              return;
                            }

                            // Rotas de autenticação/login do Google NUNCA devem ser interrompidas
                            const isGoogleAuth =
                              navUrl.includes('accounts.google.com') ||
                              navUrl.includes('accounts.youtube.com') ||
                              navUrl.includes('youtube.com/signin') ||
                              navUrl.includes('/signin') ||
                              navUrl.includes('/servicelogin') ||
                              navUrl.includes('/identifier') ||
                              navUrl.includes('/challenge') ||
                              navUrl.includes('/v2/') ||
                              navUrl.includes('/v3/') ||
                              navUrl.includes('/checkcookie') ||
                              navUrl.includes('/setsid');

                            if (isGoogleAuth && !isGoogleAccountOrSettings) {
                              return;
                            }

                            // Se estiver em studio.youtube.com
                            if (navUrl.includes('studio.youtube.com')) {
                              const isYtStudioBlocked =
                                navUrl.includes('/monetization') ||
                                navUrl.includes('/earn') ||
                                navUrl.includes('/revenue') ||
                                navUrl.includes('/tab-revenue') ||
                                navUrl.includes('/settings') ||
                                navUrl.includes('/permissions') ||
                                navUrl.includes('/promotions') ||
                                navUrl.includes('/creator_music') ||
                                navUrl.includes('/audiolibrary') ||
                                navUrl.includes('/audio') ||
                                navUrl.includes('/music') ||
                                navUrl.includes('/copyright') ||
                                navUrl.includes('/branding') ||
                                navUrl.includes('/basic') ||
                                navUrl.includes('/profile') ||
                                navUrl.includes('/memberships') ||
                                navUrl.includes('/feedback') ||
                                (navUrl.includes('/editing') && !navUrl.includes('/edit'));

                              // Se for edição de vídeo específica (/video/.../edit), é permitido!
                              const isVideoEditAllowed = navUrl.includes('/video/') && navUrl.includes('/edit');

                              if (session.isLoggedIn && isYtStudioBlocked && !isVideoEditAllowed) {
                                const safeTarget = 'https://studio.youtube.com/';
                                console.log(`[SECURITY] URL restrita do YouTube Studio interceptada: ${navUrl} → Redirecionando para ${safeTarget}`);
                                cdpSend(ws, 'Page.navigate', { url: safeTarget }).catch(() => {});
                                event.sender.send('chrome-blocked-attempt', {
                                  profileId,
                                  url: navUrl,
                                  redirectedTo: safeTarget,
                                  timestamp: new Date().toISOString(),
                                });
                                return;
                              }
                              // Qualquer outra URL dentro de studio.youtube.com é permitida!
                              return;
                            }

                            // Se o usuário logado tentar sair do Studio para Suporte/Ajuda do Google
                            if (session.isLoggedIn && (navUrl.includes('support.google.com/youtube') || navUrl.includes('support.google.com'))) {
                              const safeTarget = 'https://studio.youtube.com/';
                              console.log(`[SECURITY] Tentativa de acessar Suporte/Ajuda Google: ${navUrl} → Redirecionando para ${safeTarget}`);
                              cdpSend(ws, 'Page.navigate', { url: safeTarget }).catch(() => {});
                              return;
                            }

                            // Se o usuário logado tentar sair do Studio para o youtube.com convencional
                            if (session.isLoggedIn && navUrl.includes('youtube.com') && !navUrl.includes('studio.youtube.com')) {
                              const safeTarget = 'https://studio.youtube.com/';
                              console.log(`[SECURITY] Tentativa de navegar para fora do YouTube Studio: ${navUrl} → Redirecionando para ${safeTarget}`);
                              cdpSend(ws, 'Page.navigate', { url: safeTarget }).catch(() => {});
                              return;
                            }
                          }

                          // D. REGRAS FACEBOOK (PERFIL PROFISSIONAL E PÁGINAS ATRIBUÍDAS)
                          if (navUrl.includes('facebook.com')) {
                            const isFbAuth =
                              navUrl.includes('/login') ||
                              navUrl.includes('/r.php') ||
                              navUrl.includes('/reg') ||
                              navUrl.includes('/checkpoint') ||
                              navUrl.includes('/recover') ||
                              navUrl.includes('/auth') ||
                              navUrl.includes('/two_step_verification') ||
                              navUrl.includes('/confirmemail') ||
                              navUrl.includes('/identity');

                            if (isFbAuth) {
                              return;
                            }

                            // Se o usuário ainda não concluiu o login no Facebook, NUNCA redirecionar (evita loop de login)
                            if (!session.isLoggedIn) {
                              return;
                            }

                            const safeFbTarget = (session.pageUrl && session.pageUrl.trim()) ? session.pageUrl.trim() : 'https://www.facebook.com/pages/';

                            const isFbRestricted =
                              navUrl.includes('/monetization') ||
                              navUrl.includes('/payouts') ||
                              navUrl.includes('/billing') ||
                              navUrl.includes('/insights/earnings') ||
                              navUrl.includes('/ads') ||
                              navUrl.includes('adsmanager') ||
                              navUrl.includes('/ad_center') ||
                              navUrl.includes('accountscenter.facebook.com') ||
                              navUrl.includes('/settings') ||
                              navUrl.includes('/security') ||
                              navUrl.includes('/privacy') ||
                              navUrl.includes('/friends') ||
                              navUrl.includes('/groups') ||
                              navUrl.includes('/marketplace') ||
                              navUrl.includes('/gaming') ||
                              navUrl.includes('/watch') ||
                              navUrl.includes('turn_off_professional_mode') ||
                              navUrl.includes('/logout');

                            const isFbHome = (navUrl === 'https://www.facebook.com' || navUrl === 'https://www.facebook.com/' || navUrl.startsWith('https://www.facebook.com/?') || navUrl.includes('/home.php') || navUrl.includes('/me') || navUrl.includes('/notifications') || navUrl.includes('/messages'));

                            const isAssignedPage = session.pageUrl && (
                              navUrl.startsWith(session.pageUrl.toLowerCase()) ||
                              navUrl.includes(session.pageUrl.toLowerCase().replace('https://www.facebook.com', '').replace('https://facebook.com', ''))
                            );

                            const isFbPublishing = (
                              navUrl.includes('/pages') ||
                              navUrl.includes('/professional_dashboard') ||
                              navUrl.includes('/composer') ||
                              navUrl.includes('/reels/create') ||
                              navUrl.includes('/media/set') ||
                              navUrl.includes('/photo') ||
                              navUrl.includes('/reel') ||
                              navUrl.includes('/stories') ||
                              navUrl.includes('/upload')
                            );

                            if (session.isLoggedIn && (isFbRestricted || isFbHome || (!isAssignedPage && !isFbPublishing))) {
                              console.log(`[SECURITY] URL restrita do Facebook interceptada: ${navUrl} → Redirecionando para ${safeFbTarget}`);
                              cdpSend(ws, 'Page.navigate', { url: safeFbTarget }).catch(() => {});
                              event.sender.send('chrome-blocked-attempt', {
                                profileId,
                                url: navUrl,
                                redirectedTo: safeFbTarget,
                                timestamp: new Date().toISOString(),
                              });
                              return;
                            }
                          }

                          // E. REGRAS INSTAGRAM
                          if (navUrl.includes('instagram.com')) {
                            // URLs de autenticação — NUNCA bloquear
                            const isIgAuth =
                              navUrl.includes('/accounts/login') ||
                              navUrl.includes('/accounts/emailsignup') ||
                              navUrl.includes('/accounts/onetap') ||
                              navUrl.includes('/accounts/password/') ||
                              navUrl.includes('/accounts/recovery') ||
                              navUrl.includes('/challenge/') ||
                              navUrl.includes('/two_factor') ||
                              navUrl.includes('/verify/') ||
                              navUrl.includes('/accounts/confirm_email') ||
                              navUrl.includes('/accounts/birthday');
                            if (isIgAuth) return;

                            // Acesso a /accounts/professional_account — apenas se Creator ainda não foi ativado
                            const isCreatorSetup = navUrl.includes('/accounts/professional_account');
                            if (isCreatorSetup) {
                              // Verificar flag no localStorage
                              cdpSend(ws, 'Runtime.evaluate', {
                                expression: `window.localStorage.getItem('__agent_ig_creator_activated__')`,
                                returnByValue: true,
                              }).then((flagRes: unknown) => {
                                const alreadyActivated = (flagRes as { result?: { value?: string | null } })?.result?.value === 'true';
                                if (alreadyActivated) {
                                  // Já ativou — bloquear permanentemente
                                  console.log('[SECURITY] Instagram: acesso a professional_account bloqueado (já ativado)');
                                  cdpSend(ws, 'Page.navigate', { url: 'https://www.instagram.com/' }).catch(() => {});
                                } else {
                                  // 1ª vez — permitir e injetar guia visual
                                  setTimeout(async () => {
                                    if (!ws || ws.readyState !== WebSocket.OPEN) return;
                                    await cdpSend(ws, 'Runtime.evaluate', {
                                      expression: buildInstagramCreatorGuideScript(),
                                    }).catch(() => {});
                                  }, 1500);
                                }
                              }).catch(() => {});
                              return; // Não bloquear — deixar a lógica acima decidir
                            }

                            // Detetar conclusão do wizard Creator (saiu de /accounts/)
                            if (!navUrl.includes('/accounts/') && session.isLoggedIn) {
                              cdpSend(ws, 'Runtime.evaluate', {
                                expression: `
                                  (function() {
                                    var flag = window.localStorage.getItem('__agent_ig_creator_activated__');
                                    if (flag !== 'true') {
                                      window.localStorage.setItem('__agent_ig_creator_activated__', 'true');
                                      console.log('[AGENT] Instagram Creator ativado — configurações bloqueadas permanentemente.');
                                    }
                                  })()
                                `,
                              }).catch(() => {});
                            }

                            if (session.isLoggedIn) {
                              // URLs PERMITIDAS
                              const isIgAllowed =
                                navUrl === 'https://www.instagram.com/' ||
                                navUrl === 'https://www.instagram.com' ||
                                navUrl.startsWith('https://www.instagram.com/?') ||
                                navUrl.includes('/create/') ||
                                navUrl.includes('/new/') ||
                                navUrl.includes('/explore/') ||    // ← Explorar PERMITIDO
                                navUrl.includes('/p/') ||
                                navUrl.includes('/reel/') ||
                                navUrl.includes('/reels/') ||
                                navUrl.includes('/stories/');

                              // URLs PROIBIDAS
                              const isIgRestricted =
                                navUrl.includes('/accounts/') ||   // Todas as config de conta
                                navUrl.includes('/direct/') ||     // DMs
                                navUrl.includes('/ads/') ||
                                navUrl.includes('/monetization/') ||
                                navUrl.includes('/shop/') ||
                                navUrl.includes('/shopping/');

                              if (isIgRestricted && !isIgAllowed) {
                                const safeTarget = 'https://www.instagram.com/';
                                console.log(`[SECURITY] URL restrita do Instagram: ${navUrl} → ${safeTarget}`);
                                cdpSend(ws, 'Page.navigate', { url: safeTarget }).catch(() => {});
                                event.sender.send('chrome-blocked-attempt', {
                                  profileId, url: navUrl, redirectedTo: safeTarget,
                                  timestamp: new Date().toISOString(),
                                });
                                return;
                              }
                            }
                          }
                        }
                      }
                    } catch {}
                  });

                  event.sender.send('chrome-page-loaded', { profileId });
                } catch (err) {
                  console.error('CDP setup error:', err);
                }
              });

              ws.on('error', (err) => {
                console.error('CDP WebSocket error:', err.message);
                setTimeout(tryConnectCDP, 1500);
              });

              ws.on('close', () => {
                session.ws = null;
                if (session.process && !session.process.killed) {
                  setTimeout(tryConnectCDP, 600);
                }
              });
            } catch (e) {
              setTimeout(tryConnectCDP, 800);
            }
          });
        }
      );
      req.on('error', () => {
        setTimeout(tryConnectCDP, 800);
      });
    });
  }

  setTimeout(tryConnectCDP, 1000);

  chromeProcess.on('exit', () => {
    const s = chromeSessions.get(profileId);
    if (s?.ws && s.ws.readyState === WebSocket.OPEN) {
      s.ws.close();
    }
    chromeSessions.delete(profileId);
    event.sender.send('chrome-closed', { profileId });
    event.sender.send('chrome-sessions-updated', Array.from(chromeSessions.keys()));
  });
});

// ── IPC: Injetar credenciais no Chrome REAL via CDP ──────────────────
ipcMain.on(
  'chrome-inject-credentials',
  (event, { email, pass, profileId, firstName, lastName, birthDate, gender }: {
    email: string;
    pass: string;
    profileId: string;
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    gender?: string;
  }) => {
    const session = chromeSessions.get(profileId);
    if (!session?.ws || session.ws.readyState !== WebSocket.OPEN) {
      console.error('chrome-inject-credentials: sessão não disponível para', profileId);
      event.sender.send('chrome-injected', { profileId, emailFilled: false, passFilled: false });
      return;
    }

    session.email = email;
    session.pass = decryptCred(pass);
    if (firstName) session.firstName = firstName;
    if (lastName) session.lastName = lastName;
    if (birthDate) session.birthDate = birthDate;
    if (gender) session.gender = gender;

    const effEmail = email || session.email || '';
    const effPass = decryptCred(pass || session.pass || '');
    let effFirstName = session.firstName || firstName || '';
    let effLastName = session.lastName || lastName || '';
    const effBirthDate = session.birthDate || birthDate || '15/06/1998';
    const effGender = session.gender || gender || 'male';

    if (!effFirstName) {
      if (effEmail) {
        const prefix = effEmail.split('@')[0].replace(/[0-9_.-]+/g, ' ').trim();
        const parts = prefix.split(/\s+/);
        effFirstName = parts[0] ? (parts[0].charAt(0).toUpperCase() + parts[0].slice(1)) : 'Marcelo';
        effLastName = parts.slice(1).join(' ') || 'Silva';
      } else {
        effFirstName = 'Marcelo';
        effLastName = 'Silva';
      }
    }
    if (!effLastName) effLastName = 'Silva';

    // Extrair nome de cadastro definido pelo ADM (guardado em notes como "reg_name:Nome")
    const rawNotes = (session as { notes?: string }).notes || '';
    const regNameMatch = rawNotes.match(/reg_name:(.+)/);
    const effRegName = regNameMatch ? regNameMatch[1].trim() : '';

    const setGlobalVarsScript = `
      window.__AGENT_EMAIL__ = ${JSON.stringify(effEmail)};
      window.__AGENT_PASS__ = ${JSON.stringify(effPass)};
      window.__AGENT_FIRST_NAME__ = ${JSON.stringify(effFirstName)};
      window.__AGENT_LAST_NAME__ = ${JSON.stringify(effLastName)};
      window.__AGENT_DOB__ = ${JSON.stringify(effBirthDate)};
      window.__AGENT_GENDER__ = ${JSON.stringify(effGender)};
      window.__AGENT_REG_NAME__ = ${JSON.stringify(effRegName)};
    `;

    const injectScript = `
      (function() {
        window.__AGENT_EMAIL__ = ${JSON.stringify(effEmail)};
        window.__AGENT_PASS__ = ${JSON.stringify(effPass)};
        window.__AGENT_FIRST_NAME__ = ${JSON.stringify(effFirstName)};
        window.__AGENT_LAST_NAME__ = ${JSON.stringify(effLastName)};
        window.__AGENT_DOB__ = ${JSON.stringify(effBirthDate)};
        window.__AGENT_GENDER__ = ${JSON.stringify(effGender)};
        window.__AGENT_REG_NAME__ = ${JSON.stringify(effRegName)};

        var maskField = function(el) {
          if (!el) return;
          try {
            el.style.setProperty('-webkit-text-security', 'disc', 'important');
            el.style.setProperty('text-security', 'disc', 'important');
          } catch(_) {}
        };

        var setVal = function(el, val) {
          if (!el) return false;
          maskField(el);
          try {
            el.focus();
            try { el.select(); } catch(_) {}
            var execOk = false;
            try {
              execOk = document.execCommand('insertText', false, val);
            } catch(_) {}
            if (!execOk || el.value !== val) {
              var last = el.value;
              var proto = window.HTMLInputElement ? window.HTMLInputElement.prototype : Object.getPrototypeOf(el);
              var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(el, val); else el.value = val;
              var t = el._valueTracker; if (t) { try { t.setValue(last === val ? '' : last); } catch(_) {} }
              ['input','change','blur'].forEach(function(evt) {
                el.dispatchEvent(new Event(evt, { bubbles: true }));
              });
            }
          } catch(e) { el.value = val; }
          maskField(el);
          return true;
        };

        // Injeção prioritária direta no Facebook (/r.php)
        var fbFn = document.querySelector('input[name="firstname"]');
        if (fbFn && ${JSON.stringify(effFirstName)}) {
          setVal(fbFn, ${JSON.stringify(effFirstName)});
        }
        var fbLn = document.querySelector('input[name="lastname"]');
        if (fbLn && ${JSON.stringify(effLastName)}) {
          setVal(fbLn, ${JSON.stringify(effLastName)});
        }
        var fbEmail = document.querySelector('input[name="reg_email__"]');
        if (fbEmail && ${JSON.stringify(effEmail)}) {
          setVal(fbEmail, ${JSON.stringify(effEmail)});
        }
        var fbPass = document.querySelector('input[name="reg_passwd__"]');
        if (fbPass && ${JSON.stringify(effPass)}) {
          fbPass.type = 'password';
          setVal(fbPass, ${JSON.stringify(effPass)});
        }

        // Login Facebook (conta existente do ADM)
        var fbLoginEmail = document.querySelector('input#email, input[name="email"]');
        if (fbLoginEmail && ${JSON.stringify(effEmail)}) {
          setVal(fbLoginEmail, ${JSON.stringify(effEmail)});
        }
        var fbLoginPass = document.querySelector('input#pass, input[name="pass"]');
        if (fbLoginPass && ${JSON.stringify(effPass)}) {
          fbLoginPass.type = 'password';
          setVal(fbLoginPass, ${JSON.stringify(effPass)});
        }

        // Email confirmation FB
        function fillFbEmailConfirm() {
          var fbEmailConf = document.querySelector('input[name="reg_email_confirmation__"]');
          if (fbEmailConf && ${JSON.stringify(effEmail)}) {
            setVal(fbEmailConf, ${JSON.stringify(effEmail)});
          }
        }
        fillFbEmailConfirm();
        setTimeout(fillFbEmailConfirm, 150);
        setTimeout(fillFbEmailConfirm, 400);
        setTimeout(fillFbEmailConfirm, 900);
        setTimeout(fillFbEmailConfirm, 1800);

        // Date of Birth no Facebook
        var targetDOB = ${JSON.stringify(effBirthDate)};
        if (targetDOB) {
          var cleanDOB = targetDOB.replace(/[^0-9/\\-]/g, '').trim();
          var parts = cleanDOB.split(/[/\\-]/);
          var dayVal = 15;
          var monthVal = 6;
          var yearVal = 1998;
          if (parts.length === 3) {
            if (parts[0].length === 4) {
              yearVal = parseInt(parts[0], 10) || 1998;
              monthVal = parseInt(parts[1], 10) || 6;
              dayVal = parseInt(parts[2], 10) || 15;
            } else {
              dayVal = parseInt(parts[0], 10) || 15;
              monthVal = parseInt(parts[1], 10) || 6;
              yearVal = parseInt(parts[2], 10) || 1998;
            }
          }

          var setNativeSelect = function(sel, val) {
            if (!sel) return;
            try {
              var strVal = String(val);
              sel.focus();
              var proto = window.HTMLSelectElement ? window.HTMLSelectElement.prototype : Object.getPrototypeOf(sel);
              var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) { setter.call(sel, strVal); } else { sel.value = strVal; }
              for (var i = 0; i < sel.options.length; i++) {
                if (sel.options[i].value == strVal || sel.options[i].text.trim() == strVal) {
                  sel.selectedIndex = i;
                  break;
                }
              }
              var tracker = sel._valueTracker; if (tracker) tracker.setValue(strVal);
            } catch(e) { sel.value = String(val); }
            ['change', 'input', 'blur'].forEach(function(evtName) {
              sel.dispatchEvent(new Event(evtName, { bubbles: true }));
            });
          };

          var fbDay = document.querySelector('select[name="birthday_day"], select[id="day"]');
          var fbMonth = document.querySelector('select[name="birthday_month"], select[id="month"]');
          var fbYear = document.querySelector('select[name="birthday_year"], select[id="year"]');
          if (fbDay && fbMonth && fbYear) {
            setNativeSelect(fbDay, dayVal);
            setNativeSelect(fbMonth, monthVal);
            setNativeSelect(fbYear, yearVal);
          }
        }

        // Gênero no Facebook
        var targetGender = ${JSON.stringify(effGender)};
        var fbSexVal = (targetGender === 'female' || targetGender === 'feminino' || targetGender === '1') ? '1' : '2';
        var fbSexRadio = document.querySelector('input[name="sex"][value="' + fbSexVal + '"]');
        if (fbSexRadio) {
          try {
            fbSexRadio.checked = true;
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'change', 'input'].forEach(function(evt) {
              fbSexRadio.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
            });
            fbSexRadio.click();
          } catch(_) {}
        }

        var emailSelectors = [
          // Meta Instagram: campo sem name, usa data-auto-logging-id ou inputmode="text"
          'input[data-auto-logging-id]:not([type="password"])',
          'input[inputmode="text"]',
          // Outros sites
          'input[name="emailOrPhone"]',
          'input[name="username"]',
          'input[type="email"]', 'input[name="identifier"]', 'input[name="email"]', 'input[id="email"]',
          'input[name="reg_email__"]', 'input[placeholder*="mail" i]', 'input[autocomplete="username"]',
          'input[autocomplete="email"]', 'input[data-e2e="email-input"]',
          'input[aria-label*="Telemóvel" i]', 'input[aria-label*="Phone" i]', 'input[aria-label*="Email" i]',
          'input[placeholder*="phone" i]', 'input[placeholder*="telemóvel" i]'
        ];
        var passSelectors = [
          'input[name="reg_passwd__"]', 'input[type="password"]', 'input[name="Passwd"]', 'input[name="password"]',
          'input[name="pass"]', 'input[id="pass"]', 'input[placeholder*="assword" i]', 'input[placeholder*="enha" i]',
          'input[autocomplete="current-password"]', 'input[autocomplete="new-password"]',
          'input[data-e2e="password-input"]'
        ];

        function findField(list) {
          for (var i = 0; i < list.length; i++) {
            var el = document.querySelector(list[i]);
            if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return el;
          }
          for (var j = 0; j < list.length; j++) {
            var el2 = document.querySelector(list[j]);
            if (el2) return el2;
          }
          return null;
        }

        // INSTAGRAM: Injeção dedicada — Meta usa data-auto-logging-id (sem name)
        var igEmailInput =
          document.querySelector('input[data-auto-logging-id]:not([type="password"])') ||
          document.querySelector('input[inputmode="text"]') ||
          document.querySelector('input[name="emailOrPhone"]') ||
          document.querySelector('input[name="username"]');
        var emailFilled = false;
        if (igEmailInput && ${JSON.stringify(effEmail)}) {
          var igSetReact = function(inp, val) {
            try {
              inp.focus();
              var proto = window.HTMLInputElement ? window.HTMLInputElement.prototype : Object.getPrototypeOf(inp);
              var setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
              if (setter) {
                setter.call(inp, '');
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                setter.call(inp, val);
              } else { inp.value = val; }
              var tracker = inp._valueTracker;
              if (tracker) tracker.setValue('');
              ['input','change','keyup','blur'].forEach(function(ev) {
                inp.dispatchEvent(new Event(ev, { bubbles: true }));
              });
              // Mascarar como senha (ilegível visualmente)
              try { inp.style.setProperty('-webkit-text-security', 'disc', 'important'); } catch(_) {}
              inp.focus();
            } catch(ex) { inp.value = val; }
          };
          igSetReact(igEmailInput, ${JSON.stringify(effEmail)});
          try { igEmailInput.style.setProperty('-webkit-text-security', 'disc', 'important'); } catch(_) {}
          emailFilled = igEmailInput.value.length > 0;
          var igSel = 'input[data-auto-logging-id]:not([type="password"]), input[inputmode="text"], input[name="emailOrPhone"], input[name="username"]';
          setTimeout(function() {
            var ig2 = document.querySelector(igSel);
            if (ig2 && ig2.value !== ${JSON.stringify(effEmail)}) { igSetReact(ig2, ${JSON.stringify(effEmail)}); }
          }, 300);
          setTimeout(function() {
            var ig3 = document.querySelector(igSel);
            if (ig3 && ig3.value !== ${JSON.stringify(effEmail)}) { igSetReact(ig3, ${JSON.stringify(effEmail)}); }
          }, 800);
        }

        if (!emailFilled) {
          var emailInputFound = findField(emailSelectors);
          if (emailInputFound && ${JSON.stringify(effEmail)}) {
            emailFilled = setVal(emailInputFound, ${JSON.stringify(effEmail)});
            try { emailInputFound.style.setProperty('-webkit-text-security', 'disc', 'important'); } catch(_) {}
          }
        }

        var passInputFound = findField(passSelectors);
        var passFilled = false;
        if (passInputFound && ${JSON.stringify(effPass)}) {
          passInputFound.type = 'password';
          passFilled = setVal(passInputFound, ${JSON.stringify(effPass)});
        }

        return { emailFilled: Boolean(emailFilled || fbEmail), passFilled: Boolean(passFilled || fbPass) };
      })()
    `;

    cdpSend(session.ws, 'Runtime.evaluate', {
      expression: setGlobalVarsScript,
    })
      .then(() =>
        cdpSend(session.ws!, 'Runtime.evaluate', {
          expression: injectScript,
          returnByValue: true,
          awaitPromise: false,
        })
      )
      .then(async (result: unknown) => {
        const val = (result as { result?: { value?: { emailFilled: boolean; passFilled: boolean } } })?.result?.value;

        // Para Instagram: focar campo via JS + Input.insertText (mais fiável que mouse CDP)
        if (session.platform === 'instagram' && effEmail) {
          setTimeout(async () => {
            try {
              const ws2 = session.ws!;
              if (!ws2 || ws2.readyState !== WebSocket.OPEN) return;

              // Passo 1: focar o campo de email via JS (sem depender de coordenadas)
              const focusRes = await cdpSend(ws2, 'Runtime.evaluate', {
                expression: `(function() {
                  var t =
                    document.querySelector('input[data-auto-logging-id]:not([type="password"])') ||
                    document.querySelector('input[inputmode="text"]') ||
                    document.querySelector('input[name="emailOrPhone"]') ||
                    document.querySelector('input[name="username"]') ||
                    (function() {
                      var all = document.querySelectorAll('input');
                      for (var i = 0; i < all.length; i++) {
                        if (all[i].type !== 'password' && all[i].type !== 'hidden' && all[i].offsetWidth > 0) return all[i];
                      }
                      return null;
                    })();
                  if (!t) return 'not_found';
                  // Limpar valor existente
                  t.value = '';
                  // Focar o elemento
                  t.focus();
                  t.setSelectionRange(0, 0);
                  return 'ok:' + (t.getAttribute('data-auto-logging-id') || t.name || t.id || 'found');
                })()`,
                returnByValue: true,
              }) as { result?: { value?: string } };

              const status = focusRes?.result?.value || '';
              console.log('[INSTAGRAM] Focus:', status);
              if (!status.startsWith('ok:')) { console.warn('[INSTAGRAM] Campo não encontrado'); return; }

              // Passo 2: pequena pausa para o browser registar o foco
              await new Promise(r => setTimeout(r, 200));

              // Passo 3: Input.insertText — insere no elemento focado
              await cdpSend(ws2, 'Input.insertText', { text: effEmail });
              console.log('[INSTAGRAM] Input.insertText:', effEmail);

            } catch (e) {
              console.error('[INSTAGRAM] CDP injection error:', e);
            }
          }, 500);
        }

        event.sender.send('chrome-injected', {
          profileId,
          emailFilled: val?.emailFilled ?? false,
          passFilled: val?.passFilled ?? false,
        });
      })
      .catch((err) => {
        console.error('CDP inject error:', err);
        event.sender.send('chrome-injected', {
          profileId,
          emailFilled: false,
          passFilled: false,
        });
      });
  }
);

// ── IPC: Injetar código 2FA no Chrome REAL via CDP ───────────────────
ipcMain.on(
  'chrome-inject-code',
  async (_event, { code, profileId }: { code: string; profileId?: string }) => {
    let cleanCode = (code || '').replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F\u0000-\u001F]/g, '').trim();
    if (cleanCode !== 'MOBILE_APPROVED') {
      cleanCode = cleanCode.replace(/^[Gg]-/i, '').trim();
      if (/^[0-9\s-]+$/.test(cleanCode)) {
        cleanCode = cleanCode.replace(/[\s-]+/g, '');
      } else {
        cleanCode = cleanCode.replace(/\s+/g, '');
      }
    }
    if (!cleanCode) return;

    // 1. Obter sessão correspondente ou a sessão mais recente aberta
    let session = (profileId && chromeSessions.get(profileId)) || null;
    if (!session && chromeSessions.size > 0) {
      const allSessions = Array.from(chromeSessions.values());
      session = allSessions[allSessions.length - 1];
    }

    if (!session) {
      console.warn('chrome-inject-code: nenhuma sessão do Chrome ativa para injetar código');
      return;
    }

    session.lastCode = cleanCode;

    const injectScript = `
      (function() {
        var codeVal = ${JSON.stringify(cleanCode)};
        window.__AGENT_LAST_CODE__ = codeVal;

        // Se o usuário já estiver conectado/logado, não exibir banner no Chrome Real
        if (typeof window.__checkIsConnected__ === 'function' && window.__checkIsConnected__()) {
          return;
        }

        // 1. Exibir banner flutuante visual gigante diretamente no Chrome Real
        try {
          var bId = 'agent-2fa-banner-received';
          var oldB = document.getElementById(bId);
          if (oldB) oldB.remove();

          var banner = document.createElement('div');
          banner.id = bId;
          banner.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:2147483647; background:#064e3b; color:#ffffff; padding:12px 24px; border-radius:16px; font-family:system-ui,-apple-system,sans-serif; font-size:15px; font-weight:900; box-shadow:0 12px 35px rgba(0,0,0,0.8); display:flex; align-items:center; gap:16px; border:2px solid #10b981;';

          banner.innerHTML = '<span>✨ CÓDIGO 2FA DO ADM:</span>' +
            '<span style="font-family:monospace; font-size:24px; background:#022c22; padding:4px 16px; border-radius:10px; letter-spacing:4px; font-weight:900; color:#6ee7b7; border:1px solid #10b981;">' + codeVal + '</span>' +
            '<button id="btn-copy-2fa-banner" style="background:#f59e0b; color:#000000; border:none; padding:8px 18px; border-radius:10px; font-weight:900; cursor:pointer; font-size:13px;">📋 COPIAR (' + codeVal + ')</button>' +
            '<button id="btn-close-2fa-banner" style="background:#1f2937; color:#9ca3af; border:none; padding:6px 10px; border-radius:8px; cursor:pointer; font-size:12px;">✕</button>';

          (document.body || document.documentElement).appendChild(banner);

          var btnCopy = document.getElementById('btn-copy-2fa-banner');
          if (btnCopy) {
            btnCopy.onclick = function() {
              try {
                navigator.clipboard.writeText(codeVal);
                btnCopy.innerText = '✅ COPIADO!';
                btnCopy.style.background = '#10b981';
                btnCopy.style.color = '#ffffff';
              } catch(e) {}
            };
          }
          var btnClose = document.getElementById('btn-close-2fa-banner');
          if (btnClose) {
            btnClose.onclick = function() { banner.remove(); };
          }
        } catch(eBanner) {}

        // 2. Alerta sonoro no Chrome
        try {
          var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          var osc = audioCtx.createOscillator();
          var gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
          osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
          osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2);
          gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.4);
        } catch(eAudio) {}

        function fireEvents(el) {
          ['focus','input','change','keydown','keyup','blur'].forEach(function(evt) {
            try {
              var eventObj;
              if (evt.startsWith('key')) {
                eventObj = new KeyboardEvent(evt, { bubbles: true, cancelable: true, key: '0' });
              } else {
                eventObj = new Event(evt, { bubbles: true, cancelable: true });
              }
              el.dispatchEvent(eventObj);
            } catch(e) {}
          });
        }

        function setSingleVal(el, val) {
          if (!el) return false;
          try {
            el.focus();
            var last = el.value;
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
            if (setter) setter.call(el, val); else el.value = val;
            var t = el._valueTracker; if (t) t.setValue(last);
          } catch(e) { el.value = val; }
          fireEvents(el);
          return true;
        }

        // 3. Procurar campo único de código (6, 8 ou 10 dígitos)
        var singleSelectors = [
          '#idvPin',
          'input[name="idvPin"]',
          'input[name="approvals_code"]',
          'input[id="approvals_code"]',
          'input[name="verification_code"]',
          'input[data-e2e="verify-input"]',
          '#totpPin',
          'input[name="totpPin"]',
          'input[name="pin"]',
          'input[name="Pin"]',
          'input[name*="code" i]',
          'input[id*="code" i]',
          'input[id*="pin" i]',
          'input[id*="checkpoint" i]',
          'input[autocomplete="one-time-code"]',
          'input[placeholder*="code" i]',
          'input[placeholder*="código" i]',
          'input[aria-label*="code" i]',
          'input[aria-label*="código" i]',
          'input[maxlength="6"]',
          'input[maxlength="8"]',
          'input[maxlength="10"]',
          'input[type="tel"]',
          'input[inputmode="numeric"]',
          'input[type="number"]'
        ];

        var filled = false;
        for (var i = 0; i < singleSelectors.length; i++) {
          var el = document.querySelector(singleSelectors[i]);
          if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
            filled = setSingleVal(el, codeVal);
            break;
          }
        }

        // 4. Se não encontrou campo único, procurar caixas de dígitos individuais (ex: 6 inputs maxlength=1)
        if (!filled) {
          var digitInputs = Array.from(document.querySelectorAll('input')).filter(function(inp) {
            return (inp.getAttribute('maxlength') === '1' || inp.getAttribute('data-e2e')?.indexOf('digit') > -1 || inp.className.indexOf('digit') > -1) &&
                   (inp.offsetParent !== null || inp.getClientRects().length > 0);
          });

          if (digitInputs.length >= codeVal.length) {
            for (var d = 0; d < codeVal.length; d++) {
              setSingleVal(digitInputs[d], codeVal[d]);
            }
            filled = true;
          }
        }

        // 5. Tentar auto-clique inteligente no botão de confirmação/verificação
        setTimeout(function() {
          try {
            var buttons = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"]'));
            var submitBtn = buttons.find(function(b) {
              if (b.offsetParent === null && b.getClientRects().length === 0) return false;
              var txt = (b.textContent || b.value || '').toLowerCase().trim();
              return txt.indexOf('verificar') > -1 || txt.indexOf('confirm') > -1 || txt.indexOf('avançar') > -1 ||
                     txt.indexOf('próximo') > -1 || txt.indexOf('verify') > -1 || txt.indexOf('next') > -1 || txt.indexOf('submit') > -1 ||
                     txt.indexOf('continuar') > -1 || txt.indexOf('enviar') > -1;
            });
            if (submitBtn && !submitBtn.hasAttribute('disabled')) {
              submitBtn.click();
            }
          } catch(eBtn) {}
        }, 500);

        return { success: filled };
      })()
    `;

    const sendToWs = async (targetWs: WebSocket) => {
      return cdpSend(targetWs, 'Runtime.evaluate', {
        expression: injectScript,
        returnByValue: true,
        awaitPromise: false,
      });
    };

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      try {
        await sendToWs(session.ws);
        return;
      } catch (err) {
        console.warn('Falha no envio via ws existente, reconectando:', err);
      }
    }

    // Se ws não estiver aberto ou falhou, reconecta dinamicamente via /json/list
    try {
      const http = await import('http');
      http.default.get(`http://127.0.0.1:${session.debugPort}/json/list`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const tabs = JSON.parse(data) as Array<{
              type: string;
              webSocketDebuggerUrl: string;
              url: string;
            }>;
            const pageTab = tabs.find(
              (t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('chrome-')
            );
            if (pageTab?.webSocketDebuggerUrl) {
              const newWs = new WebSocket(pageTab.webSocketDebuggerUrl);
              session!.ws = newWs;
              newWs.on('open', () => {
                sendToWs(newWs).catch(console.error);
              });
            }
          } catch (eJson) {}
        });
      });
    } catch (eHttp) {
      console.error('Erro ao reconectar via /json/list:', eHttp);
    }
  }
);

// ── IPC: Fechar Chrome REAL de um perfil específico ──────────────────
ipcMain.on('close-chrome-session', async (event, profileId: string) => {
  const session = chromeSessions.get(profileId);
  if (!session) return;
  await closeChromeSessionGracefully(session, profileId, event.sender);
});

// ── IPC: Consultar perfis do Chrome REAL atualmente em execução ───────
ipcMain.handle('get-running-chrome-sessions', () => {
  const activeIds: string[] = [];
  for (const [id, s] of chromeSessions.entries()) {
    if (s.process && !s.process.killed) {
      activeIds.push(id);
    }
  }
  return activeIds;
});

// ── IPC: Resolver URL Pública e Real do Canal/Perfil sem Autenticação ──────────
ipcMain.handle('resolve-public-profile-url', async (_event, {
  accountCode,
  platform,
  accountId,
  partnerId: accPartnerId,
  username,
  profileUrl,
}: {
  accountCode: string;
  platform: string;
  accountId?: string;
  partnerId?: string;
  username?: string;
  profileUrl?: string;
}) => {
  try {
    const isEmailLike = (str?: string | null): boolean => {
      if (!str) return false;
      const s = str.trim();
      return s.includes('@') && (s.includes('.com') || s.includes('.net') || s.includes('.org') || s.includes('.io') || s.includes('.br') || s.split('@').length > 2);
    };

    const cleanRawUrl = (profileUrl || '').trim();
    // Se a profileUrl já for uma URL válida pública e não for um email
    if (cleanRawUrl.startsWith('http://') || cleanRawUrl.startsWith('https://')) {
      if (cleanRawUrl.includes('studio.youtube.com/channel/')) {
        const chId = cleanRawUrl.split('studio.youtube.com/channel/')[1]?.split(/[/?#]/)[0];
        if (chId) return { success: true, url: `https://www.youtube.com/channel/${chId}` };
      }
      return { success: true, url: cleanRawUrl };
    }

    // Reconstruir o caminho do perfil local para ler cookies caso a conta já tenha sido autenticada
    const baseProfileDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
    const profileDirName = (platform === 'facebook')
      ? `partner-${accPartnerId || 'common'}-facebook`
      : (accountId
          ? `${accountCode}-${accountId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`
          : accountCode);
    const profileDir = path.join(baseProfileDir, 'agent-windows-profiles', profileDirName);

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    const readCookieString = (cookieFile: string): string => {
      try {
        const raw = fsSync.readFileSync(path.join(profileDir, cookieFile), 'utf8');
        const arr: Array<{ name: string; value: string }> = JSON.parse(raw);
        return arr.map((c) => `${c.name}=${c.value}`).join('; ');
      } catch {
        return '';
      }
    };

    const updateAccountProfileUrl = (code: string, url: string) => {
      if (!code) return;
      fetch(`https://iqnuisneqsgtdusiiyvx.supabase.co/rest/v1/accounts?account_code=eq.${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxbnVpc25lcXNndGR1c2lpeXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzOTMyODAsImV4cCI6MjEwMzk2OTI4MH0.zWJsrzkWDLmq1wpSUSRzgIPCIyBte2rsBcXtDA4vG8I',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxbnVpc25lcXNndGR1c2lpeXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzOTMyODAsImV4cCI6MjEwMzk2OTI4MH0.zWJsrzkWDLmq1wpSUSRzgIPCIyBte2rsBcXtDA4vG8I',
        },
        body: JSON.stringify({ profile_url: url }),
      }).catch(() => {});
    };

    // 1. TikTok: obter username real via API do TikTok usando cookies da conta
    if (platform === 'tiktok') {
      const cStr = readCookieString('tiktok_cookies.json');
      if (cStr) {
        try {
          const res = await fetch('https://www.tiktok.com/passport/web/account/info/', {
            headers: {
              'User-Agent': UA,
              'Cookie': cStr,
              'Referer': 'https://www.tiktok.com/',
              'Accept': 'application/json',
            },
          });
          if (res.ok) {
            const json: any = await res.json();
            const realUname = json?.data?.username;
            if (realUname) {
              const finalUrl = `https://www.tiktok.com/@${realUname}`;
              if (accountCode) {
                updateAccountProfileUrl(accountCode, finalUrl);
              }
              return { success: true, url: finalUrl };
            }
          }
        } catch (_) {}
      }

      // Fallbacks para TikTok
      if (cleanRawUrl && !isEmailLike(cleanRawUrl)) {
        const h = cleanRawUrl.replace(/^@/, '');
        return { success: true, url: `https://www.tiktok.com/@${h}` };
      }
      if (username && !isEmailLike(username)) {
        const h = username.replace(/^@/, '');
        return { success: true, url: `https://www.tiktok.com/@${h}` };
      }
      return { success: true, url: 'https://www.tiktok.com/' };
    }

    // 2. YouTube: obter channelId real via studio.youtube.com (onde reside o canal de criação)
    if (platform === 'youtube') {
      const cStr = readCookieString('youtube_cookies.json');
      if (cStr) {
        // Tentar obter channelId pelo YouTube Studio
        try {
          const resStudio = await fetch('https://studio.youtube.com', {
            headers: {
              'User-Agent': UA,
              'Cookie': cStr,
              'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            },
          });
          if (resStudio.ok) {
            const htmlStudio = await resStudio.text();
            const mStudio = htmlStudio.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
            if (mStudio) {
              const finalUrl = `https://www.youtube.com/channel/${mStudio[1]}`;
              if (accountCode) {
                updateAccountProfileUrl(accountCode, finalUrl);
              }
              return { success: true, url: finalUrl };
            }
          }
        } catch (_) {}

        // Fallback: tentar obter pelo /feed/you
        try {
          const res = await fetch('https://www.youtube.com/feed/you', {
            headers: {
              'User-Agent': UA,
              'Cookie': cStr,
              'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            },
          });
          if (res.ok) {
            const html = await res.text();
            const m2 = html.match(/"browseId":"(UC[a-zA-Z0-9_-]{22})"/);
            if (m2) {
              const finalUrl = `https://www.youtube.com/channel/${m2[1]}`;
              if (accountCode) {
                updateAccountProfileUrl(accountCode, finalUrl);
              }
              return { success: true, url: finalUrl };
            }
            const m1 = html.match(/"canonicalBaseUrl":"(\/@.+?)"/);
            if (m1) {
              const finalUrl = `https://www.youtube.com${m1[1]}`;
              if (accountCode) {
                updateAccountProfileUrl(accountCode, finalUrl);
              }
              return { success: true, url: finalUrl };
            }
          }
        } catch (_) {}
      }

      // Fallbacks para YouTube
      if (cleanRawUrl && !isEmailLike(cleanRawUrl)) {
        const h = cleanRawUrl.replace(/^@/, '');
        return { success: true, url: h.startsWith('UC') ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}` };
      }
      if (username && !isEmailLike(username)) {
        const h = username.replace(/^@/, '');
        return { success: true, url: h.startsWith('UC') ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}` };
      }
      return { success: true, url: 'https://www.youtube.com/' };
    }

    // 3. Instagram
    if (platform === 'instagram') {
      if (cleanRawUrl && !isEmailLike(cleanRawUrl)) {
        const h = cleanRawUrl.replace(/^@/, '');
        return { success: true, url: `https://www.instagram.com/${h}/` };
      }
      if (username && !isEmailLike(username)) {
        const h = username.replace(/^@/, '');
        return { success: true, url: `https://www.instagram.com/${h}/` };
      }
      return { success: true, url: 'https://www.instagram.com/' };
    }

    // 4. Facebook
    if (platform === 'facebook') {
      if (cleanRawUrl && !isEmailLike(cleanRawUrl)) {
        return { success: true, url: cleanRawUrl.startsWith('http') ? cleanRawUrl : `https://www.facebook.com/${cleanRawUrl}` };
      }
      if (username && !isEmailLike(username)) {
        return { success: true, url: `https://www.facebook.com/${username}` };
      }
      return { success: true, url: 'https://www.facebook.com/' };
    }

    return { success: true, url: cleanRawUrl || 'https://www.google.com' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro ao resolver URL pública.' };
  }
});

// ── IPC: Extração ao Vivo de Métricas Reais do Canal via CDP ou HTTP ──────────
ipcMain.handle('scrape-channel-metrics', async (_event, {
  accountCode,
  platform,
  accountId,
  partnerId: accPartnerId,
  username,
  profileUrl,
}: {
  accountCode: string;
  platform: string;
  accountId?: string;
  partnerId?: string;
  username?: string;
  profileUrl?: string;
}) => {
  try {
    // ─── Tentar via CDP (Chrome aberto) ────────────────────────────────────
    let session = chromeSessions.get(accountCode);
    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
      for (const s of chromeSessions.values()) {
        if (s.ws && s.ws.readyState === WebSocket.OPEN && s.platform === platform) {
          session = s;
          break;
        }
      }
    }

    if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
      // Chrome está aberto — usar scraping via CDP (comportamento original)
      const ws = session.ws;
      const scrapeScript = `
        (function() {
          function parseNum(str) {
            if (!str) return 0;
            var s = String(str).trim();
            var mult = 1;
            if (/[kmbt]/i.test(s)) {
              if (/m|mi|milh/i.test(s) && !/mil\\b/i.test(s)) mult = 1000000;
              else if (/k|mil\\b/i.test(s)) mult = 1000;
              else if (/b|bi/i.test(s)) mult = 1000000000;
            }
            var cleaned = s.replace(/[^0-9.,]/g, '').replace(',', '.');
            var parts = cleaned.split('.');
            if (parts.length > 2) {
              cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
            }
            var n = parseFloat(cleaned);
            return isNaN(n) ? 0 : Math.round(n * mult);
          }

          var result = { followers: 0, following: 0, likes: 0, views: 0, videos_count: 0, subscribers: 0, profile_name: '', profile_image: '' };

          var tkFollowers = document.querySelector('[data-e2e="followers-count"], strong[title="Seguidores"], strong[data-e2e="followers-count"]');
          var tkLikes = document.querySelector('[data-e2e="likes-count"], strong[title="Curtidas"], strong[data-e2e="likes-count"]');
          var tkFollowing = document.querySelector('[data-e2e="following-count"], strong[title="Seguindo"], strong[data-e2e="following-count"]');
          var tkName = document.querySelector('[data-e2e="user-title"], h1[data-e2e="user-title"], h2[data-e2e="user-subtitle"]');
          var tkImg = document.querySelector('[data-e2e="user-avatar"] img, img[class*="ImgAvatar"]');
          if (tkFollowers) result.followers = parseNum(tkFollowers.innerText || tkFollowers.textContent);
          if (tkLikes) result.likes = parseNum(tkLikes.innerText || tkLikes.textContent);
          if (tkFollowing) result.following = parseNum(tkFollowing.innerText || tkFollowing.textContent);
          if (tkName) result.profile_name = (tkName.innerText || tkName.textContent || '').trim();
          if (tkImg && tkImg.src) result.profile_image = tkImg.src;

          var ytSubs = document.querySelector('#subscriber-count, yt-formatted-string#subscriber-count, [id="subscriber-count"]');
          var ytVideos = document.querySelector('#videos-count, yt-formatted-string#videos-count, [id="videos-count"]');
          var ytName = document.querySelector('#channel-name #text, yt-formatted-string#text.ytd-channel-name, #channel-header #text');
          var ytImg = document.querySelector('#avatar #img, yt-img-shadow#avatar img');
          if (ytSubs) result.subscribers = parseNum(ytSubs.innerText || ytSubs.textContent);
          if (ytVideos) result.videos_count = parseNum(ytVideos.innerText || ytVideos.textContent);
          if (ytName) result.profile_name = (ytName.innerText || ytName.textContent || '').trim();
          if (ytImg && ytImg.src) result.profile_image = ytImg.src;

          var igStats = Array.from(document.querySelectorAll('header section ul li, header ul li'));
          if (igStats.length >= 2) {
            var pText = igStats[0] ? (igStats[0].innerText || '') : '';
            var fText = igStats[1] ? (igStats[1].querySelector('span[title]')?.getAttribute('title') || igStats[1].innerText || '') : '';
            var fwText = igStats[2] ? (igStats[2].innerText || '') : '';
            result.videos_count = parseNum(pText);
            result.followers = parseNum(fText);
            result.following = parseNum(fwText);
          }
          var igName = document.querySelector('header h2, header h1, header section > div > div');
          var igImg = document.querySelector('header img, [alt*="foto do perfil" i]');
          if (igName) result.profile_name = (igName.innerText || igName.textContent || '').trim();
          if (igImg && igImg.src) result.profile_image = igImg.src;

          return result;
        })()
      `;

      const evalRes: any = await cdpSend(ws, 'Runtime.evaluate', {
        expression: scrapeScript,
        returnByValue: true,
      }).catch(() => null);

      const scraped = evalRes?.result?.value;
      if (scraped) {
        return { success: true, metrics: scraped, source: 'cdp' };
      }
    }

    // ─── Fallback: Chrome não está aberto — scraping via HTTP com cookies ──
    // Funciona desde que a conta esteja autenticada (cookies salvos no disco)
    // NÃO conflita com os bloqueadores: opera no processo Node.js, sem página browser
    const baseProfileDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
    const profileDirName = (platform === 'facebook')
      ? `partner-${accPartnerId || 'common'}-facebook`
      : (accountId
          ? `${accountCode}-${accountId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`
          : accountCode);
    const profileDir = path.join(baseProfileDir, 'agent-windows-profiles', profileDirName);

    // Verificar se conta está autenticada
    const flagName = platform === 'tiktok' ? 'tt_authenticated.flag'
      : platform === 'youtube' ? 'yt_authenticated.flag'
      : platform === 'instagram' ? 'ig_authenticated.flag'
      : 'fb_authenticated.flag';

    if (!fsSync.existsSync(path.join(profileDir, flagName))) {
      return { success: false, error: 'Conta não autenticada. Faça login primeiro.', source: 'http' };
    }

    // Helper: ler cookies do ficheiro JSON e converter para string de header
    const readCookieString = (cookieFile: string): string => {
      try {
        const raw = fsSync.readFileSync(path.join(profileDir, cookieFile), 'utf8');
        const arr: Array<{ name: string; value: string; domain?: string }> = JSON.parse(raw);
        return arr.map((c) => `${c.name}=${c.value}`).join('; ');
      } catch {
        return '';
      }
    };

    // Helper: parsear número com sufixos (K, M, B, mil, milh)
    const parseNum = (str: string): number => {
      if (!str) return 0;
      const s = String(str).trim();
      let mult = 1;
      if (/m|mi|milh/i.test(s) && !/mil\b/i.test(s)) mult = 1_000_000;
      else if (/k|mil\b/i.test(s)) mult = 1_000;
      else if (/b|bi/i.test(s)) mult = 1_000_000_000;
      const cleaned = s.replace(/[^0-9.,]/g, '').replace(',', '.');
      const n = parseFloat(cleaned);
      return isNaN(n) ? 0 : Math.round(n * mult);
    };

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    if (platform === 'tiktok' && username) {
      // TikTok: dados públicos — não precisa de cookies para métricas básicas
      try {
        const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8', 'Accept': 'text/html' },
        });
        const html = await res.text();
        // Extrair JSON de UNIVERSAL_DATA_FOR_REHYDRATION
        const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
        if (match) {
          const data = JSON.parse(match[1]);
          const userInfo = data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo;
          const stats = userInfo?.stats;
          const user = userInfo?.user;
          if (stats) {
            return {
              success: true,
              source: 'http',
              metrics: {
                followers: stats.followerCount || 0,
                following: stats.followingCount || 0,
                likes: stats.heartCount || 0,
                videos_count: stats.videoCount || 0,
                views: 0,
                subscribers: 0,
                profile_name: user?.nickname || user?.uniqueId || username,
                profile_image: user?.avatarLarger || user?.avatarMedium || '',
              },
            };
          }
        }
      } catch (e) {
        console.warn('[METRICS-HTTP] Erro TikTok HTTP:', e);
      }
    }

    if (platform === 'youtube') {
      try {
        // Extrair channelId do profileUrl (ex: studio.youtube.com/channel/UCxxx ou youtube.com/channel/UCxxx)
        let channelId = '';
        const pUrl = profileUrl || '';
        const chMatch = pUrl.match(/channel\/(UC[a-zA-Z0-9_-]{22})/);
        if (chMatch) channelId = chMatch[1];

        const cookieStr = readCookieString('youtube_cookies.json');

        if (!channelId && cookieStr) {
          try {
            const resStudio = await fetch('https://studio.youtube.com', {
              headers: {
                'User-Agent': UA,
                'Cookie': cookieStr,
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
              },
            });
            if (resStudio.ok) {
              const htmlStudio = await resStudio.text();
              const mStudio = htmlStudio.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
              if (mStudio) channelId = mStudio[1];
            }
          } catch (_) {}
        }

        const targetUrl = channelId
          ? `https://www.youtube.com/channel/${channelId}/about`
          : `https://www.youtube.com/feed/you`;

        const res = await fetch(targetUrl, {
          headers: {
            'User-Agent': UA,
            'Cookie': cookieStr,
            'Accept-Language': 'pt-PT,pt;q=0.9',
            'Accept': 'text/html',
          },
        });
        const html = await res.text();

        // Extrair ytInitialData
        const initMatch = html.match(/var ytInitialData = ({.+?});<\/script>/s) ||
                          html.match(/window\["ytInitialData"\] = ({.+?});<\/script>/s);
        if (initMatch) {
          const data = JSON.parse(initMatch[1]);
          const header = data?.header?.c4TabbedHeaderRenderer;
          const subText = header?.subscriberCountText?.simpleText ||
            (header?.subscriberCountText?.runs || []).map((r: any) => r.text).join('');
          const videoText = header?.videosCountText?.runs?.[0]?.text || '';
          const channelName = header?.title || '';
          const thumbs = header?.avatar?.thumbnails || [];
          const thumb = thumbs[thumbs.length - 1]?.url || '';

          return {
            success: true,
            source: 'http',
            metrics: {
              followers: 0,
              following: 0,
              likes: 0,
              views: 0,
              videos_count: parseNum(videoText),
              subscribers: parseNum(subText),
              profile_name: channelName,
              profile_image: thumb,
            },
          };
        }
      } catch (e) {
        console.warn('[METRICS-HTTP] Erro YouTube HTTP:', e);
      }
    }

    if (platform === 'instagram' && username) {
      try {
        // Tentar cookies salvos se existirem
        const igCookieFile = path.join(profileDir, 'instagram_cookies.json');
        let cookieStr = '';
        if (fsSync.existsSync(igCookieFile)) {
          cookieStr = readCookieString('instagram_cookies.json');
        }

        const res = await fetch(
          `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
          {
            headers: {
              'User-Agent': UA,
              'Cookie': cookieStr,
              'X-IG-App-ID': '936619743392459',
              'X-Requested-With': 'XMLHttpRequest',
              'Referer': `https://www.instagram.com/${username}/`,
              'Accept': 'application/json',
            },
          },
        );
        if (res.ok) {
          const json: any = await res.json();
          const user = json?.data?.user;
          if (user) {
            return {
              success: true,
              source: 'http',
              metrics: {
                followers: user.edge_followed_by?.count || 0,
                following: user.edge_follow?.count || 0,
                likes: 0,
                views: 0,
                videos_count: user.edge_owner_to_timeline_media?.count || 0,
                subscribers: 0,
                profile_name: user.full_name || user.username || username,
                profile_image: user.profile_pic_url_hd || user.profile_pic_url || '',
              },
            };
          }
        }
      } catch (e) {
        console.warn('[METRICS-HTTP] Erro Instagram HTTP:', e);
      }
    }

    return { success: false, error: 'Não foi possível extrair métricas. Tente abrir a conta no Chrome primeiro.', source: 'http' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro ao sincronizar métricas.' };
  }
});


// ── IPC: Download de Vídeo para Cofre Criptografado (AES-256 Anti-Furto) ──
ipcMain.handle('download-video', async (_event, { videoUrl, profileName, filename }: { videoUrl: string; profileName: string; filename: string }) => {
  try {
    await fs.mkdir(VAULT_DIR, { recursive: true });

    const cleanProfileName = (profileName || 'Geral').replace(/[<>:"/\\|?*]/g, '_').trim();
    const cleanFilename = (filename || `video_${Date.now()}.mp4`).replace(/[<>:"/\\|?*]/g, '_').trim();
    const hash = crypto.createHash('sha256').update(`${cleanProfileName}_${cleanFilename}_${videoUrl}`).digest('hex').slice(0, 32);
    const targetEncryptedPath = path.join(VAULT_DIR, `vault_${hash}.enc`);

    // Reutilizar arquivo existente no cofre seguro se já foi baixado
    if (fsSync.existsSync(targetEncryptedPath)) {
      try {
        const stats = fsSync.statSync(targetEncryptedPath);
        if (stats.size > 1000) {
          console.log(`[VAULT] Vídeo já existente e íntegro no cofre seguro (${stats.size} bytes): ${targetEncryptedPath}`);
          return { success: true, localPath: targetEncryptedPath };
        }
      } catch (_) {}
    }

    console.log(`[VAULT] Baixando vídeo para cofre seguro: ${targetEncryptedPath}`);

    const directUrl = resolveDirectDownloadUrl(videoUrl);
    let res = await fetch(directUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    // Verificar se o Google Drive redirecionou para tela de login (arquivo privado)
    if (res.url.includes('accounts.google.com') || res.url.includes('ServiceLogin')) {
      throw new Error(
        'O link do Google Drive está com acesso privado/restrito (pedindo login do Google). ' +
        'Para resolver: abra o Google Drive, clique com botão direito no vídeo > Compartilhar > ' +
        'altere o Acesso Geral de "Restrito" para "Qualquer pessoa com o link pode ver" (Leitor), ou faça o upload direto do arquivo MP4 no painel administrativo.'
      );
    }

    let arrayBuffer = await res.arrayBuffer();
    let rawBuffer = Buffer.from(arrayBuffer);

    // Se retornou página HTML, verificar se é aviso de vírus do Google Drive para arquivo grande
    const headAscii = rawBuffer.subarray(0, 150).toString('ascii').toLowerCase();
    if (headAscii.includes('<!doctype') || headAscii.includes('<html')) {
      const html = rawBuffer.toString('utf8');

      if (html.includes('accounts.google.com') || html.includes('Google Drive: Sign-in') || html.includes('Sign in - Google Accounts')) {
        throw new Error(
          'O link do Google Drive está com acesso privado/restrito (pedindo login do Google). ' +
          'No Google Drive: clique com botão direito no vídeo > Compartilhar > altere de "Restrito" para "Qualquer pessoa com o link pode ver".'
        );
      }

      // Tenta seguir formulário/link de confirmação de vírus do Google Drive para arquivos grandes (>100MB)
      const confirmMatch = html.match(/href="(\/download\?[^"]+confirm=[^"]+)"/i) ||
                           html.match(/href="(https:\/\/drive\.usercontent\.google\.com\/download\?[^"]+confirm=[^"]+)"/i) ||
                           html.match(/action="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/i);

      if (confirmMatch) {
        let confirmUrl = confirmMatch[1].replace(/&amp;/g, '&');
        if (confirmUrl.startsWith('/')) {
          confirmUrl = `https://drive.usercontent.google.com${confirmUrl}`;
        }
        console.log(`[VAULT] Seguindo confirmação de download do Google Drive: ${confirmUrl}`);
        const confirmRes = await fetch(confirmUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          }
        });
        if (confirmRes.ok && !confirmRes.url.includes('accounts.google.com')) {
          arrayBuffer = await confirmRes.arrayBuffer();
          rawBuffer = Buffer.from(arrayBuffer);
        }
      }
    }

    // Validação estrita: garantir que é um container de vídeo real antes de salvar no cofre
    if (!isValidVideoBuffer(rawBuffer)) {
      if (rawBuffer.toString('utf8').includes('accounts.google.com')) {
        throw new Error(
          'O link do Google Drive está com acesso privado/restrito (pedindo login do Google). ' +
          'No Google Drive: clique com botão direito no vídeo > Compartilhar > altere de "Restrito" para "Qualquer pessoa com o link pode ver".'
        );
      }
      throw new Error(
        `O arquivo baixado (${rawBuffer.length} bytes) não é um vídeo reconhecível (.mp4, .mov, etc). ` +
        'O link retornou conteúdo inválido ou página web. Certifique-se de que o link é de download direto público ou envie o arquivo diretamente no painel.'
      );
    }

    // Criptografar bytes em memória com AES-256 antes de gravar no disco
    const encryptedBuffer = encryptVaultBuffer(rawBuffer);
    await fs.writeFile(targetEncryptedPath, encryptedBuffer);

    console.log(`[VAULT] Vídeo blindado e salvo com sucesso (${encryptedBuffer.length} bytes criptografados).`);
    return { success: true, localPath: targetEncryptedPath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha ao baixar vídeo no cofre';
    console.error('[DOWNLOAD-VIDEO ERROR]:', msg);
    return { success: false, error: msg };
  }
});

// ── IPC: Preparar Vídeo para Modo Manual (Temporário com Auto-Destruição) ──
ipcMain.handle('prepare-manual-video', async (_event, { vaultPath, filename }: { vaultPath: string; filename?: string }) => {
  try {
    const ephemeral = await getEphemeralUploadPath(vaultPath, filename);

    // Auto-destruição em 10 minutos caso o parceiro esqueça a janela aberta
    const timer = setTimeout(async () => {
      await ephemeral.cleanup();
      activeManualCleanups.delete(ephemeral.path);
      console.log(`[VAULT] Vídeo temporário manual auto-destruído por tempo: ${ephemeral.path}`);
    }, 10 * 60 * 1000);

    activeManualCleanups.set(ephemeral.path, async () => {
      clearTimeout(timer);
      await ephemeral.cleanup();
    });

    return { success: true, tempPath: ephemeral.path };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha ao preparar vídeo manual';
    return { success: false, error: msg };
  }
});

// ── IPC: Limpar Vídeo Temporário Manual (Chamado ao fechar Kiosk) ───────
ipcMain.handle('cleanup-manual-video', async (_event, { tempPath }: { tempPath: string }) => {
  try {
    const cleanup = activeManualCleanups.get(tempPath);
    if (cleanup) {
      await cleanup();
      activeManualCleanups.delete(tempPath);
      return { success: true };
    }
    if (tempPath && fsSync.existsSync(tempPath)) {
      await fs.unlink(tempPath);
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha ao limpar vídeo';
    return { success: false, error: msg };
  }
});

// ── Helper: Guia visual único para ativar Conta Creator no Instagram ──
function buildInstagramCreatorGuideScript(): string {
  return `
    (function() {
      if (window.__agent_creator_guide_injected__) return;
      window.__agent_creator_guide_injected__ = true;

      // 1. CSS: escurecer tudo, destacar apenas o botão alvo
      var style = document.createElement('style');
      style.id = 'agent-ig-creator-guide-css';
      style.textContent = \`
        body > * { opacity: 0.18 !important; pointer-events: none !important; transition: opacity 0.3s; }
        #agent-ig-creator-banner { opacity: 1 !important; pointer-events: auto !important; }
        .agent-ig-target {
          opacity: 1 !important; pointer-events: auto !important;
          border: 3px solid #00C851 !important; border-radius: 8px !important;
          box-shadow: 0 0 0 4px rgba(0,200,81,0.35) !important;
          animation: agent-ig-pulse 1.6s ease-in-out infinite !important;
        }
        @keyframes agent-ig-pulse {
          0%   { box-shadow: 0 0 0 4px rgba(0,200,81,0.25); }
          50%  { box-shadow: 0 0 0 10px rgba(0,200,81,0.5); }
          100% { box-shadow: 0 0 0 4px rgba(0,200,81,0.25); }
        }
      \`;
      (document.head || document.documentElement).appendChild(style);

      // 2. Banner de instrução
      var banner = document.createElement('div');
      banner.id = 'agent-ig-creator-banner';
      banner.style.cssText = [
        'position:fixed','top:0','left:0','right:0','z-index:2147483647',
        'background:linear-gradient(135deg,#405DE6,#5851DB,#833AB4)',
        'color:#fff','font-family:-apple-system,sans-serif',
        'padding:14px 20px','text-align:center','font-size:15px','font-weight:600',
        'box-shadow:0 4px 20px rgba(0,0,0,0.3)','opacity:1 !important','pointer-events:auto !important'
      ].join(';');
      banner.innerHTML = '👆 <strong>Configuração única:</strong> Clique em <em>"Mudar para conta profissional"</em> e siga os passos para ativar a Conta Creator. Este ecrã aparece apenas uma vez.';
      document.body.insertBefore(banner, document.body.firstChild);

      // 3. Procurar e destacar o botão alvo
      var KEYWORDS = [
        'mudar para conta profissional','switch to professional account',
        'conta profissional','professional account',
        'account type and tools','tipo de conta e ferramentas',
        'mudar para profissional','switch to professional'
      ];
      function highlightTarget() {
        var candidates = Array.from(document.querySelectorAll('a, button, div[role="button"], li, span, div'));
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          for (var k = 0; k < KEYWORDS.length; k++) {
            if (txt.includes(KEYWORDS[k]) && !el.classList.contains('agent-ig-target')) {
              el.classList.add('agent-ig-target');
              el.style.setProperty('opacity', '1', 'important');
              el.style.setProperty('pointer-events', 'auto', 'important');
              // Tornar os ancestrais visíveis também
              var p = el.parentElement;
              for (var d = 0; d < 5 && p; d++) {
                p.style.setProperty('opacity', '1', 'important');
                p.style.setProperty('pointer-events', 'auto', 'important');
                p = p.parentElement;
              }
              break;
            }
          }
        }
      }
      highlightTarget();
      var obs = new MutationObserver(function() { highlightTarget(); });
      obs.observe(document.body, { childList: true, subtree: true });

      // 4. Detetar conclusão (saiu de /accounts/) e limpar
      var checkInterval = setInterval(function() {
        if (!window.location.pathname.includes('/accounts/')) {
          window.localStorage.setItem('__agent_ig_creator_activated__', 'true');
          clearInterval(checkInterval);
          obs.disconnect();
          try { document.getElementById('agent-ig-creator-guide-css').remove(); } catch(_) {}
          try { document.getElementById('agent-ig-creator-banner').remove(); } catch(_) {}
          // Remover classes de destaque
          document.querySelectorAll('.agent-ig-target').forEach(function(e) { e.classList.remove('agent-ig-target'); });
          console.log('[AGENT] Instagram Creator ativado com sucesso!');
        }
      }, 1500);
    })()
  `;
}

async function launchChromeForAccount(
  accountCode: string,
  platform: 'tiktok' | 'youtube' | 'facebook' | 'instagram',
  runInBackground: boolean = true,
  partnerId?: string,
  pageUrl?: string
): Promise<ChromeSession | null> {
  // Publicação automática é estritamente em segundo plano
  runInBackground = true;
  // 1. Reutilizar sessão aberta existente se processo estiver vivo
  let existing = chromeSessions.get(accountCode);
  if (!existing && platform === 'facebook') {
    for (const [, s] of chromeSessions.entries()) {
      if (s.platform === platform && (s.partnerId === partnerId || !partnerId)) {
        existing = s;
        break;
      }
    }
  }

  if (existing) {
    let isProcessAlive = false;
    if (existing.process && !existing.process.killed && existing.process.pid) {
      try {
        process.kill(existing.process.pid, 0);
        isProcessAlive = true;
      } catch {
        isProcessAlive = false;
      }
    }
    if (isProcessAlive) {
      if (existing.ws && existing.ws.readyState === WebSocket.OPEN) {
        console.log(`[CHROME AUTO-LAUNCH] Reutilizando sessão existente aberta para ${accountCode}`);
        try {
          await injectSecurityShieldToSession(existing.ws, { isSignup: false, pageUrl: pageUrl || existing.pageUrl || '' });
        } catch {}
        if (runInBackground) {
          try {
            const boundsRes = (await cdpSend(existing.ws, 'Browser.getWindowForTarget')) as { windowId?: number };
            if (boundsRes?.windowId) {
              await cdpSend(existing.ws, 'Browser.setWindowBounds', {
                windowId: boundsRes.windowId,
                bounds: { windowState: 'normal', left: -32000, top: -32000, width: 1200, height: 810 }
              });
            }
          } catch (_) {}
          if (existing.process?.pid) {
            startBackgroundWindowKeeper(existing.process.pid);
            setProcessTaskbarVisibility(existing.process.pid, false);
          }
        }
        return existing;
      }
      if (existing.debugPort) {
        try {
          const http = await import('http');
          const tabs = await new Promise<Array<{ id?: string; type: string; webSocketDebuggerUrl?: string; url: string }>>((resolve, reject) => {
            const req = http.default.get(`http://127.0.0.1:${existing.debugPort}/json/list`, (res) => {
              let data = '';
              res.on('data', (c) => (data += c));
              res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
              });
            });
            req.on('error', reject);
          });
          const pageTab = tabs.find((t) => (t.type === 'page' || t.type === 'app') && t.webSocketDebuggerUrl && !t.url.startsWith('chrome-'));
          if (pageTab && pageTab.webSocketDebuggerUrl) {
            const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
            await new Promise<void>((resolve, reject) => {
              ws.once('open', () => resolve());
              ws.once('error', reject);
            });
            existing.mainTargetId = pageTab.id;
            existing.ws = ws;
            try {
              await injectSecurityShieldToSession(ws, { isSignup: false, pageUrl: pageUrl || existing.pageUrl || '' });
            } catch {}
            attachSecurityListenersToWs(ws, existing, existing.platform || platform);
            if (platform === 'tiktok' && existing.profileDir) {
              await restoreTikTokCookies(ws, existing.profileDir).catch(() => {});
            } else if (platform === 'facebook' && existing.profileDir) {
              await restoreFacebookCookies(ws, existing.profileDir).catch(() => {});
            } else if (platform === 'instagram' && existing.profileDir) {
              await restoreInstagramCookies(ws, existing.profileDir).catch(() => {});
            }
            if (runInBackground) {
              try {
                const boundsRes = (await cdpSend(ws, 'Browser.getWindowForTarget')) as { windowId?: number };
                if (boundsRes?.windowId) {
                  await cdpSend(ws, 'Browser.setWindowBounds', {
                    windowId: boundsRes.windowId,
                    bounds: { windowState: 'normal', left: -32000, top: -32000, width: 1200, height: 810 }
                  });
                }
              } catch (_) {}
              if (existing.process?.pid) {
                startBackgroundWindowKeeper(existing.process.pid);
                setProcessTaskbarVisibility(existing.process.pid, false);
              }
            }
            console.log(`[CHROME AUTO-LAUNCH] Reconectado e blindado na sessão existente de ${accountCode}`);
            return existing;
          }
        } catch (err) {
          console.warn(`[CHROME AUTO-LAUNCH] Não conseguiu reconectar WS na porta ${existing.debugPort}:`, err);
        }
      }
    } else {
      if (existing.ws) {
        try { existing.ws.close(); } catch {}
      }
      chromeSessions.delete(accountCode);
    }
  }

  const baseProfileDir = process.env.LOCALAPPDATA || path.join(app.getPath('userData'), 'ChromeData');
  let profileDir = path.join(baseProfileDir, 'agent-windows-profiles', accountCode);
  if (platform === 'facebook') {
    const parentDir = path.join(baseProfileDir, 'agent-windows-profiles');
    const partnerFbDir = partnerId ? `partner-${partnerId}-facebook` : '';
    if (partnerFbDir && fsSync.existsSync(path.join(parentDir, partnerFbDir))) {
      profileDir = path.join(parentDir, partnerFbDir);
    } else if (fsSync.existsSync(parentDir)) {
      const match = fsSync.readdirSync(parentDir).find((d) => d.startsWith('partner-') && d.endsWith('-facebook'));
      if (match) {
        profileDir = path.join(parentDir, match);
      } else if (partnerId) {
        profileDir = path.join(parentDir, `partner-${partnerId}-facebook`);
      }
    }
  } else {
    // Para Instagram, YouTube e TikTok: perfis individuais isolados por conta (accountCode ou accountCode-UUID)
    const parentDir = path.join(baseProfileDir, 'agent-windows-profiles');
    if (fsSync.existsSync(parentDir)) {
      const match = fsSync.readdirSync(parentDir).find((d) => d === accountCode || d.startsWith(`${accountCode}-`));
      if (match) {
        profileDir = path.join(parentDir, match);
      }
    }
  }

  let initialUrl = 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&lang=pt&tab=video';
  if (platform === 'youtube')   initialUrl = 'https://studio.youtube.com';
  if (platform === 'facebook') {
    const fbSwitchedFlag = path.join(profileDir, 'fb_page_switched.flag');
    const hasSwitched = fsSync.existsSync(fbSwitchedFlag);
    const fbDomain = (pageUrl && pageUrl.includes('web.facebook.com')) ? 'web.facebook.com' : 'www.facebook.com';
    if (hasSwitched) {
      initialUrl = `https://${fbDomain}/reels/create/`;
    } else {
      initialUrl = (pageUrl && pageUrl.trim()) ? pageUrl.trim() : `https://${fbDomain}/reels/create/`;
    }
  }
  if (platform === 'instagram') initialUrl = 'https://www.instagram.com/';

  const chromePath = findChromePath();
  const debugPort = getNextDebugPort();
  const extDir = ensureSecurityExtension();

  const args = [
    `--app=${initialUrl}`,
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--disable-popup-blocking',
    `--load-extension=${extDir}`,
    `--disable-extensions-except=${extDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-tools',
    '--disable-debugging-keyboard-shortcuts',
    '--lang=pt-PT',
    ...(runInBackground
      ? [
          '--window-position=-32000,-32000',
          '--window-size=1200,810',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ]
      : ['--window-size=1200,810']),
    '--disk-cache-size=2147483648',
    '--media-cache-size=1073741824',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--ignore-gpu-blocklist',
    '--enable-features=ParallelDownloading',
  ];

  console.log(`[CHROME AUTO-LAUNCH] Iniciando Chrome Real para ${accountCode} (${platform}) em ${runInBackground ? 'segundo plano (oculto)' : 'janela visível'}`);
  const chromeProcess = spawn(chromePath, args, { windowsHide: false, stdio: 'ignore' });

  const session: ChromeSession = {
    process: chromeProcess,
    profileDir,
    ws: null,
    debugPort,
    platform,
    partnerId,
    pageUrl,
  };
  chromeSessions.set(accountCode, session);

  // Se for segundo plano, ocultar o Chrome da Barra de Tarefas do Windows
  if (runInBackground && chromeProcess.pid) {
    startBackgroundWindowKeeper(chromeProcess.pid);
    setTimeout(() => setProcessTaskbarVisibility(chromeProcess.pid, false), 800);
    setTimeout(() => setProcessTaskbarVisibility(chromeProcess.pid, false), 2000);
    setTimeout(() => setProcessTaskbarVisibility(chromeProcess.pid, false), 4000);
  }

  // Aguardar conexão CDP
  const http = await import('http');
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const tabs = await new Promise<Array<{ id?: string; type: string; webSocketDebuggerUrl?: string; url: string }>>((resolve, reject) => {
        const req = http.default.get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
      });

      const pageTab = tabs.find((t) => (t.type === 'page' || t.type === 'app') && t.webSocketDebuggerUrl && !t.url.startsWith('chrome-'));
      if (pageTab && pageTab.webSocketDebuggerUrl) {
        const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => resolve());
          ws.on('error', reject);
        });
        session.mainTargetId = pageTab.id;
        session.ws = ws;
        try {
          await injectSecurityShieldToSession(ws, { isSignup: false, pageUrl: pageUrl || '' });
        } catch {}
        attachSecurityListenersToWs(ws, session, platform);
        if (platform === 'tiktok') {
          await restoreTikTokCookies(ws, session.profileDir || profileDir).catch(() => {});
        } else if (platform === 'facebook') {
          await restoreFacebookCookies(ws, session.profileDir || profileDir).catch(() => {});
        } else if (platform === 'instagram') {
          await restoreInstagramCookies(ws, session.profileDir || profileDir).catch(() => {});
        }
        if (runInBackground) {
          try {
            const boundsRes = (await cdpSend(ws, 'Browser.getWindowForTarget')) as { windowId?: number };
            if (boundsRes?.windowId) {
              await cdpSend(ws, 'Browser.setWindowBounds', {
                windowId: boundsRes.windowId,
                bounds: { windowState: 'normal', left: -32000, top: -32000, width: 1200, height: 810 }
              });
            }
          } catch (_) {}
          if (session.process?.pid) {
            startBackgroundWindowKeeper(session.process.pid);
            setProcessTaskbarVisibility(session.process.pid, false);
          }
        }
        console.log(`[CHROME AUTO-LAUNCH] CDP conectado e blindado com sucesso para ${accountCode}`);
        return session;
      }
    } catch {}
  }

  return session;
}

// ── IPC: Publicação Automática em Segundo Plano Multi-Rede (1-Clique Blindado) ──
ipcMain.handle('auto-publish-video', async (event, {
  jobId,
  videoLocalPath,
  title,
  caption,
  hashtags,
  platforms,
  accountCode,
  partnerId,
  pageUrl,
  runInBackground,
}: {
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
}) => {
  const results: Record<string, { success: boolean; error?: string; postUrl?: string }> = {};

  const notify = (platform: string, status: 'uploading' | 'captioning' | 'publishing' | 'done' | 'error', progress: number, message: string) => {
    event.sender.send('publish-progress', { jobId, platform, status, progress, message });
  };

  const cleanTags = (hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  const fullText = [caption, cleanTags].filter(Boolean).join('\n\n');

  let ephemeral: { path: string; cleanup: () => Promise<void> } | null = null;

  try {
    // Validar existência física do vídeo local
    if (!videoLocalPath || !fsSync.existsSync(videoLocalPath)) {
      throw new Error(`Arquivo de vídeo local não encontrado: "${videoLocalPath || '(vazio)'}". Certifique-se de que o vídeo foi descarregado.`);
    }

    // Descriptografar em arquivo efêmero temporário apenas para o upload
    ephemeral = await getEphemeralUploadPath(videoLocalPath, title || 'video.mp4');
    const actualUploadPath = ephemeral.path;

    for (const plat of platforms) {
      notify(plat, 'uploading', 15, `Iniciando publicação no ${plat.toUpperCase()}...`);

      // Se não veio accountCode, tentar inferir da lista de sessões ativas
      let effectiveAccountCode = accountCode;
      if (!effectiveAccountCode) {
        for (const [code, s] of chromeSessions.entries()) {
          if (s.platform === plat) {
            effectiveAccountCode = code;
            break;
          }
        }
        if (!effectiveAccountCode && chromeSessions.size > 0) {
          effectiveAccountCode = Array.from(chromeSessions.keys())[0];
        }
      }

      // Procurar sessão aberta compatível no Chrome Real
      let targetSession: ChromeSession | undefined | null;

      // 1. Tentar por effectiveAccountCode exato se fornecido
      if (effectiveAccountCode && chromeSessions.has(effectiveAccountCode)) {
        const s = chromeSessions.get(effectiveAccountCode)!;
        if (s.ws && s.ws.readyState === WebSocket.OPEN) {
          targetSession = s;
        }
      }

      // 2. Tentar por plataforma compatível (para o Facebook, pode ser a sessão mestre do parceiro)
      if (!targetSession) {
        for (const s of chromeSessions.values()) {
          if (s.ws && s.ws.readyState === WebSocket.OPEN) {
            if (s.platform === plat) {
              targetSession = s;
              break;
            }
          }
        }
      }

      // 3. Se não estiver aberta, iniciar Chrome Real automaticamente com o perfil dedicado da conta
      if ((!targetSession || !targetSession.ws || targetSession.ws.readyState !== WebSocket.OPEN) && effectiveAccountCode) {
        notify(plat, 'uploading', 20, `Iniciando sessão isolada do Chrome Real para @${effectiveAccountCode} (${plat.toUpperCase()})...`);
        try {
          targetSession = await launchChromeForAccount(effectiveAccountCode, plat, true, partnerId, pageUrl);
        } catch (e: unknown) {
          console.error('[AUTO-LAUNCH CHROME ERROR]:', e);
        }
      }

      // 4. Fallback final: qualquer sessão aberta com a MESMA plataforma
      if (!targetSession || !targetSession.ws || targetSession.ws.readyState !== WebSocket.OPEN) {
        for (const s of chromeSessions.values()) {
          if (s.ws && s.ws.readyState === WebSocket.OPEN && (!s.platform || s.platform === plat)) {
            targetSession = s;
            break;
          }
        }
      }

      if (!targetSession || !targetSession.ws || targetSession.ws.readyState !== WebSocket.OPEN) {
        notify(plat, 'error', 0, `Nenhuma janela do Chrome Real conectada para ${plat.toUpperCase()}. Faça o login primeiro.`);
        results[plat] = { success: false, error: `Sessão do Chrome Real não disponível para ${plat.toUpperCase()}.` };
        continue;
      }

      // Blindagem estrita: assegurar que a janela esteja SEMPRE em segundo plano (-32000, -32000), sem possibilidade de foco, preview ou maximização
      try {
        const boundsRes = (await cdpSend(targetSession.ws, 'Browser.getWindowForTarget')) as { windowId?: number };
        if (boundsRes?.windowId) {
          await cdpSend(targetSession.ws, 'Browser.setWindowBounds', {
            windowId: boundsRes.windowId,
            bounds: { windowState: 'normal', left: -32000, top: -32000, width: 1200, height: 810 }
          });
        }
      } catch (_) {}
      if (targetSession.process?.pid) {
        startBackgroundWindowKeeper(targetSession.process.pid);
        setProcessTaskbarVisibility(targetSession.process.pid, false);
      }

      try {
        const ws = targetSession.ws;

        // Helper de digitação humanizada via CDP (simula comportamento humano caractere a caractere)
        const typeHumanCdp = async (text: string, customWs?: WebSocket): Promise<void> => {
          const targetWs = customWs || ws;
          for (const char of text) {
            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char, key: char }).catch(() => {});
            const dwell = Math.floor(Math.random() * 45) + 40;
            await new Promise((r) => setTimeout(r, dwell));
            await cdpSend(targetWs, 'Input.dispatchKeyEvent', { type: 'keyUp', key: char }).catch(() => {});
            // Pausa extra em pontuação/quebra de linha (simula comportamento humano real)
            const isPunct = [',', '.', '!', '?', '\n', '\r'].includes(char);
            const delay = isPunct
              ? Math.floor(Math.random() * 120) + 180
              : Math.floor(Math.random() * 60) + 50;
            await new Promise((r) => setTimeout(r, delay));
          }
        };

        // Helper para localizar nodeId de input[type="file"] em Shadow DOM e iframes
        const locateFileInputNodeId = async (): Promise<number> => {
          try {
            const evalRes = (await cdpSend(ws, 'Runtime.evaluate', {
              expression: `
                (function() {
                  function searchDoc(doc) {
                    if (!doc) return null;
                    var el = doc.querySelector('input[type="file"], input[accept*="video"], input[accept*="mp4"], input[data-e2e="upload_video"]');
                    if (el) return el;
                    var all = doc.querySelectorAll('*');
                    for (var i = 0; i < all.length; i++) {
                      if (all[i].shadowRoot) {
                        var found = searchDoc(all[i].shadowRoot);
                        if (found) return found;
                      }
                    }
                    var iframes = doc.querySelectorAll('iframe');
                    for (var j = 0; j < iframes.length; j++) {
                      try {
                        var cDoc = iframes[j].contentDocument || iframes[j].contentWindow.document;
                        var foundInIframe = searchDoc(cDoc);
                        if (foundInIframe) return foundInIframe;
                      } catch(e) {}
                    }
                    return null;
                  }
                  return searchDoc(document);
                })()
              `,
            })) as { result?: { objectId?: string } };

            if (evalRes?.result?.objectId) {
              const nodeRes = (await cdpSend(ws, 'DOM.requestNode', {
                objectId: evalRes.result.objectId,
              })) as { nodeId?: number };
              if (nodeRes?.nodeId) return nodeRes.nodeId;
            }
          } catch {}

          try {
            const docRes = (await cdpSend(ws, 'DOM.getDocument', { depth: -1, pierce: true })) as { root: { nodeId: number } };
            const selectors = [
              'input[type="file"]',
              'input[accept*="video"]',
              'input[accept*="mp4"]',
              'input[data-e2e="upload_video"]',
            ];
            for (const sel of selectors) {
              const qRes = (await cdpSend(ws, 'DOM.querySelector', {
                nodeId: docRes.root.nodeId,
                selector: sel,
              })) as { nodeId: number };
              if (qRes?.nodeId) return qRes.nodeId;
            }
          } catch {}

          return 0;
        };

        const dispatchEventsOnAllInputs = async () => {
          await cdpSend(ws, 'Runtime.evaluate', {
            expression: `
              (function() {
                function dispatchOnDoc(doc) {
                  if (!doc) return;
                  try {
                    var inputs = doc.querySelectorAll('input[type="file"], input[accept*="video"]');
                    inputs.forEach(function(input) {
                      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    });
                  } catch(e) {}
                  try {
                    var all = doc.querySelectorAll('*');
                    for (var i = 0; i < all.length; i++) {
                      if (all[i].shadowRoot) dispatchOnDoc(all[i].shadowRoot);
                    }
                  } catch(e) {}
                  try {
                    var iframes = doc.querySelectorAll('iframe');
                    for (var j = 0; j < iframes.length; j++) {
                      try {
                        var cDoc = iframes[j].contentDocument || iframes[j].contentWindow.document;
                        dispatchOnDoc(cDoc);
                      } catch(e) {}
                    }
                  } catch(e) {}
                }
                dispatchOnDoc(document);
                return true;
              })()
            `,
          });
        };

        if (plat === 'tiktok') {
          notify(plat, 'uploading', 25, 'Acessando módulo de carregamento do TikTok Studio...');
          await cdpSend(ws, 'Page.navigate', {
            url: 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&lang=pt&tab=video',
          });
          await injectSecurityShieldToSession(ws, { isSignup: false });

          // ── Helper: Fechar automaticamente popups/notificações/banners do TikTok ──
          // Lida com: avisos de conta nova, notificações de boas-vindas, modais de "primeiro upload",
          // popups de permissão, banners de dica, toasts, diálogos de segurança e qualquer overlay
          // que bloqueie a interface de upload.
          const dismissTikTokUploadPopups = async (): Promise<void> => {
            const script = `
              (function() {
                var dismissed = 0;

                // ── 1. Textos de botão de fechar / dispensar genéricos ──
                var dismissKeywords = [
                  'fechar', 'close', 'dispensar', 'dismiss', 'got it', 'entendi', 'ok', 'okay',
                  'continuar', 'continue', 'prosseguir', 'proceed', 'skip', 'ignorar', 'ignore',
                  'not now', 'agora não', 'talvez mais tarde', 'maybe later', 'later', 'depois',
                  'não, obrigado', 'no thanks', 'no, thanks', 'no thank you',
                  'concluído', 'done', 'certo', 'percebido', 'understood',
                  'allow', 'permitir', 'accept', 'aceitar',
                  // Botões de fechar (x) sem texto visível são tratados por seletores abaixo
                ];

                // ── 2. Seletores de overlays/modais/banners do TikTok ──
                var overlaySelectors = [
                  // Modais genéricos
                  '[role="dialog"]',
                  '[role="alertdialog"]',
                  'div[class*="modal"]',
                  'div[class*="Modal"]',
                  'div[class*="dialog"]',
                  'div[class*="Dialog"]',
                  'div[class*="popup"]',
                  'div[class*="Popup"]',
                  'div[class*="overlay"]',
                  'div[class*="Overlay"]',
                  // TikTok specifics
                  'div[class*="tux-modal"]',
                  'div[class*="TUXModal"]',
                  'div[class*="onboarding"]',
                  'div[class*="Onboarding"]',
                  'div[class*="welcome"]',
                  'div[class*="Welcome"]',
                  'div[class*="guide"]',
                  'div[class*="Guide"]',
                  'div[class*="tip"]',
                  'div[class*="Tip"]',
                  'div[class*="tooltip"]',
                  'div[class*="Tooltip"]',
                  'div[class*="notice"]',
                  'div[class*="Notice"]',
                  'div[class*="announcement"]',
                  'div[class*="Announcement"]',
                  'div[class*="banner"]',
                  'div[class*="Banner"]',
                  'div[class*="notification"]',
                  'div[class*="Notification"]',
                  'div[class*="toast"]',
                  'div[class*="Toast"]',
                  'div[class*="alert"]',
                  'div[class*="Alert"]',
                  'div[class*="newbie"]',
                  'div[class*="Newbie"]',
                  'div[class*="first-time"]',
                  'div[class*="FirstTime"]',
                  'div[class*="first_time"]',
                  'div[class*="interstitial"]',
                  'div[class*="Interstitial"]',
                  'div[class*="cookie"]',
                  'div[class*="Cookie"]',
                  'div[class*="privacy"]',
                  'div[class*="Privacy"]',
                  'div[class*="gdpr"]',
                  'div[class*="GDPR"]',
                  'div[class*="consent"]',
                  'div[class*="Consent"]',
                ];

                // ── 3. Seletores de botões de fechar (ícone X) ──
                var closeButtonSelectors = [
                  'button[aria-label*="close" i]',
                  'button[aria-label*="fechar" i]',
                  'button[aria-label*="dismiss" i]',
                  'button[aria-label*="dispensar" i]',
                  '[data-e2e*="close"]',
                  '[data-e2e*="dismiss"]',
                  'button[class*="close"]',
                  'button[class*="Close"]',
                  'button[class*="dismiss"]',
                  'div[class*="close-btn"]',
                  'div[class*="closeBtn"]',
                  'div[class*="close-button"]',
                  'div[class*="closeButton"]',
                  'span[class*="close"]',
                  'i[class*="close"]',
                  // TikTok-specific close buttons
                  '.tux-modal-close',
                  '[class*="TUXModal"] [class*="close"]',
                  '[class*="modal-close"]',
                  '[class*="modal_close"]',
                ];

                // ── Fase A: Clicar em botões X de fechar em overlays ──
                for (var cs = 0; cs < closeButtonSelectors.length; cs++) {
                  try {
                    var closeBtns = document.querySelectorAll(closeButtonSelectors[cs]);
                    for (var ci = 0; ci < closeBtns.length; ci++) {
                      var cb = closeBtns[ci];
                      if (!cb || !cb.offsetParent) continue; // skip hidden
                      try { cb.click(); dismissed++; } catch(e) {}
                    }
                  } catch(e) {}
                }

                // ── Fase B: Varrer overlays e clicar em botões com palavras-chave de dispensar ──
                for (var os = 0; os < overlaySelectors.length; os++) {
                  try {
                    var overlays = document.querySelectorAll(overlaySelectors[os]);
                    for (var oi = 0; oi < overlays.length; oi++) {
                      var overlay = overlays[oi];
                      if (!overlay || !overlay.offsetParent) continue; // skip hidden

                      // Buscar botões dentro deste overlay
                      var btns = overlay.querySelectorAll('button, [role="button"], a[class*="btn"], div[class*="btn"]');
                      for (var bi = 0; bi < btns.length; bi++) {
                        var btn = btns[bi];
                        var txt = (btn.innerText || btn.textContent || '').toLowerCase().trim();
                        if (!txt) continue;

                        var isConfirmPublish = (
                          txt === 'publicar' || txt === 'publicar agora' ||
                          txt === 'publicar mesmo assim' || txt === 'post' ||
                          txt === 'post now' || txt === 'post anyway' ||
                          txt === 'postar' || txt === 'postar agora'
                        );
                        if (isConfirmPublish) continue; // NUNCA clicar no botão de publicar real

                        for (var ki = 0; ki < dismissKeywords.length; ki++) {
                          if (txt === dismissKeywords[ki] || txt.startsWith(dismissKeywords[ki])) {
                            try { btn.click(); dismissed++; break; } catch(e) {}
                          }
                        }
                      }
                    }
                  } catch(e) {}
                }

                // ── Fase C: Overlays de cookie / LGPD / consentimento com botão "Aceitar tudo" ──
                try {
                  var cookieBtns = document.querySelectorAll('button, [role="button"]');
                  for (var cki = 0; cki < cookieBtns.length; cki++) {
                    var ck = cookieBtns[cki];
                    if (!ck || !ck.offsetParent) continue;
                    var ckTxt = (ck.innerText || ck.textContent || '').toLowerCase().trim();
                    if (
                      ckTxt === 'aceitar tudo' || ckTxt === 'accept all' ||
                      ckTxt === 'aceitar todos' || ckTxt === 'acceptall' ||
                      ckTxt === 'aceitar cookies' || ckTxt === 'accept cookies' ||
                      ckTxt === 'concordar' || ckTxt === 'agree' ||
                      ckTxt === 'concordar com todos' || ckTxt === 'agree to all'
                    ) {
                      try { ck.click(); dismissed++; } catch(e) {}
                    }
                  }
                } catch(e) {}

                // ── Fase D: Pressionar Escape para fechar qualquer overlay modal ──
                try {
                  var hasVisibleOverlay = false;
                  for (var vs = 0; vs < overlaySelectors.length; vs++) {
                    var visEls = document.querySelectorAll(overlaySelectors[vs]);
                    for (var vi = 0; vi < visEls.length; vi++) {
                      if (visEls[vi] && visEls[vi].offsetParent) { hasVisibleOverlay = true; break; }
                    }
                    if (hasVisibleOverlay) break;
                  }
                  if (hasVisibleOverlay) {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  }
                } catch(e) {}

                return { dismissed: dismissed };
              })()
            `;
            try {
              const res = (await cdpSend(ws, 'Runtime.evaluate', { expression: script, returnByValue: true })) as { result?: { value?: { dismissed?: number } } };
              const count = res?.result?.value?.dismissed ?? 0;
              if (count > 0) {
                console.log(`[TIKTOK UPLOAD] Popup/notificação dispensado(s): ${count}`);
              }
            } catch (_) {}
          };

          // 1. Aguardar e localizar o seletor de arquivos (input[type="file"]) com polling
          // Dispensar popups antes e durante a espera pelo file input
          notify(plat, 'uploading', 35, 'Localizando seletor de upload do TikTok...');
          await cdpSend(ws, 'DOM.enable');
          let fileInputNodeId = 0;

          for (let attempt = 0; attempt < 30; attempt++) {
            await new Promise((r) => setTimeout(r, 1200));
            // Dispensar popups a cada ciclo enquanto aguarda o field input
            await dismissTikTokUploadPopups();
            fileInputNodeId = await locateFileInputNodeId();
            if (fileInputNodeId) break;
          }

          if (!fileInputNodeId) {
            throw new Error('Não foi possível localizar o campo de upload do TikTok Studio após 35 segundos. Verifique se a conta está logada.');
          }

          // 2. Injetar o arquivo de vídeo e disparar eventos
          await dismissTikTokUploadPopups(); // garantir tela limpa antes de injetar
          notify(plat, 'uploading', 50, 'Injetando arquivo de vídeo...');
          await cdpSend(ws, 'DOM.setFileInputFiles', {
            nodeId: fileInputNodeId,
            files: [actualUploadPath],
          });

          await dispatchEventsOnAllInputs();

          // 3. Aguardar upload do vídeo e transição para o formulário de detalhes
          notify(plat, 'uploading', 65, 'Aguardando processamento do vídeo no TikTok Studio...');
          let uploadReady = false;

          for (let waitSec = 0; waitSec < 60; waitSec++) {
            await new Promise((r) => setTimeout(r, 1500));
            // Dispensar popups durante o processamento do vídeo (especialmente em contas novas)
            if (waitSec % 2 === 0) await dismissTikTokUploadPopups();
            try {
              const checkStateScript = `
                (function() {
                  var bodyText = document.body ? document.body.innerText : '';
                  if (bodyText.includes('Não foi possível carregar') || bodyText.includes('Algo correu mal')) {
                    return { status: 'error', error: 'O TikTok recusou o carregamento do arquivo.' };
                  }

                  var editor = document.querySelector('div[contenteditable="true"], div[class*="editor"], textarea[placeholder*="legenda" i], textarea[placeholder*="caption" i]');
                  return { status: 'ok', hasEditor: !!editor };
                })()
              `;
              const stateRes = (await cdpSend(ws, 'Runtime.evaluate', {
                expression: checkStateScript,
                returnByValue: true,
              })) as { result: { value: any } };

              const val = stateRes?.result?.value;
              if (val?.status === 'error') {
                throw new Error(val.error);
              }
              if (val?.hasEditor) {
                uploadReady = true;
                break;
              }
            } catch (pollErr: unknown) {
              if (pollErr instanceof Error && pollErr.message.includes('recusou o carregamento')) {
                throw pollErr;
              }
            }
          }

          if (!uploadReady) {
            throw new Error('Tempo limite excedido aguardando o TikTok Studio processar o arquivo de vídeo.');
          }

          // 4. Preenchimento de Legenda e Hashtags (compatível 100% com Draft.js e React do TikTok)
          notify(plat, 'captioning', 80, 'Preenchendo legenda e hashtags...');
          const setTikTokCaptionScript = `
            (function() {
              var editor = document.querySelector(
                'div.notranslate.public-DraftEditor-content, ' +
                'div[data-contents="true"], ' +
                'div[contenteditable="true"], ' +
                'div[class*="editor"], ' +
                'textarea[placeholder*="legenda" i], ' +
                'textarea[placeholder*="caption" i]'
              );
              if (!editor) return { success: false, reason: 'editor_not_found' };

              editor.focus();

              if (editor.isContentEditable) {
                try {
                  var sel = window.getSelection();
                  var range = document.createRange();
                  range.selectNodeContents(editor);
                  sel.removeAllRanges();
                  sel.addRange(range);
                  document.execCommand('delete', false, null);
                  document.execCommand('insertText', false, ${JSON.stringify(fullText)});
                } catch(e) {
                  editor.innerText = ${JSON.stringify(fullText)};
                }
              } else {
                editor.value = ${JSON.stringify(fullText)};
              }

              editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              return { success: true };
            })()
          `;

          const captionSetRes = (await cdpSend(ws, 'Runtime.evaluate', {
            expression: setTikTokCaptionScript,
            returnByValue: true,
          }).catch(() => null)) as any;

          if (!captionSetRes?.result?.value?.success) {
            try { await typeHumanCdp(fullText); } catch (_) {}
          }
          await new Promise((r) => setTimeout(r, 1500));

          // 5. Localizar e aguardar botão "Publicar" ficar ativo e habilitado (até 120 tentativas = 180s)
          notify(plat, 'publishing', 90, 'Aguardando verificação do vídeo e ativação do botão Publicar no TikTok...');
          let buttonInfo: {
            found: boolean;
            enabled: boolean;
            text?: string;
            rect?: { x: number; y: number; width: number; height: number; cx: number; cy: number };
          } | null = null;

          const inspectButtonScript = `
            (function() {
              // Rolar página e containers para o final garantindo visibilidade do botão
              try {
                window.scrollTo(0, document.body.scrollHeight || 999999);
                var scrollables = document.querySelectorAll('div[class*="scroll"], div[class*="container"], div[class*="content"], main');
                for (var s = 0; s < scrollables.length; s++) {
                  try { scrollables[s].scrollTop = scrollables[s].scrollHeight; } catch(_) {}
                }
              } catch(_) {}

              function findTikTokPostButton(root) {
                if (!root) return null;
                var candidates = [];
                function addCandidate(el) {
                  if (!el || candidates.indexOf(el) !== -1) return;
                  candidates.push(el);
                }

                var specificSelectors = [
                  'button[data-e2e="post_video_button"]',
                  'button[data-e2e*="post_video"]',
                  '[data-e2e="post_video_button"]',
                  'button.TUXButton--primary',
                  '.TUXButton--primary',
                  'button[class*="primary"]',
                  'div[class*="btn-post"] button',
                  'button[class*="btn-post"]',
                  'div[class*="btn-post"]',
                  '.btn-post button',
                  '.btn-post',
                  'div[class*="button-group"] button',
                  'div[class*="btn-group"] button',
                  'div[class*="footer-actions"] button',
                  'div[class*="publish-actions"] button',
                  'div[class*="common-modal-footer"] button',
                  'div[class*="footer"] button',
                  'footer button',
                  '[class*="footer"] button',
                  '[class*="publish"] button',
                  'div[class*="action"] button'
                ];
                for (var s = 0; s < specificSelectors.length; s++) {
                  try {
                    var matches = root.querySelectorAll(specificSelectors[s]);
                    for (var m = 0; m < matches.length; m++) addCandidate(matches[m]);
                  } catch(e) {}
                }

                try {
                  var allInteractive = root.querySelectorAll('button, div[role="button"], a[role="button"], span[role="button"], div[class*="btn"], div[class*="button"], div[class*="primary"]');
                  for (var a = 0; a < allInteractive.length; a++) addCandidate(allInteractive[a]);
                } catch(e) {}

                try {
                  var allNodes = root.querySelectorAll('*');
                  for (var k = 0; k < allNodes.length; k++) {
                    if (allNodes[k].shadowRoot) {
                      var inSh = findTikTokPostButton(allNodes[k].shadowRoot);
                      if (inSh) return inSh;
                    }
                  }
                } catch(e) {}

                try {
                  var iframes = root.querySelectorAll('iframe');
                  for (var f = 0; f < iframes.length; f++) {
                    try {
                      var iDoc = iframes[f].contentDocument || iframes[f].contentWindow.document;
                      if (iDoc) {
                        var inIf = findTikTokPostButton(iDoc);
                        if (inIf) return inIf;
                      }
                    } catch(eI) {}
                  }
                } catch(eF) {}

                var validButtons = [];
                var blockedWords = ['cancelar', 'descartar', 'agendar', 'rascunho', 'draft', 'editar', 'substituir', 'voltar', 'música', 'musica', 'som', 'capa', 'dividir', 'modelo', 'template'];

                for (var i = 0; i < candidates.length; i++) {
                  var el = candidates[i];
                  var txt = (el.innerText || el.textContent || '').toLowerCase().trim();
                  if (!txt) continue;

                  var isBlocked = false;
                  for (var b = 0; b < blockedWords.length; b++) {
                    if (txt.includes(blockedWords[b])) { isBlocked = true; break; }
                  }
                  if (isBlocked) continue;

                  var isPublishText = (
                    txt === 'publicar' ||
                    txt === 'publicar agora' ||
                    txt === 'postar' ||
                    txt === 'postar agora' ||
                    txt === 'post' ||
                    txt === 'post now' ||
                    txt === 'publicar vídeo' ||
                    txt === 'publicar video' ||
                    txt === 'post video' ||
                    txt.startsWith('publicar') ||
                    txt.startsWith('postar') ||
                    txt.startsWith('post now') ||
                    (txt.includes('publicar') && txt.length < 30) ||
                    (txt.includes('postar') && txt.length < 30)
                  );

                  if (isPublishText) {
                    validButtons.push(el);
                  }
                }

                if (validButtons.length === 0) return null;

                validButtons.sort(function(a, b) {
                  try {
                    var rA = a.getBoundingClientRect();
                    var rB = b.getBoundingClientRect();
                    return rB.top - rA.top;
                  } catch(e) { return 0; }
                });

                return validButtons[0];
              }

              var rawBtn = findTikTokPostButton(document);
              if (!rawBtn) return { found: false, enabled: false };

              var btn = rawBtn.closest('button, div[role="button"]') || rawBtn;

              // Desbloquear e garantir visibilidade nos ancestrais
              var curr = btn;
              while (curr && curr !== document.body && curr !== document.documentElement) {
                try {
                  if (curr.style) {
                    curr.style.setProperty('display', 'block', 'important');
                    curr.style.setProperty('visibility', 'visible', 'important');
                    curr.style.setProperty('opacity', '1', 'important');
                    curr.style.setProperty('pointer-events', 'auto', 'important');
                  }
                } catch(_) {}
                curr = curr.parentElement;
              }

              var isDisabled = (
                btn.disabled ||
                btn.getAttribute('aria-disabled') === 'true' ||
                btn.getAttribute('disabled') !== null ||
                (typeof btn.className === 'string' && (
                  btn.className.includes('disabled') ||
                  btn.className.includes('is-disabled') ||
                  btn.className.includes('button-disabled') ||
                  btn.className.includes('TUXButton--disabled')
                ))
              );

              try {
                var cs = window.getComputedStyle(btn);
                if (cs.opacity === '0.5' || cs.opacity === '0.4') {
                  isDisabled = true;
                }
              } catch(e) {}

              try {
                btn.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
              } catch(e) {}

              var r = btn.getBoundingClientRect();

              return {
                found: true,
                enabled: !isDisabled,
                text: (btn.innerText || btn.textContent || '').trim(),
                rect: {
                  x: r.left,
                  y: r.top,
                  width: r.width,
                  height: r.height,
                  cx: r.left + r.width / 2,
                  cy: r.top + r.height / 2
                }
              };
            })()
          `;

          // Script para tratar modais de confirmação popup do TikTok (Direitos Autorais / Publicar mesmo assim / etc.)
          const handleConfirmModalScript = `
            (function() {
              var modalBtns = document.querySelectorAll(
                'div[role="dialog"] button, div[class*="modal"] button, ' +
                'div[role="dialog"] [role="button"], div[class*="dialog"] button, ' +
                'div[class*="dialog"] [role="button"], div[class*="popover"] button, ' +
                'div[class*="popover"] [role="button"], .tux-modal button, ' +
                '[class*="TUXModal"] button, [class*="TUXModal"] [role="button"]'
              );
              for (var i = 0; i < modalBtns.length; i++) {
                var mb = modalBtns[i];
                var txt = (mb.innerText || mb.textContent || '').toLowerCase().trim();
                if (
                  txt === 'publicar agora' ||
                  txt === 'publicar mesmo assim' ||
                  txt === 'continuar a publicar' ||
                  txt === 'post anyway' ||
                  txt === 'post now' ||
                  txt === 'publicar' ||
                  txt === 'confirmar'
                ) {
                  try {
                    mb.click();
                    return { clicked: true, text: txt };
                  } catch(e) {}
                }
              }
              return { clicked: false };
            })()
          `;

          for (let bAttempt = 0; bAttempt < 120; bAttempt++) {
            await new Promise((r) => setTimeout(r, 1500));
            // Dispensar popups que possam estar cobrindo o botão Publicar
            await dismissTikTokUploadPopups();
            try { await cdpSend(ws, 'Runtime.evaluate', { expression: handleConfirmModalScript, returnByValue: true }); } catch(_) {}

            const checkRes = (await cdpSend(ws, 'Runtime.evaluate', {
              expression: inspectButtonScript,
              returnByValue: true,
            })) as { result: { value: any } };

            const val = checkRes?.result?.value;
            if (val?.found) {
              if (val.enabled) {
                buttonInfo = val;
                break;
              } else {
                notify(plat, 'publishing', 91, `Aguardando upload/verificação concluir no TikTok (botão "${val.text || 'Publicar'}" em processamento)...`);
              }
            }
          }

          if (!buttonInfo || !buttonInfo.enabled) {
            throw new Error('O botão "Publicar" no TikTok Studio permaneceu desabilitado após 180 segundos. Verifique se o arquivo atende às diretrizes.');
          }

          // Pausa humanizada de revisão antes de publicar (2-4 segundos simulando leitura humana)
          const reviewPauseTk = Math.floor(Math.random() * 2000) + 2000;
          notify(plat, 'publishing', 93, `Revisando publicação antes de confirmar (${Math.round(reviewPauseTk / 1000)}s)...`);
          await new Promise((r) => setTimeout(r, reviewPauseTk));

          // 6. Acionar o clique de Publicar (Físico via CDP Input + Sintético DOM)
          notify(plat, 'publishing', 95, `Acionando clique em "${buttonInfo.text || 'Publicar agora'}" no TikTok Studio...`);

          const executeClickScript = `
            (function() {
              function findTikTokPostButton(root) {
                if (!root) return null;
                var candidates = [];
                function addCandidate(el) {
                  if (!el || candidates.indexOf(el) !== -1) return;
                  candidates.push(el);
                }
                var specificSelectors = [
                  'button[data-e2e="post_video_button"]',
                  'button[data-e2e*="post_video"]',
                  '[data-e2e="post_video_button"]',
                  'div[class*="btn-post"] button',
                  'button[class*="btn-post"]',
                  'div[class*="btn-post"]',
                  '.btn-post button',
                  '.btn-post',
                  'div[class*="button-group"] button',
                  'div[class*="btn-group"] button',
                  'div[class*="footer-actions"] button',
                  'div[class*="publish-actions"] button',
                  'div[class*="common-modal-footer"] button',
                  'div[class*="footer"] button'
                ];
                for (var s = 0; s < specificSelectors.length; s++) {
                  try {
                    var matches = root.querySelectorAll(specificSelectors[s]);
                    for (var m = 0; m < matches.length; m++) addCandidate(matches[m]);
                  } catch(e) {}
                }
                try {
                  var allInteractive = root.querySelectorAll('button, div[role="button"], a[role="button"], span[role="button"], div[class*="btn"], div[class*="button"], div[class*="primary"]');
                  for (var a = 0; a < allInteractive.length; a++) addCandidate(allInteractive[a]);
                } catch(e) {}

                try {
                  var allNodes = root.querySelectorAll('*');
                  for (var k = 0; k < allNodes.length; k++) {
                    if (allNodes[k].shadowRoot) {
                      var inSh = findTikTokPostButton(allNodes[k].shadowRoot);
                      if (inSh) return inSh;
                    }
                  }
                } catch(e) {}

                try {
                  var iframes = root.querySelectorAll('iframe');
                  for (var f = 0; f < iframes.length; f++) {
                    try {
                      var iDoc = iframes[f].contentDocument || iframes[f].contentWindow.document;
                      if (iDoc) {
                        var inIf = findTikTokPostButton(iDoc);
                        if (inIf) return inIf;
                      }
                    } catch(eI) {}
                  }
                } catch(eF) {}

                var validButtons = [];
                var blockedWords = ['cancelar', 'descartar', 'agendar', 'rascunho', 'draft', 'editar', 'substituir', 'voltar', 'música', 'musica', 'som', 'capa', 'dividir', 'modelo', 'template'];
                for (var i = 0; i < candidates.length; i++) {
                  var el = candidates[i];
                  var txt = (el.innerText || el.textContent || '').toLowerCase().trim();
                  if (!txt) continue;
                  var isBlocked = false;
                  for (var b = 0; b < blockedWords.length; b++) {
                    if (txt.includes(blockedWords[b])) { isBlocked = true; break; }
                  }
                  if (isBlocked) continue;
                  if (
                    txt === 'publicar' || txt === 'publicar agora' || txt === 'postar' || txt === 'postar agora' ||
                    txt === 'post' || txt === 'post now' || txt.startsWith('publicar') || txt.startsWith('postar') ||
                    (txt.includes('publicar') && txt.length < 30) || (txt.includes('postar') && txt.length < 30)
                  ) {
                    validButtons.push(el);
                  }
                }
                if (validButtons.length === 0) return null;
                validButtons.sort(function(a, b) {
                  try { return b.getBoundingClientRect().top - a.getBoundingClientRect().top; } catch(e) { return 0; }
                });
                return validButtons[0];
              }

              var raw = findTikTokPostButton(document);
              if (!raw) return { clicked: false };
              var btn = raw.closest('button, div[role="button"]') || raw;

              // Desbloquear e garantir visibilidade irrestrita nos ancestrais
              var curr = btn;
              while (curr && curr !== document.body && curr !== document.documentElement) {
                try {
                  if (curr.style) {
                    curr.style.setProperty('display', 'block', 'important');
                    curr.style.setProperty('visibility', 'visible', 'important');
                    curr.style.setProperty('opacity', '1', 'important');
                    curr.style.setProperty('pointer-events', 'auto', 'important');
                  }
                } catch(_) {}
                curr = curr.parentElement;
              }

              try { btn.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }); } catch(e) {}
              try {
                btn.disabled = false;
                btn.removeAttribute('disabled');
                btn.removeAttribute('aria-disabled');
                btn.style.setProperty('display', 'inline-flex', 'important');
                btn.style.setProperty('visibility', 'visible', 'important');
                btn.style.setProperty('pointer-events', 'auto', 'important');
                btn.style.setProperty('opacity', '1', 'important');
              } catch(e) {}
              try { btn.focus(); } catch(e) {}
              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                try {
                  btn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window }));
                } catch(e) {}
              });
              try { btn.click(); } catch(e) {}
              var r = btn.getBoundingClientRect();
              return {
                clicked: true,
                text: (btn.innerText || btn.textContent || '').trim(),
                rect: {
                  x: r.left,
                  y: r.top,
                  width: r.width,
                  height: r.height,
                  cx: r.left + r.width / 2,
                  cy: r.top + r.height / 2
                }
              };
            })()
          `;

          const clickRes = (await cdpSend(ws, 'Runtime.evaluate', {
            expression: executeClickScript,
            returnByValue: true,
          })) as { result: { value: any } };

          // Disparo físico complementar de mouse via CDP nas coordenadas exatas do botão
          const cVal = clickRes?.result?.value;
          const rect = cVal?.rect || buttonInfo.rect;
          if (rect && rect.width > 0 && rect.height > 0) {
            const cx = Math.round(rect.cx);
            const cy = Math.round(rect.cy);
            try {
              await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
              await new Promise((r) => setTimeout(r, 80));
              await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
              await new Promise((r) => setTimeout(r, 120));
              await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
            } catch (cdpMouseErr) {
              console.warn('[CDP MOUSE CLICK ERROR]:', cdpMouseErr);
            }
          }

          // 7. Confirmação Estrita: Aguardar tela ou modal de sucesso real do TikTok
          notify(plat, 'publishing', 98, 'Aguardando confirmação definitiva da publicação no TikTok...');
          let publishConfirmed = false;

          for (let confAttempt = 0; confAttempt < 35; confAttempt++) {
            await new Promise((r) => setTimeout(r, 1200));

            // Verificar se surgiu modal de confirmação no meio do caminho
            try {
              await cdpSend(ws, 'Runtime.evaluate', { expression: handleConfirmModalScript, returnByValue: true });
            } catch(e) {}

            const verifySuccess = `
              (function() {
                var url = window.location.href;
                if (url.includes('/manage') || url.includes('/content') || url.includes('/post-success')) {
                  return true;
                }
                var bodyText = document.body ? document.body.innerText : '';
                if (
                  bodyText.includes('O teu vídeo foi publicado') ||
                  bodyText.includes('Seu vídeo foi publicado') ||
                  bodyText.includes('Your video has been published') ||
                  bodyText.includes('Vídeo publicado') ||
                  bodyText.includes('Video publicado') ||
                  bodyText.includes('Publicado com sucesso') ||
                  bodyText.includes('Publicação enviada') ||
                  bodyText.includes('Gerir publicações') ||
                  bodyText.includes('Gerenciar publicações') ||
                  bodyText.includes('Manage your posts') ||
                  bodyText.includes('Carregar outro vídeo') ||
                  bodyText.includes('Upload another video')
                ) {
                  return true;
                }
                return false;
              })()
            `;
            const confRes = (await cdpSend(ws, 'Runtime.evaluate', { expression: verifySuccess, returnByValue: true })) as { result: { value: boolean } };
            if (confRes?.result?.value) {
              publishConfirmed = true;
              break;
            }

            // Se após 3 tentativas ainda não confirmou, re-acionar o clique caso o botão ainda esteja visível
            if (confAttempt > 0 && confAttempt % 3 === 0) {
              try {
                await cdpSend(ws, 'Runtime.evaluate', { expression: executeClickScript, returnByValue: true });
              } catch(e) {}
            }
          }

          if (!publishConfirmed) {
            throw new Error('O comando de publicar foi enviado, mas a confirmação de postagem do TikTok não foi detectada a tempo. O vídeo NÃO foi marcado como publicado.');
          }

          notify(plat, 'done', 100, 'Publicado e confirmado com sucesso no TikTok!');
          results[plat] = { success: true };

        } else if (plat === 'youtube') {
          notify(plat, 'uploading', 30, 'Acessando YouTube Studio...');

          // Helper: Descartar popups/avisos/diálogos do YouTube Studio
          const dismissYouTubeStudioPopups = async (): Promise<void> => {
            const dismissYtScript = `
              (function() {
                try {
                  var popups = document.querySelectorAll(
                    'ytcp-dialog #close-button, ' +
                    'ytcp-confirmation-dialog #cancel-button, ' +
                    'tp-yt-paper-dialog [aria-label*="Fechar" i], ' +
                    'tp-yt-paper-dialog [aria-label*="Close" i], ' +
                    '#dismiss-button, button#dismiss-button, ' +
                    'tp-yt-paper-button[aria-label*="Entendi" i], ' +
                    'tp-yt-paper-button[aria-label*="Got it" i]'
                  );
                  for (var i = 0; i < popups.length; i++) {
                    var p = popups[i];
                    if (p && p.offsetParent) {
                      var inner = p.querySelector('button, [role="button"]') || p;
                      inner.click();
                      p.click();
                    }
                  }
                } catch(_) {}
              })()
            `;
            try { await cdpSend(ws, 'Runtime.evaluate', { expression: dismissYtScript }); } catch(_) {}
          };

          // Navegar para o YouTube Studio se necessário
          try {
            await cdpSend(ws, 'Page.navigate', { url: 'https://studio.youtube.com' });
          } catch (_) {}
          await injectSecurityShieldToSession(ws, { isSignup: false });

          // Aguardar a SPA do YouTube Studio inicializar
          notify(plat, 'uploading', 35, 'Aguardando painel do YouTube Studio inicializar...');
          for (let waitYt = 0; waitYt < 20; waitYt++) {
            await new Promise((r) => setTimeout(r, 1000));
            await dismissYouTubeStudioPopups();
            const checkYtLoaded = `
              (function() {
                return !!(
                  document.querySelector('#create-icon, button#create-button, [aria-label*="Criar" i], [aria-label*="Create" i], #upload-button, ytcp-uploads-dialog')
                );
              })()
            `;
            const ytlRes = (await cdpSend(ws, 'Runtime.evaluate', { expression: checkYtLoaded, returnByValue: true }).catch(() => null)) as any;
            if (ytlRes?.result?.value) break;
          }

          // 1. Abrir modal de upload no YouTube Studio com polling ativo e múltiplos seletores
          notify(plat, 'uploading', 42, 'Abrindo assistente de upload do YouTube Studio...');
          for (let openAttempt = 0; openAttempt < 20; openAttempt++) {
            const checkDialogScript = `
              (function() {
                var dlg = document.querySelector('ytcp-uploads-dialog, [role="dialog"][aria-label*="Carregar" i], [role="dialog"][aria-label*="Upload" i]');
                var inp = document.querySelector('ytcp-uploads-dialog input[type="file"], input[type="file"]');
                return !!(dlg || inp);
              })()
            `;
            const dlgRes = (await cdpSend(ws, 'Runtime.evaluate', { expression: checkDialogScript, returnByValue: true }).catch(() => null)) as any;
            if (dlgRes?.result?.value) break;

            const triggerUploadScript = `
              (function() {
                // Opção A: Botão central no painel quando não há vídeos ou na tela inicial
                var centerUpload = document.querySelector('#upload-button, ytcp-button#upload-button, button#upload-button, [aria-label*="Enviar vídeos" i], [aria-label*="Upload videos" i]');
                if (centerUpload) {
                  var cInner = centerUpload.querySelector('button, [role="button"]') || centerUpload;
                  cInner.click();
                  centerUpload.click();
                  return 'center_clicked';
                }

                // Opção B: Botão "+ Criar" no topo
                var createBtn = document.querySelector('#create-icon, button#create-button, ytcp-button#create-icon, [aria-label*="Criar" i], [aria-label*="Create" i]');
                if (createBtn) {
                  var crInner = createBtn.querySelector('button, [role="button"]') || createBtn;
                  crInner.click();
                  createBtn.click();

                  setTimeout(function() {
                    var items = document.querySelectorAll('ytcp-text-menu [role="menuitem"], tp-yt-paper-item, #text-item-0, [test-id="upload-action"]');
                    for (var i = 0; i < items.length; i++) {
                      var t = (items[i].innerText || '').toLowerCase();
                      if (t.includes('enviar') || t.includes('upload') || t.includes('vídeo') || t.includes('video')) {
                        items[i].click();
                        return;
                      }
                    }
                    if (items.length > 0) items[0].click();
                  }, 400);

                  return 'create_clicked';
                }

                return 'none_found';
              })()
            `;
            await cdpSend(ws, 'Runtime.evaluate', { expression: triggerUploadScript }).catch(() => {});
            await new Promise((r) => setTimeout(r, 1200));
          }

          // 2. Localizar seletor de arquivos no YouTube Studio com polling
          notify(plat, 'uploading', 50, 'Localizando seletor de upload do YouTube...');
          await cdpSend(ws, 'DOM.enable');
          let ytFileNodeId = 0;
          for (let attempt = 0; attempt < 35; attempt++) {
            await new Promise((r) => setTimeout(r, 1200));
            ytFileNodeId = await locateFileInputNodeId();
            if (ytFileNodeId) break;
          }

          if (!ytFileNodeId) {
            throw new Error('Não foi possível localizar o campo de upload no YouTube Studio. Verifique se o canal está ativo e conectado.');
          }

          // 3. Injetar arquivo no YouTube Shorts
          notify(plat, 'uploading', 60, 'Enviando arquivo de vídeo para o YouTube Shorts...');
          await cdpSend(ws, 'DOM.setFileInputFiles', {
            nodeId: ytFileNodeId,
            files: [actualUploadPath],
          });

          await dispatchEventsOnAllInputs();

          // 4. Aguardar campos de título e descrição montarem no formulário do YouTube
          notify(plat, 'captioning', 75, 'Aguardando processamento e preenchendo detalhes...');
          let ytDetailsReady = false;
          for (let waitSec = 0; waitSec < 45; waitSec++) {
            await new Promise((r) => setTimeout(r, 1500));
            const checkForm = `
              (function() {
                var titleBox = document.querySelector('#textbox[aria-label*="title" i], #title-textarea #textbox, ytcp-social-suggestions-textbox #textbox');
                return !!titleBox;
              })()
            `;
            const formRes = (await cdpSend(ws, 'Runtime.evaluate', { expression: checkForm, returnByValue: true }).catch(() => null)) as any;
            if (formRes?.result?.value) {
              ytDetailsReady = true;
              break;
            }
          }

          if (!ytDetailsReady) {
            throw new Error('Tempo limite excedido aguardando o YouTube carregar os detalhes do vídeo.');
          }

          // Garantir limite estrito de 100 caracteres no título do YouTube para nunca travar a validação
          const rawTitle = title || caption || 'Shorts';
          const ytTitleText = rawTitle.slice(0, 95).trim();

          // Preencher Título de forma nativa e compatível com WebComponent Polymer
          const fillYtTitleScript = `
            (function() {
              var tb = document.querySelector('#textbox[aria-label*="title" i], #title-textarea #textbox, ytcp-social-suggestions-textbox #textbox');
              if (!tb) return false;
              tb.focus();
              try {
                var sel = window.getSelection();
                var range = document.createRange();
                range.selectNodeContents(tb);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('delete', false, null);
                document.execCommand('insertText', false, ${JSON.stringify(ytTitleText)});
              } catch(_) {
                tb.innerText = ${JSON.stringify(ytTitleText)};
              }
              tb.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              tb.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              return true;
            })()
          `;
          await cdpSend(ws, 'Runtime.evaluate', { expression: fillYtTitleScript }).catch(() => {});
          await new Promise((r) => setTimeout(r, 800));

          // Preencher Descrição de forma nativa
          const fillYtDescScript = `
            (function() {
              var db = document.querySelector('#description-textarea #textbox, #textbox[aria-label*="description" i]');
              if (!db) return false;
              db.focus();
              try {
                var sel = window.getSelection();
                var range = document.createRange();
                range.selectNodeContents(db);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('delete', false, null);
                document.execCommand('insertText', false, ${JSON.stringify(fullText)});
              } catch(_) {
                db.innerText = ${JSON.stringify(fullText)};
              }
              db.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              db.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              return true;
            })()
          `;
          await cdpSend(ws, 'Runtime.evaluate', { expression: fillYtDescScript }).catch(() => {});
          await new Promise((r) => setTimeout(r, 800));

          // Selecionar "Não é conteúdo para crianças" (obrigatório para liberar o botão Avançar)
          const setYtNotKidsScript = `
            (function() {
              var notKids = document.querySelector(
                'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], ' +
                '[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], ' +
                'tp-yt-paper-radio-button:has([name*="NOT_MFK"]), ' +
                '#radioContainer:has([name*="NOT_MFK"])'
              );
              if (notKids) {
                try { notKids.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch(_) {}
                var rCont = notKids.querySelector('#radioContainer, [role="radio"]') || notKids;
                rCont.click();
                notKids.click();
                try {
                  notKids.checked = true;
                  notKids.setAttribute('checked', '');
                  notKids.dispatchEvent(new Event('change', { bubbles: true }));
                  notKids.dispatchEvent(new CustomEvent('iron-change', { bubbles: true }));
                } catch(_) {}
                return true;
              }
              return false;
            })()
          `;
          await cdpSend(ws, 'Runtime.evaluate', { expression: setYtNotKidsScript }).catch(() => {});
          await new Promise((r) => setTimeout(r, 1500));

          // 5. Avançar pelas etapas do assistente do YouTube até a etapa de Visibilidade
          notify(plat, 'publishing', 85, 'Avançando etapas de publicação do YouTube...');
          let reachedVisibility = false;

          for (let stepAttempt = 0; stepAttempt < 35; stepAttempt++) {
            const stepResult = (await cdpSend(ws, 'Runtime.evaluate', {
              expression: `
                (function() {
                  var doneBtn = document.querySelector('#done-button, ytcp-button#done-button, button#done-button');
                  var isDoneVisible = doneBtn && (doneBtn.offsetWidth > 0 || doneBtn.offsetHeight > 0) && window.getComputedStyle(doneBtn).display !== 'none';
                  var hasPrivacyRadios = !!document.querySelector('#privacy-radios, tp-yt-paper-radio-button[name="PUBLIC"], [name="PUBLIC"]');
                  
                  if (isDoneVisible || hasPrivacyRadios) {
                    return { isVisibility: true };
                  }

                  var next = document.querySelector('#next-button, ytcp-button#next-button, button#next-button');
                  if (next) {
                    var isDisabled = (
                      next.disabled ||
                      next.getAttribute('aria-disabled') === 'true' ||
                      next.getAttribute('disabled') !== null
                    );
                    if (!isDisabled) {
                      var inner = next.querySelector('button, [role="button"]') || next;
                      inner.click();
                      next.click();
                      return { isVisibility: false, clicked: true };
                    }
                    return { isVisibility: false, waitingEnabled: true };
                  }
                  return { isVisibility: false, clicked: false };
                })()
              `,
              returnByValue: true,
            })) as { result: { value: { isVisibility: boolean; clicked?: boolean; waitingEnabled?: boolean } } };

            if (stepResult?.result?.value?.isVisibility) {
              reachedVisibility = true;
              console.log('[YOUTUBE AUTO] Etapa de Visibilidade alcançada com sucesso!');
              break;
            }
            await new Promise((r) => setTimeout(r, 1500));
          }

          // 6. Selecionar "Público" na etapa de Visibilidade com verificação de ativação estrita
          notify(plat, 'publishing', 88, 'Configurando visibilidade pública no YouTube Shorts...');
          let pubSelected = false;

          for (let pRadioAttempt = 0; pRadioAttempt < 20; pRadioAttempt++) {
            const selectPubScript = `
              (function() {
                // 1. Tentar localizar o rádio público por name (case-insensitive), id ou atributo
                var pubRadio = document.querySelector(
                  'tp-yt-paper-radio-button[name="PUBLIC" i], ' +
                  'tp-yt-paper-radio-button[name="public" i], ' +
                  '[name="PUBLIC" i], ' +
                  '#privacy-radios tp-yt-paper-radio-button[name="PUBLIC" i], ' +
                  'tp-yt-paper-radio-button#public-radio-button, ' +
                  '#public-radio-button, ' +
                  'ytcp-radio-button[name="PUBLIC" i], ' +
                  '[test-id="PUBLIC" i]'
                );

                // 2. Se não encontrou por atributo, varrer os rádios dentro do container de visibilidade
                if (!pubRadio) {
                  var privacyGroup = document.querySelector('#privacy-radios, ytcp-video-visibility-select, ytcp-video-metadata-visibility, #first-container');
                  var container = privacyGroup || document;
                  var radios = Array.from(container.querySelectorAll('tp-yt-paper-radio-button, ytcp-radio-button, [role="radio"]'));

                  for (var r = 0; r < radios.length; r++) {
                    var el = radios[r];
                    var txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
                    // Deve ser especificamente o item Público (e não a descrição de agendamento ou do grupo)
                    if (
                      (txt.startsWith('público') || txt.startsWith('public') || txt.includes('todos podem ver') || txt.includes('everyone can watch')) &&
                      !txt.includes('defina o vídeo') && !txt.includes('selecione uma data')
                    ) {
                      pubRadio = el;
                      break;
                    }
                  }

                  // Fallback: no grupo de privacidade do YouTube Studio existem 3 opções na ordem (Privado, Não listado, Público)
                  if (!pubRadio && radios.length >= 3) {
                    pubRadio = radios[2];
                  }
                }

                // 3. Se ainda não encontrou, buscar por label ou texto direto
                if (!pubRadio) {
                  var allLabels = Array.from(document.querySelectorAll('label, span, div.title, #radioLabel, [role="radio"]'));
                  for (var l = 0; l < allLabels.length; l++) {
                    var item = allLabels[l];
                    if (!item.offsetParent && item.getBoundingClientRect().width === 0) continue;
                    var t = (item.innerText || item.textContent || '').trim().toLowerCase();
                    if (
                      (t === 'público' || t === 'public' || t.startsWith('público\\n') || t.startsWith('public\\n')) &&
                      !t.includes('defina o vídeo') && !t.includes('selecione uma data')
                    ) {
                      pubRadio = item.closest('tp-yt-paper-radio-button, ytcp-radio-button, [role="radio"]') || item;
                      break;
                    }
                  }
                }

                if (pubRadio) {
                  try { pubRadio.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch(_) {}

                  // Tentar clicar em todas as partes internas possíveis (suportando Shadow DOM)
                  var shadowCont = pubRadio.shadowRoot ? (pubRadio.shadowRoot.querySelector('#radioContainer') || pubRadio.shadowRoot.querySelector('#radioLabel')) : null;
                  var lightCont = pubRadio.querySelector('#radioContainer, #radioLabel, [role="radio"]') || pubRadio;
                  var clickTarget = shadowCont || lightCont;

                  try {
                    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                      try { clickTarget.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                      try { pubRadio.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                    });
                    if (typeof clickTarget.click === 'function') clickTarget.click();
                    if (typeof pubRadio.click === 'function') pubRadio.click();
                  } catch(_) {}

                  try {
                    pubRadio.checked = true;
                    pubRadio.setAttribute('checked', '');
                    pubRadio.setAttribute('aria-checked', 'true');
                    pubRadio.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    pubRadio.dispatchEvent(new CustomEvent('iron-change', { bubbles: true, composed: true }));
                  } catch(_) {}

                  var doneBtn = document.querySelector('#done-button, ytcp-button#done-button, button#done-button');
                  var isDoneReady = doneBtn && !doneBtn.disabled && doneBtn.getAttribute('aria-disabled') !== 'true' && !doneBtn.hasAttribute('disabled');
                  var isChecked = (
                    pubRadio.checked === true ||
                    pubRadio.getAttribute('aria-checked') === 'true' ||
                    pubRadio.hasAttribute('checked') ||
                    (pubRadio.classList && pubRadio.classList.contains('checked'))
                  );

                  var rect = (clickTarget || pubRadio).getBoundingClientRect();
                  return {
                    found: true,
                    activated: isDoneReady || isChecked,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                  };
                }
                return { found: false, activated: false };
              })()
            `;

            const pubRes = (await cdpSend(ws, 'Runtime.evaluate', { expression: selectPubScript, returnByValue: true }).catch(() => null)) as any;
            const pVal = pubRes?.result?.value;

            if (pVal?.found) {
              if (pVal.x > 0 && pVal.y > 0) {
                const px = Math.round(pVal.x);
                const py = Math.round(pVal.y);
                await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py }).catch(() => {});
                await new Promise((r) => setTimeout(r, 60));
                await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 }).catch(() => {});
                await new Promise((r) => setTimeout(r, 100));
                await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 }).catch(() => {});
              }

              if (pVal.activated) {
                pubSelected = true;
                console.log('[YOUTUBE AUTO] Rádio Público selecionado e validado com sucesso!');
                break;
              }
            }
            await new Promise((r) => setTimeout(r, 1200));
          }

          // Pausa humanizada de revisão antes de confirmar
          const reviewPauseYt = Math.floor(Math.random() * 2000) + 1500;
          notify(plat, 'publishing', 90, `Revisando publicação antes de confirmar (${Math.round(reviewPauseYt / 1000)}s)...`);
          await new Promise((r) => setTimeout(r, reviewPauseYt));

          // 7. Clicar em "Salvar" / "Publicar" / "Guardar" (#done-button) com despacho duplo (DOM + coordenadas físicas CDP)
          notify(plat, 'publishing', 92, 'Publicando no YouTube Shorts...');
          for (let pAttempt = 0; pAttempt < 8; pAttempt++) {
            const doneCoordsRes = (await cdpSend(ws, 'Runtime.evaluate', {
              expression: `
                (function() {
                  var doneBtn = document.querySelector(
                    '#done-button, ytcp-button#done-button, button#done-button, ' +
                    '[aria-label*="Publicar" i], [aria-label*="Publish" i], [aria-label*="Guardar" i], [aria-label*="Save" i]'
                  );
                  if (doneBtn) {
                    try { doneBtn.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch(_) {}
                    doneBtn.removeAttribute('disabled');
                    doneBtn.removeAttribute('aria-disabled');
                    var inner = doneBtn.querySelector('button, [role="button"], #button') || doneBtn;
                    inner.removeAttribute('disabled');
                    inner.removeAttribute('aria-disabled');
                    try {
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                        try { inner.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                        try { doneBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                      });
                      inner.click();
                      doneBtn.click();
                    } catch(_) {}
                    var rect = inner.getBoundingClientRect();
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, found: true };
                  }
                  return { found: false };
                })()
              `,
              returnByValue: true,
            })) as { result: { value: { x?: number; y?: number; found: boolean } } };

            if (doneCoordsRes?.result?.value?.found && doneCoordsRes.result.value.x! > 0) {
              const dx = Math.round(doneCoordsRes.result.value.x!);
              const dy = Math.round(doneCoordsRes.result.value.y!);
              await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: dx, y: dy }).catch(() => {});
              await new Promise((r) => setTimeout(r, 60));
              await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: dx, y: dy, button: 'left', clickCount: 1 }).catch(() => {});
              await new Promise((r) => setTimeout(r, 100));
              await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: dx, y: dy, button: 'left', clickCount: 1 }).catch(() => {});
            }

            await new Promise((r) => setTimeout(r, 1200));

            // Tratar possível diálogo de confirmação ("Publicar mesmo assim" / "Publish anyway")
            await cdpSend(ws, 'Runtime.evaluate', {
              expression: `
                (function() {
                  var confirmBtn = document.querySelector(
                    'ytcp-confirmation-dialog #confirm-button, ytcp-dialog #confirm-button, #confirm-button, ' +
                    'button[aria-label*="Publicar mesmo assim" i], button[aria-label*="Publish anyway" i]'
                  );
                  if (confirmBtn) {
                    var cInner = confirmBtn.querySelector('button, [role="button"]') || confirmBtn;
                    cInner.click();
                    confirmBtn.click();
                    return true;
                  }
                  return false;
                })()
              `,
            }).catch(() => {});

            await new Promise((r) => setTimeout(r, 1500));

            // Verificar se o diálogo de share já abriu
            const checkQuickShare = `!!document.querySelector('ytcp-video-share-dialog, ytcp-dialog[dialog-type="SHARE"]')`;
            const qsRes = (await cdpSend(ws, 'Runtime.evaluate', { expression: checkQuickShare, returnByValue: true }).catch(() => null)) as any;
            if (qsRes?.result?.value) {
              console.log('[YOUTUBE AUTO] Diálogo de compartilhamento detectado imediatamente após o clique!');
              break;
            }
          }

          // 8. Confirmação estrita e resiliente de publicação no YouTube Shorts
          notify(plat, 'publishing', 95, 'Aguardando confirmação definitiva do YouTube...');
          let ytConfirmed = false;
          let ytConfirmReason = '';

          for (let conf = 0; conf < 60; conf++) {
            await new Promise((r) => setTimeout(r, 1500));

            // A cada 4 iterações (~6s), se ainda houver botão de confirmação ou done visível, re-acionar
            if (conf > 0 && conf % 4 === 0) {
              try {
                await cdpSend(ws, 'Runtime.evaluate', {
                  expression: `
                    (function() {
                      var confirmBtn = document.querySelector(
                        'ytcp-confirmation-dialog #confirm-button, ytcp-dialog #confirm-button, #confirm-button, ' +
                        'button[aria-label*="Publicar mesmo assim" i], button[aria-label*="Publish anyway" i], ' +
                        'button[aria-label*="Guardar" i], button[aria-label*="Save" i]'
                      );
                      if (confirmBtn && !confirmBtn.disabled && confirmBtn.getAttribute('aria-disabled') !== 'true') {
                        var cInner = confirmBtn.querySelector('button, [role="button"]') || confirmBtn;
                        cInner.click();
                        confirmBtn.click();
                        return true;
                      }
                      var doneBtn = document.querySelector('#done-button, ytcp-button#done-button, button#done-button');
                      if (doneBtn && !doneBtn.disabled && doneBtn.getAttribute('aria-disabled') !== 'true') {
                        var dInner = doneBtn.querySelector('button, [role="button"]') || doneBtn;
                        dInner.click();
                        doneBtn.click();
                        return true;
                      }
                      return false;
                    })()
                  `,
                }, undefined, 5000);
              } catch (_) {}
            }

            const checkYtDone = `
              (function() {
                var bodyText = (document.body ? document.body.innerText : '').toLowerCase();

                // 1. Frases de sucesso explícitas no corpo (pt-PT, pt-BR, EN, ES)
                var successPhrases = [
                  'vídeo publicado', 'video publicado', 'video published', 'short publicado',
                  'o teu vídeo foi publicado', 'o seu vídeo foi publicado', 'o teu short foi publicado', 'o seu short foi publicado',
                  'o processamento do vídeo foi concluído', 'o processamento do short foi concluído',
                  'o processamento continuará em segundo plano', 'o processamento continuará',
                  'o envio continuará em segundo plano', 'o carregamento continuará em segundo plano',
                  'o upload continuará em segundo plano', 'o upload continuará',
                  'carregamento concluído', 'upload complete', 'envio concluído', 'envio terminado',
                  'o link do teu vídeo', 'link do seu vídeo', 'o link do vídeo',
                  'o link do teu short', 'link do seu short', 'link do short',
                  'o teu vídeo está agora visível', 'o seu vídeo já está disponível', 'o teu vídeo é agora público',
                  'o seu vídeo já é público', 'video link', 'short link'
                ];

                for (var s = 0; s < successPhrases.length; s++) {
                  if (bodyText.includes(successPhrases[s])) {
                    return { confirmed: true, reason: 'phrase:' + successPhrases[s] };
                  }
                }

                // 2. Diálogo oficial de compartilhamento (ytcp-video-share-dialog)
                var shareDialog = document.querySelector('ytcp-video-share-dialog, ytcp-dialog[dialog-type="SHARE"], ytcp-share-dialog');
                if (shareDialog) {
                  var sdStyle = window.getComputedStyle(shareDialog);
                  if (sdStyle.display !== 'none' && sdStyle.visibility !== 'hidden') {
                    return { confirmed: true, reason: 'share_dialog' };
                  }
                }

                // 3. Toasts ou Snackbars de confirmação
                var toasts = document.querySelectorAll('tp-yt-paper-toast, ytcp-toast, mwc-snackbar, #toast, .ytcp-toast');
                for (var t = 0; t < toasts.length; t++) {
                  var tText = (toasts[t].innerText || toasts[t].textContent || '').toLowerCase();
                  if (
                    tText.includes('publicado') || tText.includes('published') ||
                    tText.includes('concluído') || tText.includes('completo') ||
                    tText.includes('processamento') || tText.includes('segundo plano')
                  ) {
                    return { confirmed: true, reason: 'toast:' + tText.substring(0, 30) };
                  }
                }

                return { confirmed: false };
              })()
            `;

            try {
              const ytDoneRes = (await cdpSend(ws, 'Runtime.evaluate', {
                expression: checkYtDone,
                returnByValue: true
              }, undefined, 8000)) as { result?: { value?: { confirmed: boolean; reason?: string } } };

              const val = ytDoneRes?.result?.value;
              if (val?.confirmed) {
                ytConfirmed = true;
                ytConfirmReason = val.reason || 'detected';
                console.log('[YOUTUBE AUTO] Confirmação detectada com sucesso! Motivo:', ytConfirmReason);
                break;
              }
            } catch (_) {}

            if (conf % 5 === 0) {
              notify(plat, 'publishing', Math.min(95 + Math.floor(conf / 12), 98), `Aguardando confirmação definitiva do YouTube (${Math.round((conf + 1) * 1.5)}s)...`);
            }
          }

          if (!ytConfirmed) {
            throw new Error('Publicação enviada ao YouTube, mas a tela de confirmação não foi detectada a tempo. O vídeo NÃO foi marcado como publicado.');
          }

          // 9. Fechar apenas o diálogo de compartilhamento do YouTube (se visível) sem resetar a página
          notify(plat, 'publishing', 99, 'Finalizando publicação no YouTube Studio...');
          try {
            await cdpSend(ws, 'Runtime.evaluate', {
              expression: `
                (function() {
                  var closeBtns = document.querySelectorAll(
                    'ytcp-video-share-dialog #close-button, ' +
                    'ytcp-video-share-dialog button#close-button, ' +
                    'ytcp-video-share-dialog [aria-label*="Fechar" i], ' +
                    'ytcp-video-share-dialog [aria-label*="Close" i]'
                  );
                  for (var cb = 0; cb < closeBtns.length; cb++) {
                    try {
                      var cBtn = closeBtns[cb];
                      var innerBtn = cBtn.querySelector('button, [role="button"]') || cBtn;
                      innerBtn.click();
                      cBtn.click();
                    } catch(_) {}
                  }
                  return true;
                })()
              `,
            });
          } catch(_) {}

          await new Promise((r) => setTimeout(r, 1500));

          notify(plat, 'done', 100, 'Publicado e confirmado com sucesso no YouTube Shorts!');
          results[plat] = { success: true };

        } else if (plat === 'facebook') {
          const targetPageUrl = (pageUrl && pageUrl.trim()) ? pageUrl.trim() : (targetSession?.pageUrl || '');

          // Helper: Re-adquirir WebSocket ao vivo a partir do debugPort após qualquer navegação
          const reacquireWs = async (debugPort: number, timeoutMs = 15000): Promise<WebSocket | null> => {
            const httpMod = await import('http');
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 800));
              try {
                const tabs = await new Promise<Array<{ type: string; webSocketDebuggerUrl?: string; url: string }>>((resolve, reject) => {
                  const req = httpMod.default.get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
                    let data = '';
                    res.on('data', (c) => (data += c));
                    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
                  });
                  req.on('error', reject);
                });
                const pageTab = tabs.find((t) =>
                  (t.type === 'page' || t.type === 'app') && t.webSocketDebuggerUrl &&
                  !t.url.startsWith('chrome-') && !t.url.startsWith('about:')
                );
                if (pageTab?.webSocketDebuggerUrl) {
                  const freshWs = new WebSocket(pageTab.webSocketDebuggerUrl);
                  await new Promise<void>((resolve, reject) => {
                    freshWs.once('open', () => resolve());
                    freshWs.once('error', reject);
                  });
                  await cdpSend(freshWs, 'Runtime.enable', undefined, undefined, 4000).catch(() => {});
                  await cdpSend(freshWs, 'Page.enable', undefined, undefined, 4000).catch(() => {});
                  await cdpSend(freshWs, 'DOM.enable', undefined, undefined, 4000).catch(() => {});
                  return freshWs;
                }
              } catch {}
            }
            return null;
          };

          let activeWs = ws;
          const sessionDebugPort = targetSession?.debugPort || 0;

          // Helper: Avaliação segura e resiliente a quedas de WebSocket e congelamento do V8 do Facebook
          const safeEvaluate = async (
            expression: string,
            timeoutMs = 12000,
            returnByValue = true
          ): Promise<any> => {
            try {
              if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
                if (sessionDebugPort) {
                  const reacq = await reacquireWs(sessionDebugPort, 8000);
                  if (reacq) {
                    try { activeWs.close(); } catch {}
                    activeWs = reacq;
                    if (targetSession) targetSession.ws = activeWs;
                  }
                }
              }
              if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return null;
              return await cdpSend(activeWs, 'Runtime.evaluate', { expression, returnByValue }, undefined, timeoutMs);
            } catch (err: any) {
              console.warn('[FACEBOOK AUTO] safeEvaluate captura segura:', err?.message || err);
              if (sessionDebugPort && (err?.message?.includes('timeout') || err?.message?.includes('socket') || err?.message?.includes('closed') || err?.message?.includes('destroyed'))) {
                try {
                  const reacq = await reacquireWs(sessionDebugPort, 6000);
                  if (reacq) {
                    try { activeWs.close(); } catch {}
                    activeWs = reacq;
                    if (targetSession) targetSession.ws = activeWs;
                  }
                } catch (_) {}
              }
              return null;
            }
          };

          // Helper: Aguardar prontidão da página (document.readyState) sem travar
          const waitForPageReady = async (maxWaitMs = 15000): Promise<boolean> => {
            const deadline = Date.now() + maxWaitMs;
            while (Date.now() < deadline) {
              const res: any = await safeEvaluate('document.readyState', 4000, true);
              const state = res?.result?.value;
              if (state === 'complete' || state === 'interactive') {
                return true;
              }
              await new Promise((r) => setTimeout(r, 800));
            }
            return false;
          };

          // Helper: Descartar popups de cookies, notificações e boas-vindas do Facebook
          const dismissFacebookPopups = async (): Promise<void> => {
            const script = `
              (function() {
                try {
                  // 1. Banners de cookies da Meta
                  var cookieBtns = document.querySelectorAll('button, div[role="button"]');
                  for (var i = 0; i < cookieBtns.length; i++) {
                    var b = cookieBtns[i];
                    var t = (b.innerText || b.textContent || '').trim().toLowerCase();
                    if (
                      t === 'permitir todos os cookies' || t === 'aceitar todos os cookies' ||
                      t === 'permitir cookies' || t === 'aceitar cookies' ||
                      t === 'allow all cookies' || t === 'accept all' || t === 'allow essential and optional cookies'
                    ) {
                      b.click();
                      break;
                    }
                  }

                  // 2. Diálogos de notificações ("Agora não" / "Not now")
                  var notifBtns = document.querySelectorAll('div[role="dialog"] button, div[role="dialog"] div[role="button"]');
                  for (var j = 0; j < notifBtns.length; j++) {
                    var nb = notifBtns[j];
                    var nt = (nb.innerText || nb.textContent || '').trim().toLowerCase();
                    if (nt === 'agora não' || nt === 'agora nao' || nt === 'not now' || nt === 'talvez mais tarde' || nt === 'cancelar') {
                      nb.click();
                    }
                  }
                } catch(_) {}
              })()
            `;
            await safeEvaluate(script, 6000, false);
          };

          // Ativar bypass do Shield durante TODA a publicação automática no Facebook
          // O bypass impede que o Shield oculte ou bloqueie botões necessários (Switch, Next, Publish)
          if (targetSession) targetSession.isPublishing = true;
          console.log('[FACEBOOK AUTO] Ativando bypass do Shield para publicação automática...');
          await safeEvaluate('window.__AGENT_AUTO_PUBLISHING__ = true;', 4000, false);

          // Verificar se o perfil já foi alternado para a Página em sessão anterior (flag persistente em disco)
          const fbSwitchedFlag = targetSession?.profileDir ? path.join(targetSession.profileDir, 'fb_page_switched.flag') : '';
          const hasAlreadySwitched = Boolean(fbSwitchedFlag && fsSync.existsSync(fbSwitchedFlag));

          if (hasAlreadySwitched) {
            console.log('[FACEBOOK AUTO] Perfil já alternado para a Página anteriormente (fb_page_switched.flag presente). Pulando etapa de alternância e indo direto para Reels!');
            notify(plat, 'uploading', 35, 'Identidade da Página já configurada. Acessando estúdio de Reels...');
          } else if (targetPageUrl) {
            notify(plat, 'uploading', 25, 'Acessando Página do Facebook para ativar voz de Administrador...');
            try {
              await safeEvaluate(`window.location.href = ${JSON.stringify(targetPageUrl)};`, 6000, false);
              await new Promise((r) => setTimeout(r, 4000));

              // Re-adquirir WS após navegação
              if (sessionDebugPort) {
                const reacq = await reacquireWs(sessionDebugPort, 12000);
                if (reacq) {
                  try { activeWs.close(); } catch {}
                  activeWs = reacq;
                  if (targetSession) targetSession.ws = activeWs;
                }
              }

              await waitForPageReady(12000);
              await dismissFacebookPopups();

              // Temporariamente desativar bloqueios do Shield para permitir alternância de Página
              console.log('[FACEBOOK AUTO] Ativando bypass temporário do Shield para alternância de Página...');
              await safeEvaluate(`
                (function() {
                  window.__AGENT_AUTO_PUBLISHING__ = true;
                  // Remover CSS de bloqueio que oculta botões de alternância
                  var css = document.getElementById('agent-post-login-css');
                  if (css) css.remove();
                  // Restaurar todos os elementos bloqueados pelo agente
                  var blocked = document.querySelectorAll('[data-blocked-by-agent="true"]');
                  for (var i = 0; i < blocked.length; i++) {
                    blocked[i].style.removeProperty('display');
                    blocked[i].style.removeProperty('visibility');
                    blocked[i].style.removeProperty('opacity');
                    blocked[i].style.removeProperty('pointer-events');
                    blocked[i].removeAttribute('data-blocked-by-agent');
                  }
                })()
              `, 6000, false);

              // 1. Verificar primeiro se já está na voz de Administrador da Página
              let switchClicked = false;
              let pageVoiceConfirmed = false;

              const checkVoiceRes = await safeEvaluate(`
                (function() {
                  var allInteractive = Array.from(document.querySelectorAll('a, button, div[role="button"], div[role="tab"]'));
                  for (var i = 0; i < allInteractive.length; i++) {
                    var el = allInteractive[i];
                    var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    if (
                      txt === 'gerir' || txt === 'manage' ||
                      txt === 'painel profissional' || txt === 'professional dashboard' ||
                      txt === 'editar página' || txt === 'edit page' ||
                      aria === 'gerir' || aria === 'manage' ||
                      aria.includes('painel profissional') || aria.includes('professional dashboard')
                    ) {
                      return { isAdmin: true, text: txt || aria };
                    }
                  }
                  return { isAdmin: false };
                })()
              `, 6000, true);

              if (checkVoiceRes?.result?.value?.isAdmin) {
                console.log('[FACEBOOK AUTO] Voz de Administrador já ativa na Página:', checkVoiceRes.result.value.text);
                pageVoiceConfirmed = true;
              } else {
                // Polling para botão "Alternar" / "Switch into" na Página
                notify(plat, 'uploading', 32, 'Verificando identidade e ativando voz da Página...');
                for (let sAttempt = 0; sAttempt < 6; sAttempt++) {
                  await new Promise((r) => setTimeout(r, 1200));
                  try {
                    const switchRes = await safeEvaluate(`
                      (function() {
                        var allInteractive = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], a[href*="switch"]'));
                        for (var i = 0; i < allInteractive.length; i++) {
                          var el = allInteractive[i];
                          if (!el.offsetParent && el.getBoundingClientRect().width === 0) continue;
                          var txt = (el.innerText || el.textContent || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                          var aria = (el.getAttribute('aria-label') || '').toLowerCase().replace(/\\s+/g, ' ');
                          
                          var isSwitchBtn = (
                            txt === 'alternar' || txt === 'switch' || txt === 'trocar' || txt === 'mudar' ||
                            txt === 'mudar agora' || txt === 'alternar agora' || txt === 'switch now' ||
                            txt === 'trocar agora' || txt === 'troque agora' ||
                            txt.startsWith('switch into') || txt.startsWith('switch to') || txt.startsWith('switch now') ||
                            txt.includes('switch into') || txt.includes('switch to') || txt.includes('alternar para') ||
                            txt.includes('mudar para') || txt.includes('trocar para') || txt.includes('use page') ||
                            aria === 'alternar' || aria === 'switch' || aria.includes('switch into') ||
                            aria.includes('switch to') || aria.includes('switch profile') || aria.includes('alternar') ||
                            aria.includes('mudar para') || aria.includes('troque para')
                          );

                          if (isSwitchBtn) {
                            try { el.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch(_) {}
                            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                              try { el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                            });
                            try { el.click(); } catch(_) {}
                            var r = el.getBoundingClientRect();
                            return { switched: true, text: txt || aria, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                          }
                        }
                        return { switched: false };
                      })()
                    `, 8000, true);

                    const sVal = switchRes?.result?.value;
                    if (sVal?.switched) {
                      console.log('[FACEBOOK AUTO] Clique inicial de alternância detectado:', sVal.text);
                      switchClicked = true;

                      if (sVal.x && sVal.y && sVal.x > 0 && sVal.y > 0) {
                        const sx = Math.round(sVal.x);
                        const sy = Math.round(sVal.y);
                        await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy }, undefined, 3000).catch(() => {});
                        await new Promise((r) => setTimeout(r, 60));
                        await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 }, undefined, 3000).catch(() => {});
                        await new Promise((r) => setTimeout(r, 100));
                        await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 }, undefined, 3000).catch(() => {});
                      }

                      await new Promise((r) => setTimeout(r, 2000));

                      // Tratar possível diálogo modal de confirmação ("Trocar de perfil" / "Switch into...")
                      const confirmRes = await safeEvaluate(`
                        (function() {
                          var dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]'));
                          for (var d = 0; d < dialogs.length; d++) {
                            var diag = dialogs[d];
                            var diagText = (diag.innerText || diag.textContent || '').toLowerCase();
                            var isSwitchDialog = (
                              diagText.includes('trocar de perfil') || diagText.includes('troque para') ||
                              diagText.includes('mudar para') || diagText.includes('alternar para') ||
                              diagText.includes('switch to') || diagText.includes('switch into') ||
                              diagText.includes('switch profile') || diagText.includes('alternar') ||
                              diagText.includes('switch')
                            );
                            if (isSwitchDialog) {
                              var btns = Array.from(diag.querySelectorAll('button, div[role="button"]'));
                              for (var b = 0; b < btns.length; b++) {
                                var btn = btns[b];
                                var txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                                var aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                                var isConfirm = (
                                  txt === 'alternar' || txt === 'switch' || txt === 'mudar' || txt === 'confirmar' ||
                                  txt === 'confirm' || txt === 'switch profile' || txt === 'continue' || txt === 'continuar' ||
                                  aria.includes('switch') || aria.includes('alternar') || aria.includes('confirm')
                                );
                                if (isConfirm) {
                                  try { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch(_) {}
                                  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                                    try { btn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                                  });
                                  try { btn.click(); } catch(_) {}
                                  var r = btn.getBoundingClientRect();
                                  return { confirmed: true, text: txt, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                                }
                              }
                            }
                          }
                          return { confirmed: false };
                        })()
                      `, 8000, true);

                      const cVal = confirmRes?.result?.value;
                      if (cVal?.confirmed && cVal.x && cVal.y && cVal.x > 0 && cVal.y > 0) {
                        const cx = Math.round(cVal.x);
                        const cy = Math.round(cVal.y);
                        await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy }, undefined, 3000).catch(() => {});
                        await new Promise((r) => setTimeout(r, 60));
                        await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 }, undefined, 3000).catch(() => {});
                        await new Promise((r) => setTimeout(r, 100));
                        await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 }, undefined, 3000).catch(() => {});
                        console.log('[FACEBOOK AUTO] Confirmação no diálogo acionada:', cVal.text);
                      }

                      notify(plat, 'uploading', 36, 'Identidade da Página confirmada! Aguardando transição...');
                      await new Promise((r) => setTimeout(r, 5000));

                      if (sessionDebugPort) {
                        const reacqAfterSwitch = await reacquireWs(sessionDebugPort, 15000);
                        if (reacqAfterSwitch) {
                          try { activeWs.close(); } catch {}
                          activeWs = reacqAfterSwitch;
                          if (targetSession) targetSession.ws = activeWs;
                        }
                      }
                      await waitForPageReady(12000);
                      pageVoiceConfirmed = true;
                      break;
                    }
                  } catch (sErr) {
                    console.warn('[FACEBOOK AUTO] Erro durante verificação de alternância:', sErr);
                  }
                }
              }

              // Gravar a flag persistente para que nas próximas publicações não precise alternar nunca mais!
              if (pageVoiceConfirmed || switchClicked) {
                if (fbSwitchedFlag) {
                  try {
                    fsSync.writeFileSync(fbSwitchedFlag, new Date().toISOString());
                    console.log('[FACEBOOK AUTO] Flag fb_page_switched.flag gravada com sucesso! Próximas publicações irão direto para os Reels.');
                  } catch (flagErr) {
                    console.warn('[FACEBOOK AUTO] Aviso ao gravar flag de alternância:', flagErr);
                  }
                }
                notify(plat, 'uploading', 38, 'Voz da Página configurada e salva com sucesso!');
              } else {
                console.log('[FACEBOOK AUTO] Nenhum botão de alternância encontrado na Página — prosseguindo para Reels...');
                notify(plat, 'uploading', 36, 'Voz de Administrador da Página ativa!');
              }
            } catch (switchErr) {
              console.warn('[FACEBOOK AUTO] Aviso ao alternar para Página:', switchErr);
            }
          }

          notify(plat, 'uploading', 40, 'Acessando estúdio de Reels como Administrador da Página...');

          // Navegar para /reels/create/ usando o mesmo subdomínio da Página atribuída
          const fbDomain = (targetPageUrl && targetPageUrl.includes('web.facebook.com')) ? 'web.facebook.com' : 'www.facebook.com';

          // Verificar se já estamos em /reels/create/; se não, navegar e confirmar
          for (let rAttempt = 0; rAttempt < 5; rAttempt++) {
            const checkUrlRes = await safeEvaluate('window.location.href', 4000, true);
            const currentUrl = (checkUrlRes?.result?.value || '').toLowerCase();
            if (currentUrl.includes('/reels/create')) {
              break;
            }
            console.log(`[FACEBOOK AUTO] URL atual (${currentUrl}) não é /reels/create/. Navegando...`);
            await safeEvaluate(`window.location.href = "https://${fbDomain}/reels/create/";`, 8000, false);
            await new Promise((r) => setTimeout(r, 3000));
            if (sessionDebugPort) {
              const reacqReels = await reacquireWs(sessionDebugPort, 12000);
              if (reacqReels) {
                try { activeWs.close(); } catch {}
                activeWs = reacqReels;
                if (targetSession) targetSession.ws = activeWs;
              }
            }
            await waitForPageReady(12000);
          }

          // Aguardar a página do Reels carregar de verdade
          await waitForPageReady(18000);

          // IMPORTANTE: Re-ativar bypass ANTES de injetar o Shield para que ele não bloqueie nada no wizard
          await safeEvaluate('window.__AGENT_AUTO_PUBLISHING__ = true;', 4000, false);
          await injectSecurityShieldToSession(activeWs, { isSignup: false, pageUrl: targetPageUrl }).catch(() => {});

          // Garantir que o bypass persiste: remover CSS e desbloquear elementos marcados pelo Shield
          await safeEvaluate(`
            (function() {
              window.__AGENT_AUTO_PUBLISHING__ = true;
              var css = document.getElementById('agent-post-login-css');
              if (css) css.remove();
              var blocked = document.querySelectorAll('[data-blocked-by-agent="true"]');
              for (var i = 0; i < blocked.length; i++) {
                blocked[i].style.removeProperty('display');
                blocked[i].style.removeProperty('visibility');
                blocked[i].style.removeProperty('opacity');
                blocked[i].style.removeProperty('pointer-events');
                blocked[i].removeAttribute('data-blocked-by-agent');
              }
            })()
          `, 6000, false);

          await dismissFacebookPopups();

          // Wrappers locais seguros que usam activeWs atualizado
          const fbLocateFileInput = async (): Promise<number> => {
            try {
              const evalRes: any = await safeEvaluate(`
                (function() {
                  if (!window.location.href.toLowerCase().includes('/reels/create')) {
                    return null;
                  }
                  function searchDoc(doc) {
                    if (!doc) return null;
                    var el = doc.querySelector('input[type="file"][accept*="video"], input[type="file"][accept*="mp4"], input[type="file"]');
                    if (el) return el;
                    var all = doc.querySelectorAll('*');
                    for (var i = 0; i < all.length; i++) {
                      if (all[i].shadowRoot) { var f = searchDoc(all[i].shadowRoot); if (f) return f; }
                    }
                    return null;
                  }
                  return searchDoc(document);
                })()
              `, 8000, false);
              if (evalRes?.result?.objectId) {
                const nodeRes = (await cdpSend(activeWs, 'DOM.requestNode', { objectId: evalRes.result.objectId }, undefined, 6000).catch(() => null)) as { nodeId?: number } | null;
                if (nodeRes?.nodeId) return nodeRes.nodeId;
              }
            } catch {}
            try {
              const docRes = (await cdpSend(activeWs, 'DOM.getDocument', { depth: -1, pierce: true }, undefined, 6000).catch(() => null)) as { root?: { nodeId: number } } | null;
              if (docRes?.root?.nodeId) {
                for (const sel of ['input[type="file"]', 'input[accept*="video"]', 'input[accept*="mp4"]']) {
                  const qRes = (await cdpSend(activeWs, 'DOM.querySelector', { nodeId: docRes.root.nodeId, selector: sel }, undefined, 4000).catch(() => null)) as { nodeId?: number } | null;
                  if (qRes?.nodeId) return qRes.nodeId;
                }
              }
            } catch {}
            return 0;
          };

          const fbDispatchEvents = async () => {
            await safeEvaluate(`
              (function() {
                var inputs = document.querySelectorAll('input[type="file"], input[accept*="video"]');
                inputs.forEach(function(i) {
                  i.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                  i.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                });
              })()
            `, 6000, false);
          };

          // 2. Polling para encontrar input[type="file"] no Facebook Reels
          notify(plat, 'uploading', 45, 'Localizando seletor de Reels do Facebook...');
          await cdpSend(activeWs, 'DOM.enable', undefined, undefined, 5000).catch(() => {});
          let fbFileNodeId = 0;
          for (let attempt = 0; attempt < 35; attempt++) {
            await new Promise((r) => setTimeout(r, 1200));
            await dismissFacebookPopups();
            fbFileNodeId = await fbLocateFileInput();
            if (fbFileNodeId) break;
          }

          if (!fbFileNodeId) {
            throw new Error('Não foi possível localizar o campo de upload de Reels no Facebook. Verifique se a conta está logada.');
          }

          // 3. Injetar arquivo no Facebook
          notify(plat, 'uploading', 60, 'Enviando arquivo de vídeo para o Facebook Reels...');
          await cdpSend(activeWs, 'DOM.setFileInputFiles', {
            nodeId: fbFileNodeId,
            files: [actualUploadPath],
          }, undefined, 15000);

          await fbDispatchEvents();

          // 4. Máquina de Estados Inteligente para o Assistente de Reels (Suporte a pt-PT, pt-BR e EN)
          notify(plat, 'captioning', 70, 'Aguardando processamento do vídeo no Facebook Reels...');

          let pubClicked = false;
          let pubCoords: { x: number; y: number } | null = null;
          let descFilled = false;
          let stepCount = 0;

          for (let wizardCycle = 0; wizardCycle < 100; wizardCycle++) {
            await new Promise((r) => setTimeout(r, 1500));
            if (wizardCycle % 5 === 0) await dismissFacebookPopups();

            const cycleRes = await safeEvaluate(`
              (function() {
                var nextTerms = ['avançar', 'avancar', 'seguinte', 'próximo', 'proximo', 'continuar', 'next', 'siguiente'];
                var pubTerms = [
                  'publicar', 'publicar agora', 'partilhar', 'partilhar agora',
                  'publish', 'publish now', 'share now', 'postar', 'post', 'post now',
                  'share', 'partilhar reel', 'publicar reel', 'share reel', 'post reel'
                ];
                var badTerms = [
                  'voltar', 'anterior', 'back', 'atrás', 'atras', 'cancelar', 'cancel',
                  'substitua', 'substituir', 'replace', 'fechar', 'close',
                  'reproduzir', 'pausar', 'play', 'pause', 'som', 'silenciar', 'mute',
                  'ajuda', 'help', 'eliminar', 'delete', 'follow', 'seguir', 'like', 'react', 'comment',
                  'previous', 'next card', 'previous card', 'next items', 'previous items',
                  'search', 'pesquisar', 'trim video', 'closed captions', 'audio description', 'text transcript', 'music',
                  'schedule', 'schedule for later', 'agendar', 'agendar para depois', 'programar', 'scheduling',
                  'audience', 'audiência', 'audiencia', 'remixing', 'remix', 'playlist', 'boost post',
                  'share to groups', 'share to story', 'partilhar em grupos', 'partilhar no story',
                  'draft', 'rascunho', 'save as draft', 'guardar como rascunho', 'salvar como rascunho'
                ];

                function isIgnored(t) {
                  if (!t) return false;
                  for (var b = 0; b < badTerms.length; b++) {
                    if (t === badTerms[b] || t.includes(badTerms[b])) return true;
                  }
                  return false;
                }

                function isNextMatch(t, a) {
                  if (isIgnored(t) || isIgnored(a)) return false;
                  for (var i = 0; i < nextTerms.length; i++) {
                    var term = nextTerms[i];
                    if (t === term || a === term || t.startsWith(term + ' ') || a.startsWith(term + ' ') || t.startsWith(term + '\\n')) return true;
                  }
                  return false;
                }

                function isPubMatch(t, a) {
                  if (isIgnored(t) || isIgnored(a)) return false;
                  for (var i = 0; i < pubTerms.length; i++) {
                    var term = pubTerms[i];
                    if (t === term || a === term || t === term + ' reel' || a === term + ' reel' || t.startsWith(term + '\\n') || a.startsWith(term + '\\n')) return true;
                  }
                  return false;
                }

                function isElDisabled(el) {
                  if (el.disabled) return true;
                  if (el.getAttribute('aria-disabled') === 'true') return true;
                  var cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
                  if (cls.includes('disabled') || cls.includes('is-disabled')) return true;
                  var cs = window.getComputedStyle(el);
                  if (cs && (cs.pointerEvents === 'none' || cs.opacity === '0' || cs.opacity === '0.4' || cs.opacity === '0.5')) return true;
                  return false;
                }

                // 1. Localizar campo de descrição / legenda (em qualquer container visível)
                var descSelectors = [
                  'div[contenteditable="true"][role="textbox"]',
                  'div[contenteditable="true"][data-lexical-editor="true"]',
                  'div[aria-label*="describe" i]',
                  'div[aria-label*="description" i]',
                  'div[aria-label*="descrição" i]',
                  'div[aria-label*="legenda" i]',
                  'div[aria-label*="escreva" i]',
                  'div[aria-label*="write" i]',
                  'textarea[placeholder*="reel" i]',
                  'textarea[placeholder*="descrição" i]',
                  'textarea[placeholder*="describe" i]',
                  'div[contenteditable="true"]'
                ];
                var descBox = null;
                for (var s = 0; s < descSelectors.length; s++) {
                  var founds = document.querySelectorAll(descSelectors[s]);
                  for (var f = 0; f < founds.length; f++) {
                    var el = founds[f];
                    if (el.offsetParent !== null || el.getBoundingClientRect().width > 0) {
                      descBox = el;
                      break;
                    }
                  }
                  if (descBox) break;
                }

                // 2. Varrer botões em toda a página (suportando tanto div[role="main"] quanto modais)
                var allButtons = Array.from(document.querySelectorAll('div[role="button"], button, a[role="button"]')).filter(function(b) {
                  return b.offsetParent !== null || b.getBoundingClientRect().width > 0;
                });

                var nextBtn = null;
                var pubBtn = null;

                for (var i = 0; i < allButtons.length; i++) {
                  var b = allButtons[i];
                  if (b.getAttribute('role') === 'radio' || b.getAttribute('role') === 'switch' || b.hasAttribute('aria-checked')) continue;
                  var bt = (b.innerText || b.textContent || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                  var ba = (b.getAttribute('aria-label') || '').trim().toLowerCase().replace(/\\s+/g, ' ');

                  if (!nextBtn && isNextMatch(bt, ba)) {
                    nextBtn = b;
                  }

                  if (!pubBtn && isPubMatch(bt, ba)) {
                    // Evitar contadores numéricos do feed (ex: "4 share", "1.5K share")
                    if (!/^\\d/.test(bt)) {
                      pubBtn = b;
                    }
                  }
                }

                return {
                  hasDesc: !!descBox,
                  hasNext: !!nextBtn,
                  nextDisabled: nextBtn ? isElDisabled(nextBtn) : null,
                  nextText: nextBtn ? ((nextBtn.innerText || nextBtn.getAttribute('aria-label') || '').trim()) : '',
                  hasPub: !!pubBtn,
                  pubDisabled: pubBtn ? isElDisabled(pubBtn) : null,
                  pubText: pubBtn ? ((pubBtn.innerText || pubBtn.getAttribute('aria-label') || '').trim()) : ''
                };
              })()
            `, 12000, true);

            const state = cycleRes?.result?.value;
            if (!state) {
              console.log(`[FACEBOOK AUTO] Ciclo ${wizardCycle}: aguardando resposta da interface...`);
              continue;
            }

            console.log(`[FACEBOOK AUTO] Ciclo ${wizardCycle}: desc=${state.hasDesc}, next=${state.hasNext}(${state.nextText}), pub=${state.hasPub}(${state.pubText})`);

            // Se a descrição já foi preenchida ou se o botão de publicação está presente,
            // garantir que está selecionado "Publicar agora" (e NÃO "Agendar" com calendário/hora adiantada)
            if (descFilled || state?.hasPub) {
              // PASSO 1: Fechar modal de agendamento se estiver aberto (dialog com "Scheduling options" / "Opções de agendamento")
              const modalDismissed = await safeEvaluate(`
                (function() {
                  // Procurar dialogs/modais overlay que contenham texto de agendamento
                  var dialogs = Array.from(document.querySelectorAll(
                    'div[role="dialog"], div[aria-modal="true"], div[class*="overlay" i], div[class*="modal" i]'
                  )).filter(function(d) {
                    if (!d.offsetParent && d.getBoundingClientRect().width === 0) return false;
                    var txt = (d.innerText || d.textContent || '').toLowerCase();
                    return (
                      txt.includes('scheduling options') || txt.includes('opções de agendamento') ||
                      txt.includes('schedule for later') || txt.includes('agendar para depois') ||
                      (txt.includes('schedule') && txt.includes('date') && txt.includes('time')) ||
                      (txt.includes('agendar') && txt.includes('data') && txt.includes('hora'))
                    );
                  });

                  if (dialogs.length === 0) return { found: false };

                  // Encontrar o botão X (fechar) dentro do modal
                  for (var d = 0; d < dialogs.length; d++) {
                    var dialog = dialogs[d];
                    // Tentar aria-label="Close" ou aria-label="Fechar"
                    var closeBtn = dialog.querySelector(
                      'div[aria-label="Close"], div[aria-label="Fechar"], ' +
                      'button[aria-label="Close"], button[aria-label="Fechar"], ' +
                      'a[aria-label="Close"], a[aria-label="Fechar"], ' +
                      'div[role="button"][aria-label="Close"], div[role="button"][aria-label="Fechar"]'
                    );
                    if (!closeBtn) {
                      // Tentar SVG com path de X dentro de um role=button
                      var btns = Array.from(dialog.querySelectorAll('div[role="button"], button'));
                      for (var b = 0; b < btns.length; b++) {
                        var btn = btns[b];
                        var svg = btn.querySelector('svg');
                        var ariaL = (btn.getAttribute('aria-label') || '').toLowerCase();
                        var btnText = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                        // É o X se: tem SVG sem texto visível, ou aria-label é close/fechar, ou texto é ×/X
                        if (svg && (!btnText || btnText === '×' || btnText === 'x')) { closeBtn = btn; break; }
                        if (ariaL === 'close' || ariaL === 'fechar') { closeBtn = btn; break; }
                      }
                    }
                    if (closeBtn) {
                      try { closeBtn.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch(_) {}
                      try { closeBtn.focus(); } catch(_) {}
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                        try { closeBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                      });
                      try { closeBtn.click(); } catch(_) {}
                      return { found: true, closed: true };
                    }
                  }
                  // Se não encontrou o X, clicar em Escape para fechar
                  try {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                  } catch(_) {}
                  return { found: true, closed: false, triedEsc: true };
                })()
              `, 6000, true);

              const mVal = modalDismissed?.result?.value;
              if (mVal?.found) {
                console.log(`[FACEBOOK AUTO] Modal de agendamento detectado e ${mVal.closed ? 'fechado' : 'tentado fechar'}`);
                await new Promise((r) => setTimeout(r, 1500));
                continue; // voltar ao ciclo para re-avaliar a interface sem o modal
              }

              // PASSO 2: Se não há modal overlay, verificar radio/switch de agendamento inline
              await safeEvaluate(`
                (function() {
                  // Verificar se campos de data/hora de agendamento estão visíveis na tela
                  var dateInputs = Array.from(document.querySelectorAll(
                    'input[type="date"], input[type="time"], input[type="datetime-local"], ' +
                    'input[aria-label*="data" i], input[aria-label*="date" i], ' +
                    'input[aria-label*="hora" i], input[aria-label*="time" i]'
                  )).filter(function(i) {
                    return i.offsetParent !== null && i.getBoundingClientRect().width > 0;
                  });

                  // Verificar se há opção/switch de agendamento marcado como ativo
                  var scheduleActive = Array.from(document.querySelectorAll(
                    'div[role="radio"], div[role="switch"], input[type="radio"], input[type="checkbox"]'
                  )).find(function(el) {
                    var isChecked = el.getAttribute('aria-checked') === 'true' || el.checked === true;
                    if (!isChecked) return false;
                    var t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
                    return t.includes('agendar') || t.includes('schedule') || t.includes('programar');
                  });

                  if (dateInputs.length > 0 || scheduleActive) {
                    console.log('[FACEBOOK AUTO] Agendamento ativo detectado. Alternando para "Publicar agora"...');

                    // Se for switch ligado, desligar
                    if (scheduleActive && (scheduleActive.getAttribute('role') === 'switch' || scheduleActive.type === 'checkbox')) {
                      try { scheduleActive.click(); return { changed: true }; } catch(_) {}
                    }

                    // Se for rádio ou opção, procurar o botão/rádio de "Publicar agora" / "Partilhar agora"
                    var nowOptions = Array.from(document.querySelectorAll(
                      'div[role="radio"], input[type="radio"], label, div[role="button"], span'
                    )).filter(function(el) {
                      if (!el.offsetParent && el.getBoundingClientRect().width === 0) return false;
                      var t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
                      return (
                        t === 'publicar agora' || t === 'partilhar agora' ||
                        t === 'publish now' || t === 'share now' ||
                        t.startsWith('publicar agora') || t.startsWith('partilhar agora') ||
                        t.startsWith('publish now') || t.startsWith('share now')
                      ) && !t.includes('agendar') && !t.includes('schedule');
                    });

                    for (var i = 0; i < nowOptions.length; i++) {
                      try {
                        nowOptions[i].click();
                        return { changed: true };
                      } catch(_) {}
                    }
                  }
                  return { changed: false };
                })()
              `, 6000, false);
            }

            // A. Se o campo de descrição for visível e ainda não preenchido:
            if (state?.hasDesc && !descFilled) {
              notify(plat, 'captioning', 84, 'Preenchendo descrição e hashtags do Reel...');
              
              const fillFbDescScript = `
                (function(text) {
                  var descSelectors = [
                    'div[contenteditable="true"][role="textbox"]',
                    'div[contenteditable="true"][data-lexical-editor="true"]',
                    'div[aria-label*="describe" i]',
                    'div[aria-label*="description" i]',
                    'div[aria-label*="descrição" i]',
                    'div[aria-label*="legenda" i]',
                    'div[aria-label*="escreva" i]',
                    'div[aria-label*="write" i]',
                    'textarea[placeholder*="reel" i]',
                    'textarea[placeholder*="descrição" i]',
                    'textarea[placeholder*="describe" i]',
                    'div[contenteditable="true"]'
                  ];
                  var descBox = null;
                  for (var s = 0; s < descSelectors.length; s++) {
                    var founds = document.querySelectorAll(descSelectors[s]);
                    for (var f = 0; f < founds.length; f++) {
                      var el = founds[f];
                      if (el.offsetParent !== null || el.getBoundingClientRect().width > 0) {
                        descBox = el;
                        break;
                      }
                    }
                    if (descBox) break;
                  }
                  if (!descBox) return false;
                  try { descBox.focus(); } catch(_) {}

                  if (descBox.isContentEditable) {
                    try {
                      var sel = window.getSelection();
                      var range = document.createRange();
                      range.selectNodeContents(descBox);
                      sel.removeAllRanges();
                      sel.addRange(range);
                      document.execCommand('delete', false, null);
                      document.execCommand('insertText', false, text);
                    } catch(_) {
                      descBox.innerText = text;
                    }
                  } else {
                    descBox.value = text;
                  }
                  descBox.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                  descBox.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                  return true;
                })(${JSON.stringify(fullText)})
              `;

              const fillRes: any = await safeEvaluate(fillFbDescScript, 10000, true);

              if (!fillRes?.result?.value) {
                try {
                  await typeHumanCdp(fullText, activeWs);
                } catch (_) {
                  await cdpSend(activeWs, 'Input.insertText', { text: fullText }, undefined, 5000).catch(() => {});
                }
              }

              descFilled = true;
              console.log('[FACEBOOK AUTO] Descrição e hashtags preenchidas com sucesso!');
              await new Promise((r) => setTimeout(r, 1500));
              continue;
            }

            // B. Se o botão "Avançar" / "Seguinte" / "Next" estiver presente:
            if (state?.hasNext && (!state?.hasDesc || descFilled)) {
              if (state.nextDisabled === false) {
                stepCount++;
                notify(plat, 'captioning', 74 + Math.min(stepCount * 5, 12), `Avançando etapa (${state.nextText || 'Avançar'})...`);
                
                const clickNextRes = await safeEvaluate(`
                  (function() {
                    var nextTerms = ['avançar', 'avancar', 'seguinte', 'próximo', 'proximo', 'continuar', 'next', 'siguiente'];
                    var badTerms = [
                      'voltar', 'anterior', 'back', 'atrás', 'atras', 'cancelar', 'cancel',
                      'substitua', 'substituir', 'fechar', 'close', 'next card', 'previous card', 'next items', 'previous items',
                      'trim video', 'closed captions', 'audio description', 'text transcript', 'music',
                      'schedule', 'schedule for later', 'agendar', 'agendar para depois', 'programar', 'scheduling',
                      'audience', 'audiência', 'audiencia', 'remixing', 'remix', 'playlist', 'boost post',
                      'share to groups', 'share to story', 'partilhar em grupos', 'partilhar no story',
                      'draft', 'rascunho', 'save as draft', 'guardar como rascunho', 'salvar como rascunho'
                    ];

                    function isIgnored(t) {
                      if (!t) return false;
                      for (var b = 0; b < badTerms.length; b++) { if (t === badTerms[b] || t.includes(badTerms[b])) return true; }
                      return false;
                    }
                    function isNextMatch(t, a) {
                      if (isIgnored(t) || isIgnored(a)) return false;
                      for (var i = 0; i < nextTerms.length; i++) {
                        var term = nextTerms[i];
                        if (t === term || a === term || t.startsWith(term + ' ') || a.startsWith(term + ' ') || t.startsWith(term + '\\n')) return true;
                      }
                      return false;
                    }

                    var allButtons = Array.from(document.querySelectorAll('div[role="button"], button, a[role="button"]'));
                    for (var i = 0; i < allButtons.length; i++) {
                      var nb = allButtons[i];
                      if (!nb.offsetParent && nb.getBoundingClientRect().width === 0) continue;
                      var nt = (nb.innerText || nb.textContent || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                      var na = (nb.getAttribute('aria-label') || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                      if (isNextMatch(nt, na)) {
                        var disabled = nb.getAttribute('aria-disabled') === 'true' || nb.disabled;
                        if (!disabled) {
                          try { nb.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }); } catch(_) {}
                          try { nb.focus(); } catch(_) {}
                          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                            try { nb.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                          });
                          try { nb.click(); } catch(_) {}
                          var rect = nb.getBoundingClientRect();
                          return { clicked: true, text: nt || na, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                        }
                      }
                    }
                    return { clicked: false };
                  })()
                `, 10000, true);

                const nVal = clickNextRes?.result?.value;
                if (nVal?.clicked && nVal.x && nVal.y && nVal.x > 0 && nVal.y > 0) {
                  const cx = Math.round(nVal.x);
                  const cy = Math.round(nVal.y);
                  await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy }, undefined, 3000).catch(() => {});
                  await new Promise((r) => setTimeout(r, 60));
                  await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 }, undefined, 3000).catch(() => {});
                  await new Promise((r) => setTimeout(r, 100));
                  await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 }, undefined, 3000).catch(() => {});
                }

                console.log(`[FACEBOOK AUTO] Avançada etapa ${stepCount} com "${state.nextText}"`);
                await new Promise((r) => setTimeout(r, 2500));
              } else {
                notify(plat, 'captioning', 72, 'Facebook gerando pré-visualização do vídeo...');
              }
              continue;
            }

            // C. Se o botão de Publicar / Partilhar / Publish / Share estiver presente (Etapa Final):
            if (state?.hasPub) {
              if (state.pubDisabled === false) {
                const reviewPauseFb = Math.floor(Math.random() * 2000) + 1500;
                notify(plat, 'publishing', 88, `Revisando publicação antes de confirmar (${Math.round(reviewPauseFb / 1000)}s)...`);
                await new Promise((r) => setTimeout(r, reviewPauseFb));

                notify(plat, 'publishing', 90, `Acionando "${state.pubText || 'Publicar'}" no Facebook Reels...`);
                const clickPubRes = await safeEvaluate(`
                  (function() {
                    var pubTerms = [
                      'publicar', 'publicar agora', 'partilhar', 'partilhar agora',
                      'publish', 'publish now', 'share now', 'postar', 'post', 'post now',
                      'share', 'partilhar reel', 'publicar reel', 'share reel', 'post reel'
                    ];
                    var badTerms = [
                      'voltar', 'anterior', 'back', 'atrás', 'atras', 'cancelar', 'cancel',
                      'substitua', 'substituir', 'fechar', 'close', 'next card', 'previous card', 'next items', 'previous items',
                      'schedule', 'schedule for later', 'agendar', 'agendar para depois', 'programar', 'scheduling',
                      'audience', 'audiência', 'audiencia', 'remixing', 'remix', 'playlist', 'boost post',
                      'share to groups', 'share to story', 'partilhar em grupos', 'partilhar no story',
                      'draft', 'rascunho', 'save as draft', 'guardar como rascunho', 'salvar como rascunho'
                    ];

                    function isIgnored(t) {
                      if (!t) return false;
                      for (var b = 0; b < badTerms.length; b++) { if (t === badTerms[b] || t.includes(badTerms[b])) return true; }
                      return false;
                    }
                    function isPubMatch(t, a) {
                      if (isIgnored(t) || isIgnored(a)) return false;
                      for (var i = 0; i < pubTerms.length; i++) {
                        var term = pubTerms[i];
                        if (t === term || a === term || t === term + ' reel' || a === term + ' reel' || t.startsWith(term + '\\n') || a.startsWith(term + '\\n')) return true;
                      }
                      return false;
                    }

                    var allButtons = Array.from(document.querySelectorAll('div[role="button"], button, a[role="button"]'));
                    for (var i = 0; i < allButtons.length; i++) {
                      var pb = allButtons[i];
                      if (!pb.offsetParent && pb.getBoundingClientRect().width === 0) continue;
                      if (pb.getAttribute('role') === 'radio' || pb.getAttribute('role') === 'switch' || pb.hasAttribute('aria-checked')) continue;
                      var pt = (pb.innerText || pb.textContent || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                      var pa = (pb.getAttribute('aria-label') || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                      if (isPubMatch(pt, pa)) {
                        if (/^\\d/.test(pt)) continue; // Ignorar contadores de feed
                        var disabled = pb.getAttribute('aria-disabled') === 'true' || pb.disabled;
                        if (!disabled) {
                          try { pb.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }); } catch(_) {}
                          try { pb.focus(); } catch(_) {}
                          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(ev) {
                            try { pb.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, composed: true, view: window })); } catch(_) {}
                          });
                          try { pb.click(); } catch(_) {}
                          var rect = pb.getBoundingClientRect();
                          return { clicked: true, text: pt || pa, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                        }
                      }
                    }
                    return { clicked: false };
                  })()
                `, 10000, true);

                const pVal = clickPubRes?.result?.value;
                if (pVal?.clicked) {
                  pubClicked = true;
                  if (pVal.x && pVal.y) pubCoords = { x: pVal.x, y: pVal.y };
                  console.log('[FACEBOOK AUTO] Botão de publicação clicado com sucesso:', pVal.text);
                  break;
                }
              } else {
                notify(plat, 'publishing', 89, 'Aguardando validação do Reel pelo Facebook...');
              }
            }
          }

          // Despacho de clique físico via CDP se obtidas coordenadas
          if (pubCoords && pubCoords.x > 0) {
            const px = Math.round(pubCoords.x);
            const py = Math.round(pubCoords.y);
            await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py }, undefined, 3000).catch(() => {});
            await new Promise((r) => setTimeout(r, 60));
            await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 }, undefined, 3000).catch(() => {});
            await new Promise((r) => setTimeout(r, 100));
            await cdpSend(activeWs, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 }, undefined, 3000).catch(() => {});
          }

          if (!pubClicked) {
            throw new Error('O botão "Publicar" no Facebook Reels permaneceu inativo ou não foi localizado após o preenchimento.');
          }

          // 5. Confirmação Real e Estrita do Facebook (incluindo tratamento de modais pós-clique)
          notify(plat, 'publishing', 93, 'Upload enviado! Aguardando confirmação oficial do Facebook...');
          let fbConfirmed = false;

          for (let conf = 0; conf < 60; conf++) {
            await new Promise((r) => setTimeout(r, 2000));

            // Tratar possível modal de confirmação pós-clique ("Quem pode ver os reels", "Confirmar", "Concluído", "Público", "Partilhar")
            await safeEvaluate(`
              (function() {
                var postModals = document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]');
                for (var m = 0; m < postModals.length; m++) {
                  var mEl = postModals[m];
                  var mTxt = (mEl.innerText || '').toLowerCase();
                  if (
                    mTxt.includes('quem pode ver') || mTxt.includes('who can see') ||
                    mTxt.includes('público') || mTxt.includes('public') ||
                    mTxt.includes('concluir') || mTxt.includes('partilhar') ||
                    mTxt.includes('share') || mTxt.includes('reels') ||
                    mTxt.includes('ativar') || mTxt.includes('enable') ||
                    mTxt.includes('guardar') || mTxt.includes('salvar') ||
                    mTxt.includes('confirmar') || mTxt.includes('confirm')
                  ) {
                    var confBtns = mEl.querySelectorAll('button, div[role="button"]');
                    for (var cb = 0; cb < confBtns.length; cb++) {
                      var cbt = (confBtns[cb].innerText || '').toLowerCase().trim();
                      var aria = (confBtns[cb].getAttribute('aria-label') || '').toLowerCase().trim();
                      if (
                        cbt === 'concluído' || cbt === 'concluido' || cbt === 'done' ||
                        cbt === 'confirmar' || cbt === 'confirm' ||
                        cbt === 'partilhar agora' || cbt === 'share now' ||
                        cbt === 'publicar' || cbt === 'publish' ||
                        cbt === 'partilhar' || cbt === 'share' ||
                        cbt === 'continuar' || cbt === 'continue' ||
                        cbt === 'ok' || cbt === 'entendi' || cbt === 'got it' ||
                        aria === 'fechar' || aria === 'close'
                      ) {
                        try { confBtns[cb].click(); } catch(_) {}
                        return true;
                      }
                    }
                  }
                }
                return false;
              })()
            `, 6000, false);

            const checkFbDone = `
              (function() {
                var bodyText = document.body ? document.body.innerText.toLowerCase() : '';

                // 1. Verificar se o upload ou processamento ainda está ATIVO
                var isUploadingActive = (
                  document.querySelector('[role="progressbar"], [aria-busy="true"], .progress_bar') !== null ||
                  bodyText.includes('a carregar') ||
                  bodyText.includes('a enviar') ||
                  bodyText.includes('uploading') ||
                  bodyText.includes('a guardar') ||
                  bodyText.includes('saving') ||
                  bodyText.includes('publicando') ||
                  bodyText.includes('a publicar')
                );

                // 2. Mensagens explícitas de confirmação (pt-PT, pt-BR, EN)
                if (
                  bodyText.includes('o teu reel foi publicado') ||
                  bodyText.includes('o teu reel foi partilhado') ||
                  bodyText.includes('seu reel foi publicado') ||
                  bodyText.includes('seu reel foi compartilhado') ||
                  bodyText.includes('o teu reel está a ser processado') ||
                  bodyText.includes('seu reel está sendo processado') ||
                  bodyText.includes('your reel is being published') ||
                  bodyText.includes('your reel has been published') ||
                  bodyText.includes('your reel was published') ||
                  bodyText.includes('your reel is being processed') ||
                  bodyText.includes('publicado com sucesso') ||
                  bodyText.includes('partilhado com sucesso') ||
                  bodyText.includes('publicação concluída') ||
                  bodyText.includes('partilha concluída') ||
                  bodyText.includes('a tua publicação foi partilhada') ||
                  bodyText.includes('a sua publicação foi compartilhada')
                ) {
                  return { done: true, reason: 'explicit_text' };
                }

                // 3. Redirecionamento para fora de /reels/create/ (indica conclusão no Facebook SPA)
                // Deve ter decorrido pelo menos 3 ciclos (6s) e o upload não pode estar explicitamente em progresso
                var curPath = window.location.pathname.toLowerCase();
                if (!curPath.includes('/reels/create') && !isUploadingActive && ${conf} >= 3) {
                  return { done: true, reason: 'navigated_away_from_composer' };
                }

                // 4. Se a interface de Reels composer sumiu (sem botão publicar e sem botão avançar e sem campo de descrição),
                // e o upload ativo terminou, após pelo menos 8 ciclos (16 segundos)
                var hasComposer = (
                  document.querySelector('div[contenteditable="true"]') !== null ||
                  document.querySelector('input[type="file"]') !== null ||
                  document.querySelector('video') !== null
                );
                var hasPubOrNext = Array.from(document.querySelectorAll('div[role="button"], button')).some(function(b) {
                  var t = (b.innerText || '').trim().toLowerCase();
                  return t === 'publicar' || t === 'publish' || t === 'partilhar' || t === 'avançar' || t === 'next';
                });

                if (!hasComposer && !hasPubOrNext && !isUploadingActive && ${conf} >= 8) {
                  return { done: true, reason: 'composer_dismissed_and_idle' };
                }

                return { done: false, isUploading: isUploadingActive };
              })()
            `;

            const fbDoneRes = await safeEvaluate(checkFbDone, 8000, true);

            if (fbDoneRes?.result?.value?.done) {
              console.log('[FACEBOOK AUTO] Confirmação detectada:', fbDoneRes.result.value.reason);
              fbConfirmed = true;
              break;
            } else {
              const isUp = fbDoneRes?.result?.value?.isUploading;
              if (isUp) {
                notify(plat, 'publishing', 94, `Facebook enviando/processando vídeo (${(conf + 1) * 2}s)...`);
              } else {
                notify(plat, 'publishing', 94, `Facebook finalizando publicação do Reel (${(conf + 1) * 2}s)...`);
              }
            }
          }

          if (!fbConfirmed) {
            throw new Error('A publicação foi enviada, mas o Facebook não confirmou o upload dentro do tempo limite.');
          }

          notify(plat, 'done', 100, 'Publicado e confirmado com sucesso no Facebook Reels da Página!');
          results[plat] = { success: true };
          if (targetSession) targetSession.isPublishing = false;
        } else if (plat === 'instagram') {

          // ── Helper: Re-adquirir WS após navegação (mesmo padrão do Facebook) ──
          const igReacquireWs = async (debugPort: number, timeoutMs = 15000): Promise<WebSocket | null> => {
            const httpMod = await import('http');
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 800));
              try {
                const tabs = await new Promise<Array<{ type: string; webSocketDebuggerUrl?: string; url: string }>>((resolve, reject) => {
                  const req = httpMod.default.get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
                    let data = ''; res.on('data', (c) => (data += c));
                    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
                  });
                  req.on('error', reject);
                });
                const tab = tabs.find((t) =>
                  (t.type === 'page' || t.type === 'app') && t.webSocketDebuggerUrl &&
                  !t.url.startsWith('chrome-') && !t.url.startsWith('about:')
                );
                if (tab?.webSocketDebuggerUrl) {
                  const freshWs = new WebSocket(tab.webSocketDebuggerUrl);
                  await new Promise<void>((resolve, reject) => {
                    freshWs.once('open', () => resolve()); freshWs.once('error', reject);
                  });
                  return freshWs;
                }
              } catch {}
            }
            return null;
          };

          let igWs = ws;
          const igDebugPort = targetSession?.debugPort || 0;

          // 1. Navegar para o feed do Instagram
          notify(plat, 'uploading', 25, 'Abrindo Instagram...');
          await cdpSend(igWs, 'Runtime.evaluate', {
            expression: 'window.location.href = "https://www.instagram.com/";',
          }).catch(() => {});
          await new Promise((r) => setTimeout(r, 3000));

          // Re-adquirir WS (Instagram é SPA, navegação invalida o WS)
          if (igDebugPort) {
            const reacq = await igReacquireWs(igDebugPort, 12000);
            if (reacq) { try { igWs.close(); } catch {} igWs = reacq; if (targetSession) targetSession.ws = igWs; }
          }
          await injectSecurityShieldToSession(igWs, { isSignup: false, pageUrl: '' }).catch(() => {});

          // 2. Clicar no botão "+" (Nova publicação / Create)
          notify(plat, 'uploading', 32, 'Abrindo criador de publicação...');
          let igCreateClicked = false;
          for (let attempt = 0; attempt < 12; attempt++) {
            await new Promise((r) => setTimeout(r, 1000));
            const res = (await cdpSend(igWs, 'Runtime.evaluate', {
              expression: `
                (function() {
                  var labels = ['nova publicação','new post','criar','create','nova publicaçao'];
                  var els = Array.from(document.querySelectorAll('a, button, div[role="button"], svg, span'));
                  for (var i = 0; i < els.length; i++) {
                    var aria = (els[i].getAttribute('aria-label') || '').trim().toLowerCase();
                    var title = (els[i].getAttribute('title') || '').trim().toLowerCase();
                    var txt = (els[i].innerText || els[i].textContent || '').trim().toLowerCase();
                    if (labels.indexOf(aria) >= 0 || labels.indexOf(title) >= 0 || labels.indexOf(txt) >= 0) {
                      var clickable = els[i].closest('a, button, div[role="button"]') || els[i];
                      clickable.click(); return { clicked: true };
                    }
                  }
                  return { clicked: false };
                })()
              `,
              returnByValue: true,
            })) as { result?: { value?: { clicked: boolean } } };
            if (res?.result?.value?.clicked) { igCreateClicked = true; break; }
          }
          if (!igCreateClicked) throw new Error('Botão de criar publicação não encontrado no Instagram. Confirme que a conta está logada e é do tipo Creator.');
          await new Promise((r) => setTimeout(r, 1500));

          // 3. Selecionar "Reel" no menu de tipo
          notify(plat, 'uploading', 38, 'Selecionando tipo "Reel"...');
          for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise((r) => setTimeout(r, 1000));
            const reelRes = (await cdpSend(igWs, 'Runtime.evaluate', {
              expression: `
                (function() {
                  var els = Array.from(document.querySelectorAll('button, div[role="tab"], div[role="button"], span, a'));
                  for (var i = 0; i < els.length; i++) {
                    var txt = (els[i].innerText || els[i].textContent || '').trim().toLowerCase();
                    var aria = (els[i].getAttribute('aria-label') || '').toLowerCase();
                    if (txt === 'reel' || txt === 'reels' || aria === 'reel' || aria === 'reels') {
                      els[i].click(); return { clicked: true };
                    }
                  }
                  return { clicked: false };
                })()
              `,
              returnByValue: true,
            })) as { result?: { value?: { clicked: boolean } } };
            if (reelRes?.result?.value?.clicked) break;
          }
          await new Promise((r) => setTimeout(r, 1000));

          // 4. Localizar e injetar o ficheiro de vídeo
          notify(plat, 'uploading', 45, 'Localizando campo de upload do Instagram...');
          await cdpSend(igWs, 'DOM.enable');

          const igLocateFileInput = async (): Promise<number> => {
            try {
              const evalRes = (await cdpSend(igWs, 'Runtime.evaluate', {
                expression: `document.querySelector('input[type="file"], input[accept*="video"], input[accept*=".mp4"]')`,
              })) as { result?: { objectId?: string } };
              if (evalRes?.result?.objectId) {
                const nodeRes = (await cdpSend(igWs, 'DOM.requestNode', { objectId: evalRes.result.objectId })) as { nodeId?: number };
                if (nodeRes?.nodeId) return nodeRes.nodeId;
              }
            } catch {}
            try {
              const docRes = (await cdpSend(igWs, 'DOM.getDocument', { depth: -1, pierce: true })) as { root: { nodeId: number } };
              for (const sel of ['input[type="file"]', 'input[accept*="video"]', 'input[accept*=".mp4"]']) {
                const qRes = (await cdpSend(igWs, 'DOM.querySelector', { nodeId: docRes.root.nodeId, selector: sel })) as { nodeId: number };
                if (qRes?.nodeId) return qRes.nodeId;
              }
            } catch {}
            return 0;
          };

          let igFileNodeId = 0;
          for (let attempt = 0; attempt < 25; attempt++) {
            await new Promise((r) => setTimeout(r, 1500));
            igFileNodeId = await igLocateFileInput();
            if (igFileNodeId) break;
          }
          if (!igFileNodeId) throw new Error('Campo de upload do Instagram não encontrado. Verifique login e tipo de conta (Creator).');

          notify(plat, 'uploading', 60, 'Enviando vídeo para o Instagram...');
          await cdpSend(igWs, 'DOM.setFileInputFiles', { nodeId: igFileNodeId, files: [actualUploadPath] });
          await cdpSend(igWs, 'Runtime.evaluate', {
            expression: `
              (function() {
                document.querySelectorAll('input[type="file"]').forEach(function(i) {
                  i.dispatchEvent(new Event('change', { bubbles: true }));
                  i.dispatchEvent(new Event('input', { bubbles: true }));
                });
              })()
            `,
          }).catch(() => {});

          // 5. Wizard automático: Avançar → Caption → Publicar
          notify(plat, 'captioning', 68, 'Aguardando processamento do vídeo no Instagram...');
          let igPubClicked = false;
          let igDescFilled = false;
          let igStepCount = 0;

          for (let cycle = 0; cycle < 60; cycle++) {
            await new Promise((r) => setTimeout(r, 2000));

            const igStateRes = (await cdpSend(igWs, 'Runtime.evaluate', {
              expression: `
                (function() {
                  var nextTerms = ['avançar','avancar','next','seguinte','próximo','continue','continuar'];
                  var pubTerms  = ['partilhar','share','compartilhar','publicar','publish','postar'];
                  function match(txt, terms) {
                    var t = (txt||'').trim().toLowerCase();
                    return terms.some(function(term){ return t === term || t.startsWith(term+' ') || t.startsWith(term+'\\n'); });
                  }
                  var btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                  var nextBtn = null, pubBtn = null;
                  for (var i = 0; i < btns.length; i++) {
                    var txt  = (btns[i].innerText || btns[i].textContent || '').trim();
                    var aria = btns[i].getAttribute('aria-label') || '';
                    var dis  = btns[i].disabled || btns[i].getAttribute('aria-disabled') === 'true';
                    if (!dis && !nextBtn && (match(txt, nextTerms) || match(aria, nextTerms))) nextBtn = btns[i];
                    if (!dis && !pubBtn  && (match(txt, pubTerms)  || match(aria, pubTerms)))  pubBtn  = btns[i];
                  }
                  var captionBox = document.querySelector(
                    'textarea[aria-label*="Escreve" i], textarea[aria-label*="Write" i], ' +
                    'textarea[aria-label*="Legenda" i], textarea[aria-label*="Caption" i], ' +
                    'div[contenteditable="true"][aria-label*="Legenda" i], ' +
                    'div[contenteditable="true"][aria-label*="Caption" i], ' +
                    'textarea[placeholder*="caption" i], textarea[placeholder*="Escreve" i], ' +
                    'textarea[placeholder*="Write" i], textarea[placeholder*="legenda" i]'
                  );
                  return {
                    hasNext: !!nextBtn, nextText: nextBtn ? (nextBtn.innerText||'').trim() : '',
                    hasPub:  !!pubBtn,  pubText:  pubBtn  ? (pubBtn.innerText ||'').trim() : '',
                    hasCaption: !!captionBox,
                  };
                })()
              `,
              returnByValue: true,
            })) as { result?: { value?: { hasNext: boolean; nextText: string; hasPub: boolean; pubText: string; hasCaption: boolean } } };

            const igState = igStateRes?.result?.value;
            if (!igState) continue;

            // Avançar (sem caption visível = passos de corte/filtros)
            if (igState.hasNext && !igState.hasCaption) {
              igStepCount++;
              notify(plat, 'captioning', 70 + Math.min(igStepCount * 5, 12), `Avançando passo ${igStepCount} (${igState.nextText})...`);
              await cdpSend(igWs, 'Runtime.evaluate', {
                expression: `
                  (function() {
                    var terms = ['avançar','avancar','next','seguinte','próximo','continue','continuar'];
                    var btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                    for (var i = 0; i < btns.length; i++) {
                      var t = (btns[i].innerText||'').trim().toLowerCase();
                      var a = (btns[i].getAttribute('aria-label')||'').toLowerCase();
                      if ((terms.some(function(x){ return t===x||t.startsWith(x); }) || terms.some(function(x){ return a===x||a.startsWith(x); })) && !btns[i].disabled) {
                        btns[i].click(); return true;
                      }
                    }
                    return false;
                  })()
                `,
              }).catch(() => {});
              await new Promise((r) => setTimeout(r, 2500));
              continue;
            }

            // Preencher legenda / caption
            if (igState.hasCaption && !igDescFilled) {
              notify(plat, 'captioning', 84, 'Preenchendo legenda do Reel (digitação humanizada)...');
              
              // Passo: Focar e limpar a caixa antes de digitar
              const focusIgBox = `
                (function() {
                  var box = document.querySelector(
                    'textarea[aria-label*="Escreve" i], textarea[aria-label*="Write" i], ' +
                    'textarea[aria-label*="Caption" i], textarea[aria-label*="Legenda" i], ' +
                    'div[contenteditable="true"][aria-label*="Caption" i], ' +
                    'div[contenteditable="true"][aria-label*="Legenda" i], ' +
                    'textarea[placeholder*="caption" i], textarea[placeholder*="Escreve" i]'
                  );
                  if (!box) return false;
                  try { box.focus(); } catch(_) {}
                  if (box.tagName === 'TEXTAREA') {
                    box.value = '';
                  } else {
                    try { document.execCommand('selectAll', false, null); } catch(_) {}
                    try { document.execCommand('delete', false, null); } catch(_) {}
                  }
                  return true;
                })()
              `;
              const igFocused = await cdpSend(igWs, 'Runtime.evaluate', { expression: focusIgBox, returnByValue: true }).catch(() => null) as any;
              await new Promise((r) => setTimeout(r, 400));

              try {
                if (igFocused?.result?.value === true) {
                  await typeHumanCdp(fullText, igWs);
                } else {
                  throw new Error('ig-box-not-found');
                }
              } catch (_) {
                // Fallback robusto
                await cdpSend(igWs, 'Runtime.evaluate', {
                  expression: `
                    (function(text) {
                      var box = document.querySelector(
                        'textarea[aria-label*="Escreve" i], textarea[aria-label*="Write" i], ' +
                        'textarea[aria-label*="Caption" i], textarea[aria-label*="Legenda" i], ' +
                        'div[contenteditable="true"][aria-label*="Caption" i], ' +
                        'div[contenteditable="true"][aria-label*="Legenda" i], ' +
                        'textarea[placeholder*="caption" i], textarea[placeholder*="Escreve" i]'
                      );
                      if (!box) return false;
                      try { box.focus(); } catch(_) {}
                      if (box.tagName === 'TEXTAREA') {
                        box.value = text;
                        box.dispatchEvent(new Event('input',  { bubbles: true }));
                        box.dispatchEvent(new Event('change', { bubbles: true }));
                      } else {
                        try { document.execCommand('selectAll', false, null); } catch(_) {}
                        try { document.execCommand('insertText', false, text); } catch(_) { box.innerText = text; }
                        box.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
                      }
                      return true;
                    })(${JSON.stringify(fullText)})
                  `,
                }).catch(() => {});
                try { await cdpSend(igWs, 'Input.insertText', { text: fullText }); } catch {}
              }

              igDescFilled = true;
              await new Promise((r) => setTimeout(r, 1500));
              continue;
            }

            // Clicar Publicar / Share
            if (igState.hasPub) {
              // Pausa humanizada de revisão antes de publicar no Instagram (2-4 segundos simulando leitura humana)
              const reviewPauseIg = Math.floor(Math.random() * 2000) + 2000;
              notify(plat, 'publishing', 88, `Revisando publicação antes de confirmar (${Math.round(reviewPauseIg / 1000)}s)...`);
              await new Promise((r) => setTimeout(r, reviewPauseIg));

              notify(plat, 'publishing', 90, `Publicando Reel no Instagram (${igState.pubText || 'Partilhar'})...`);
              const igPubRes = (await cdpSend(igWs, 'Runtime.evaluate', {
                expression: `
                  (function() {
                    var terms = ['partilhar','share','compartilhar','publicar','publish','postar'];
                    var btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                    for (var i = 0; i < btns.length; i++) {
                      var t = (btns[i].innerText||'').trim().toLowerCase();
                      var a = (btns[i].getAttribute('aria-label')||'').toLowerCase();
                      if ((terms.some(function(x){ return t===x||t.startsWith(x); }) || terms.some(function(x){ return a===x||a.startsWith(x); })) && !btns[i].disabled) {
                        btns[i].click(); return { clicked: true };
                      }
                    }
                    return { clicked: false };
                  })()
                `,
                returnByValue: true,
              })) as { result?: { value?: { clicked: boolean } } };
              if (igPubRes?.result?.value?.clicked) { igPubClicked = true; break; }
            }
          }

          if (!igPubClicked) throw new Error('Botão de publicação do Instagram não encontrado ou inativo.');

          // 6. Aguardar confirmação real da publicação
          notify(plat, 'publishing', 93, 'Aguardando confirmação do Instagram...');
          let igConfirmed = false;
          for (let conf = 0; conf < 30; conf++) {
            await new Promise((r) => setTimeout(r, 2000));
            const igDoneRes = (await cdpSend(igWs, 'Runtime.evaluate', {
              expression: `
                (function() {
                  var body = document.body ? document.body.innerText.toLowerCase() : '';
                  if (body.includes('reel publicado') || body.includes('reel partilhado') ||
                      body.includes('reel shared') || body.includes('reel posted') ||
                      body.includes('publicado no instagram') || body.includes('shared to instagram') ||
                      body.includes('o teu reel') || body.includes('your reel') ||
                      body.includes('publicação partilhada') || body.includes('post shared')) {
                    return { done: true, reason: 'explicit_text' };
                  }
                  var p = window.location.pathname;
                  if (p.includes('/reel/') || p.includes('/p/')) return { done: true, reason: 'url_reel' };
                  var isInFeed = p === '/' || p === '';
                  var noWizard = !document.querySelector('div[role="dialog"] button');
                  if (isInFeed && noWizard && ${conf} >= 3) return { done: true, reason: 'feed_redirect' };
                  return { done: false };
                })()
              `,
              returnByValue: true,
            })) as { result?: { value?: { done: boolean; reason?: string } } };

            if (igDoneRes?.result?.value?.done) {
              console.log('[INSTAGRAM AUTO] Confirmação detectada:', igDoneRes.result.value.reason);
              igConfirmed = true; break;
            }
            notify(plat, 'publishing', 94, `Instagram processando (${(conf + 1) * 2}s)...`);
          }

          if (!igConfirmed) throw new Error('Instagram não confirmou a publicação dentro do tempo limite.');

          notify(plat, 'done', 100, 'Reel publicado com sucesso no Instagram!');
          results[plat] = { success: true };
        }

        // Fechar a janela do Chrome imediatamente após a confirmação de publicação com sucesso
        if (results[plat]?.success && targetSession) {
          notify(plat, 'done', 100, `Publicação concluída! Aguardando persistência dos dados e fechando ${plat.toUpperCase()}...`);
          await new Promise((r) => setTimeout(r, 8000));
          try {
            if (targetSession.ws && targetSession.ws.readyState === WebSocket.OPEN) {
              try { await cdpSend(targetSession.ws, 'Browser.close', {}, undefined, 4000); } catch (_) {}
              try { targetSession.ws.close(); } catch (_) {}
            }
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 2000));
          try {
            if (targetSession.process && !targetSession.process.killed && targetSession.process.pid) {
              targetSession.process.kill();
            }
          } catch (_) {}
          if (effectiveAccountCode) {
            chromeSessions.delete(effectiveAccountCode);
            event.sender.send('chrome-closed', { profileId: effectiveAccountCode });
            event.sender.send('chrome-sessions-updated', Array.from(chromeSessions.keys()));
          }
        }
      } catch (platErr: unknown) {
        if (targetSession) targetSession.isPublishing = false;
        const errStr = platErr instanceof Error ? platErr.message : 'Falha na publicação automática';
        notify(plat, 'error', 0, `Erro ao publicar: ${errStr}`);
        results[plat] = { success: false, error: errStr };
      }
    }
  } finally {
    // Auto-destruição imediata do arquivo efêmero descriptografado!
    if (ephemeral) {
      await ephemeral.cleanup();
    }
  }

  const hasSuccess = Object.values(results).some((r) => r.success);
  return { success: hasSuccess, results };
});

// ══════════════════════════════════════════════════════════════════════
// ── IPC Handlers Legados ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

ipcMain.on('open-tiktok-signup', (_event, signupUrl) => {
  if (!mainWindow) return;
  if (tiktokView) {
    mainWindow.contentView.removeChildView(tiktokView);
    tiktokView = null;
  }
  tiktokView = new WebContentsView({
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  mainWindow.contentView.addChildView(tiktokView);
  const bounds = mainWindow.getBounds();
  tiktokView.setBounds({ x: 0, y: 80, width: bounds.width, height: bounds.height - 80 });
  tiktokView.webContents.loadURL(
    signupUrl || 'https://www.tiktok.com/login'
  );
});

ipcMain.on('inject-credentials', (_event, { email, pass }) => {
  if (!tiktokView) return;
  const decPass = decryptCred(pass);
  const script = `
    (function() {
      function setNativeValue(element, value) {
        const proto = Object.getPrototypeOf(element);
        const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const ownSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        if (protoSetter && ownSetter !== protoSetter) {
          protoSetter.call(element, value);
        } else if (ownSetter) {
          ownSetter.call(element, value);
        } else {
          element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      const emailInput = document.querySelector('input[type="email"], input[name="email"], input[placeholder*="Email"]');
      const passInput = document.querySelector('input[type="password"], input[name="password"]');
      if (emailInput) setNativeValue(emailInput, ${JSON.stringify(email)});
      if (passInput) setNativeValue(passInput, ${JSON.stringify(decPass)});
    })();
  `;
  tiktokView.webContents
    .executeJavaScript(script)
    .catch((err) => console.error('Erro na injeção DOM:', err));
});

ipcMain.on('inject-verification-code', (_event, code) => {
  if (!tiktokView) return;
  const script = `
    (function() {
      const codeInput = document.querySelector(
        'input[placeholder*="code" i], input[name*="code" i], input[type="number"][maxlength="6"], input[maxlength="6"]'
      );
      if (codeInput) {
        codeInput.value = ${JSON.stringify(code)};
        codeInput.dispatchEvent(new Event('input', { bubbles: true }));
        codeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })();
  `;
  tiktokView.webContents
    .executeJavaScript(script)
    .catch((err) => console.error('Erro na injeção de código:', err));
});

ipcMain.on('close-tiktok-session', () => {
  if (mainWindow && tiktokView) {
    mainWindow.contentView.removeChildView(tiktokView);
    tiktokView = null;
  }
});
