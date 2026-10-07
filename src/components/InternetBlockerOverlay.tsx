import React, { useState, useEffect } from 'react';

export const InternetBlockerOverlay: React.FC = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isChecking, setIsChecking] = useState(false);

  // Verificação ativa de conectividade real via Supabase REST ping
  const checkRealConnection = async (): Promise<boolean> => {
    try {
      // Tenta um ping leve no endpoint auth/health do Supabase
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch('https://iqnuisneqsgtdusiiyvx.supabase.co/rest/v1/', {
        method: 'HEAD',
        headers: {
          apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxbnVpc25lcXNndGR1c2lpeXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyNjQ3NDUsImV4cCI6MjA1Njg0MDc0NX0.V8iT2sO0T2oM6eX4XQn6M8K3J3N7o9_1x2y3z4a5b6c',
        },
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);
      return res !== null && (res.status === 200 || res.status === 401 || res.status === 404);
    } catch {
      return false;
    }
  };

  const verifyStatus = async () => {
    if (!navigator.onLine) {
      setIsOffline(true);
      return;
    }
    const alive = await checkRealConnection();
    setIsOffline(!alive);
  };

  useEffect(() => {
    const handleOnline = () => {
      verifyStatus();
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Heartbeat de verificação a cada 6 segundos
    const interval = setInterval(verifyStatus, 6000);

    // Verificação inicial
    verifyStatus();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const handleManualRetry = async () => {
    setIsChecking(true);
    await verifyStatus();
    setIsChecking(false);
  };

  if (!isOffline) return null;

  return (
    <div className="fixed inset-0 z-[9999999] bg-[#0E0C0A]/96 backdrop-blur-md flex items-center justify-center p-6 select-none animate-in fade-in duration-300">
      <div className="max-w-md w-full bg-[#181411] border border-[#DFC068]/50 rounded-3xl p-8 shadow-2xl text-center space-y-6 shadow-amber-950/40 relative overflow-hidden">
        {/* Efeito de brilho de fundo */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-[#C59B27]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-[#DFC068]/15 rounded-full blur-3xl pointer-events-none" />

        {/* Ícone de alerta pulsante */}
        <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-rose-500/20 animate-ping duration-1000" />
          <div className="relative w-16 h-16 rounded-2xl bg-[#241E18] border border-rose-500/40 flex items-center justify-center text-3xl shadow-inner">
            📡
          </div>
        </div>

        {/* Títulos e avisos */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[11px] font-bold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            Operação Bloqueada
          </div>
          <h2 className="text-xl font-extrabold text-[#F5EFE6] tracking-tight">
            Sem Conexão à Internet
          </h2>
          <p className="text-xs text-[#9E9182] leading-relaxed">
            O <strong className="text-[#DFC068]">2AM Studio Parceiros</strong> exige conexão ativa com a internet para sincronização segura de perfis, publicações automáticas e blindagem de segurança.
          </p>
        </div>

        {/* Barra de reconexão */}
        <div className="bg-[#120F0D] border border-[#2E2620] rounded-2xl p-4 text-left space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#D5C9B8] font-medium flex items-center gap-2">
              <span className="animate-spin text-sm">⏳</span> Reconectando automaticamente...
            </span>
            <span className="text-[10px] font-mono text-[#DFC068] font-bold">REDE</span>
          </div>
          <p className="text-[11px] text-[#7D7063]">
            Verifique o seu Wi-Fi ou cabo de rede. O sistema será liberado imediatamente assim que a conexão for restabelecida.
          </p>
        </div>

        {/* Botão de teste manual */}
        <button
          onClick={handleManualRetry}
          disabled={isChecking}
          className="w-full py-3 px-5 rounded-xl bg-gradient-to-r from-[#8C6D19] via-[#B8860B] to-[#C59B27] hover:from-[#9E7C1D] hover:to-[#D4A72B] text-[#141210] font-extrabold text-xs tracking-wide transition-all shadow-lg shadow-amber-950/50 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 active:scale-[0.98]"
        >
          {isChecking ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-[#141210] border-t-transparent rounded-full animate-spin" />
              <span>Verificando conexão...</span>
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>Testar Conexão Agora</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
