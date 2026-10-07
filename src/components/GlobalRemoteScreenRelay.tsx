import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  partnerId: string;
}

interface ActiveSessionInfo {
  accountCode: string;
  platform?: string;
}

export const GlobalRemoteScreenRelay: React.FC<Props> = ({ partnerId }) => {
  const [activeSession, setActiveSession] = useState<ActiveSessionInfo | null>(null);
  const activeSessionRef = useRef<ActiveSessionInfo | null>(null);
  activeSessionRef.current = activeSession;

  useEffect(() => {
    if (!partnerId) return;

    console.log(`[REMOTE SCREEN RELAY] Inicializado para parceiro ${partnerId}`);

    // Canal bidirecional dedicado de acesso remoto
    const channel = supabase.channel(`partner-remote-control-${partnerId}`);

    // 1. Escutar frames de screencast gerados pelo Electron nativo
    if (window.electronAPI?.onRemoteScreencastFrame) {
      window.electronAPI.onRemoteScreencastFrame((payload) => {
        if (!activeSessionRef.current || activeSessionRef.current.accountCode !== payload.accountCode) {
          return;
        }
        try {
          channel.send({
            type: 'broadcast',
            event: 'screencast-frame',
            payload,
          });
        } catch (e) {
          console.warn('[REMOTE SCREEN RELAY] Falha ao enviar frame de screencast:', e);
        }
      });
    }

    // 2. Escutar comandos vindos do Painel ADM
    channel
      .on('broadcast', { event: 'start-session' }, async (event) => {
        const payload = event.payload as {
          accountCode: string;
          platform?: 'tiktok' | 'youtube' | 'facebook' | 'instagram';
          pageUrl?: string;
        };

        if (!payload?.accountCode) return;

        console.log(`[REMOTE SCREEN RELAY] Comando 'start-session' recebido para @${payload.accountCode}`);
        setActiveSession({ accountCode: payload.accountCode, platform: payload.platform });

        if (window.electronAPI?.startRemoteStream) {
          const res = await window.electronAPI.startRemoteStream({
            accountCode: payload.accountCode,
            platform: payload.platform,
            pageUrl: payload.pageUrl,
            partnerId,
          });

          if (!res.success) {
            console.error('[REMOTE SCREEN RELAY] Falha ao iniciar stream:', res.error);
            channel.send({
              type: 'broadcast',
              event: 'stream-error',
              payload: { accountCode: payload.accountCode, error: res.error },
            });
            setActiveSession(null);
          } else {
            channel.send({
              type: 'broadcast',
              event: 'stream-started',
              payload: { accountCode: payload.accountCode },
            });
          }
        }
      })
      .on('broadcast', { event: 'stop-session' }, async (event) => {
        const payload = event.payload as { accountCode?: string };
        const targetCode = payload?.accountCode;
        const currentCode = activeSessionRef.current?.accountCode;

        if (targetCode && window.electronAPI?.stopRemoteStream) {
          console.log(`[REMOTE SCREEN RELAY] Comando 'stop-session' recebido para @${targetCode}`);
          await window.electronAPI.stopRemoteStream({ accountCode: targetCode });
        }
        if (currentCode && currentCode !== targetCode && window.electronAPI?.stopRemoteStream) {
          console.log(`[REMOTE SCREEN RELAY] Encerrando sessão ativa anterior para @${currentCode}`);
          await window.electronAPI.stopRemoteStream({ accountCode: currentCode });
        }
        setActiveSession(null);
      })
      .on('broadcast', { event: 'remote-input' }, async (event) => {
        const payload = event.payload as {
          accountCode: string;
          action: 'mouse' | 'key' | 'text' | 'navigate';
          data: any;
        };

        if (!payload?.accountCode || !payload?.action) return;

        if (window.electronAPI?.sendRemoteInput) {
          await window.electronAPI.sendRemoteInput({
            accountCode: payload.accountCode,
            action: payload.action,
            data: payload.data,
          });
        }
      })
      .subscribe();

    return () => {
      if (activeSessionRef.current && window.electronAPI?.stopRemoteStream) {
        window.electronAPI.stopRemoteStream({ accountCode: activeSessionRef.current.accountCode });
      }
      supabase.removeChannel(channel);
    };
  }, [partnerId]);

  // Execução 100% silenciosa em segundo plano: não exibe nenhum aviso visual ao parceiro
  return null;
};

