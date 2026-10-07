import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, type Account } from '../lib/supabase';
import { PlatformIcon } from './PlatformIcon';

interface Props {
  account: Account;
  partnerId: string;
  onClose: () => void;
}

export const ChromeProfileLauncherModal: React.FC<Props> = ({
  account,
  partnerId,
  onClose,
}) => {
  const [chromeStatus, setChromeStatus] = useState<'closed' | 'opening' | 'ready' | 'injected' | 'page-loaded'>('opening');
  const [accountEmail, setAccountEmail] = useState<string | null>(null);

  // 2FA code request states
  const [requestCodeLoading, setRequestCodeLoading] = useState(false);
  const [emailCodeValue, setEmailCodeValue] = useState<string | null>(null);
  const [emailCodeMessage, setEmailCodeMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

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

  const getTargetUrl = (platform: string) => {
    switch (platform) {
      case 'tiktok':
        return 'https://www.tiktok.com/';
      case 'youtube':
        return 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fstudio.youtube.com%2F';
      case 'facebook':
        return account.profile_url || 'https://www.facebook.com/login';
      case 'instagram':
        return 'https://www.instagram.com/accounts/login/';
      default:
        return 'https://www.tiktok.com/';
    }
  };

  const maskEmail = (emailStr: string | null): string => {
    if (!emailStr) return 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢';
    const parts = emailStr.split('@');
    if (parts.length !== 2) return 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢';
    return `â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢@${parts[1]}`;
  };

  const [profilePersona, setProfilePersona] = useState<{
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    gender?: string;
  } | null>(null);

  // Buscar email e persona associados Ã  conta
  useEffect(() => {
    async function loadAccountDetails() {
      if (account.controlled_email_id) {
        const { data } = await supabase
          .from('controlled_emails')
          .select('email')
          .eq('id', account.controlled_email_id)
          .single();
        if (data?.email) setAccountEmail(data.email);
      }

      if (account.profile_id) {
        const { data: prof } = await supabase
          .from('account_profiles')
          .select('first_name, last_name, birth_date, gender')
          .eq('id', account.profile_id)
          .single();
        if (prof) {
          setProfilePersona({
            firstName: prof.first_name || '',
            lastName: prof.last_name || '',
            birthDate: prof.birth_date || '',
            gender: prof.gender || 'male',
          });
        }
      }
    }
    loadAccountDetails();
  }, [account]);

  // Cleanup de listeners ao desmontar o modal (NUNCA encerra o Chrome automaticamente)
  useEffect(() => {
    return () => {
      clearCodeListeners();
    };
  }, [clearCodeListeners]);

  // Chrome IPC event listeners
  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onChromeReady(() => {
      setChromeStatus('ready');
    });

    window.electronAPI.onChromePageLoaded(() => {
      setChromeStatus('page-loaded');
    });

    window.electronAPI.onChromeInjected(() => {
      setChromeStatus('injected');
    });

    window.electronAPI.onChromeClosed((data?: { profileId?: string }) => {
      if (!data?.profileId || data.profileId === account.account_code) {
        setChromeStatus('closed');
        onClose();
      }
    });

    window.electronAPI.onChromeAlreadyRunning?.(({ profileId }) => {
      if (!profileId || profileId === account.account_code) {
        setChromeStatus('ready');
      }
    });
  }, [account.account_code, account.username, onClose]);

  const isValidEmail = (str?: string | null): boolean => {
    if (!str) return false;
    const s = str.trim();
    return s.includes('@') && s.includes('.') && !s.startsWith('@') && s.length > 5;
  };

  const gEmail = isValidEmail(account.google_email)
    ? account.google_email!.trim()
    : (isValidEmail(account.controlled_emails?.email)
        ? account.controlled_emails!.email.trim()
        : (isValidEmail(accountEmail)
            ? accountEmail!.trim()
            : (isValidEmail(account.username) ? account.username.trim() : '')));

  const gPass = account.google_password_encrypted || account.controlled_emails?.password_encrypted || account.password_encrypted || '';

  // Resolva o e-mail: para TikTok e YouTube (Google OAuth) prioriza email Google válido; para FB e IG prioriza email/login da conta
  const resolvedEmail = (account.platform === 'tiktok' || account.platform === 'youtube')
    ? (gEmail || account.controlled_emails?.email || accountEmail || account.username || '')
    : (account.platform === 'instagram')
      ? ((account.username && account.username.includes('@')) ? account.username.trim() : (account.controlled_emails?.email || accountEmail || account.username || ''))
      : ((account.username && account.username.trim()) ? account.username.trim() : (account.controlled_emails?.email || accountEmail || ''));

  // Abrir Chrome Real ou focar sessão ativa para esta conta
  useEffect(() => {
    if (!account.account_code) return;

    const pageUrl = account.platform === 'facebook' && account.profile_url ? account.profile_url : '';

    if (window.electronAPI) {
      window.electronAPI.openChromeSignup({
        url: pageUrl ? pageUrl : getTargetUrl(account.platform),
        profileId: account.account_code,
        email: resolvedEmail,
        pass: account.password_encrypted || gPass || '',
        googleEmail: gEmail,
        googlePass: gPass,
        birthDate: profilePersona?.birthDate || account.birth_date || '15/06/1998',
        partnerId: partnerId,
        accountId: account.id,
        firstName: profilePersona?.firstName || '',
        lastName: profilePersona?.lastName || '',
        gender: profilePersona?.gender || 'male',
        platform: account.platform as 'tiktok' | 'youtube' | 'facebook' | 'instagram',
        pageUrl: pageUrl || undefined,
      });
    } else {
      setErrorMsg('Electron não disponível.');
      setChromeStatus('closed');
    }
  }, [account.account_code]);

  // Injetar credenciais cegas no Chrome via CDP (Sempre disponÃ­vel)
  const handleInjectCredentials = useCallback(() => {
    if (!window.electronAPI || !resolvedEmail) return;
    window.electronAPI.chromeInjectCredentials({
      email: resolvedEmail,
      pass: account.password_encrypted || '',
      profileId: account.account_code,
      firstName: profilePersona?.firstName || '',
      lastName: profilePersona?.lastName || '',
      birthDate: profilePersona?.birthDate || account.birth_date || '15/06/1998',
      gender: profilePersona?.gender || 'male',
    });
  }, [account, resolvedEmail, profilePersona]);

  const isRequestingRef = useRef(false);

  // Processar resposta do ADM (recebido por Realtime ou Polling REST)
  const handleCodeResponse = useCallback((status: string, codeVal: string | null) => {
    if (status === 'responded' && codeVal) {
      setEmailCodeValue(codeVal);
      setEmailCodeMessage('âœ¨ CÃ“DIGO RECEBIDO DO ADM! A injetar no Chrome Real...');

      if (window.electronAPI) {
        window.electronAPI.chromeInjectCode({
          code: codeVal,
          profileId: account.account_code,
        });
      }

      try {
        if ('Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('âœ¨ CÃ³digo 2FA Recebido do ADM!', { body: `CÃ³digo: ${codeVal}` });
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then((p) => {
              if (p === 'granted') new Notification('âœ¨ CÃ³digo 2FA Recebido do ADM!', { body: `CÃ³digo: ${codeVal}` });
            });
          }
        }
      } catch {}

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
      setEmailCodeMessage('âŒ ADM negou o pedido de cÃ³digo.');
      clearCodeListeners();
    }
  }, [account.account_code, clearCodeListeners]);

  // Solicitar cÃ³digo 2FA ao ADM (Executa com cliente Supabase Autenticado - 0 RLS Errors)
  const handleRequestCode = useCallback(async () => {
    if (!resolvedEmail || isRequestingRef.current) return;
    isRequestingRef.current = true;
    setRequestCodeLoading(true);
    setEmailCodeMessage(null);
    clearCodeListeners();

    try {
      const reqCode = 'REQ-' + Math.floor(1000 + Math.random() * 9000);

      const { data, error } = await supabase
        .from('code_requests')
        .insert({
          request_code: reqCode,
          partner_id: partnerId,
          account_id: account.id,
          email: resolvedEmail,
          password_encrypted: null,
          birth_date: account.birth_date || null,
          request_type: 'totp',
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      try {
        await supabase.from('notifications').insert({
          target_type: 'admin',
          target_id: partnerId || '00000000-0000-0000-0000-000000000000',
          title: 'ðŸ”‘ Pedido de CÃ³digo 2FA Recebido',
          message: `O parceiro solicitou cÃ³digo 2FA para o perfil ${account.username} (${account.account_code}). Pedido: ${reqCode}`,
          type: 'code_request',
          is_read: false,
        });
      } catch (errNotif) {
        console.error('NotificaÃ§Ã£o ADM erro:', errNotif);
      }

      setEmailCodeMessage('â³ Pedido enviado ao ADM! Aguardando resposta...');

      // 1. Ouvinte Realtime Supabase
      const channel = supabase
        .channel(`profile_code_req_${data.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'code_requests',
            filter: `id=eq.${data.id}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            const updated = payload.new as unknown as {
              status: string;
              code_value: string | null;
            };
            handleCodeResponse(updated.status, updated.code_value);
          }
        )
        .subscribe();

      channelRef.current = channel;

      // 2. Fallback por Polling REST a cada 1.5 segundos
      pollIntervalRef.current = setInterval(async () => {
        try {
          const { data: pollData } = await supabase
            .from('code_requests')
            .select('status, code_value')
            .eq('id', data.id)
            .single();

          if (pollData && (pollData.status === 'responded' || pollData.status === 'denied')) {
            handleCodeResponse(pollData.status, pollData.code_value);
          }
        } catch {}
      }, 1500);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao solicitar cÃ³digo.';
      setEmailCodeMessage(`âŒ ${msg}`);
    } finally {
      setRequestCodeLoading(false);
      setTimeout(() => {
        isRequestingRef.current = false;
      }, 5000);
    }
  }, [account, partnerId, resolvedEmail, clearCodeListeners, handleCodeResponse]);

  // Escutar pedido de 2FA vindo do botÃ£o no Chrome Real
  useEffect(() => {
    if (window.electronAPI?.onChromeRequest2FA) {
      window.electronAPI.onChromeRequest2FA(() => {
        handleRequestCode();
      });
    }
  }, [handleRequestCode]);

  // Escutar status de autenticaÃ§Ã£o/conexÃ£o do Chrome Real
  useEffect(() => {
    if (window.electronAPI?.onChromeAuthStatus) {
      window.electronAPI.onChromeAuthStatus((data) => {
        if (!data.profileId || data.profileId === account.account_code) {
          setIsConnected(data.isLoggedIn);
        }
      });
    }
  }, [account.account_code]);

  // Escutar tentativas de acesso bloqueadas no Chrome Real e registrar no Supabase
  useEffect(() => {
    if (window.electronAPI?.onChromeBlockedAttempt) {
      window.electronAPI.onChromeBlockedAttempt(async (data) => {
        if (!data.profileId || data.profileId === account.account_code) {
          console.warn('[SECURITY AUDIT] Tentativa de acesso bloqueada:', data);
          try {
            await supabase.from('notifications').insert({
              target_type: 'admin',
              target_id: partnerId || '00000000-0000-0000-0000-000000000000',
              title: 'ðŸ›¡ï¸ Tentativa de Acesso Restrito Bloqueada',
              message: `O parceiro tentou acessar "${data.url}" no perfil ${account.username} (${account.account_code}) e foi redirecionado automaticamente para "${data.redirectedTo}".`,
              type: 'security_alert',
              is_read: false,
            });
          } catch (err) {
            console.error('Erro ao registrar notificaÃ§Ã£o de auditoria no Supabase:', err);
          }
        }
      });
    }
  }, [account.account_code, account.username, partnerId]);

  return (
    <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col animate-fade-in">
      {/* Top Restricted Control Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xl z-20">
        <div className="flex items-center gap-3">
          <PlatformIcon platform={account.platform} className="w-8 h-8 shrink-0 rounded-lg" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white">{account.username}</h3>
              <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded-full font-mono font-bold">
                {account.account_code}
              </span>
              <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full font-mono font-bold">
                Email: {maskEmail(accountEmail || account.username)}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              SessÃ£o do Chrome Real Isolada â€¢ Protegida com Filtro de URLs e OcultaÃ§Ã£o de DefiniÃ§Ãµes
            </p>
          </div>
        </div>

        {/* Action Buttons â€” Ocultados automaticamente quando o utilizador jÃ¡ estÃ¡ conectado */}
        <div className="flex items-center gap-3">
          {!isConnected ? (
            <>
              <button
                type="button"
                onClick={handleInjectCredentials}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2 scale-105 active:scale-95 cursor-pointer"
                title="Injetar e-mail e senha encriptados no formulÃ¡rio do Chrome"
              >
                <span className="text-sm">âš¡</span>
                <span>INJETAR EMAIL E SENHA CEGOS</span>
              </button>

              <button
                type="button"
                onClick={handleRequestCode}
                disabled={requestCodeLoading}
                className="px-4 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-extrabold shadow-md transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <span>ðŸ”‘</span>
                <span>{requestCodeLoading ? 'Solicitando...' : 'Pedir CÃ³digo 2FA ao ADM'}</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs font-black shadow-inner">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>CONECTADO / SESSÃƒO ATIVA</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (window.electronAPI) {
                window.electronAPI.closeChromeSession(account.account_code);
              }
              onClose();
            }}
            className="px-4 py-2.5 bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-800/60 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            âŒ Encerrar SessÃ£o
          </button>
        </div>
      </div>

      {/* Realtime Notification Banner */}
      {(emailCodeMessage || chromeStatus === 'opening') && !isConnected && (
        <div
          className={`px-6 py-2.5 text-xs font-extrabold flex items-center justify-between border-b shadow-inner ${
            emailCodeValue
              ? 'bg-emerald-950 text-emerald-200 border-emerald-600/50'
              : 'bg-amber-950 text-amber-300 border-amber-600/50 animate-pulse'
          }`}
        >
          <div className="flex items-center gap-3">
            <span>{emailCodeMessage || 'â³ A abrir Chrome Real com velocidade mÃ¡xima de navegaÃ§Ã£o...'}</span>
            {emailCodeValue && (
              <span className="font-mono text-sm bg-emerald-900/80 border border-emerald-500 px-3 py-0.5 rounded-lg text-emerald-300 font-black tracking-widest">
                {emailCodeValue}
              </span>
            )}
          </div>
          {emailCodeValue && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(emailCodeValue);
                alert('CÃ³digo copiado: ' + emailCodeValue);
              }}
              className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-lg text-xs font-mono shadow"
            >
              ðŸ“‹ COPIAR ({emailCodeValue})
            </button>
          )}
        </div>
      )}

      {/* Main Info Body */}
      <div className="flex-1 bg-slate-950 flex flex-col items-center justify-center text-slate-500 text-sm">
        <div className="text-center space-y-4 p-6">
          <div className="text-6xl">ðŸŒ</div>
          <p className="font-bold text-white text-lg">Perfil {account.username} ({account.account_code}) Ativo</p>
          <p className="text-slate-300 max-w-lg text-center text-sm">
            O Chrome Real estÃ¡ aberto no seu ecrÃ£ com a sessÃ£o exclusiva do perfil <b>{account.account_code}</b>.<br />
            Navegue livremente com velocidade real de internet. DefiniÃ§Ãµes sensÃ­veis e alteraÃ§Ã£o de senhas sÃ£o bloqueadas automaticamente.
          </p>

          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border border-rose-800/60 text-rose-300 text-xs rounded-xl max-w-md">
              âŒ {errorMsg}
            </div>
          )}

          {isConnected && (
            <div className="p-4 bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs font-semibold rounded-2xl max-w-lg flex items-center gap-3 shadow-lg">
              <span className="text-2xl">ðŸŽ‰</span>
              <div>
                <p className="font-bold text-white text-sm">Conta Conectada com Sucesso!</p>
                <p className="text-emerald-300/90 text-xs mt-0.5">Os botÃµes de injeÃ§Ã£o e solicitaÃ§Ã£o de cÃ³digo foram ocultados no Chrome Real para navegaÃ§Ã£o desimpedida.</p>
              </div>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 max-w-lg text-left space-y-3 shadow-xl">
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <span>ðŸ›¡ï¸</span> Recursos de SeguranÃ§a & AÃ§Ãµes RÃ¡pidas:
            </p>
            <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed">
              <li>
                <b>InjeÃ§Ã£o Cega:</b> Clique no botÃ£o verde <b>âš¡ INJETAR EMAIL E SENHA CEGOS</b> no topo para preencher os dados de login no Chrome sem ver a senha.
              </li>
              <li>
                <b>SessÃ£o Isolada:</b> Todos os cookies e logins deste perfil ficam guardados na pasta de alta velocidade.
              </li>
              <li>
                <b>Login Google Gmail 100% Suportado:</b> Pode fazer login com a conta Google nativamente sem mensagens de bloqueio.
              </li>
              <li>
                <b>Bloqueio Restrito:</b> Acesso a URLs de seguranÃ§a/password Ã© intercetado e redirecionado automaticamente.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
