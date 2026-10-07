import React, { useEffect, useState, useMemo } from 'react';
import { supabase, type Account, type AccountMetrics } from '../lib/supabase';
import { PlatformIcon } from './PlatformIcon';

interface Props {
  partnerId: string;
}

interface AccountWithMetrics extends Account {
  account_metrics?: AccountMetrics[] | AccountMetrics | null;
  account_profiles?: {
    name?: string | null;
    profile_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
}

interface ProfileGroup {
  profileId: string;
  profileCode: string;
  profileName: string;
  accounts: AccountWithMetrics[];
  totalViews: number;
  totalFollowers: number;
  totalLikes: number;
  totalVideos: number;
}

export const MetricsView: React.FC<Props> = ({ partnerId }) => {
  const [accounts, setAccounts] = useState<AccountWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchMetrics = async (showLoadingState = true) => {
    if (showLoadingState) setLoading(true);
    else setIsRefreshing(true);

    try {
      const { data, error } = await supabase
        .from('accounts')
        .select(`
          *,
          account_metrics(*),
          account_profiles!profile_id(name, profile_name, first_name, last_name)
        `)
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (error) {
        // Fallback sem join de profiles caso FK seja diferente
        const { data: fallbackData } = await supabase
          .from('accounts')
          .select(`
            *,
            account_metrics(*)
          `)
          .eq('partner_id', partnerId)
          .order('created_at', { ascending: false });

        if (fallbackData) {
          setAccounts(fallbackData as unknown as AccountWithMetrics[]);
        }
      } else if (data) {
        setAccounts(data as unknown as AccountWithMetrics[]);
      }

      setLastSyncTime(new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('Erro ao carregar métricas:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleSyncLiveMetrics = async () => {
    setIsRefreshing(true);
    try {
      // Tentar coletar métricas reais de sessões abertas do Chrome via CDP
      const api = (window as unknown as { electronAPI?: { scrapeChannelMetrics?: (data: { accountCode: string; platform: string }) => Promise<{ success: boolean; metrics?: Partial<AccountMetrics>; error?: string }> } }).electronAPI;
      if (api?.scrapeChannelMetrics) {
        for (const acc of accounts) {
          try {
            const res = await api.scrapeChannelMetrics({
              accountCode: acc.account_code,
              platform: acc.platform,
              accountId: acc.id,
              partnerId: (acc as any).partner_id || partnerId,
              username: acc.username || '',
              profileUrl: acc.profile_url || '',
            });
            if (res?.success && res.metrics) {
              const m = res.metrics;
              await supabase.from('account_metrics').upsert(
                {
                  account_id: acc.id,
                  followers: m.followers || 0,
                  following: m.following || 0,
                  likes: m.likes || 0,
                  views: m.views || 0,
                  videos_count: m.videos_count || 0,
                  subscribers: m.subscribers || 0,
                  profile_name: m.profile_name || null,
                  profile_image: m.profile_image || null,
                },
                { onConflict: 'account_id' }
              );
            }
          } catch (e) {
            console.warn(`Erro ao sincronizar métricas de ${acc.account_code}:`, e);
          }
        }
      }

      await fetchMetrics(false);
    } catch (err) {
      console.error('Erro na sincronização de métricas:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (partnerId) {
      fetchMetrics(true);
    }

    // Escutar mudanças em tempo real na tabela account_metrics
    const metricsChannel = supabase
      .channel(`partner_metrics_realtime_${partnerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'account_metrics',
        },
        () => {
          fetchMetrics(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(metricsChannel);
    };
  }, [partnerId]);

  // Helper para extrair métricas de forma normalizada
  const getMetrics = (acc: AccountWithMetrics): AccountMetrics => {
    const m = Array.isArray(acc.account_metrics)
      ? acc.account_metrics[0]
      : acc.account_metrics;

    return {
      id: m?.id || '',
      account_id: acc.id,
      followers: Number(m?.followers) || 0,
      following: Number(m?.following) || 0,
      likes: Number(m?.likes) || 0,
      views: Number(m?.views) || 0,
      videos_count: Number(m?.videos_count) || 0,
      subscribers: Number(m?.subscribers) || 0,
      profile_name: m?.profile_name || null,
      profile_image: m?.profile_image || null,
    };
  };

  // Helper para verificar se uma string parece com endereço de e-mail
  const isEmailLike = (str?: string | null): boolean => {
    if (!str) return false;
    const s = str.trim();
    return s.includes('@') && (s.includes('.com') || s.includes('.net') || s.includes('.org') || s.includes('.io') || s.includes('.br') || s.split('@').length > 2);
  };

  // Helper para gerar a URL pública e direta do canal/perfil sem autenticação
  const getPublicChannelUrl = (acc: AccountWithMetrics): string => {
    const plat = acc.platform;
    const rawUrl = (acc.profile_url || '').trim();
    const rawUser = (acc.username || '').trim().replace(/^@/, '');

    if (plat === 'youtube') {
      if (rawUrl) {
        if (rawUrl.includes('studio.youtube.com/channel/')) {
          const chId = rawUrl.split('studio.youtube.com/channel/')[1]?.split(/[/?#]/)[0];
          if (chId) return `https://www.youtube.com/channel/${chId}`;
        }
        if (!isEmailLike(rawUrl)) {
          if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
          const h = rawUrl.replace(/^@/, '');
          return h.startsWith('UC') ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}`;
        }
      }
      if (rawUser && !isEmailLike(rawUser)) {
        if (rawUser.startsWith('UC') && rawUser.length === 24) {
          return `https://www.youtube.com/channel/${rawUser}`;
        }
        return `https://www.youtube.com/@${rawUser}`;
      }
      return 'https://www.youtube.com';
    }

    if (plat === 'tiktok') {
      if (rawUrl) {
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
        if (!isEmailLike(rawUrl)) {
          return `https://www.tiktok.com/@${rawUrl.replace(/^@/, '')}`;
        }
      }
      if (rawUser && !isEmailLike(rawUser)) {
        return `https://www.tiktok.com/@${rawUser}`;
      }
      return 'https://www.tiktok.com';
    }

    if (plat === 'instagram') {
      if (rawUrl) {
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
        if (!isEmailLike(rawUrl)) {
          return `https://www.instagram.com/${rawUrl.replace(/^@/, '')}/`;
        }
      }
      if (rawUser && !isEmailLike(rawUser)) {
        return `https://www.instagram.com/${rawUser}/`;
      }
      return 'https://www.instagram.com';
    }

    if (plat === 'facebook') {
      if (rawUrl) {
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
        if (!isEmailLike(rawUrl)) {
          return `https://www.facebook.com/${rawUrl.replace(/^@/, '')}`;
        }
      }
      if (rawUser && !isEmailLike(rawUser)) {
        return `https://www.facebook.com/${rawUser}`;
      }
      return 'https://www.facebook.com';
    }

    return 'https://www.google.com';
  };

  const handleOpenPublicProfile = async (acc: AccountWithMetrics) => {
    setResolvingId(acc.id);
    try {
      const api = (window as unknown as { electronAPI?: {
        resolvePublicProfileUrl?: (data: any) => Promise<{ success: boolean; url?: string }>;
        openExternalUrl?: (url: string) => Promise<void>;
      } }).electronAPI;

      let targetUrl = '';
      if (api?.resolvePublicProfileUrl) {
        const res = await api.resolvePublicProfileUrl({
          accountCode: acc.account_code,
          platform: acc.platform,
          accountId: acc.id,
          partnerId: (acc as any).partner_id || partnerId,
          username: acc.username || '',
          profileUrl: acc.profile_url || '',
        });
        if (res?.success && res.url) {
          targetUrl = res.url;
          setAccounts((prev) =>
            prev.map((a) => (a.id === acc.id ? { ...a, profile_url: targetUrl } : a))
          );
        }
      }

      if (!targetUrl) {
        targetUrl = getPublicChannelUrl(acc);
      }

      if (!targetUrl || targetUrl === '#' || targetUrl.length < 5) {
        alert('Página pública não encontrada para esta conta.');
        return;
      }

      if (api?.openExternalUrl) {
        await api.openExternalUrl(targetUrl);
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err: any) {
      console.error('Erro ao abrir canal público:', err);
    } finally {
      setResolvingId(null);
    }
  };

  // Agrupamento por Perfil (PRF-01, PRF-02...)
  const profileGroups = useMemo<ProfileGroup[]>(() => {
    const map = new Map<string, ProfileGroup>();

    accounts.forEach((acc) => {
      // Extrair código de perfil do account_code (ex: PRF-01-TK -> PRF-01)
      const prfMatch = acc.account_code?.match(/^(PRF-\d+)/i);
      const prfCode = prfMatch ? prfMatch[1].toUpperCase() : 'PRF-01';
      const key = acc.profile_id || prfCode;

      const profName =
        acc.account_profiles?.name ||
        acc.account_profiles?.profile_name ||
        (acc.account_profiles?.first_name ? `${acc.account_profiles.first_name} ${acc.account_profiles.last_name || ''}`.trim() : '') ||
        `Perfil ${prfCode}`;

      if (!map.has(key)) {
        map.set(key, {
          profileId: key,
          profileCode: prfCode,
          profileName: profName,
          accounts: [],
          totalViews: 0,
          totalFollowers: 0,
          totalLikes: 0,
          totalVideos: 0,
        });
      }

      const group = map.get(key)!;
      group.accounts.push(acc);

      const met = getMetrics(acc);
      group.totalViews += met.views;
      group.totalFollowers += acc.platform === 'youtube' ? met.subscribers : met.followers;
      group.totalLikes += met.likes;
      group.totalVideos += met.videos_count;
    });

    return Array.from(map.values()).sort((a, b) => a.profileCode.localeCompare(b.profileCode));
  }, [accounts]);

  // Totais Gerais Acumulados do Parceiro
  const overallTotals = useMemo(() => {
    let views = 0;
    let audience = 0;
    let likes = 0;
    let videos = 0;
    let hasAnyData = false;

    accounts.forEach((acc) => {
      const met = getMetrics(acc);
      views += met.views;
      audience += acc.platform === 'youtube' ? met.subscribers : met.followers;
      likes += met.likes;
      videos += met.videos_count;
      if (met.views > 0 || met.followers > 0 || met.subscribers > 0 || met.likes > 0) {
        hasAnyData = true;
      }
    });

    return { views, audience, likes, videos, hasAnyData };
  }, [accounts]);

  // Filtragem
  const filteredGroups = useMemo(() => {
    return profileGroups
      .map((group) => {
        const filteredAccounts = group.accounts.filter((acc) => {
          const matchPlatform = selectedPlatform === 'all' || acc.platform === selectedPlatform;
          const query = searchQuery.toLowerCase().trim();
          const matchSearch =
            !query ||
            acc.account_code?.toLowerCase().includes(query) ||
            acc.username?.toLowerCase().includes(query) ||
            group.profileName.toLowerCase().includes(query);

          return matchPlatform && matchSearch;
        });

        return {
          ...group,
          accounts: filteredAccounts,
        };
      })
      .filter((group) => group.accounts.length > 0);
  }, [profileGroups, selectedPlatform, searchQuery]);

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(1).replace('.0', '') + 'M';
    }
    if (num >= 1_000) {
      return (num / 1_000).toFixed(1).replace('.0', '') + 'k';
    }
    return num.toLocaleString('pt-PT');
  };

  const platformNames: Record<string, string> = {
    tiktok: 'TikTok',
    youtube: 'YouTube Shorts',
    facebook: 'Facebook Reels',
    instagram: 'Instagram Reels',
  };

  return (
    <div className="p-6 space-y-6">
      {/* Cabeçalho da Aba */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[#1A1714] border border-[#383028] p-5 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📈</span>
            <h2 className="text-lg font-black text-[#F5EFE6] tracking-wide">
              Métricas & Desempenho Real das Contas
            </h2>
          </div>
          <p className="text-xs text-[#A89C8E] mt-1">
            Estatísticas auditadas e dados oficiais das suas contas e redes vinculadas. Zero números fictícios.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          {lastSyncTime && (
            <span className="text-[11px] text-[#A89C8E] hidden sm:inline">
              Última sincronização: <span className="font-mono text-[#DFC068]">{lastSyncTime}</span>
            </span>
          )}
          <button
            onClick={handleSyncLiveMetrics}
            disabled={isRefreshing || loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#2A231D] hover:bg-[#383028] text-[#E8C872] border border-[#524436] rounded-xl text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer shadow-xs"
            title="Atualizar e raspar métricas oficiais do canal"
          >
            <span className={isRefreshing ? 'animate-spin' : ''}>🔄</span>
            <span>{isRefreshing ? 'Sincronizando...' : 'Sincronizar Métricas'}</span>
          </button>
        </div>
      </div>

      {/* Cards de Resumo Geral Acumulado */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Views */}
        <div className="bg-[#1A1714] border border-[#383028] rounded-2xl p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#A89C8E] uppercase tracking-wider">
              Visualizações Reais
            </span>
            <div className="w-8 h-8 rounded-lg bg-[#DFC068]/10 border border-[#DFC068]/20 flex items-center justify-center text-sm">
              👁️
            </div>
          </div>
          <h3 className="text-2xl font-black text-[#F5EFE6] mt-2 font-mono">
            {formatNumber(overallTotals.views)}
          </h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
            {overallTotals.views > 0 ? (
              <span className="text-[#7EE787] font-medium">● Dados sincronizados</span>
            ) : (
              <span className="text-[#A89C8E] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#A89C8E]"></span>
                Aguardando visualizações oficiais
              </span>
            )}
          </div>
        </div>

        {/* Audiência / Seguidores */}
        <div className="bg-[#1A1714] border border-[#383028] rounded-2xl p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#A89C8E] uppercase tracking-wider">
              Audiência Total
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-sm">
              👥
            </div>
          </div>
          <h3 className="text-2xl font-black text-[#F5EFE6] mt-2 font-mono">
            {formatNumber(overallTotals.audience)}
          </h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#A89C8E]">
            <span>Seguidores & Inscritos</span>
          </div>
        </div>

        {/* Curtidas / Likes */}
        <div className="bg-[#1A1714] border border-[#383028] rounded-2xl p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#A89C8E] uppercase tracking-wider">
              Curtidas & Reações
            </span>
            <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-sm">
              ❤️
            </div>
          </div>
          <h3 className="text-2xl font-black text-[#F5EFE6] mt-2 font-mono">
            {formatNumber(overallTotals.likes)}
          </h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#A89C8E]">
            <span>Engajamento acumulado</span>
          </div>
        </div>

        {/* Contas Monitoradas */}
        <div className="bg-[#1A1714] border border-[#383028] rounded-2xl p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#A89C8E] uppercase tracking-wider">
              Canais Conectados
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-sm">
              🎬
            </div>
          </div>
          <h3 className="text-2xl font-black text-[#F5EFE6] mt-2 font-mono">
            {accounts.length}
          </h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#A89C8E]">
            <span>Em {profileGroups.length} {profileGroups.length === 1 ? 'perfil' : 'perfis'}</span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros & Pesquisa */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#1A1714] border border-[#383028] p-3 rounded-2xl">
        {/* Filtro por Plataforma */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'Todas Redes' },
            { id: 'tiktok', label: 'TikTok' },
            { id: 'youtube', label: 'YouTube' },
            { id: 'instagram', label: 'Instagram' },
            { id: 'facebook', label: 'Facebook' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedPlatform(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedPlatform === tab.id
                  ? 'bg-[#2A231D] text-[#E8C872] border border-[#524436]'
                  : 'text-[#9E9182] hover:text-[#EDE4D5] hover:bg-[#1E1A17]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Input de Busca */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#9E9182]">🔍</span>
          <input
            type="text"
            placeholder="Buscar por @username ou PRF..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-64 bg-[#141210] border border-[#383028] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#F5EFE6] placeholder-[#6E6459] focus:outline-none focus:border-[#DFC068]/60 transition-colors"
          />
        </div>
      </div>

      {/* Lista de Perfis e Contas */}
      {loading ? (
        <div className="py-16 text-center text-[#DFC068] flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#DFC068] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium tracking-wide">Carregando métricas reais do banco...</span>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bg-[#1A1714] border border-[#383028] rounded-2xl p-12 text-center">
          <span className="text-4xl">📊</span>
          <h3 className="text-sm font-bold text-[#F5EFE6] mt-3">Nenhuma conta encontrada</h3>
          <p className="text-xs text-[#A89C8E] mt-1">
            {accounts.length === 0
              ? 'Você ainda não possui contas vinculadas neste parceiro.'
              : 'Nenhuma conta corresponde aos filtros aplicados.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredGroups.map((group) => (
            <div
              key={group.profileId}
              className="bg-[#1A1714] border border-[#383028] rounded-2xl overflow-hidden shadow-sm"
            >
              {/* Cabeçalho do Perfil */}
              <div className="bg-[#141210]/60 border-b border-[#383028] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold text-[#DFC068] bg-[#2A231D] border border-[#524436] px-2.5 py-1 rounded-lg">
                    {group.profileCode}
                  </span>
                  <div>
                    <h3 className="font-bold text-sm text-[#F5EFE6]">{group.profileName}</h3>
                    <p className="text-[11px] text-[#A89C8E]">
                      {group.accounts.length} {group.accounts.length === 1 ? 'canal monitorado' : 'canais monitorados'}
                    </p>
                  </div>
                </div>

                {/* Subtotais do Perfil */}
                <div className="flex items-center gap-4 text-xs font-mono">
                  <div className="text-right">
                    <span className="text-[10px] uppercase text-[#A89C8E] block">Views</span>
                    <span className="font-bold text-[#F5EFE6]">{formatNumber(group.totalViews)}</span>
                  </div>
                  <div className="w-px h-6 bg-[#383028]" />
                  <div className="text-right">
                    <span className="text-[10px] uppercase text-[#A89C8E] block">Audiência</span>
                    <span className="font-bold text-[#DFC068]">{formatNumber(group.totalFollowers)}</span>
                  </div>
                  <div className="w-px h-6 bg-[#383028]" />
                  <div className="text-right">
                    <span className="text-[10px] uppercase text-[#A89C8E] block">Likes</span>
                    <span className="font-bold text-[#F5EFE6]">{formatNumber(group.totalLikes)}</span>
                  </div>
                </div>
              </div>

              {/* Cards das Redes Sociais do Perfil */}
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.accounts.map((acc) => {
                  const m = getMetrics(acc);
                  const isYt = acc.platform === 'youtube';
                  const audienceCount = isYt ? m.subscribers : m.followers;
                  const audienceLabel = isYt ? 'Inscritos' : 'Seguidores';
                  const hasData = m.views > 0 || audienceCount > 0 || m.likes > 0 || m.videos_count > 0;

                  return (
                    <div
                      key={acc.id}
                      className="bg-[#141210] border border-[#2E2620] hover:border-[#524436] transition-all rounded-xl p-4 flex flex-col justify-between gap-4"
                    >
                      {/* Topo do Card da Conta */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <PlatformIcon platform={acc.platform} className="w-8 h-8 shrink-0" />
                          <div className="min-w-0">
                            <span className="text-[11px] font-bold text-[#DFC068] block leading-tight">
                              {platformNames[acc.platform] || acc.platform.toUpperCase()}
                            </span>
                            <span
                              className="text-xs font-mono text-[#F5EFE6] truncate block max-w-[150px]"
                              title={acc.username || acc.account_code}
                            >
                              {m.profile_name ||
                                (acc.profile_url && !isEmailLike(acc.profile_url) && !acc.profile_url.startsWith('http') ? acc.profile_url : '') ||
                                (acc.username && !isEmailLike(acc.username) ? `@${acc.username.replace(/^@/, '')}` : '') ||
                                acc.account_code}
                            </span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                            hasData
                              ? 'text-[#7EE787] bg-[#14261B] border-[#1E4A30]'
                              : 'text-[#A89C8E] bg-[#1E1A17] border-[#383028]'
                          }`}
                        >
                          {hasData ? '● Ativo' : '⏳ Aguardando sync'}
                        </span>
                      </div>

                      {/* Métricas Principais em Grade */}
                      <div className="grid grid-cols-2 gap-2 bg-[#1A1714] p-3 rounded-lg border border-[#2E2620]">
                        {/* Visualizações */}
                        <div>
                          <span className="text-[10px] text-[#A89C8E] uppercase tracking-wider block">
                            Visualizações
                          </span>
                          <span className="text-base font-black font-mono text-[#F5EFE6]">
                            {formatNumber(m.views)}
                          </span>
                        </div>

                        {/* Seguidores / Inscritos */}
                        <div>
                          <span className="text-[10px] text-[#A89C8E] uppercase tracking-wider block">
                            {audienceLabel}
                          </span>
                          <span className="text-base font-black font-mono text-[#DFC068]">
                            {formatNumber(audienceCount)}
                          </span>
                        </div>

                        {/* Curtidas */}
                        <div>
                          <span className="text-[10px] text-[#A89C8E] uppercase tracking-wider block">
                            Curtidas
                          </span>
                          <span className="text-xs font-bold font-mono text-[#F5EFE6]">
                            {formatNumber(m.likes)}
                          </span>
                        </div>

                        {/* Vídeos Postados */}
                        <div>
                          <span className="text-[10px] text-[#A89C8E] uppercase tracking-wider block">
                            Vídeos
                          </span>
                          <span className="text-xs font-bold font-mono text-[#F5EFE6]">
                            {m.videos_count}
                          </span>
                        </div>
                      </div>

                      {/* Rodapé do Card com Botão de Acesso Público */}
                      <div className="flex items-center justify-between text-[10px] text-[#A89C8E] pt-2 border-t border-[#251F1A]">
                        <span className="font-mono text-[10px] text-[#6E6459]">
                          ID: {acc.account_code}
                        </span>
                        <button
                          type="button"
                          disabled={resolvingId === acc.id}
                          onClick={() => handleOpenPublicProfile(acc)}
                          className="px-2.5 py-1 rounded-lg bg-[#1E1A16] hover:bg-[#2A231C] text-[#DFC068] hover:text-[#F5EFE6] border border-[#383028] hover:border-[#6B5844] transition-all flex items-center gap-1.5 font-medium shadow-sm active:scale-95 group cursor-pointer disabled:opacity-50"
                          title={`Abrir página pública no navegador padrão sem login (${platformNames[acc.platform] || acc.platform})`}
                        >
                          {resolvingId === acc.id ? (
                            <>
                              <span className="w-2.5 h-2.5 border-2 border-[#DFC068] border-t-transparent rounded-full animate-spin"></span>
                              <span>Localizando...</span>
                            </>
                          ) : (
                            <>
                              <span>Ver {isYt ? 'Canal' : 'Perfil'}</span>
                              <span className="text-xs transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
