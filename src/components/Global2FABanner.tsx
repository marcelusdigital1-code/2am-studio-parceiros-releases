import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  partnerId: string;
}

export const Global2FABanner: React.FC<Props> = ({ partnerId }) => {
  const [activeCode, setActiveCode] = useState<{
    id: string;
    code: string;
    requestCode: string;
    createdAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const lastProcessedIdRef = useRef<string | null>(null);

  const handleNewCode = useCallback((id: string, code: string, requestCode: string, createdAt: string) => {
    if (dismissedIdsRef.current.has(id)) return;
    if (lastProcessedIdRef.current === id) return;

    lastProcessedIdRef.current = id;
    setActiveCode({ id, code, requestCode, createdAt });

    // 1. Tentar injeção via CDP no Chrome Real se estiver aberto
    if (window.electronAPI) {
      try {
        window.electronAPI.chromeInjectCode({ code, profileId: '' });
      } catch {}
    }

    // 2. Tocar Som de Notificação
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
      osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
      osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.45);
    } catch {}

    // 3. Disparar Notificação Nativa do Sistema Operativo
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('🔑 Código 2FA Recebido do ADM!', { body: `Código: ${code} (Pedido: ${requestCode})` });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then((p) => {
            if (p === 'granted') {
              new Notification('🔑 Código 2FA Recebido do ADM!', { body: `Código: ${code} (Pedido: ${requestCode})` });
            }
          });
        }
      }
    } catch {}
  }, []);

  const checkRespondedCodes = useCallback(async () => {
    if (!partnerId) return;

    try {
      // Buscar código atendido nos últimos 15 minutos
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

      const { data } = await supabase
        .from('code_requests')
        .select('id, code_value, request_code, created_at')
        .eq('partner_id', partnerId)
        .eq('status', 'responded')
        .gte('created_at', fifteenMinAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const item = data[0];
        if (item.code_value) {
          handleNewCode(item.id, item.code_value, item.request_code || '2FA', item.created_at);
        }
      }
    } catch (err) {
      console.error('Erro no polling de códigos 2FA:', err);
    }
  }, [partnerId, handleNewCode]);

  useEffect(() => {
    checkRespondedCodes();

    // 1. Escuta Realtime Supabase
    const channel = supabase
      .channel(`global_2fa_partner_${partnerId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'code_requests',
          filter: `partner_id=eq.${partnerId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const updated = payload.new as {
            id?: string;
            status?: string;
            code_value?: string | null;
            request_code?: string;
            created_at?: string;
          };
          if (updated.status === 'responded' && updated.code_value && updated.id) {
            handleNewCode(updated.id, updated.code_value, updated.request_code || '2FA', updated.created_at || new Date().toISOString());
          }
        }
      )
      .subscribe();

    // 2. Polling REST a cada 1.5 segundos
    const interval = setInterval(checkRespondedCodes, 1500);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [partnerId, checkRespondedCodes, handleNewCode]);

  if (!activeCode) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeCode.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleDismiss = () => {
    dismissedIdsRef.current.add(activeCode.id);
    setActiveCode(null);
  };

  return (
    <div className="sticky top-0 z-50 bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-950 border-b-2 border-emerald-500 shadow-2xl px-6 py-3 text-white flex flex-wrap items-center justify-between gap-4 animate-bounce-once">
      <div className="flex items-center gap-3">
        <span className="text-3xl animate-pulse">🔑</span>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-extrabold text-sm text-emerald-300 uppercase tracking-wider">
              Código 2FA Recebido do Administrador!
            </p>
            <span className="text-[10px] bg-emerald-900 border border-emerald-500/50 text-emerald-200 px-2 py-0.5 rounded font-mono">
              Pedido: {activeCode.requestCode}
            </span>
          </div>
          <p className="text-xs text-slate-300">
            Copie o código abaixo ou utilize a injeção automática no navegador.
          </p>
        </div>
      </div>

      {/* Caixa do Código Destacado */}
      <div className="flex items-center gap-3">
        <div className="bg-slate-950 border-2 border-emerald-500 px-4 py-1.5 rounded-xl flex items-center gap-2 shadow-inner">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Código:</span>
          <span className="font-mono text-xl font-black text-emerald-300 tracking-widest select-all">
            {activeCode.code}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black shadow-lg transition-all flex items-center gap-1.5 active:scale-95 shrink-0"
        >
          <span>{copied ? '✅' : '📋'}</span>
          <span>{copied ? 'COPIADO!' : `COPIAR (${activeCode.code})`}</span>
        </button>

        <button
          type="button"
          onClick={handleDismiss}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all border border-slate-700 shrink-0"
          title="Ocultar aviso"
        >
          ✕ Fechar
        </button>
      </div>
    </div>
  );
};
