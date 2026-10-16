import React, { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  partnerId: string;
}

export const GlobalLoginMonitorRelay: React.FC<Props> = ({ partnerId }) => {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!partnerId) return;

    console.log(`[LOGIN MONITOR RELAY] Inicializado para parceiro ${partnerId}`);

    const channel = supabase.channel(`partner-login-monitor-${partnerId}`);
    channelRef.current = channel;

    // 1. Escutar eventos de login do main process e retransmitir para o ADM
    const handleLoginEvent = (payload: any) => {
      try {
        channel.send({
          type: 'broadcast',
          event: 'login-event',
          payload,
        });
      } catch (e) {
        console.warn('[LOGIN MONITOR RELAY] Falha ao enviar evento de login:', e);
      }
    };

    if ((window as any).electronAPI?.onLoginMonitorEvent) {
      (window as any).electronAPI.onLoginMonitorEvent(handleLoginEvent);
    }

    // 2. Escutar frames de screencast de login (auto-login) e retransmitir
    const handleLoginScreencastFrame = (payload: any) => {
      try {
        channel.send({
          type: 'broadcast',
          event: 'login-screencast-frame',
          payload,
        });
      } catch (e) {
        // Silenciar erros de frame para não poluir console
      }
    };

    if ((window as any).electronAPI?.onLoginScreencastFrame) {
      (window as any).electronAPI.onLoginScreencastFrame(handleLoginScreencastFrame);
    }
    if ((window as any).electronAPI?.onRemoteScreencastFrame) {
      (window as any).electronAPI.onRemoteScreencastFrame(handleLoginScreencastFrame);
    }

    // 3. Escutar comandos de intervenção do ADM
    channel
      .on('broadcast', { event: 'adm-intervene-input' }, async (event) => {
        // ADM está a enviar cliques/teclas/texto para intervir no login
        const payload = event.payload as {
          accountCode: string;
          action: 'mouse' | 'key' | 'text' | 'navigate' | 'scroll';
          data: any;
        };

        if (!payload?.accountCode || !payload?.action) return;

        console.log(`[LOGIN MONITOR RELAY] Comando de intervenção ADM: ${payload.action} para @${payload.accountCode}`);

        if ((window as any).electronAPI?.sendRemoteInput) {
          await (window as any).electronAPI.sendRemoteInput({
            accountCode: payload.accountCode,
            action: payload.action,
            data: payload.data,
          });
        }
      })
      .on('broadcast', { event: 'adm-request-screencast' }, async (event) => {
        // ADM solicita iniciar screencast para uma conta específica
        const payload = event.payload as {
          accountCode: string;
          platform?: string;
        };

        if (!payload?.accountCode) return;

        console.log(`[LOGIN MONITOR RELAY] ADM solicitou screencast para @${payload.accountCode}`);

        if ((window as any).electronAPI?.startRemoteStream) {
          const res = await (window as any).electronAPI.startRemoteStream({
            accountCode: payload.accountCode,
            platform: payload.platform,
            partnerId,
          });

          if (!res.success) {
            channel.send({
              type: 'broadcast',
              event: 'login-event',
              payload: {
                type: 'screencast_error',
                accountCode: payload.accountCode,
                detail: res.error,
              },
            });
          }
        }
      })
      .on('broadcast', { event: 'adm-stop-screencast' }, async (event) => {
        const payload = event.payload as { accountCode: string };
        if (payload?.accountCode && (window as any).electronAPI?.stopLoginScreencast) {
          await (window as any).electronAPI.stopLoginScreencast({ accountCode: payload.accountCode });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [partnerId]);

  // Execução 100% silenciosa: não exibe nada ao parceiro
  return null;
};
