import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, type Account, type Job } from '../lib/supabase';
import { PlatformIcon } from './PlatformIcon';

interface Props {
  account: Account;
  partnerId: string;
  onClose: () => void;
  job?: Job | null;
  videoLocalPath?: string | null;
}

export const KioskModal: React.FC<Props> = ({ account, partnerId, onClose, job, videoLocalPath }) => {
  const [preparing, setPreparing] = useState(true);
  const [requestCodeLoading, setRequestCodeLoading] = useState(false);
  const [activeCodeRequest, setActiveCodeRequest] = useState<{
    id: string;
    code_value: string | null;
    status: string;
  } | null>(null);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(7200);
  const [ephemeralPath, setEphemeralPath] = useState<string | null>(null);

  useEffect(() => {
    let currentTemp: string | null = null;
    if (videoLocalPath && window.electronAPI?.prepareManualVideo) {
      window.electronAPI.prepareManualVideo({ vaultPath: videoLocalPath }).then((res) => {
        if (res.success && res.tempPath) {
          setEphemeralPath(res.tempPath);
          currentTemp = res.tempPath;
        }
      }).catch(console.error);
    }

    return () => {
      if (currentTemp && window.electronAPI?.cleanupManualVideo) {
        window.electronAPI.cleanupManualVideo({ tempPath: currentTemp }).catch(console.error);
      }
    };
  }, [videoLocalPath]);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCodeListeners = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const platformTargetUrl =
    account.platform === 'tiktok'
      ? 'https://www.tiktok.com'
      : account.platform === 'youtube'
      ? 'https://studio.youtube.com'
      : 'https://business.facebook.com';

  // Lista de paths bloqueados em todas as plataformas
  const blockedPaths = [
    '/settings', '/security', '/password', '/account-info',
    '/privacy', '/legal', '/login', '/signup', '/register',
  ];

  const isUrlAllowed = (url: string): boolean => {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();

      // Bloquear paths sensíveis em qualquer domínio
      if (blockedPaths.some((p) => path.startsWith(p))) return false;

      // Permitir apenas o domínio da plataforma da conta
      if (account.platform === 'tiktok') return host.includes('tiktok.com');
      if (account.platform === 'youtube') return host.includes('youtube.com') || host.includes('google.com');
      if (account.platform === 'facebook') return host.includes('facebook.com');
      return false;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    return () => {
      clearCodeListeners();
    };
  }, [clearCodeListeners]);

  useEffect(() => {
    // Timer de sessão
    const interval = setInterval(() => {
      setSessionSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    // Após 1s, remover overlay de preparação e ligar bloqueio de navegação no webview
    const timer = setTimeout(() => {
      setPreparing(false);

      // Conectar eventos de bloqueio ao webview nativo do Electron
      const webviewEl = document.getElementById('kiosk-webview') as unknown as (HTMLElement & {
        addEventListener: (event: string, listener: (e: Event) => void) => void;
        src: string;
        executeJavaScript: (code: string) => Promise<unknown>;
        insertCSS: (css: string) => Promise<unknown>;
      }) | null;

      if (webviewEl) {
        // Bloquear navegação para URLs fora da allowlist
        webviewEl.addEventListener('will-navigate', (e: Event) => {
          const navEvent = e as unknown as { url?: string; preventDefault?: () => void };
          const targetUrl = navEvent.url || '';
          if (targetUrl && !isUrlAllowed(targetUrl)) {
            if (typeof navEvent.preventDefault === 'function') navEvent.preventDefault();
            webviewEl.src = platformTargetUrl;
          }
        });

        // Bloquear também navegação in-page (SPA routing)
        webviewEl.addEventListener('did-navigate', (e: Event) => {
          const navEvent = e as unknown as { url?: string };
          const targetUrl = navEvent.url || '';
          if (targetUrl && !isUrlAllowed(targetUrl)) {
            webviewEl.src = platformTargetUrl;
          }
        });

        // Após página carregar, injectar CSS para ocultar botões sensíveis
        webviewEl.addEventListener('dom-ready', () => {
          try {
            webviewEl.insertCSS(`
              /* Ocultar botões de settings/segurança/password */
              a[href*="/settings"], a[href*="/security"], a[href*="/password"],
              a[href*="login"], a[href*="signup"], a[href*="register"],
              [data-e2e*="setting"], [data-e2e*="security"],
              [aria-label*="Setting"], [aria-label*="setting"],
              button[aria-label*="Account setting"] {
                display: none !important;
                pointer-events: none !important;
              }
            `);
          } catch {
            // Ignore if insertCSS not supported
          }
        });
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);

  const formatSessionTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${m < 10 ? '0' : ''}${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const handleCodeResponse = useCallback((reqId: string, status: string, codeVal: string | null) => {
    if (status === 'responded' && codeVal) {
      setActiveCodeRequest({ id: reqId, code_value: codeVal, status: 'responded' });
      setCodeMessage(`✨ CÓDIGO 2FA RECEBIDO DO ADM: ${codeVal}`);

      // Injectar código automaticamente no webview
      const webviewEl = document.getElementById('kiosk-webview') as unknown as { executeJavaScript: (code: string) => Promise<unknown> } | null;
      if (webviewEl && typeof webviewEl.executeJavaScript === 'function') {
        webviewEl.executeJavaScript(`
          (function() {
            function setVal(el, val) {
              var setter = Object.getOwnPropertyDescriptor(el, 'value')?.set ||
                           Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
              if (setter) { setter.call(el, val); } else { el.value = val; }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            var codeInput = document.querySelector('input[placeholder*="code"], input[name*="code"], input[type="number"], input[maxlength="6"]');
            if (codeInput) { setVal(codeInput, ${JSON.stringify(codeVal)}); }
          })();
        `).catch(console.error);
      }

      // Som de sucesso
      try {
        const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
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
      } catch {}

      clearCodeListeners();
    } else if (status === 'denied') {
      setActiveCodeRequest({ id: reqId, code_value: null, status: 'denied' });
      setCodeMessage('❌ Pedido de código negado pelo Administrador.');
      clearCodeListeners();
    }
  }, [clearCodeListeners]);

  const handleRequestCode = async () => {
    setRequestCodeLoading(true);
    setCodeMessage(null);
    clearCodeListeners();

    try {
      const requestCode = 'REQ-' + Math.floor(1000 + Math.random() * 9000);

      // Buscar dados completos da conta (email via controlled_email, password, birth_date)
      let accountEmail: string | null = null;
      if (account.controlled_email_id) {
        const { data: emailData } = await supabase
          .from('controlled_emails')
          .select('email')
          .eq('id', account.controlled_email_id)
          .single();
        accountEmail = emailData?.email || null;
      }

      // Inserir pedido de código na tabela code_requests com todos os dados
      const { data, error } = await supabase
        .from('code_requests')
        .insert({
          request_code: requestCode,
          partner_id: partnerId,
          account_id: account.id,
          request_type: 'totp',
          status: 'pending',
          email: accountEmail,
          password_encrypted: null,
          birth_date: account.birth_date || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Notificar ADM em tempo real
      try {
        await supabase.from('notifications').insert({
          target_type: 'admin',
          target_id: partnerId || '00000000-0000-0000-0000-000000000000',
          title: '🔑 Pedido de Código 2FA (Sessão Kiosk)',
          message: `Parceiro em sessão Kiosk solicita código 2FA para a conta ${account.username} (${account.platform.toUpperCase()})${accountEmail ? '. Email: ' + accountEmail : ''}. Pedido: ${requestCode}`,
          type: 'code_request',
          is_read: false,
        });
      } catch (errNotif) {
        console.error('Notif ADM erro:', errNotif);
      }

      setActiveCodeRequest({ id: data.id, code_value: null, status: 'pending' });
      setCodeMessage('⏳ Aguardando o Administrador enviar o código 2FA...');

      // 1. Ouvinte Realtime Supabase
      const channel = supabase
        .channel(`kiosk_code_req_${data.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'code_requests', filter: `id=eq.${data.id}` },
          (payload: { new: Record<string, unknown> }) => {
            const updated = payload.new as unknown as { status: string; code_value: string | null };
            handleCodeResponse(data.id, updated.status, updated.code_value);
          }
        );

      channel.subscribe();
      channelRef.current = channel;

      // 2. Fallback por Polling REST a cada 1.5s
      pollIntervalRef.current = setInterval(async () => {
        try {
          const { data: pollData } = await supabase
            .from('code_requests')
            .select('status, code_value')
            .eq('id', data.id)
            .single();

          if (pollData && (pollData.status === 'responded' || pollData.status === 'denied')) {
            handleCodeResponse(data.id, pollData.status, pollData.code_value);
          }
        } catch {}
      }, 1500);

    } catch (err: unknown) {
      console.error(err);
      setCodeMessage('Erro ao solicitar código ao ADM.');
    } finally {
      setRequestCodeLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-50 flex flex-col animate-fade-in">
      {/* Top Restricted Control Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <PlatformIcon platform={account.platform} className="w-6 h-6 shrink-0 rounded-md" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm text-white">{account.username}</h2>
              <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded-full font-mono">
                Sessão Kiosk Segura
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Ambiente Controlado • Sem Acesso a Senhas ou Configurações
            </p>
          </div>
        </div>

        {/* Central Code Request Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleRequestCode}
            disabled={requestCodeLoading || activeCodeRequest?.status === 'pending'}
            className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <span>🔐</span>
            <span>
              {requestCodeLoading
                ? 'Solicitando...'
                : activeCodeRequest?.status === 'pending'
                ? 'Aguardando ADM...'
                : 'Pedir Código de Verificação / 2FA'}
            </span>
          </button>
        </div>

        {/* Status & Close */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 block font-mono">Tempo Restante</span>
            <span className="text-xs font-bold text-amber-400 font-mono">
              ⏱️ {formatSessionTime(sessionSeconds)}
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 border border-slate-700 hover:border-rose-700 rounded-xl text-xs font-semibold transition-all"
          >
            ❌ Encerrar Sessão
          </button>
        </div>
      </div>

      {/* Realtime Code Delivery Banner */}
      {codeMessage && (
        <div
          className={`px-6 py-3 text-xs text-center font-bold flex items-center justify-between shadow-inner ${
            activeCodeRequest?.status === 'responded'
              ? 'bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-950 text-emerald-200 border-b border-emerald-500/50'
              : activeCodeRequest?.status === 'denied'
              ? 'bg-rose-950 text-rose-300 border-b border-rose-800/50'
              : 'bg-amber-950 text-amber-300 border-b border-amber-800/50 animate-pulse'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">
              {activeCodeRequest?.status === 'responded' ? '✨' : activeCodeRequest?.status === 'denied' ? '❌' : '⏳'}
            </span>
            <div className="text-left">
              <p className="text-[11px] text-slate-300 uppercase tracking-wider">{codeMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Kiosk Window Body */}
      <div className="flex-1 relative bg-slate-950 flex flex-col">
        {/* Preparing Overlay */}
        {preparing ? (
          <div className="absolute inset-0 bg-slate-950 z-20 flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold text-white">Iniciando Navegador Seguro Kiosk...</h3>
              <p className="text-xs text-slate-400">
                Ativando filtros de segurança e bloqueio de navegação...
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-emerald-400 font-mono bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
              <span>🔒 Email Oculto</span> • <span>🔐 Senha Oculta (••••••••)</span> • <span>🚫 URLs Restritas</span>
            </div>
          </div>
        ) : null}

        {/* Webview Nativo do Electron com Bloqueio Real de URLs */}
        <div className="flex-1 flex flex-col bg-slate-900 m-2 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl relative">
          {/* Internal Browser Header */}
          <div className="bg-slate-950 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs text-slate-400 font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span>🔒 {platformTargetUrl} (Protegido por Kiosk Rules)</span>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-slate-500">DevTools: DESATIVADO</span>
              <span className="text-slate-500">Settings/Password: BLOQUEADO</span>
            </div>
          </div>

          {/* Helper de Postagem Manual (quando aberto a partir de um vídeo específico) */}
          {job && (
            <div className="bg-[#141210] border-b border-[#383028] px-4 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 overflow-hidden text-[#EDE4D5]">
                <span className="text-sm">🎬</span>
                <span className="font-bold truncate max-w-xs">{job.videos?.filename || 'video.mp4'}</span>
                <span
                  title={ephemeralPath ? `Cofre efêmero ativo: ${ephemeralPath}` : 'Carregando cofre efêmero...'}
                  className="text-[10px] text-[#DFC068] font-mono flex items-center gap-1 cursor-help"
                >
                  <span>🔒</span> Cofre Efêmero (Auto-destruição ativa ao fechar)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {job.caption && (
                  <button
                    onClick={() => {
                      const tags = (job.hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
                      const full = [job.caption, tags].filter(Boolean).join('\n\n');
                      navigator.clipboard.writeText(full);
                      alert('📋 Legenda e hashtags copiadas para a área de transferência!');
                    }}
                    className="px-2.5 py-1 bg-[#251F1A] hover:bg-[#2E2721] text-[#DFC068] border border-[#473C31] rounded-md text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-all"
                  >
                    <span>📋</span>
                    <span>Copiar Legenda</span>
                  </button>
                )}
                {job.status !== 'published' && (
                  <button
                    onClick={async () => {
                      await supabase
                        .from('jobs')
                        .update({ status: 'published', published_at: new Date().toISOString() })
                        .eq('id', job.id);
                      alert('✅ Vídeo marcado como publicado no sistema!');
                      onClose();
                    }}
                    className="px-2.5 py-1 bg-[#14261B] hover:bg-[#1B3525] text-[#7EE787] border border-[#1E4A30] rounded-md text-[11px] font-semibold cursor-pointer transition-all"
                  >
                    Marcar como Publicado
                  </button>
                )}
              </div>
            </div>
          )}

          {/* WebView Nativo — substitui o <iframe> */}
          <div className="flex-1 bg-white relative">
            <webview
              id="kiosk-webview"
              partition={`persist:account_${account.id}`}
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
              allowpopups
              src={platformTargetUrl}
              className="w-full h-full border-0"
            />

            {/* Floating Security Badge */}
            <div className="absolute bottom-4 right-4 bg-slate-900/90 backdrop-blur-md text-white border border-slate-700/80 px-4 py-2.5 rounded-xl text-xs shadow-xl flex items-center gap-3 z-10">
              <span className="text-lg">🛡️</span>
              <div>
                <p className="font-bold text-[11px]">Sessão Kiosk Ativa</p>
                <p className="text-[10px] text-slate-400">
                  Navegue e publique. Configurações e senhas são bloqueadas automaticamente.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
