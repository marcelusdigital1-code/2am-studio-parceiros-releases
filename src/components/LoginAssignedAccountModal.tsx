import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, type Account } from '../lib/supabase';
import { decryptCred } from '../lib/crypto';
import { PlatformIcon } from './PlatformIcon';

interface Props {
  partnerId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export const LoginAssignedAccountModal: React.FC<Props> = ({
  partnerId,
  onClose,
}) => {
  const [step, setStep] = useState<'select' | 'browser' | 'chrome-opened'>('select');
  const [assignedAccounts, setAssignedAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [tiktokQrBase64, setTiktokQrBase64] = useState<string | null>(null);

  // States do navegador Kiosk (webview — apenas YouTube/Facebook)
  const [injecting, setInjecting] = useState(false);
  const [injectionNotice, setInjectionNotice] = useState<string | null>(null);
  const [requestCodeLoading, setRequestCodeLoading] = useState(false);
  const [emailCodeValue, setEmailCodeValue] = useState<string | null>(null);
  const [emailCodeMessage, setEmailCodeMessage] = useState<string | null>(null);

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

  useEffect(() => {
    fetchAssignedAccounts();
    return () => {
      clearCodeListeners();
    };
  }, [partnerId, clearCodeListeners]);

  useEffect(() => {
    if (!window.electronAPI?.onTikTokQRStream) return;
    window.electronAPI.onTikTokQRStream(({ profileId, qrDataUrl }) => {
      if (selectedAccount && (selectedAccount.account_code === profileId || `tiktok-login-${selectedAccount.id}` === profileId || selectedAccount.id === profileId)) {
        setTiktokQrBase64(qrDataUrl);
      }
    });
  }, [selectedAccount]);

  const fetchAssignedAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setAssignedAccounts(data as Account[]);
      }
    } catch (err) {
      console.error('Erro ao buscar contas atribuídas:', err);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const getLoginUrl = (platform: string) => {
    switch (platform) {
      case 'tiktok':
        return 'https://www.tiktok.com/';
      case 'youtube':
        return 'https://accounts.google.com/signin';
      case 'facebook':
        return 'https://www.facebook.com/login';
      default:
        return 'https://www.tiktok.com/';
    }
  };

  const isValidEmail = (str?: string | null): boolean => {
    if (!str) return false;
    const s = str.trim();
    return s.includes('@') && s.includes('.') && !s.startsWith('@') && s.length > 5;
  };

  // ── Abrir TikTok no Chrome Real com isolamento de perfil e automação ──
  const openTikTokInChrome = async (acc: Account) => {
    try {
      if (window.electronAPI?.openChromeSignup) {
        const gEmail = isValidEmail(acc.google_email)
          ? acc.google_email!.trim()
          : (isValidEmail(acc.controlled_emails?.email)
              ? acc.controlled_emails!.email.trim()
              : (isValidEmail(acc.username) ? acc.username.trim() : ''));
        const gPass = acc.google_password_encrypted || acc.controlled_emails?.password_encrypted || acc.password_encrypted || '';

        window.electronAPI.openChromeSignup({
          url: 'https://www.tiktok.com/',
          profileId: acc.account_code,
          email: acc.controlled_emails?.email || '',
          pass: acc.password_encrypted || '',
          googleEmail: gEmail,
          googlePass: gPass,
          platform: 'tiktok',
          partnerId: partnerId,
          accountId: acc.id,
          runInBackground: false,
        });
        onClose();
      }
    } catch (err) {
      console.error('Erro ao abrir Chrome para TikTok:', err);
    }
  };

  // Processar resposta do ADM (recebido por Realtime ou Polling REST)
  const handleCodeResponse = useCallback((status: string, codeVal: string | null) => {
    if (status === 'responded' && codeVal) {
      setEmailCodeValue(codeVal);
      setEmailCodeMessage(`✨ CÓDIGO 2FA RECEBIDO DO ADM: ${codeVal}`);

      handleInjectCodeToWebview(codeVal);

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
      setEmailCodeMessage('❌ Pedido de código negado pelo Administrador.');
      clearCodeListeners();
    }
  }, [clearCodeListeners]);

  // Solicitar ao ADM o código 2FA / Verificação de Login (webview)
  const handleRequestLoginCode = async () => {
    if (!selectedAccount) return;
    setRequestCodeLoading(true);
    setEmailCodeMessage(null);
    clearCodeListeners();

    try {
      const reqCode = 'REQ-2FA-' + Math.floor(1000 + Math.random() * 9000);

      const { data, error } = await supabase
        .from('code_requests')
        .insert({
          request_code: reqCode,
          partner_id: partnerId,
          account_id: selectedAccount.id,
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
          title: '🔑 Pedido de Código 2FA para Login',
          message: `O parceiro solicitou código 2FA para a conta ${selectedAccount.username} (${selectedAccount.platform.toUpperCase()}). Pedido: ${reqCode}`,
          type: 'code_request',
          is_read: false,
        });
      } catch (errNotif) {
        console.error('Notificação ADM erro:', errNotif);
      }

      setEmailCodeMessage('⏳ Pedido enviado ao ADM! Aguardando o ADM enviar o código 2FA...');

      const channel = supabase
        .channel(`login_code_req_${data.id}`)
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
        );

      channel.subscribe();
      channelRef.current = channel;

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
      const detail = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message || JSON.stringify(err);
      console.error('handleRequestLoginCode ERRO:', err);
      setEmailCodeMessage('❌ Erro: ' + detail);
    } finally {
      setRequestCodeLoading(false);
    }
  };

  // Injetar credenciais de Login de forma cega no webview (YouTube/Facebook)
  const handleInjectCredentialsToLogin = async () => {
    if (!selectedAccount) return;

    setInjecting(true);

    try {
      const { data: fullAcc } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', selectedAccount.id)
        .single();

      const passVal = fullAcc?.password_encrypted ? await decryptCred(fullAcc.password_encrypted) : '';
      const emailVal = fullAcc?.username || '';

      const jsCode = `
        (function() {
          function setVal(el, val) {
            if (!el) return;
            var setter = Object.getOwnPropertyDescriptor(el, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
            if (setter) { setter.call(el, val); } else { el.value = val; }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }

          var inputs = Array.from(document.querySelectorAll('input'));

          var userEl = inputs.find(function(i) {
            var p = (i.placeholder || '').toLowerCase();
            var n = (i.name || '').toLowerCase();
            var t = (i.type || '').toLowerCase();
            return p.indexOf('email') > -1 || p.indexOf('username') > -1 || p.indexOf('telef') > -1 ||
                   n.indexOf('email') > -1 || n.indexOf('user') > -1 || t === 'email' || t === 'text';
          }) || inputs[0];

          if (userEl) { setVal(userEl, ${JSON.stringify(emailVal)}); }

          var passEl = inputs.find(function(i) {
            return i.type === 'password' || (i.name || '').toLowerCase().indexOf('pass') > -1 || (i.placeholder || '').toLowerCase().indexOf('senha') > -1;
          });

          if (passEl) { setVal(passEl, ${JSON.stringify(passVal)}); }

          setTimeout(function() {
            var attempts = 0;
            var clickInterval = setInterval(function() {
              attempts++;
              try {
                var candidates = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], input[type="submit"]'));
                var loginBtn = candidates.find(function(b) {
                  var t = (b.textContent || b.value || '').toLowerCase().trim();
                  return t.indexOf('log in') > -1 || t.indexOf('login') > -1 || t.indexOf('entrar') > -1 || t.indexOf('sign in') > -1 || t.indexOf('iniciar sessão') > -1;
                });
                if (loginBtn) {
                  var isDisabled = loginBtn.hasAttribute('disabled') || loginBtn.getAttribute('aria-disabled') === 'true';
                  if (!isDisabled || attempts >= 6) {
                    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function(evt) {
                      try { loginBtn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window })); } catch(e) {}
                    });
                    try { loginBtn.click(); } catch(e) {}
                    clearInterval(clickInterval);
                  }
                }
              } catch(eBtn) {}
              if (attempts >= 8) { clearInterval(clickInterval); }
            }, 350);
          }, 600);
        })();
      `;

      const webviewEl = document.getElementById('login-assigned-webview') as unknown as { executeJavaScript: (code: string) => Promise<unknown> } | null;
      if (webviewEl && typeof webviewEl.executeJavaScript === 'function') {
        webviewEl.executeJavaScript(jsCode).catch(console.error);
      }

      setTimeout(() => {
        setInjecting(false);
        setInjectionNotice('🔒 Credenciais de Login injetadas de forma cega e segura!');
        setTimeout(() => setInjectionNotice(null), 4000);
      }, 800);
    } catch (err) {
      console.error('Erro na injeção de login:', err);
      setInjecting(false);
    }
  };

  // Injetar código 2FA no webview
  const handleInjectCodeToWebview = (code: string) => {
    const jsCode = `
      (function() {
        function setVal(el, val) {
          if (!el) return;
          var setter = Object.getOwnPropertyDescriptor(el, 'value')?.set ||
                       Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
          if (setter) { setter.call(el, val); } else { el.value = val; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        var codeInput = document.querySelector('input[placeholder*="code"], input[name*="code"], input[type="number"], input[maxlength="6"]');
        if (codeInput) {
          setVal(codeInput, ${JSON.stringify(code)});
        }

        setTimeout(function() {
          var nextBtn = Array.from(document.querySelectorAll('button')).find(function(b) {
            var t = (b.textContent || '').toLowerCase();
            return t.indexOf('avançar') > -1 || t.indexOf('próximo') > -1 || t.indexOf('confirm') > -1 || t.indexOf('verify') > -1 || t.indexOf('next') > -1 || b.type === 'submit';
          });
          if (nextBtn) { nextBtn.click(); }
        }, 700);
      })();
    `;

    const webviewEl = document.getElementById('login-assigned-webview') as unknown as { executeJavaScript: (code: string) => Promise<unknown> } | null;
    if (webviewEl && typeof webviewEl.executeJavaScript === 'function') {
      webviewEl.executeJavaScript(jsCode).catch(console.error);
    }
  };

  // Configuração do Webview + Allowlist de URLs
  useEffect(() => {
    if (step === 'browser' && selectedAccount) {
      const timer = setTimeout(() => {
        const webviewEl = document.getElementById('login-assigned-webview') as unknown as (HTMLElement & {
          addEventListener: (event: string, listener: (e: Event) => void) => void;
          src: string;
        }) | null;

        if (webviewEl) {
          const allowedPlatform = selectedAccount.platform;

          const handleWillNavigate = (e: Event) => {
            const navEvent = e as unknown as { url?: string; preventDefault?: () => void };
            const targetUrl = (navEvent.url || '').toLowerCase();
            try {
              const u = new URL(targetUrl);
              const path = u.pathname.toLowerCase();
              if (path.includes('/settings') || path.includes('/security') || path.includes('/password')) {
                if (typeof navEvent.preventDefault === 'function') navEvent.preventDefault();
                webviewEl.src = getLoginUrl(allowedPlatform);
              }
            } catch(err) {}
          };

          webviewEl.addEventListener('will-navigate', handleWillNavigate);
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [step, selectedAccount]);


  // ── PASSO: CHROME REAL ABERTO PARA TIKTOK ──
  if (step === 'chrome-opened' && selectedAccount) {
    return (
      <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-7 space-y-5 shadow-2xl text-center">
          <div className="flex items-center justify-center gap-3">
            <PlatformIcon platform="tiktok" className="w-10 h-10 rounded-xl" />
            <div className="text-left">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Login TikTok por QR Code</span>
                <span className="text-[10px] bg-pink-500/20 text-pink-300 border border-pink-500/40 px-2 py-0.5 rounded-full font-bold">
                  Zero Cliques
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Conta: <span className="text-pink-400 font-semibold">{selectedAccount.username}</span>
              </p>
            </div>
          </div>

          {/* QR Code Frame */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col items-center gap-3">
            {tiktokQrBase64 ? (
              <div className="p-3 bg-white rounded-2xl shadow-xl border-4 border-pink-500/80 animate-fade-in">
                <img
                  src={tiktokQrBase64}
                  alt="QR Code TikTok"
                  className="w-52 h-52 object-contain rounded-lg"
                />
              </div>
            ) : (
              <div className="w-52 h-52 flex flex-col items-center justify-center text-slate-500 text-xs bg-slate-900 rounded-2xl border border-slate-800">
                <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                <span className="font-semibold text-slate-400">Capturando QR Code...</span>
                <span className="text-[10px] text-slate-500 mt-1">Carregando direto do TikTok</span>
              </div>
            )}
            <p className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
              <span>📡</span> Transmitido em tempo real ao painel do Administrador
            </p>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 text-left space-y-1.5 text-xs text-slate-300">
            <p className="font-bold text-white text-xs">Como autorizar:</p>
            <p>1. O <strong>Administrador</strong> já recebeu este QR Code no painel e pode autorizar pelo celular com 1 toque.</p>
            <p>2. Assim que o ADM confirmar, o Chrome entrará sozinho e salvará a sessão permanentemente.</p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => { setStep('select'); setSelectedAccount(null); setTiktokQrBase64(null); }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all"
            >
              ↩️ Trocar Conta
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white rounded-xl text-xs font-bold shadow-md transition-all"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // PASSO 2: MODO NAVEGADOR KIOSK DE LOGIN (YouTube / Facebook)
  if (step === 'browser' && selectedAccount) {
    return (
      <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col animate-fade-in">
        {/* Barra Superior de Controle */}
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xl z-20">
          <div className="flex items-center gap-3">
            <PlatformIcon platform={selectedAccount.platform} className="w-6 h-6 shrink-0 rounded-md" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">Login em Conta Atribuída</h3>
                <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded-full font-mono font-bold">
                  Conta: {selectedAccount.username}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Sessão Kiosk Controlada • Credenciais Injetadas sem Acesso à Senha
              </p>
            </div>
          </div>

          {/* Botões de Ação na Barra */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleInjectCredentialsToLogin}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-extrabold shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2"
            >
              <span>⚡</span>
              <span>Injetar Login e Senha Cegos</span>
            </button>

            <button
              type="button"
              onClick={handleRequestLoginCode}
              disabled={requestCodeLoading}
              className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-extrabold shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <span>🔑</span>
              <span>{requestCodeLoading ? 'Solicitando...' : 'Pedir Código 2FA ao ADM'}</span>
            </button>

            <button
              type="button"
              onClick={() => { setStep('select'); setSelectedAccount(null); }}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all"
            >
              ↩️ Trocar Conta
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-slate-400 hover:text-white text-xs font-semibold"
            >
              Fechar
            </button>
          </div>
        </div>

        {/* Banner de Notificações de 2FA ou Injeção */}
        {(injectionNotice || emailCodeMessage) && (
          <div
            className={`px-6 py-2 text-xs font-extrabold flex items-center justify-between border-b shadow-inner ${
              emailCodeValue
                ? 'bg-emerald-950 text-emerald-200 border-emerald-600/50'
                : 'bg-amber-950 text-amber-300 border-amber-600/50 animate-pulse'
            }`}
          >
            <span>{injectionNotice || emailCodeMessage}</span>
          </div>
        )}

        {/* Corpo Principal: Webview Nativo */}
        <div className="flex-1 relative bg-slate-950 overflow-hidden">
          {injecting && (
            <div className="absolute inset-0 bg-slate-950 z-30 flex flex-col items-center justify-center space-y-3 animate-fade-in">
              <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-emerald-400 font-bold text-xs">🔒 Injetando credenciais na página de login de forma cega...</p>
            </div>
          )}

          <webview
            id="login-assigned-webview"
            partition={`persist:account_${selectedAccount.id}`}
            useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            allowpopups
            src={getLoginUrl(selectedAccount.platform)}
            className="w-full h-full border-0 bg-white"
          />
        </div>
      </div>
    );
  }

  // PASSO 1: SELEÇÃO DE CONTA ATRIBUÍDA
  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 space-y-6 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>🔐</span> Logar com Conta Atribuída pelo ADM
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Selecione uma das contas disponíveis para acessar com credenciais ocultas
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl font-bold w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Lista de Contas */}
        {loadingAccounts ? (
          <div className="py-12 text-center text-xs text-slate-400 italic">
            Buscando contas atribuídas pelo Administrador...
          </div>
        ) : assignedAccounts.length === 0 ? (
          <div className="py-10 text-center space-y-3 bg-slate-950/60 border border-slate-800 rounded-2xl">
            <span className="text-3xl block">📱</span>
            <p className="text-sm font-bold text-white">Nenhuma conta atribuída encontrada</p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              O administrador ainda não atribuiu contas ativas para este perfil de parceiro.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {assignedAccounts.map((acc) => {
              const isTikTok = acc.platform === 'tiktok';
              return (
                <div
                  key={acc.id}
                  className="bg-slate-950 border border-slate-800 hover:border-slate-700 p-4 rounded-2xl flex items-center justify-between transition-all"
                >
                  <div className="flex items-center gap-3">
                    <PlatformIcon platform={acc.platform} className="w-7 h-7 shrink-0 rounded-lg" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-white text-sm">{acc.username}</h4>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md">
                          {acc.account_code}
                        </span>
                        {isTikTok && (
                          <span className="text-[10px] bg-pink-950 text-pink-400 border border-pink-800/50 px-2 py-0.5 rounded-full font-bold">
                            Chrome Real
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 capitalize">
                        Plataforma: {acc.platform} • Status: <span className="text-emerald-400 font-semibold">{acc.status}</span>
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (isTikTok) {
                        openTikTokInChrome(acc);
                      } else {
                        setSelectedAccount(acc);
                        setStep('browser');
                      }
                    }}
                    className={`px-4 py-2 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 shrink-0 ${
                      isTikTok
                        ? 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 shadow-pink-600/20'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-600/20'
                    }`}
                  >
                    <span>{isTikTok ? '🎵' : '🔐'}</span>
                    <span>Entrar nesta Conta</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Footer */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
