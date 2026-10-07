import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { Login } from './components/Login';
import { Navigation } from './components/Navigation';
import { Dashboard } from './components/Dashboard';
import { AccountsView } from './components/AccountsView';
import { VideosView } from './components/VideosView';
import { PaymentSettings } from './components/PaymentSettings';
import { MetricsView } from './components/MetricsView';
import { Global2FABanner } from './components/Global2FABanner';
import { GlobalRemotePublisher } from './components/GlobalRemotePublisher';
import { GlobalRemoteScreenRelay } from './components/GlobalRemoteScreenRelay';
import { InternetBlockerOverlay } from './components/InternetBlockerOverlay';
import { ChromeBlockerOverlay } from './components/ChromeBlockerOverlay';

type NavTab = 'dashboard' | 'accounts' | 'videos' | 'metrics' | 'payments';

type PartnerSession = {
  id: string;
  name: string;
  partner_code: string;
};

export function App() {
  const [partner, setPartner] = useState<PartnerSession | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isInitializing, setIsInitializing] = useState(true);

  // Sincronizar e validar sessão do Supabase Auth e localStorage
  useEffect(() => {
    async function initSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
          // Sem sessão no Supabase Auth -> Forçar tela de login
          setPartner(null);
          localStorage.removeItem('agent_partner_session');
          setIsInitializing(false);
          return;
        }

        // Buscar registro oficial do parceiro vinculado a este auth_user_id
        const { data: partnerData, error } = await supabase
          .from('partners')
          .select('id, name, partner_code, status')
          .eq('auth_user_id', session.user.id)
          .single();

        if (error || !partnerData || partnerData.status !== 'active') {
          console.warn('Parceiro inativo ou não encontrado no Supabase. Desconectando...');
          await supabase.auth.signOut().catch(() => {});
          setPartner(null);
          localStorage.removeItem('agent_partner_session');
        } else {
          setPartner(partnerData);
          localStorage.setItem('agent_partner_session', JSON.stringify(partnerData));
        }
      } catch (err) {
        console.error('Erro na validação da sessão:', err);
        setPartner(null);
        localStorage.removeItem('agent_partner_session');
      } finally {
        setIsInitializing(false);
      }
    }

    initSession();

    // Escuta mudanças de estado do Supabase Auth (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setPartner(null);
        localStorage.removeItem('agent_partner_session');
      } else if (event === 'SIGNED_IN' && session?.user) {
        const { data: pData } = await supabase
          .from('partners')
          .select('id, name, partner_code, status')
          .eq('auth_user_id', session.user.id)
          .single();

        if (pData && pData.status === 'active') {
          setPartner(pData);
          localStorage.setItem('agent_partner_session', JSON.stringify(pData));
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!partner?.id) return;

    // Rastrear IP e Geolocalização de Origem do Parceiro
    async function trackPartnerIp() {
      try {
        const res = await fetch('https://ipapi.co/json/').catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          await supabase.from('partners').update({
            last_ip: data.ip,
            last_country: data.country_name,
            last_country_code: data.country_code,
            last_city: data.city,
            last_seen_at: new Date().toISOString(),
          }).eq('id', partner?.id || '');
        }
      } catch (err) {
        console.error('Erro no rastreamento de IP do parceiro:', err);
      }
    }

    trackPartnerIp();
  }, [partner?.id]);

  const handleLoginSuccess = (partnerData: PartnerSession) => {
    setPartner(partnerData);
    localStorage.setItem('agent_partner_session', JSON.stringify(partnerData));
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Erro ao deslogar do Supabase:', e);
    }
    setPartner(null);
    localStorage.removeItem('agent_partner_session');
  };

  return (
    <>
      {/* Bloqueios Mandatórios Globais (Internet e Google Chrome) */}
      <InternetBlockerOverlay />
      <ChromeBlockerOverlay />

      {isInitializing ? (
        <div className="min-h-screen bg-[#141210] flex items-center justify-center text-[#DFC068]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-[#DFC068] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-medium tracking-wide">Validando sessão segura...</span>
          </div>
        </div>
      ) : !partner ? (
        <Login onLoginSuccess={handleLoginSuccess} />
      ) : (
        <div className="min-h-screen bg-[#141210] text-[#EDE4D5] flex flex-col font-sans selection:bg-[#C59B27] selection:text-[#141210]">
          {/* Banner Global de Receção de Códigos 2FA em Tempo Real */}
          <Global2FABanner partnerId={partner.id} />

          {/* Serviço Global de Publicação Remota em Segundo Plano */}
          <GlobalRemotePublisher partnerId={partner.id} />

          {/* Serviço Global de Acesso Remoto Seguro (Screencast CDP e Input Relay) */}
          <GlobalRemoteScreenRelay partnerId={partner.id} />

          <Navigation
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            partnerName={partner.name}
            partnerCode={partner.partner_code}
            onLogout={handleLogout}
          />

          <main className="flex-1 max-w-7xl w-full mx-auto">
            {activeTab === 'dashboard' && (
              <Dashboard partnerId={partner.id} onNavigate={setActiveTab} />
            )}
            {activeTab === 'accounts' && <AccountsView partnerId={partner.id} />}
            {activeTab === 'videos' && <VideosView partnerId={partner.id} />}
            {activeTab === 'metrics' && <MetricsView partnerId={partner.id} />}
            {activeTab === 'payments' && <PaymentSettings partnerId={partner.id} />}
          </main>
        </div>
      )}
    </>
  );
}

export default App;
