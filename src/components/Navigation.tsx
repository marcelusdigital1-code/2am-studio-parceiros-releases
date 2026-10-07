import React from 'react';
import logoImg from '../assets/logo.png';

type NavTab = 'dashboard' | 'accounts' | 'videos' | 'metrics' | 'payments';

interface Props {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  partnerName: string;
  partnerCode: string;
  onLogout: () => void;
}

export const Navigation: React.FC<Props> = ({
  activeTab,
  setActiveTab,
  partnerName,
  partnerCode,
  onLogout,
}) => {
  return (
    <header className="bg-[#1A1714] text-[#F5EFE6] border-b border-[#383028] px-6 py-3.5 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl p-0.5 bg-gradient-to-br from-[#8C6D19] via-[#B8860B] to-[#C59B27] shadow-sm border border-[#DFC068]/40 overflow-hidden flex items-center justify-center shrink-0">
          <img src={logoImg} alt="2AM Studio" className="w-full h-full object-cover rounded-lg" />
        </div>
        <div>
          <h1 className="font-extrabold text-sm tracking-wide text-[#F5EFE6] leading-tight">
            2AM Studio Parceiros
          </h1>
          <p className="text-[11px] text-[#A89C8E]">
            {partnerName} <span className="font-mono text-[#DFC068]">({partnerCode})</span>
          </p>
        </div>
      </div>

      <nav className="flex items-center gap-1 bg-[#141210] p-1 rounded-xl border border-[#2E2620]">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'dashboard'
              ? 'bg-[#2A231D] text-[#E8C872] border border-[#524436] shadow-xs'
              : 'text-[#9E9182] hover:text-[#EDE4D5] hover:bg-[#1E1A17]'
          }`}
        >
          <span>📊</span>
          <span>Visão Geral</span>
        </button>

        <button
          onClick={() => setActiveTab('accounts')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'accounts'
              ? 'bg-[#2A231D] text-[#E8C872] border border-[#524436] shadow-xs'
              : 'text-[#9E9182] hover:text-[#EDE4D5] hover:bg-[#1E1A17]'
          }`}
        >
          <span>👤</span>
          <span>Perfis & Redes</span>
        </button>

        <button
          onClick={() => setActiveTab('videos')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'videos'
              ? 'bg-[#2A231D] text-[#E8C872] border border-[#524436] shadow-xs'
              : 'text-[#9E9182] hover:text-[#EDE4D5] hover:bg-[#1E1A17]'
          }`}
        >
          <span>📥</span>
          <span>Vídeos & Publicação</span>
        </button>

        <button
          onClick={() => setActiveTab('metrics')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'metrics'
              ? 'bg-[#2A231D] text-[#E8C872] border border-[#524436] shadow-xs'
              : 'text-[#9E9182] hover:text-[#EDE4D5] hover:bg-[#1E1A17]'
          }`}
        >
          <span>📈</span>
          <span>Métricas & Views</span>
        </button>

        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'payments'
              ? 'bg-[#2A231D] text-[#E8C872] border border-[#524436] shadow-xs'
              : 'text-[#9E9182] hover:text-[#EDE4D5] hover:bg-[#1E1A17]'
          }`}
        >
          <span>💰</span>
          <span>Pagamentos</span>
        </button>
      </nav>

      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#7EE787] bg-[#14261B] border border-[#1E4A30] px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7EE787] animate-pulse"></span>
          Ambiente Protegido
        </span>
        <button
          onClick={onLogout}
          className="text-[#9E9182] hover:text-[#F87171] p-1.5 rounded-lg hover:bg-[#251F1A] transition-colors text-xs font-semibold cursor-pointer"
          title="Sair da Plataforma"
        >
          🚪 Sair
        </button>
      </div>
    </header>
  );
};
