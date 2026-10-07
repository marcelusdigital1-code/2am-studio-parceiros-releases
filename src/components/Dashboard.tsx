import React, { useEffect, useState } from 'react';
import { supabase, type Account, type Job } from '../lib/supabase';
import { PlatformIcon } from './PlatformIcon';

interface Props {
  partnerId: string;
  onNavigate: (tab: 'dashboard' | 'accounts' | 'videos' | 'metrics' | 'payments') => void;
}

export const Dashboard: React.FC<Props> = ({ partnerId, onNavigate }) => {
  const [profilesCount, setProfilesCount] = useState(0);
  const [accountsCount, setAccountsCount] = useState(0);
  const [pendingJobsCount, setPendingJobsCount] = useState(0);
  const [publishedTodayCount, setPublishedTodayCount] = useState(0);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboardData = async () => {
      setLoading(true);

      // Contas do parceiro
      const { data: accounts } = await supabase
        .from('accounts')
        .select('*')
        .eq('partner_id', partnerId)
        .eq('status', 'active');

      if (accounts) {
        // Agrupar perfis únicos (1 perfil com TikTok, YouTube e Facebook conta como 1)
        const uniqueProfiles = new Set(
          accounts.map((acc) => {
            const prfMatch = acc.account_code?.match(/^(PRF-\d+)/i);
            return acc.profile_id || (prfMatch ? prfMatch[1].toUpperCase() : `single-${acc.id}`);
          })
        );
        setProfilesCount(uniqueProfiles.size);
        setAccountsCount(accounts.length);
        setAccountsList(accounts as Account[]);
      }

      // Jobs do parceiro
      const { data: jobs } = await supabase
        .from('jobs')
        .select(`
          *,
          videos(*),
          accounts(*)
        `)
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (jobs) {
        const typedJobs = jobs as unknown as Job[];
        const pending = typedJobs.filter((j: Job) => j.status === 'pending' || j.status === 'downloaded');
        setPendingJobsCount(pending.length);

        const todayStr = new Date().toISOString().split('T')[0];
        const publishedToday = typedJobs.filter(
          (j: Job) => j.status === 'published' && j.published_at?.startsWith(todayStr)
        );
        setPublishedTodayCount(publishedToday.length);

        setRecentJobs(typedJobs.slice(0, 5));
      }

      setLoading(false);
    };

    loadDashboardData();
  }, [partnerId]);

  return (
    <div className="p-6 space-y-6">
      {/* Resumo em Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Perfis Vinculados
            </p>
            <h3 className="text-2xl font-black text-white mt-1">{profilesCount}</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              {accountsCount} {accountsCount === 1 ? 'canal conectado' : 'canais conectados'} (TikTok, YT, FB)
            </p>
          </div>
          <button
            onClick={() => onNavigate('accounts')}
            className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-400 flex items-center justify-center text-xl hover:bg-blue-600/20 transition-all cursor-pointer"
            title="Ver perfis e canais vinculados"
          >
            👤
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Vídeos para Publicar
            </p>
            <h3 className="text-2xl font-black text-amber-400 mt-1">{pendingJobsCount}</h3>
            <p className="text-[11px] text-slate-500 mt-1">Aguardando sua publicação</p>
          </div>
          <button
            onClick={() => onNavigate('videos')}
            className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center text-xl hover:bg-amber-500/20 transition-all"
          >
            📥
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Publicados Hoje
            </p>
            <h3 className="text-2xl font-black text-emerald-400 mt-1">{publishedTodayCount}</h3>
            <p className="text-[11px] text-slate-500 mt-1">Concluídos com sucesso</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-xl">
            ✨
          </div>
        </div>
      </div>

      {/* Ações Rápidas */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <span>🚀</span> Acesso Rápido às Contas
        </h3>

        {loading ? (
          <p className="text-xs text-slate-500 italic">Carregando suas contas...</p>
        ) : accountsList.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhuma conta atribuída pelo ADM ainda.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {accountsList.map((acc) => (
              <div
                key={acc.id}
                className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center justify-between hover:border-slate-700 transition-all"
              >
                <div className="flex items-center gap-3">
                  <PlatformIcon platform={acc.platform} className="w-6 h-6 shrink-0 rounded-md" />
                  <div>
                    <h4 className="font-bold text-xs text-white">{acc.username}</h4>
                    <p className="text-[10px] text-slate-400 capitalize">{acc.platform}</p>
                  </div>
                </div>

                <button
                  onClick={() => onNavigate('accounts')}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1"
                >
                  <span>🔐</span> Acessar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lista de Tarefas / Vídeos Pendentes Recentes */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>📋</span> Últimos Vídeos Recebidos
          </h3>
          <button
            onClick={() => onNavigate('videos')}
            className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
          >
            Ver Todos →
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-slate-500 italic">Buscando publicações...</p>
        ) : recentJobs.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhum vídeo enviado pelo ADM até o momento.</p>
        ) : (
          <div className="space-y-2.5">
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-lg">
                    🎬
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">
                      {job.videos?.filename || 'Vídeo sem nome'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Destino: <span className="font-semibold text-blue-400">{job.accounts?.username || 'Conta'}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                      job.status === 'published'
                        ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                        : job.status === 'downloaded'
                        ? 'bg-blue-950/60 text-blue-400 border-blue-800/50'
                        : 'bg-amber-950/60 text-amber-400 border-amber-800/50'
                    }`}
                  >
                    {job.status === 'published'
                      ? '✅ Publicado'
                      : job.status === 'downloaded'
                      ? '⬇️ Baixado'
                      : '⏳ Pendente'}
                  </span>

                  <button
                    onClick={() => onNavigate('videos')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-all"
                  >
                    Gerenciar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
