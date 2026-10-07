import React, { useState, useEffect } from 'react';

export const ChromeBlockerOverlay: React.FC = () => {
  const [isMissingChrome, setIsMissingChrome] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const checkChrome = async () => {
    if (!window.electronAPI?.checkChromeInstalled) return;

    try {
      setIsChecking(true);
      const res = await window.electronAPI.checkChromeInstalled();
      setIsMissingChrome(!res.installed);
    } catch {
      // Se falhar a chamada IPC, não bloqueia por falso positivo
      setIsMissingChrome(false);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkChrome();

    // Re-checar a cada 10 segundos caso o parceiro acabe de instalar o Chrome
    const interval = setInterval(checkChrome, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleDownloadChrome = async () => {
    const url = 'https://www.google.com/chrome/';
    if (window.electronAPI?.openExternalUrl) {
      await window.electronAPI.openExternalUrl(url);
    } else {
      window.open(url, '_blank');
    }
  };

  if (!isMissingChrome) return null;

  return (
    <div className="fixed inset-0 z-[9999998] bg-[#0E0C0A]/98 backdrop-blur-lg flex items-center justify-center p-6 select-none animate-in fade-in duration-300">
      <div className="max-w-md w-full bg-[#181411] border border-rose-500/50 rounded-3xl p-8 shadow-2xl text-center space-y-6 shadow-rose-950/40 relative overflow-hidden">
        {/* Glow de fundo */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-[#C59B27]/10 rounded-full blur-3xl pointer-events-none" />

        {/* Ícone do Chrome com Alerta */}
        <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-[#241E18] border border-rose-500/50 flex items-center justify-center text-3xl shadow-inner">
            🌐
          </div>
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-600 text-white text-xs font-black flex items-center justify-center shadow-md">
            !
          </div>
        </div>

        {/* Textos de bloqueio */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[11px] font-bold uppercase tracking-wider">
            Requisito Obrigatório
          </div>
          <h2 className="text-xl font-extrabold text-[#F5EFE6] tracking-tight">
            Google Chrome Não Encontrado
          </h2>
          <p className="text-xs text-[#9E9182] leading-relaxed">
            O <strong className="text-[#DFC068]">2AM Studio Parceiros</strong> requer obrigatoriamente o navegador <strong className="text-[#F5EFE6]">Google Chrome oficial</strong> para executar perfis isolados, injeções seguras e blindagens contra vazamento de credenciais.
          </p>
        </div>

        {/* Instruções */}
        <div className="bg-[#120F0D] border border-[#2E2620] rounded-2xl p-4 text-left space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#D5C9B8] font-bold">O que fazer:</span>
            <span className="text-[10px] font-mono text-rose-400 font-bold">AÇÃO NECESSÁRIA</span>
          </div>
          <ol className="text-[11px] text-[#A89C8E] list-decimal list-inside space-y-1">
            <li>Baixe e instale o Google Chrome no seu computador</li>
            <li>Após concluir a instalação, clique no botão abaixo</li>
          </ol>
        </div>

        {/* Ações */}
        <div className="space-y-2.5">
          <button
            onClick={handleDownloadChrome}
            className="w-full py-3 px-5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-xs tracking-wide transition-all shadow-lg shadow-blue-950/50 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
          >
            <span>⬇️</span>
            <span>Baixar Google Chrome Oficial</span>
          </button>

          <button
            onClick={checkChrome}
            disabled={isChecking}
            className="w-full py-2.5 px-5 rounded-xl bg-[#241E18] hover:bg-[#302820] text-[#DFC068] border border-[#3E3123] font-bold text-xs tracking-wide transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {isChecking ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-[#DFC068] border-t-transparent rounded-full animate-spin" />
                <span>Verificando Chrome...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>Já Instalei, Verificar Novamente</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
