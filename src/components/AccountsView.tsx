import React, { useEffect, useState, useRef, useCallback } from 'react';
import { supabase, type Account } from '../lib/supabase';
import { ProfileCard, type GroupedProfile, type AccountWithMetrics, type QueueAccountStatus } from './ProfileCard';
import { sanitizeCode } from '../lib/sanitize';

interface Props {
  partnerId: string;
}

interface ToastNotification {
  id: string;
  type: 'info' | 'pending' | 'success' | 'error';
  title: string;
  message: string;
  code?: string;
}

// Tipos da fila de auto-login
interface AutoLoginQueueItem {
  account: AccountWithMetrics;
  status: QueueAccountStatus;
  message?: string;
  startedAt?: number;
}

export const AccountsView: React.FC<Props> = ({ partnerId }) => {
  const [accounts, setAccounts] = useState<AccountWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningProfileIds, setRunningProfileIds] = useState<string[]>([]);
  const [toast, setToast] = useState<ToastNotification | null>(null);

  // Estado da fila de auto-login
  const [isAutoLoginRunning, setIsAutoLoginRunning] = useState(false);
  const [queueMap, setQueueMap] = useState<Record<string, { status: QueueAccountStatus; message?: string }>>({});
  const autoLoginQueueRef = useRef<AutoLoginQueueItem[]>([]);
  const activeLoginsRef = useRef<Map<string, AutoLoginQueueItem>>(new Map());
  const watchdogTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isAutoLoginRunningRef = useRef(false);

  // Estado de autenticação confirmado no disco por conta
  const [authStatusMap, setAuthStatusMap] = useState<Record<string, boolean>>({});

  const accountsRef = useRef<AccountWithMetrics[]>([]);
  accountsRef.current = accounts;

  const refreshAuthStatus = useCallback(async (accountList: AccountWithMetrics[]) => {
    if (!window.electronAPI?.getProfilesAuthStatus || accountList.length === 0) return;
    try {
      const queryList = accountList.map((a) => ({
        accountCode: a.account_code,
        accountId: a.id || '',
        platform: a.platform,
        partnerId: partnerId,
      }));
      const res = await window.electronAPI.getProfilesAuthStatus(queryList);
      if (res) {
        const hasFbAuth = Object.entries(res).some(([code, isAuth]) => {
          const acc = accountList.find(a => a.account_code === code);
          return acc?.platform === 'facebook' && isAuth;
        });
        const finalMap = { ...res };
        if (hasFbAuth) {
          accountList.filter(a => a.platform === 'facebook').forEach(a => {
            finalMap[a.account_code] = true;
          });
        }
        setAuthStatusMap((prev) => ({ ...prev, ...finalMap }));
      }
    } catch (err) {
      console.warn('[AUTH STATUS] Erro ao carregar status dos perfis:', err);
    }
  }, [partnerId]);

  useEffect(() => {
    if (accounts.length > 0) {
      refreshAuthStatus(accounts);
    }
  }, [accounts, refreshAuthStatus]);

  // Sincronizar perfis de contas com sessões do Chrome Real ativas
  useEffect(() => {
    if (window.electronAPI?.getRunningChromeSessions) {
      window.electronAPI.getRunningChromeSessions().then((ids) => {
        setRunningProfileIds(ids || []);
      });
    }

    if (window.electronAPI?.onChromeSessionsUpdated) {
      window.electronAPI.onChromeSessionsUpdated((ids) => {
        setRunningProfileIds(ids || []);
      });
    }

    if (window.electronAPI?.onChromeClosed) {
      window.electronAPI.onChromeClosed(({ profileId }) => {
        setRunningProfileIds((prev) => prev.filter((id) => id !== profileId));

        // Se foi conta do Facebook, remover todos os perfis Facebook de runningProfileIds (sessão compartilhada)
        const closedAcc = accountsRef.current.find((a) => a.account_code === profileId || a.id === profileId || `tiktok-login-${a.id}` === profileId);
        if (closedAcc?.platform === 'facebook') {
          const fbCodes = accountsRef.current.filter((a) => a.platform === 'facebook').map((a) => a.account_code);
          setRunningProfileIds((prev) => prev.filter((id) => !fbCodes.includes(id)));
        }
        if (closedAcc && window.electronAPI?.checkAccountAuth) {
          window.electronAPI.checkAccountAuth({
            accountCode: closedAcc.account_code,
            accountId: closedAcc.id || '',
            platform: closedAcc.platform,
            partnerId: partnerId,
          }).then((isAuth) => {
            if (isAuth) {
              setAuthStatusMap((prev) => ({ ...prev, [closedAcc.account_code]: true }));
            }
          }).catch(() => {});
        }

        // Integração com fila de auto-login: encontrar chave correspondente
        let targetKey = profileId;
        if (!activeLoginsRef.current.has(targetKey)) {
          for (const [k, v] of activeLoginsRef.current.entries()) {
            if (k === profileId || v.account.id === profileId || v.account.account_code === profileId) {
              targetKey = k;
              break;
            }
          }
        }

        if (activeLoginsRef.current.has(targetKey)) {
          const item = activeLoginsRef.current.get(targetKey)!;
          // Limpar watchdog da conta
          const wd = watchdogTimersRef.current.get(targetKey);
          if (wd) {
            clearTimeout(wd);
            watchdogTimersRef.current.delete(targetKey);
          }

          // Se a janela fechou sem ter registrado sucesso, marcar como falha para pular
          if (item.status !== 'success') {
            item.status = 'failed';
            item.message = item.message || 'Janela fechada sem concluir login';
            setQueueMap((prev) => ({
              ...prev,
              [item.account.account_code]: { status: 'failed', message: item.message || 'Falha no login' },
            }));
          }

          activeLoginsRef.current.delete(targetKey);

          // Avançar a fila com pausa de 1.5s para que o Windows libere completamente os ficheiros SQLite do perfil anterior
          setTimeout(() => {
            dispatchAutoLoginQueueRef.current();
          }, 1500);
        }
      });
    }

    if (window.electronAPI?.onChromeAuthStatus) {
      window.electronAPI.onChromeAuthStatus(async ({ profileId, isLoggedIn }) => {
        console.log(`[AUTH STATUS] Perfil ${profileId} autenticado: ${isLoggedIn}`);
        if (isLoggedIn) {
          const acc = accountsRef.current.find(
            (a) => a.account_code === profileId || a.id === profileId || `tiktok-login-${a.id}` === profileId
          );
          if (acc) {
            if (acc.platform === 'facebook') {
              const fbUpdates: Record<string, boolean> = {};
              accountsRef.current.filter((a) => a.platform === 'facebook').forEach((a) => {
                fbUpdates[a.account_code] = true;
              });
              setAuthStatusMap((prev) => ({ ...prev, ...fbUpdates }));
            } else {
              setAuthStatusMap((prev) => ({ ...prev, [acc.account_code]: true }));
            }
            try {
              await supabase
                .from('code_requests')
                .update({ status: 'responded', responded_at: new Date().toISOString() })
                .eq('account_id', acc.id)
                .eq('request_type', 'tiktok_qr')
                .eq('status', 'pending');
            } catch (_) {}

            // Integração com fila de auto-login: marcar sucesso imediatamente na UI
            // NÃO removemos de activeLoginsRef nem despachamos a fila aqui,
            // pois o Chrome ainda aguarda seu cooldown gracioso de consolidação de cookies e fechará em instantes.
            const key = acc.account_code;
            if (activeLoginsRef.current.has(key)) {
              const item = activeLoginsRef.current.get(key)!;
              const wd = watchdogTimersRef.current.get(key);
              if (wd) {
                clearTimeout(wd);
                watchdogTimersRef.current.delete(key);
              }
              item.status = 'success';
              setQueueMap((prev) => ({ ...prev, [key]: { status: 'success' } }));
            }
            if (acc.platform === 'facebook') {
              for (const [k, v] of activeLoginsRef.current.entries()) {
                if (v.account.platform === 'facebook') {
                  v.status = 'success';
                  setQueueMap((prev) => ({ ...prev, [k]: { status: 'success' } }));
                }
              }
              for (const item of autoLoginQueueRef.current) {
                if (item.account.platform === 'facebook' && item.status === 'pending') {
                  item.status = 'success';
                  setQueueMap((prev) => ({ ...prev, [item.account.account_code]: { status: 'success', message: 'Sessão compartilhada' } }));
                }
              }
            }
          }
        }
      });
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [partnerId]);

  const normalizeAccount = (raw: any): AccountWithMetrics => {
    let controlled_emails = raw.controlled_emails;
    if (Array.isArray(controlled_emails)) {
      controlled_emails = controlled_emails[0] || null;
    }
    let account_profiles = raw.account_profiles;
    if (Array.isArray(account_profiles)) {
      account_profiles = account_profiles[0] || null;
    }
    let account_metrics = raw.account_metrics;
    if (Array.isArray(account_metrics)) {
      account_metrics = account_metrics[0] || null;
    }
    return {
      ...raw,
      controlled_emails,
      account_profiles,
      account_metrics,
    };
  };

  const fetchAccounts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('accounts')
      .select(`
        *,
        account_metrics(*),
        controlled_emails!controlled_email_id(email, password_encrypted),
        account_profiles!profile_id(first_name, last_name, birth_date, gender, profile_name, name)
      `)
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false });

    if (error) {
      const { data: fallbackData } = await supabase
        .from('accounts')
        .select(`
          *,
          account_metrics(*),
          controlled_emails!controlled_email_id(email, password_encrypted)
        `)
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (fallbackData) {
        setAccounts((fallbackData as any[]).map(normalizeAccount));
      }
    } else if (data) {
      setAccounts((data as any[]).map(normalizeAccount));
    }
    setLoading(false);
  };

  // Escutar alterações de status das contas em Tempo Real enviadas pelo ADM
  useEffect(() => {
    if (!partnerId) return;

    const channel = supabase
      .channel(`partner_accounts_realtime_${partnerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'accounts',
          filter: `partner_id=eq.${partnerId}`,
        },
        (payload: { new: Record<string, unknown>; eventType: string }) => {
          if (payload.eventType === 'UPDATE' && payload.new) {
            const updatedAcc = payload.new as unknown as Account;

            // Se o Administrador suspender ou banir a conta enquanto o parceiro navega, fecha o Chrome IMEDIATAMENTE!
            if (
              (updatedAcc.status === 'suspended' || updatedAcc.status === 'banned') &&
              runningProfileIds.includes(updatedAcc.account_code)
            ) {
              if (window.electronAPI?.closeChromeSession) {
                window.electronAPI.closeChromeSession(updatedAcc.account_code);
              }
              setRunningProfileIds((prev) => prev.filter((id) => id !== updatedAcc.account_code));
              alert(`🚫 O Administrador alterou o status do perfil ${updatedAcc.username} (${updatedAcc.account_code}) para ${updatedAcc.status.toUpperCase()}. A sessão foi encerrada.`);
            }
          }
          fetchAccounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [partnerId, runningProfileIds]);

  // Listener para pedidos 2FA vindos do Chrome Real via CDP
  useEffect(() => {
    if (!window.electronAPI?.onChromeRequest2FA) return;

    const playChime = () => {
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
    };

    // Throttle: no máximo 1 notificação 2FA a cada 90 segundos por profileId (exceto se for re-tentativa após código incorreto)
    const _fa2LastSent: Record<string, number> = {};
    window.electronAPI.onChromeRequest2FA(async ({ profileId, partnerId: evtPartnerId, platform, isRetry, errorMessage, accountId, codeType, email: evtEmail }) => {
      const _now = Date.now();
      if (!isRetry && _fa2LastSent[profileId] && _now - _fa2LastSent[profileId] < 90000) {
        console.log('[2FA-THROTTLE] Notificação ignorada (cooldown 90s) para', profileId);
        return;
      }
      _fa2LastSent[profileId] = _now;

      // Localização precisa da conta alvo: NUNCA fazer fallback cego para a primeira conta da lista
      let acc: AccountWithMetrics | undefined;
      if (accountId) {
        acc = accountsRef.current.find((a) => a.id === accountId);
      }
      if (!acc && profileId) {
        acc = accountsRef.current.find((a) => a.account_code === profileId || a.id === profileId);
      }
      if (!acc && evtEmail) {
        const cleanEvtEmail = evtEmail.trim().toLowerCase();
        acc = accountsRef.current.find(
          (a) =>
            a.controlled_emails?.email?.trim().toLowerCase() === cleanEvtEmail ||
            a.google_email?.trim().toLowerCase() === cleanEvtEmail ||
            a.username?.trim().toLowerCase() === cleanEvtEmail
        );
      }
      if (!acc && platform) {
        acc = accountsRef.current.find((a) => a.platform === platform);
      }

      const effPlatform = (platform || acc?.platform || '').toLowerCase();
      const platformName = effPlatform === 'tiktok' ? 'TikTok'
        : (effPlatform === 'youtube' || effPlatform === 'google') ? 'YouTube / Google'
        : effPlatform === 'facebook' ? 'Facebook'
        : effPlatform === 'instagram' ? 'Instagram'
        : 'Plataforma';

      let reqType = 'totp';
      let codeInstructions = '';

      if (effPlatform === 'tiktok') {
        if (codeType === 'google_totp') {
          reqType = 'totp';
          codeInstructions = 'Login TikTok via Google: Código 2FA da Google (Google Authenticator, SMS ou aviso no telemóvel da conta Google vinculada)';
        } else {
          reqType = 'email_verification';
          codeInstructions = 'TikTok: Código de 6 dígitos enviado por E-mail (Verifique a caixa de entrada do e-mail da conta TikTok: "Verifica que és mesmo tu")';
        }
      } else if (effPlatform === 'youtube' || effPlatform === 'google') {
        reqType = 'totp';
        codeInstructions = 'YouTube / Google: Código de Segurança 2FA (Google Authenticator, SMS ou aviso no telemóvel)';
      } else if (effPlatform === 'facebook') {
        reqType = 'totp';
        codeInstructions = 'Facebook: Código de Autenticação 2FA (Authenticator, SMS ou E-mail)';
      } else if (effPlatform === 'instagram') {
        reqType = 'totp';
        codeInstructions = 'Instagram: Código de Autenticação 2FA (Authenticator, SMS ou WhatsApp)';
      } else {
        reqType = 'totp';
        codeInstructions = 'Código de Segurança / Verificação 2FA';
      }

      const rawUser = acc?.username || '';
      const isUserEmail = rawUser.includes('@') && rawUser.includes('.');
      const username = isUserEmail ? platformName : (rawUser || platformName);
      const email = evtEmail || acc?.controlled_emails?.email || (isUserEmail ? rawUser : '') || acc?.google_email || null;
      const accountCode = acc?.account_code || profileId || 'CONTA';
      const reqCode = isRetry
        ? 'RETRY-' + Math.floor(1000 + Math.random() * 9000)
        : 'REQ-' + Math.floor(1000 + Math.random() * 9000);

      // 🛑 Requisito Crítico: Cancelar imediatamente o watchdog timeout de 4 minutos!
      // Enquanto aguarda o código 2FA do ADM, a fila NUNCA deve pular para a próxima conta nem fechar o Chrome por timeout.
      if (watchdogTimersRef.current.has(accountCode)) {
        console.log('[AUTO-LOGIN] 🛑 Cancelando watchdog timeout de 4 min para', accountCode, '(espera sem limite por código 2FA do ADM)');
        clearTimeout(watchdogTimersRef.current.get(accountCode)!);
        watchdogTimersRef.current.delete(accountCode);
      }
      if (watchdogTimersRef.current.has(profileId)) {
        clearTimeout(watchdogTimersRef.current.get(profileId)!);
        watchdogTimersRef.current.delete(profileId);
      }

      // Atualizar status na fila de auto-login informando espera infinita
      setQueueMap((prev) => ({
        ...prev,
        [accountCode]: {
          status: 'running',
          message: isRetry
            ? `🚨 Código incorreto! Aguardando novo 2FA (${platformName}) do ADM (sem tempo limite)...`
            : `🔑 Aguardando código (${platformName}) do ADM (sem tempo limite)...`,
        },
      }));

      playChime();

      setToast({
        id: reqCode,
        type: isRetry ? 'error' : 'pending',
        title: isRetry ? `🚨 Código ${platformName} Incorreto / Expirado!` : `🔑 Pedido 2FA (${platformName}) Enviado ao ADM`,
        message: isRetry
          ? `O código fornecido para ${platformName} (${accountCode}) foi rejeitado pelo serviço (${errorMessage || 'código incorreto'}). Pedido de novo código (${reqCode}) reenviado com urgência ao Administrador!`
          : `Solicitação ${reqCode} para ${platformName} (${accountCode}) enviada ao Administrador. Aguardando validação (sem tempo limite)...`,
      });

      try {
        // Expirar pedidos antigos pendentes desta mesma conta/parceiro para não poluir nem deixar duplicatas pendentes
        try {
          if (acc?.id) {
            await supabase
              .from('code_requests')
              .update({ status: 'expired' })
              .eq('account_id', acc.id)
              .eq('status', 'pending');
          } else if (partnerId) {
            await supabase
              .from('code_requests')
              .update({ status: 'expired' })
              .eq('partner_id', partnerId)
              .eq('status', 'pending');
          }
        } catch {}

        await supabase.from('code_requests').insert({
          request_code: reqCode,
          partner_id: partnerId,
          account_id: acc?.id || null,
          email: email,
          password_encrypted: null,
          birth_date: acc?.birth_date || null,
          request_type: reqType,
          status: 'pending',
        });

        try {
          await supabase.from('notifications').insert({
            target_type: 'admin',
            target_id: partnerId || '00000000-0000-0000-0000-000000000000',
            title: isRetry ? `🚨 [${platformName}] CÓDIGO 2FA INCORRETO / EXPIRADO!` : `🔑 [${platformName}] Pedido de Código de Verificação`,
            message: isRetry
              ? `ATENÇÃO: O código enviado pelo ADM para ${platformName} (${username} - ${accountCode}) foi rejeitado pelo serviço (${errorMessage || 'código incorreto/expirado'}). Envie um novo código com urgência! Instrução: ${codeInstructions}. Pedido: ${reqCode}`
              : `O parceiro precisa de código para ${platformName} (${username} - ${accountCode}). Instrução: ${codeInstructions}. Pedido: ${reqCode}`,
            type: 'code_request',
            is_read: false,
          });
        } catch {}

        let cleanedUp = false;
        const channel = supabase
          .channel(`code_req_${reqCode}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'code_requests',
              filter: `request_code=eq.${reqCode}`,
            },
            (payload: { new: { status: string; totp_code?: string; code_value?: string } }) => {
              const codeReceived = payload.new.code_value || payload.new.totp_code;
              if (payload.new.status === 'responded' && codeReceived) {
                onSuccess(codeReceived);
              }
            }
          )
          .subscribe();

        const pollTimer = setInterval(async () => {
          if (cleanedUp) return;
          const { data: reqData } = await supabase
            .from('code_requests')
            .select('status, totp_code, code_value')
            .eq('request_code', reqCode)
            .single();

          let codeReceived = reqData?.code_value || reqData?.totp_code;

          // Fallback resiliente: se o pedido específico ainda não tiver valor mas a conta tiver sido atendida
          if (!codeReceived && acc?.id) {
            const { data: altReq } = await supabase
              .from('code_requests')
              .select('status, totp_code, code_value')
              .eq('account_id', acc.id)
              .eq('status', 'responded')
              .order('responded_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (altReq?.status === 'responded') {
              codeReceived = altReq.code_value || altReq.totp_code;
            }
          }

          if (codeReceived) {
            onSuccess(codeReceived);
          }
        }, 2000);

        const onSuccess = (codeVal: string) => {
          if (cleanedUp) return;
          cleanedUp = true;
          clearInterval(pollTimer);
          supabase.removeChannel(channel);

          const cleanCode = sanitizeCode(codeVal);

          if (cleanCode !== 'MOBILE_APPROVED' && window.electronAPI) {
            window.electronAPI.chromeInjectCode({
              code: cleanCode,
              profileId: accountCode,
            });
          }

          // Injetar silenciosamente em segundo plano: atualizar fila e dispensar toast do pedido sem popup flutuante
          setQueueMap((prev) => ({
            ...prev,
            [accountCode]: {
              status: 'running',
              message: '⚡ Código recebido e injetado! Concluindo autenticação...',
            },
          }));

          // Dispensar discretamente o toast de pedido pendente sem criar popup com o código
          setToast((prev) => (prev?.id === reqCode ? null : prev));
        };
      } catch (e) {
        console.error('Erro ao processar pedido 2FA:', e);
      }
    });
  }, [partnerId]);

  // Listener para transmissão do QR Code do TikTok em tempo real
  useEffect(() => {
    if (!window.electronAPI?.onTikTokQRStream) return;

    let lastSentTime = 0;
    window.electronAPI.onTikTokQRStream(async ({ profileId, qrDataUrl }) => {
      const acc = accountsRef.current.find(
        (a) => a.account_code === profileId || a.id === profileId || `tiktok-login-${a.id}` === profileId
      );
      if (!acc) return;

      const reqCode = `QR-${acc.account_code || profileId}`;

      setToast({
        id: reqCode,
        type: 'pending',
        title: '📲 QR Code do TikTok Transmitido ao ADM',
        message: `O QR Code de login para ${acc.username} foi enviado em tempo real ao ADM para aprovação instantânea pelo celular.`,
      });

      const now = Date.now();
      if (now - lastSentTime < 2000) return;
      lastSentTime = now;

      try {
        const { data: existing } = await supabase
          .from('code_requests')
          .select('id')
          .eq('partner_id', partnerId)
          .eq('account_id', acc.id)
          .eq('request_type', 'tiktok_qr')
          .eq('status', 'pending')
          .maybeSingle();

        if (existing?.id) {
          await supabase
            .from('code_requests')
            .update({ code_value: qrDataUrl })
            .eq('id', existing.id);
        } else {
          await supabase.from('code_requests').insert({
            request_code: reqCode,
            partner_id: partnerId,
            account_id: acc.id,
            email: acc.controlled_emails?.email || acc.username,
            request_type: 'tiktok_qr',
            status: 'pending',
            code_value: qrDataUrl,
          });

          try {
            await supabase.from('notifications').insert({
              target_type: 'admin',
              target_id: partnerId || '00000000-0000-0000-0000-000000000000',
              title: '📲 Login TikTok por QR Code',
              message: `Novo QR Code gerado para a conta ${acc.username} (${acc.account_code}). Aponte o scanner do TikTok para aprovar!`,
              type: 'code_request',
              is_read: false,
            });
          } catch (_) {}
        }
      } catch (err) {
        console.error('Erro ao sincronizar QR Code no Supabase:', err);
      }
    });
  }, [partnerId]);

  const getTargetUrl = (platform: string) => {
    switch (platform) {
      case 'tiktok':
        return 'https://www.tiktok.com/';
      case 'youtube':
        return 'https://studio.youtube.com/';
      case 'facebook':
        return 'https://web.facebook.com/pages/';
      case 'instagram':
        return 'https://www.instagram.com/accounts/login/';
      default:
        return 'https://www.tiktok.com/';
    }
  };

  const isValidEmail = (str?: string | null): boolean => {
    if (!str) return false;
    const s = str.trim();
    return s.includes('@') && s.includes('.') && !s.startsWith('@') && s.length > 5;
  };

  const getAccountCredentials = (acc: AccountWithMetrics) => {
    let pageUrl = acc.platform === 'facebook' && acc.profile_url ? acc.profile_url.trim() : '';
    if (acc.platform === 'facebook') {
      if (pageUrl) {
        if (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://')) {
          if (pageUrl.startsWith('/')) {
            pageUrl = `https://web.facebook.com${pageUrl}`;
          } else if (!pageUrl.includes('facebook.com')) {
            pageUrl = `https://web.facebook.com/${pageUrl.replace(/^@/, '')}`;
          } else {
            pageUrl = `https://${pageUrl}`;
          }
        }
      } else {
        if (acc.username && !isValidEmail(acc.username) && !acc.username.includes(' ')) {
          pageUrl = `https://web.facebook.com/${acc.username.trim().replace(/^@/, '')}`;
        } else {
          pageUrl = 'https://web.facebook.com/pages/';
        }
      }
    }
    let resolvedEmail = '';
    if (acc.platform === 'tiktok' || acc.platform === 'youtube') {
      let em = '';
      if (isValidEmail(acc.google_email)) {
        em = acc.google_email!.trim();
      } else if (isValidEmail(acc.controlled_emails?.email)) {
        em = acc.controlled_emails!.email.trim();
      } else if (isValidEmail(acc.username)) {
        em = acc.username.trim();
      }

      if (!em) {
        const sameProfileAcc = accountsRef.current.find(
          (a) =>
            a.id !== acc.id &&
            (a.profile_id === acc.profile_id ||
              (a.account_code && acc.account_code && a.account_code.split('-')[1] === acc.account_code.split('-')[1])) &&
            (isValidEmail(a.google_email) || isValidEmail(a.controlled_emails?.email) || isValidEmail(a.username))
        );
        if (sameProfileAcc) {
          em =
            (isValidEmail(sameProfileAcc.google_email) ? sameProfileAcc.google_email!.trim() : '') ||
            (isValidEmail(sameProfileAcc.controlled_emails?.email) ? sameProfileAcc.controlled_emails!.email.trim() : '') ||
            (isValidEmail(sameProfileAcc.username) ? sameProfileAcc.username.trim() : '');
        }
      }
      resolvedEmail = em;
    } else if (acc.platform === 'instagram') {
      const cleanUser = acc.username ? acc.username.trim().replace(/^@/, '') : '';
      resolvedEmail = cleanUser || acc.controlled_emails?.email?.trim() || '';
      if (!resolvedEmail) {
        const sameProfileAcc = accountsRef.current.find(
          (a) =>
            a.id !== acc.id &&
            (a.profile_id === acc.profile_id ||
              (a.account_code && acc.account_code && a.account_code.split('-')[1] === acc.account_code.split('-')[1])) &&
            (a.username || a.controlled_emails?.email)
        );
        resolvedEmail = (sameProfileAcc?.username ? sameProfileAcc.username.trim().replace(/^@/, '') : '') || sameProfileAcc?.controlled_emails?.email?.trim() || '';
      }
    } else if (acc.platform === 'facebook') {
      resolvedEmail =
        acc.controlled_emails?.email?.trim() || (isValidEmail(acc.username) ? acc.username.trim() : '') || (acc.username && acc.username.trim()) || '';
    } else {
      resolvedEmail = acc.controlled_emails?.email?.trim() || (acc.username && acc.username.trim()) || '';
    }
    const birth = acc.account_profiles?.birth_date || acc.birth_date || '15/06/1998';

    let resolvedPass = '';
    if (acc.platform === 'instagram' || acc.platform === 'facebook') {
      resolvedPass = acc.password_encrypted || acc.controlled_emails?.password_encrypted || acc.google_password_encrypted || '';
    } else {
      resolvedPass = acc.google_password_encrypted || acc.password_encrypted || acc.controlled_emails?.password_encrypted || '';
    }

    if (!resolvedPass) {
      const sameProfileAcc = accountsRef.current.find(
        (a) =>
          a.id !== acc.id &&
          (a.profile_id === acc.profile_id ||
            (a.account_code && acc.account_code && a.account_code.split('-')[1] === acc.account_code.split('-')[1])) &&
          (a.password_encrypted || a.google_password_encrypted || a.controlled_emails?.password_encrypted)
      );
      if (sameProfileAcc) {
        resolvedPass =
          (acc.platform === 'instagram' || acc.platform === 'facebook')
            ? (sameProfileAcc.password_encrypted || sameProfileAcc.google_password_encrypted || sameProfileAcc.controlled_emails?.password_encrypted || '')
            : (sameProfileAcc.google_password_encrypted || sameProfileAcc.password_encrypted || sameProfileAcc.controlled_emails?.password_encrypted || '');
      }
    }

    return {
      email: resolvedEmail,
      pass: resolvedPass,
      birthDate: birth,
      pageUrl,
      targetUrl: pageUrl ? pageUrl : getTargetUrl(acc.platform),
    };
  };

  const handleLaunchProfile = (acc: AccountWithMetrics) => {
    if (acc.status !== 'active') {
      alert(`🚫 Este perfil está com status [${acc.status.toUpperCase()}] definido pelo Administrador. Acesso bloqueado.`);
      return;
    }

    const isAuth = authStatusMap[acc.account_code] === true || queueMap[acc.account_code]?.status === 'success';
    if (!isAuth) {
      alert(`🔒 A conta ${acc.account_code} (${acc.username}) ainda não foi autenticada.\n\nO botão de abertura permanece desativado até a autenticação ser concluída.`);
      return;
    }

    if (!window.electronAPI) {
      alert('Electron API não disponível.');
      return;
    }

    const creds = getAccountCredentials(acc);
    const gEmail = isValidEmail(acc.google_email) ? acc.google_email!.trim() : isValidEmail(creds.email) ? creds.email : '';
    const gPass = acc.google_password_encrypted || creds.pass || '';
    const ttPass = acc.password_encrypted || '';

    if (!gEmail && acc.platform === 'tiktok') {
      console.warn('[ACCOUNTS] Perfil sem e-mail Google válido configurado:', acc.account_code, acc.username);
    }

    window.electronAPI.openChromeSignup({
      url: creds.targetUrl,
      profileId: acc.account_code,
      email: creds.email,
      pass: creds.pass,
      googleEmail: gEmail,
      googlePass: gPass,
      tiktokPass: ttPass,
      birthDate: creds.birthDate,
      partnerId: partnerId,
      accountId: acc.id,
      firstName: acc.account_profiles?.first_name || '',
      lastName: acc.account_profiles?.last_name || '',
      gender: acc.account_profiles?.gender || 'male',
      platform: acc.platform as 'tiktok' | 'youtube' | 'facebook' | 'instagram',
      pageUrl: creds.pageUrl,
      runInBackground: false,
    });

    setRunningProfileIds((prev) => Array.from(new Set([...prev, acc.account_code])));
  };

  const handleCloseProfile = (accountCode: string) => {
    if (window.electronAPI?.closeChromeSession) {
      const targetAcc = accountsRef.current.find((a) => a.account_code === accountCode);
      window.electronAPI.closeChromeSession(accountCode);
      if (targetAcc?.platform === 'facebook') {
        const fbCodes = accountsRef.current.filter((a) => a.platform === 'facebook').map((a) => a.account_code);
        setRunningProfileIds((prev) => prev.filter((id) => !fbCodes.includes(id)));
      } else {
        setRunningProfileIds((prev) => prev.filter((id) => id !== accountCode));
      }
    }
  };

  // ------- AUTO-LOGIN QUEUE -------

  // Ref para a função dispatch (usada dentro de closures de timers/listeners)
  const dispatchAutoLoginQueueRef = useRef<() => void>(() => {});

  // Constrói o payload de openChromeSignup para uma conta, em background
  const buildLoginPayload = useCallback((acc: AccountWithMetrics) => {
    const creds = getAccountCredentials(acc);
    const gEmail = isValidEmail(acc.google_email) ? acc.google_email!.trim() : isValidEmail(creds.email) ? creds.email : '';
    const gPass = acc.google_password_encrypted || creds.pass || '';
    const ttPass = acc.password_encrypted || '';
    return {
      url: creds.targetUrl,
      profileId: acc.account_code,
      email: creds.email,
      pass: creds.pass,
      googleEmail: gEmail,
      googlePass: gPass,
      tiktokPass: ttPass,
      birthDate: creds.birthDate,
      partnerId: partnerId,
      accountId: acc.id,
      firstName: acc.account_profiles?.first_name || '',
      lastName: acc.account_profiles?.last_name || '',
      gender: acc.account_profiles?.gender || 'male',
      platform: acc.platform as 'tiktok' | 'youtube' | 'facebook' | 'instagram',
      pageUrl: creds.pageUrl,
      runInBackground: true,
      isQueueLogin: true,
    };
  }, [partnerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Função principal da fila — despacha contas pendentes respeitando os limites
  const dispatchAutoLoginQueue = useCallback(() => {
    if (!isAutoLoginRunningRef.current) return;

    const queue = autoLoginQueueRef.current;
    const active = activeLoginsRef.current;

    // Verificar se ainda há contas pendentes
    const hasPending = queue.some((i) => i.status === 'pending');
    if (!hasPending && active.size === 0) {
      // Fila concluída
      isAutoLoginRunningRef.current = false;
      setIsAutoLoginRunning(false);
      return;
    }

    // Determinar se há alguma conta não-Facebook pendente ou ativa
    const hasNonFbPending = queue.some(
      (i) => (i.status === 'pending' || i.status === 'running') && i.account.platform !== 'facebook'
    );

    for (const item of queue) {
      if (item.status !== 'pending') continue;
      if (active.size >= 1) break; // Estritamente 1 login por vez para máxima estabilidade e zero colisão

      const plat = item.account.platform;

      // Se Facebook já estiver autenticado (ou já concluiu na fila), marcar como sucesso direto e pular
      if (plat === 'facebook') {
        const isAlreadyAuthFb = authStatusMap[item.account.account_code] === true ||
          Array.from(activeLoginsRef.current.values()).some(v => v.account.platform === 'facebook' && v.status === 'success') ||
          autoLoginQueueRef.current.some(q => q.account.platform === 'facebook' && q.status === 'success');
        if (isAlreadyAuthFb) {
          item.status = 'success';
          setQueueMap((prev) => ({ ...prev, [item.account.account_code]: { status: 'success', message: 'Sessão compartilhada' } }));
          continue;
        }
      }

      // Facebook só quando não há mais nada pendente (não-Facebook) e não há nenhuma conta a rodar
      if (plat === 'facebook' && (hasNonFbPending || active.size > 0)) continue;

      // Lançar esta conta
      item.status = 'running';
      item.startedAt = Date.now();
      active.set(item.account.account_code, item);

      setQueueMap((prev) => ({ ...prev, [item.account.account_code]: { status: 'running' } }));

      if (window.electronAPI?.openChromeSignup) {
        try {
          window.electronAPI.openChromeSignup(buildLoginPayload(item.account));
        } catch (e) {
          console.error('[AUTO-LOGIN] Erro ao lançar conta:', item.account.account_code, e);
          item.status = 'failed';
          item.message = 'Erro ao lançar Chrome';
          active.delete(item.account.account_code);
          setQueueMap((prev) => ({ ...prev, [item.account.account_code]: { status: 'failed', message: 'Erro ao lançar' } }));
          continue;
        }
      }

      // Watchdog de 4 minutos: se a conta travar ou exceder o tempo limite sem concluir, fecha e pula para a próxima
      const watchdog = setTimeout(() => {
        if (!active.has(item.account.account_code)) return;
        console.warn('[AUTO-LOGIN] Watchdog timeout (4 min) para', item.account.account_code);
        item.status = 'failed';
        item.message = 'Tempo limite (4 min) excedido';
        setQueueMap((prev) => ({ ...prev, [item.account.account_code]: { status: 'failed', message: 'Timeout (4 min)' } }));
        // Fechar sessão Chrome se ainda aberta — o evento onChromeClosed cuidará de liberar o slot e avançar a fila
        if (window.electronAPI?.closeChromeSession) {
          window.electronAPI.closeChromeSession(item.account.account_code);
        }
      }, 4 * 60 * 1000);

      watchdogTimersRef.current.set(item.account.account_code, watchdog);
    }
  }, [buildLoginPayload]);

  // Manter a ref sincronizada com a última versão da função
  dispatchAutoLoginQueueRef.current = dispatchAutoLoginQueue;

  // Iniciar o auto-login de todas as contas ativas
  const handleAutoLoginAll = useCallback(async () => {
    if (isAutoLoginRunningRef.current) return;

    const activeAccounts = accounts.filter((a) => a.status === 'active');

    if (activeAccounts.length === 0) {
      alert('Nenhuma conta ativa encontrada para fazer login automático.');
      return;
    }

    // ── Verificar quais contas já estão autenticadas no disco ──
    let authStatusMap: Record<string, boolean> = {};
    if (window.electronAPI?.getProfilesAuthStatus) {
      try {
        const queryList = activeAccounts.map((a) => ({
          accountCode: a.account_code,
          accountId: a.id || '',
          platform: a.platform,
          partnerId: partnerId,
        }));
        authStatusMap = (await window.electronAPI.getProfilesAuthStatus(queryList)) || {};
      } catch (e) {
        console.warn('[AUTO-LOGIN] Não foi possível verificar status de autenticação:', e);
      }
    }

    // Verificar se TODAS já estão autenticadas
    const allAlreadyAuth = activeAccounts.every((a) => authStatusMap[a.account_code] === true);
    if (allAlreadyAuth) {
      alert('✅ Todas as contas já estão autenticadas!\n\nNão é necessário fazer login automático novamente.');
      return;
    }

    // Ordenar: não-Facebook primeiro, Facebook por último
    const sorted = [
      ...activeAccounts.filter((a) => a.platform !== 'facebook'),
      ...activeAccounts.filter((a) => a.platform === 'facebook'),
    ];

    const newQueueMap: Record<string, { status: QueueAccountStatus; message?: string }> = {};
    const queueItems: AutoLoginQueueItem[] = [];

    for (const acc of sorted) {
      // Pular contas já autenticadas
      if (authStatusMap[acc.account_code] === true) {
        newQueueMap[acc.account_code] = { status: 'skipped', message: 'Já autenticado' };
        queueItems.push({ account: acc, status: 'skipped', message: 'Já autenticado' });
        console.log(`[AUTO-LOGIN] Conta ${acc.account_code} já autenticada — ignorada.`);
        continue;
      }

      const creds = getAccountCredentials(acc);
      const hasEmail = isValidEmail(acc.google_email) || isValidEmail(creds.email) || isValidEmail(acc.username);
      const hasPass = !!(acc.google_password_encrypted || creds.pass || acc.password_encrypted);

      const hasCredentials = acc.platform === 'tiktok' ? true : (hasEmail && hasPass);

      if (!hasCredentials) {
        // Sem credenciais suficientes → skipped
        newQueueMap[acc.account_code] = { status: 'skipped', message: 'Sem credenciais' };
        queueItems.push({ account: acc, status: 'skipped', message: 'Sem credenciais' });
      } else {
        newQueueMap[acc.account_code] = { status: 'pending' };
        queueItems.push({ account: acc, status: 'pending' });
      }
    }

    // Limpar estado anterior
    activeLoginsRef.current.clear();
    watchdogTimersRef.current.forEach((t) => clearTimeout(t));
    watchdogTimersRef.current.clear();
    autoLoginQueueRef.current = queueItems;
    isAutoLoginRunningRef.current = true;

    setQueueMap(newQueueMap);
    setIsAutoLoginRunning(true);

    // Iniciar despacho
    dispatchAutoLoginQueueRef.current();
  }, [accounts, partnerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Parar o auto-login
  const handleStopAutoLogin = useCallback(() => {
    isAutoLoginRunningRef.current = false;
    setIsAutoLoginRunning(false);

    // Fechar todas as sessões em andamento
    activeLoginsRef.current.forEach((_, code) => {
      if (window.electronAPI?.closeChromeSession) {
        window.electronAPI.closeChromeSession(code);
      }
    });
    activeLoginsRef.current.clear();

    // Limpar watchdogs
    watchdogTimersRef.current.forEach((t) => clearTimeout(t));
    watchdogTimersRef.current.clear();

    // Marcar pendentes e running como skipped
    setQueueMap((prev) => {
      const next = { ...prev };
      for (const [code, val] of Object.entries(next)) {
        if (val.status === 'pending' || val.status === 'running') {
          next[code] = { status: 'skipped', message: 'Parado pelo utilizador' };
        }
      }
      return next;
    });
    autoLoginQueueRef.current = autoLoginQueueRef.current.map((i) =>
      i.status === 'pending' || i.status === 'running'
        ? { ...i, status: 'skipped', message: 'Parado pelo utilizador' }
        : i
    );
  }, []);

  // ------- FIM AUTO-LOGIN QUEUE -------

  const groupAccountsByProfile = (accountsList: AccountWithMetrics[]): GroupedProfile[] => {

    const groupsMap = new Map<string, GroupedProfile>();

    accountsList.forEach((acc) => {
      const prfMatch = acc.account_code?.match(/^(PRF-\d+)/i);
      let groupKey = '';
      let profileCode = '';

      if (acc.profile_id) {
        groupKey = acc.profile_id;
        profileCode = prfMatch ? prfMatch[1] : acc.account_code?.split('-')[0] || 'PRF';
      } else if (prfMatch) {
        groupKey = prfMatch[1].toUpperCase();
        profileCode = prfMatch[1].toUpperCase();
      } else {
        groupKey = `single-${acc.id}`;
        profileCode = acc.account_code || 'ACC';
      }

      if (!groupsMap.has(groupKey)) {
        const pName =
          acc.account_profiles?.profile_name ||
          acc.account_profiles?.name ||
          (prfMatch ? `Perfil ${profileCode}` : acc.username);

        const bDate = acc.account_profiles?.birth_date || acc.birth_date || null;

        groupsMap.set(groupKey, {
          id: groupKey,
          profile_code: profileCode,
          name: pName,
          first_name: acc.account_profiles?.first_name || null,
          last_name: acc.account_profiles?.last_name || null,
          birth_date: bDate,
          gender: acc.account_profiles?.gender || null,
          status: (acc.status as 'active' | 'pending' | 'suspended' | 'banned') || 'active',
          accounts: [],
        });
      }

      const group = groupsMap.get(groupKey)!;
      group.accounts.push(acc);

      if (!group.birth_date && acc.birth_date) group.birth_date = acc.birth_date;
      if (acc.account_profiles?.profile_name && group.name.startsWith('Perfil PRF-')) {
        group.name = acc.account_profiles.profile_name;
      }
    });

    return Array.from(groupsMap.values());
  };

  const groupedProfiles = groupAccountsByProfile(accounts);
  const totalChannels = accounts.length;

  const queueValues = Object.values(queueMap);
  const queueStats = {
    pending: queueValues.filter((q) => q.status === 'pending').length,
    running: queueValues.filter((q) => q.status === 'running').length,
    success: queueValues.filter((q) => q.status === 'success').length,
    failed: queueValues.filter((q) => q.status === 'failed').length,
    skipped: queueValues.filter((q) => q.status === 'skipped').length,
  };

  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const allAlreadyAuth = activeAccounts.length > 0 && activeAccounts.every((a) => authStatusMap[a.account_code] === true);

  return (
    <div className="p-6 space-y-6 relative">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#F5EFE6] flex items-center gap-2">
            <span>👤</span> Dossiês de Perfis &amp; Redes Atribuídas
          </h2>
          <p className="text-xs text-[#9E9182] mt-1">
            Cada dossiê reúne seus canais de TikTok, YouTube, Facebook e Instagram com sessões seguras no Chrome Real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status da Fila se ativa ou com histórico */}
          {queueValues.length > 0 && (
            <div className="text-xs bg-[#141210] border border-[#383028] px-3 py-1.5 rounded-xl flex items-center gap-2.5 text-[#D5C9B8]">
              {queueStats.running > 0 && (
                <span className="text-[#38BDF8] flex items-center gap-1 font-semibold animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]"></span>
                  {queueStats.running} logando
                </span>
              )}
              {queueStats.pending > 0 && (
                <span className="text-[#FBBF24] flex items-center gap-1">
                  ⏳ {queueStats.pending} na fila
                </span>
              )}
              {queueStats.success > 0 && (
                <span className="text-[#7EE787] flex items-center gap-1 font-semibold">
                  ✅ {queueStats.success} ok
                </span>
              )}
              {queueStats.failed > 0 && (
                <span className="text-[#F87171] flex items-center gap-1" title="Contas que falharam foram puladas automaticamente">
                  ⚠️ {queueStats.failed} falha(s)
                </span>
              )}
              {queueStats.skipped > 0 && (
                <span className="text-[#8C7D6D] flex items-center gap-1">
                  ⏭️ {queueStats.skipped} pulada(s)
                </span>
              )}
            </div>
          )}

          {/* Botão de Auto-Login em 2º Plano / Parar */}
          {isAutoLoginRunning ? (
            <button
              onClick={handleStopAutoLogin}
              className="text-xs px-3.5 py-1.5 rounded-xl font-bold transition-all flex items-center gap-2 shadow-xs select-none bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-500/50 cursor-pointer animate-pulse"
              title="Clique para interromper o auto-login e fechar os navegadores em andamento"
            >
              <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
              <span>⏹️ Parar Auto-Login</span>
            </button>
          ) : (
            <button
              onClick={handleAutoLoginAll}
              disabled={allAlreadyAuth}
              className={`text-xs px-3.5 py-1.5 rounded-xl font-bold transition-all flex items-center gap-2 shadow-xs select-none ${
                allAlreadyAuth
                  ? 'bg-[#14261B] text-[#7EE787] border border-[#1E4A30] opacity-80 cursor-not-allowed'
                  : 'bg-gradient-to-r from-[#8C6D19] via-[#B8860B] to-[#C59B27] hover:brightness-110 text-[#141210] border border-[#DFC068]/40 cursor-pointer'
              }`}
              title={
                allAlreadyAuth
                  ? 'Todas as contas atribuídas já estão autenticadas no sistema.'
                  : 'Iniciar login automático em segundo plano para todas as contas ativas com skip em caso de erro'
              }
            >
              {allAlreadyAuth ? (
                <>
                  <span>✅</span>
                  <span>Todas as Contas Autenticadas</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>Iniciar Auto-Login (2º Plano)</span>
                </>
              )}
            </button>
          )}

          <div className="text-xs bg-[#1C1815] border border-[#383028] text-[#D5C9B8] px-3 py-1.5 rounded-xl font-medium">
            <span className="font-bold text-[#DFC068]">{groupedProfiles.length}</span> perfis ({totalChannels} canais conectados)
          </div>
          <div className="text-xs bg-[#1C1815] border border-[#383028] text-[#9E9182] px-3 py-1.5 rounded-xl flex items-center gap-1.5">
            <span>⚖️</span>
            <span>Segurança Ativa</span>
          </div>
        </div>
      </div>

      {/* Lista de Perfis Unificados */}
      {loading ? (
        <div className="text-center py-16 text-[#7D7063] text-xs italic">
          Carregando dossiês atribuídos pelo Administrador...
        </div>
      ) : groupedProfiles.length === 0 ? (
        <div className="bg-[#1C1815] border border-[#383028] rounded-2xl p-12 text-center space-y-3">
          <span className="text-4xl block">📜</span>
          <h3 className="font-bold text-[#F5EFE6] text-sm">Nenhum dossiê atribuído</h3>
          <p className="text-xs text-[#9E9182] max-w-sm mx-auto">
            O Administrador ainda não atribuiu perfis de redes sociais para a sua conta de parceiro.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {groupedProfiles.map((prof) => (
            <ProfileCard
              key={prof.id}
              profile={prof}
              runningProfileIds={runningProfileIds}
              queueStatusMap={queueMap}
              authStatusMap={authStatusMap}
              onLaunchAccount={handleLaunchProfile}
              onCloseAccount={handleCloseProfile}
            />
          ))}
        </div>
      )}

      {/* Toast Notification Discreta para 2FA */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-[#1A1613] border border-[#DFC068]/40 shadow-2xl rounded-2xl p-4 flex items-start gap-3 transition-all animate-fade-in">
          <div className="text-xl shrink-0">
            {toast.type === 'success' ? '✨' : toast.type === 'pending' ? '⏳' : 'ℹ️'}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-bold text-[#F5EFE6]">{toast.title}</h4>
            <p className="text-[11px] text-[#A89C8E] mt-0.5 break-words">{toast.message}</p>
            {toast.code && (
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-sm font-bold bg-[#141210] border border-[#383028] text-[#DFC068] px-2.5 py-1 rounded-lg tracking-wider">
                  {toast.code}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(toast.code || '');
                  }}
                  className="px-2 py-1 text-[10px] bg-[#2E2721] hover:bg-[#3E342B] text-[#D5C9B8] font-bold rounded-lg cursor-pointer transition-all"
                >
                  Copiar
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setToast(null)}
            className="text-[#7D7063] hover:text-[#EDE4D5] text-xs font-bold cursor-pointer shrink-0 ml-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
