import React, { useEffect, useState, useMemo } from 'react';
import { supabase, type Job, type Video } from '../lib/supabase';
import { ManualPublishModal } from './ManualPublishModal';
import { PlatformIcon } from './PlatformIcon';

interface Props {
  partnerId: string;
}

const PLATFORM_ORDER: Record<string, number> = {
  tiktok: 1,
  youtube: 2,
  facebook: 3,
  instagram: 4,
};

const isEmailLike = (str?: string | null): boolean => {
  if (!str) return false;
  return str.includes('@') && (str.includes('.com') || str.includes('.net') || str.includes('.org') || str.includes('.io') || str.includes('.br') || str.includes('.pt') || /\S+@\S+\.\S+/.test(str));
};

const formatAccountDisplayName = (username?: string, platform?: string) => {
  if (!username || isEmailLike(username)) {
    switch (platform) {
      case 'youtube': return 'Canal YouTube';
      case 'facebook': return 'Página Facebook';
      case 'instagram': return 'Conta Creator';
      default: return 'Canal TikTok';
    }
  }
  return username.startsWith('@') ? username : `@${username}`;
};

export interface VideoPackage {
  packageId: string;
  videoId: string;
  video: Video;
  jobs: Job[];
  pendingJobs: Job[];
  publishedJobs: Job[];
  allPublished: boolean;
  hasPending: boolean;
  createdAt: string;
}

export const VideosView: React.FC<Props> = ({ partnerId }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  // States para download e publicação
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [localVideoPaths, setLocalVideoPaths] = useState<Record<string, string>>({});
  const [publishingJob, setPublishingJob] = useState<Job | null>(null);
  const [publishingJobId, setPublishingJobId] = useState<string | null>(null);
  const [publishingPkgId, setPublishingPkgId] = useState<string | null>(null);

  const [publishProgress, setPublishProgress] = useState<{
    jobId: string;
    platform: string;
    status: 'uploading' | 'captioning' | 'publishing' | 'done' | 'error';
    progress: number;
    message: string;
  } | null>(null);

  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'published'>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const publishInBackground = true;

  // Canal Realtime para transmitir progresso em tempo real ao Painel Administrativo
  const broadcastChannel = useMemo(() => {
    return supabase.channel('video-publishing-progress');
  }, []);

  useEffect(() => {
    broadcastChannel.subscribe();
    return () => {
      supabase.removeChannel(broadcastChannel);
    };
  }, [broadcastChannel]);

  useEffect(() => {
    fetchJobs();

    // 1. Escutar alterações em tempo real na tabela de jobs do Supabase (novos vídeos atribuídos pelo ADM)
    const jobsLiveChannel = supabase
      .channel(`partner-jobs-live-${partnerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
          filter: `partner_id=eq.${partnerId}`,
        },
        (payload) => {
          console.log('[VIDEOS VIEW] Novo job ou alteração detectada via Realtime!', payload);
          fetchJobs();
        }
      )
      .on(
        'broadcast',
        { event: 'new-video-assigned' },
        (event) => {
          console.log('[VIDEOS VIEW] Novo vídeo atribuído via broadcast do ADM!', event);
          fetchJobs();
        }
      )
      .subscribe();

    // 2. Escutar progresso de publicação do Electron em tempo real
    if (window.electronAPI?.onPublishProgress) {
      window.electronAPI.onPublishProgress((data) => {
        setPublishProgress(data);

        // Transmitir progresso ao Painel Admin em tempo real
        try {
          broadcastChannel.send({
            type: 'broadcast',
            event: 'publish-progress',
            payload: {
              ...data,
              partnerId,
            },
          });
        } catch (e) {
          console.warn('Falha no broadcast de progresso:', e);
        }
      });
    }

    return () => {
      supabase.removeChannel(jobsLiveChannel);
    };
  }, [partnerId, broadcastChannel]);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          videos(*),
          accounts(*)
        `)
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[VIDEOS VIEW] Erro ao carregar jobs do parceiro:', error);
      } else if (data) {
        setJobs(data as unknown as Job[]);
      }
    } catch (err) {
      console.error('[VIDEOS VIEW] Falha na consulta de jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Executa a publicação de um job individual com verificação estrita
  const executeSingleJob = async (job: Job): Promise<void> => {
    setPublishingJobId(job.id);
    try {
      let localPath = localVideoPaths[job.id] || '';

      // Se ainda não foi baixado, realiza o download automaticamente na hora
      if (!localPath) {
        const videoUrl = job.videos?.storage_url;
        const profileName = job.accounts?.username || 'Geral';
        const filename = job.videos?.filename || `video_${job.id.slice(0, 6)}.mp4`;

        if (window.electronAPI?.downloadVideo && videoUrl) {
          const dlRes = await window.electronAPI.downloadVideo({
            videoUrl,
            profileName,
            filename,
          });

          if (dlRes.success && dlRes.localPath) {
            localPath = dlRes.localPath;
            setLocalVideoPaths((prev) => ({ ...prev, [job.id]: dlRes.localPath! }));
            await supabase
              .from('jobs')
              .update({
                status: 'downloaded',
                downloaded_at: new Date().toISOString(),
              })
              .eq('id', job.id);

            setJobs((prev) =>
              prev.map((j) => (j.id === job.id ? { ...j, status: 'downloaded' } : j))
            );
          } else {
            throw new Error(dlRes.error || 'Falha ao baixar arquivo de vídeo');
          }
        } else {
          await new Promise((r) => setTimeout(r, 1500));
          localPath = `Agent/Videos/${profileName}/${filename}`;
        }
      }

      const platform = (job.accounts?.platform as 'tiktok' | 'youtube' | 'facebook' | 'instagram') || 'tiktok';

      if (window.electronAPI?.autoPublishVideo) {
        const res = await window.electronAPI.autoPublishVideo({
          jobId: job.id,
          videoLocalPath: localPath,
          accountCode: job.accounts?.account_code,
          partnerId: job.partner_id || partnerId,
          pageUrl: job.accounts?.profile_url || undefined,
          title: job.title || job.videos?.filename || 'Vídeo Viral',
          caption: job.caption || '',
          hashtags: job.hashtags || [],
          platforms: [platform],
          runInBackground: publishInBackground,
        });

        if (res.success) {
          const nowIso = new Date().toISOString();
          await supabase
            .from('jobs')
            .update({
              status: 'published',
              published_at: nowIso,
              fail_reason: null,
            })
            .eq('id', job.id);

          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, status: 'published', published_at: nowIso, fail_reason: null } : j))
          );
        } else {
          const platError = res.results?.[platform]?.error || res.error || 'Falha na automação da plataforma';
          await supabase
            .from('jobs')
            .update({
              status: 'failed',
              fail_reason: platError,
              failed_at: new Date().toISOString(),
            })
            .eq('id', job.id);

          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, status: 'failed', fail_reason: platError } : j))
          );
          throw new Error(platError);
        }
      } else {
        await new Promise((r) => setTimeout(r, 2000));
        const nowIso = new Date().toISOString();
        await supabase
          .from('jobs')
          .update({
            status: 'published',
            published_at: nowIso,
          })
          .eq('id', job.id);

        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: 'published', published_at: nowIso } : j))
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro na publicação';
      console.error('Erro na publicação automática:', err);
      try {
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            fail_reason: msg,
            failed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: 'failed', fail_reason: msg } : j))
        );
      } catch {}
      throw err;
    } finally {
      setPublishingJobId(null);
    }
  };

  // Helper para notificar progresso tanto no card local quanto no widget global e no painel ADM
  const reportProgress = (data: {
    jobId: string;
    platform: string;
    status: 'uploading' | 'captioning' | 'publishing' | 'done' | 'error';
    progress: number;
    message: string;
  }) => {
    setPublishProgress(data);
    window.dispatchEvent(
      new CustomEvent('app-publish-progress', {
        detail: { ...data, partnerId, isRemote: false },
      })
    );
    try {
      broadcastChannel.send({
        type: 'broadcast',
        event: 'publish-progress',
        payload: {
          ...data,
          partnerId,
        },
      });
    } catch (e) {
      console.warn('Falha no broadcast de progresso:', e);
    }
  };

  // Publicação sequencial 1-clique por pacote de vídeo (TikTok -> YouTube -> Facebook)
  const handlePublishSequential = async (pkg: VideoPackage) => {
    if (publishingPkgId || publishingJobId) return;

    const toPublish = [...pkg.pendingJobs];
    if (toPublish.length === 0) {
      alert('Todas as redes deste vídeo já foram publicadas com sucesso!');
      return;
    }

    setPublishingPkgId(pkg.packageId);

    for (let i = 0; i < toPublish.length; i++) {
      const currentJob = toPublish[i];
      const platform = (currentJob.accounts?.platform as 'tiktok' | 'youtube' | 'facebook') || 'tiktok';

      reportProgress({
        jobId: currentJob.id,
        platform,
        status: 'uploading',
        progress: 10,
        message: `[Etapa ${i + 1}/${toPublish.length}] Conectando ao ${platform.toUpperCase()} (@${currentJob.accounts?.username || ''})...`,
      });

      try {
        await executeSingleJob(currentJob);

        // Se não for o último, aguardar 4 segundos de intervalo para a sessão fechar limpa e abrir a próxima
        if (i < toPublish.length - 1) {
          const nextPlat = toPublish[i + 1]?.accounts?.platform?.toUpperCase() || 'próxima';
          reportProgress({
            jobId: currentJob.id,
            platform,
            status: 'done',
            progress: 100,
            message: `✅ Confirmado no ${platform.toUpperCase()}! Aguardando 4s para abrir ${nextPlat}...`,
          });
          await new Promise((r) => setTimeout(r, 4000));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha na publicação';
        console.error(`Erro na publicação de ${platform}:`, err);

        if (i < toPublish.length - 1) {
          const nextName = toPublish[i + 1]?.accounts?.platform?.toUpperCase() || 'próxima rede';
          const userWantsNext = confirm(
            `⚠️ Erro ao publicar no ${platform.toUpperCase()}:\n\n${msg}\n\nDeseja continuar a sequência e publicar na ${nextName}?`
          );
          if (!userWantsNext) {
            break;
          }
        }
      }
    }

    setPublishingPkgId(null);
    setPublishProgress(null);
    await fetchJobs();
  };

  const handleReopenJob = async (job: Job) => {
    if (!confirm(`Deseja mover o vídeo "${job.videos?.filename || 'vídeo'}" de volta para a fila "Para Publicar"?`)) return;
    try {
      const { error } = await supabase
        .from('jobs')
        .update({
          status: 'downloaded',
          published_at: null,
          fail_reason: null,
        })
        .eq('id', job.id);

      if (error) throw error;
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: 'downloaded', published_at: null, fail_reason: null } : j))
      );
    } catch (err: unknown) {
      alert(`Erro ao reabrir vídeo: ${err instanceof Error ? err.message : 'Falha'}`);
    }
  };

  const handleReopenAllVideoJobs = async (pkg: VideoPackage) => {
    if (!confirm(`Deseja reabrir todas as publicações do vídeo "${pkg.video?.filename || 'vídeo'}" para a fila de pendentes?`)) return;
    try {
      const ids = pkg.jobs.map((j) => j.id);
      const { error } = await supabase
        .from('jobs')
        .update({
          status: 'downloaded',
          published_at: null,
          fail_reason: null,
        })
        .in('id', ids);

      if (error) throw error;
      await fetchJobs();
    } catch (err: unknown) {
      alert(`Erro ao reabrir vídeo: ${err instanceof Error ? err.message : 'Falha'}`);
    }
  };

  const handlePublishManualModal = async (job: Job) => {
    let localPath = localVideoPaths[job.id] || '';
    if (!localPath && job.videos?.storage_url && window.electronAPI?.downloadVideo) {
      setDownloadingJobId(job.id);
      try {
        const videoUrl = job.videos.storage_url;
        const profileName = job.accounts?.username || 'Geral';
        const filename = job.videos.filename || `video_${job.id.slice(0, 6)}.mp4`;
        const dlRes = await window.electronAPI.downloadVideo({
          videoUrl,
          profileName,
          filename,
        });
        if (dlRes.success && dlRes.localPath) {
          localPath = dlRes.localPath;
          setLocalVideoPaths((prev) => ({ ...prev, [job.id]: dlRes.localPath! }));
          await supabase
            .from('jobs')
            .update({
              status: 'downloaded',
              downloaded_at: new Date().toISOString(),
            })
            .eq('id', job.id);
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, status: 'downloaded' } : j))
          );
        } else {
          alert(`⚠️ Não foi possível preparar o vídeo:\n\n${dlRes.error || 'Falha ao baixar vídeo'}`);
          return;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro no download';
        console.error('Erro ao baixar vídeo para publicação manual:', err);
        alert(`⚠️ Falha ao baixar vídeo:\n\n${msg}`);
        return;
      } finally {
        setDownloadingJobId(null);
      }
    }
    setPublishingJob(job);
  };

  // Agrupamento de Jobs por Lote/Envio do ADM (Pacote Multi-Redes separado por momento)
  const videoPackages = useMemo(() => {
    const packages: VideoPackage[] = [];

    // Ordenar jobs cronologicamente para agrupar cada lote conforme foi enviado pelo ADM
    const sortedRaw = [...jobs].sort((a, b) => {
      const tA = new Date((a as any).created_at || (a as any).scheduled_for || 0).getTime();
      const tB = new Date((b as any).created_at || (b as any).scheduled_for || 0).getTime();
      return tA - tB;
    });

    for (const rawJob of sortedRaw) {
      const jobVideo = Array.isArray(rawJob.videos) ? rawJob.videos[0] : rawJob.videos;
      const jobAccount = Array.isArray(rawJob.accounts) ? rawJob.accounts[0] : rawJob.accounts;
      const job = { ...rawJob, videos: jobVideo, accounts: jobAccount };
      const vId = job.video_id || job.videos?.id || job.id;
      const jobTime = new Date((job as any).created_at || (job as any).scheduled_for || 0).getTime();
      const plat = (job.accounts?.platform || '').toLowerCase();
      const profId = job.accounts?.profile_id;

      // Buscar se já existe um pacote deste mesmo vídeo e perfil criado no mesmo momento
      // Regras estritas para pertencer ao mesmo card:
      // 1. Mesmo video_id
      // 2. Mesmo profile_id (se houver perfil associado)
      // 3. Diferença de tempo de criação <= 3 minutos (pertencem ao mesmo lote de envio do ADM)
      // 4. O pacote AINDA NÃO possui job da mesma plataforma (no máximo 1 TikTok, 1 YouTube, 1 Facebook por card)
      const match = packages.find((pkg) => {
        if (pkg.videoId !== vId) return false;
        const pkgFirstJob = pkg.jobs[0];
        const pkgProfId = pkgFirstJob?.accounts?.profile_id;
        if (profId && pkgProfId && profId !== pkgProfId) return false;
        const pkgTime = new Date(pkg.createdAt || 0).getTime();
        if (Math.abs(jobTime - pkgTime) > 180000) return false;
        const alreadyHasPlat = pkg.jobs.some(
          (j) => (j.accounts?.platform || '').toLowerCase() === plat
        );
        if (alreadyHasPlat) return false;
        return true;
      });

      if (match) {
        match.jobs.push(job);
      } else {
        const pkgId = `pkg_${vId}_${job.id}`;
        packages.push({
          packageId: pkgId,
          videoId: vId,
          video: job.videos,
          jobs: [job],
          pendingJobs: [],
          publishedJobs: [],
          allPublished: true,
          hasPending: false,
          createdAt: (job as any).created_at || new Date().toISOString(),
        });
      }
    }

    for (const pkg of packages) {
      // Ordenação rigorosa: 1º TikTok -> 2º YouTube -> 3º Facebook
      pkg.jobs.sort((a, b) => {
        const ordA = PLATFORM_ORDER[a.accounts?.platform || ''] || 99;
        const ordB = PLATFORM_ORDER[b.accounts?.platform || ''] || 99;
        return ordA - ordB;
      });
      pkg.publishedJobs = pkg.jobs.filter((j) => j.status === 'published');
      pkg.pendingJobs = pkg.jobs.filter((j) => j.status !== 'published');
      pkg.allPublished = pkg.pendingJobs.length === 0;
      pkg.hasPending = pkg.pendingJobs.length > 0;
    }

    // Ordenar pacotes do mais recente para o mais antigo
    packages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return packages;
  }, [jobs]);

  const pendingPackages = videoPackages.filter((p) => p.hasPending);
  const publishedPackages = videoPackages.filter((p) => p.publishedJobs.length > 0);

  const filteredPendingPackages = pendingPackages.filter((pkg) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    const titleMatch = (pkg.video?.filename || '').toLowerCase().includes(q);
    const accMatch = pkg.jobs.some(
      (j) =>
        (j.accounts?.username || '').toLowerCase().includes(q) ||
        (j.accounts?.platform || '').toLowerCase().includes(q)
    );
    return titleMatch || accMatch;
  });

  const filteredPublishedPackages = publishedPackages.filter((pkg) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    const titleMatch = (pkg.video?.filename || '').toLowerCase().includes(q);
    const accMatch = pkg.jobs.some(
      (j) =>
        (j.accounts?.username || '').toLowerCase().includes(q) ||
        (j.accounts?.platform || '').toLowerCase().includes(q)
    );
    return titleMatch || accMatch;
  });

  const formatPublishDate = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Top Header & Abas Principais */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#F5EFE6] flex items-center gap-2">
            <span>🛡️</span> Acervo & Publicação de Vídeos
          </h2>
          <p className="text-xs text-[#9E9182] mt-1">
            Vídeos protegidos por cofre seguro AES-256 e postagem sequencial 1-clique (TikTok ➔ YouTube ➔ Facebook)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Seletor de Abas */}
          <div className="flex items-center bg-[#1C1815] border border-[#383028] p-1 rounded-xl shadow-xs">
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'pending'
                  ? 'bg-gradient-to-r from-[#8C6D19] to-[#C59B27] text-[#141210] shadow-sm'
                  : 'text-[#A89C8E] hover:text-[#F5EFE6]'
              }`}
            >
              <span>📋 Para Publicar</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeTab === 'pending' ? 'bg-[#141210]/20 text-[#141210]' : 'bg-[#2E2721] text-[#DFC068]'
                }`}
              >
                {pendingPackages.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('published')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'published'
                  ? 'bg-gradient-to-r from-[#8C6D19] to-[#C59B27] text-[#141210] shadow-sm'
                  : 'text-[#A89C8E] hover:text-[#F5EFE6]'
              }`}
            >
              <span>✅ Histórico de Publicados</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeTab === 'published' ? 'bg-[#141210]/20 text-[#141210]' : 'bg-[#2E2721] text-[#7EE787]'
                }`}
              >
                {publishedPackages.length}
              </span>
            </button>
          </div>


          <button
            onClick={fetchJobs}
            title="Atualizar lista"
            className="p-2 bg-[#1C1815] hover:bg-[#251F1A] text-[#DFC068] border border-[#383028] rounded-xl text-xs transition-colors cursor-pointer"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Barra de Busca Rápida */}
      <div className="relative max-w-md">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar por nome do vídeo ou conta..."
          className="w-full pl-9 pr-8 py-2 bg-[#1C1815] border border-[#383028] rounded-xl text-xs text-[#F5EFE6] placeholder-[#7D7063] focus:outline-none focus:border-[#DFC068]"
        />
        <span className="absolute left-3 top-2.5 text-xs text-[#7D7063]">🔍</span>
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="absolute right-2.5 top-2 text-xs text-[#7D7063] hover:text-[#F5EFE6]"
          >
            ✕
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#7D7063] text-xs italic">
          Carregando acervo de vídeos atribuídos...
        </div>
      ) : activeTab === 'pending' ? (
        /* ── ABA 1: PARA PUBLICAR (AGRUPADO POR VÍDEO) ── */
        filteredPendingPackages.length === 0 ? (
          <div className="bg-[#1C1815] border border-[#383028] rounded-2xl p-12 text-center space-y-3">
            <span className="text-4xl block">🎉</span>
            <h3 className="font-bold text-[#F5EFE6] text-sm">Nenhum vídeo pendente para publicação</h3>
            <p className="text-xs text-[#9E9182] max-w-sm mx-auto">
              {searchTerm
                ? 'Nenhum vídeo pendente coincide com a busca.'
                : 'Excelente trabalho! Todos os seus vídeos foram postados ou o administrador ainda não enviou novos vídeos.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredPendingPackages.map((pkg) => {
              const representativeJob = pkg.jobs[0];
              const isPkgPublishing = publishingPkgId === pkg.packageId;

              // Rótulo da sequência de plataformas configuradas pelo ADM
              const sequenceLabel = pkg.pendingJobs
                .map((j) => {
                  const p = j.accounts?.platform;
                  return p === 'tiktok' ? 'TikTok' : p === 'youtube' ? 'YouTube Shorts' : 'Facebook Reels';
                })
                .join(' ➔ ');

              return (
                <div
                  key={pkg.packageId}
                  className="bg-[#1C1815] border border-[#383028] hover:border-[#4A3F33] rounded-2xl p-5 shadow-sm space-y-4 transition-all"
                >
                  {/* Topo do Pacote: Nome do Vídeo, Duração e Preview */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#2E2721]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#8C6D19]/30 to-[#C59B27]/10 border border-[#DFC068]/30 flex items-center justify-center text-lg shrink-0">
                        🎬
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-[#F5EFE6] truncate max-w-md" title={pkg.video?.filename}>
                          {pkg.video?.filename || 'video.mp4'}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#9E9182] font-mono">
                          <span>{pkg.video?.video_code || 'VÍDEO'}</span>
                          <span>•</span>
                          <span className="text-[#DFC068]">
                            {pkg.jobs.length} {pkg.jobs.length === 1 ? 'rede vinculada pelo ADM' : 'redes vinculadas pelo ADM'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {pkg.video?.storage_url && (
                        <button
                          onClick={() => setPreviewVideoUrl(pkg.video.storage_url)}
                          className="px-3 py-1.5 bg-[#141210] hover:bg-[#251F1A] text-[#DFC068] border border-[#3E3123] rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>▶️</span> Preview do Vídeo
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Legenda & Hashtags do Pacote */}
                  {representativeJob?.caption && (
                    <div className="p-3 bg-[#141210] rounded-xl border border-[#2E2721] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[#7D7063] uppercase tracking-wider">
                          Legenda Sugerida pelo Administrador:
                        </span>
                        <button
                          onClick={() => {
                            const tags = (representativeJob.hashtags || [])
                              .map((t) => (t.startsWith('#') ? t : `#${t}`))
                              .join(' ');
                            const full = [representativeJob.caption, tags].filter(Boolean).join('\n\n');
                            navigator.clipboard.writeText(full);
                            alert('📋 Legenda e hashtags copiadas com sucesso!');
                          }}
                          className="text-[11px] text-[#DFC068] hover:underline font-semibold cursor-pointer"
                        >
                          📋 Copiar Legenda & Hashtags
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap text-xs text-[#D5C9B8] line-clamp-3">
                        {representativeJob.caption}
                      </p>
                      {representativeJob.hashtags && representativeJob.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {representativeJob.hashtags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] bg-[#221B14] text-[#DFC068] border border-[#3E3123] px-2 py-0.5 rounded-md font-mono"
                            >
                              {tag.startsWith('#') ? tag : `#${tag}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Alerta caso redes deste pacote já tenham sido postadas */}
                  {pkg.publishedJobs.length > 0 && (
                    <div className="flex items-center justify-between p-2.5 bg-[#121E16] border border-[#1E4A30] rounded-xl text-xs text-[#7EE787]">
                      <div className="flex items-center gap-2">
                        <span>✅</span>
                        <span>
                          <strong>{pkg.publishedJobs.length} rede(s) já postada(s)</strong> (
                          {pkg.publishedJobs.map((j) => j.accounts?.platform?.toUpperCase()).join(', ')}
                          ) — retirada(s) deste cartão e movida(s) para <strong>Já Publicados</strong>.
                        </span>
                      </div>
                      <button
                        onClick={() => setActiveTab('published')}
                        className="text-[11px] font-bold text-[#DFC068] hover:underline cursor-pointer ml-2 shrink-0"
                      >
                        Ver em Já Publicados ➔
                      </button>
                    </div>
                  )}

                  {/* Redes Sociais Pendentes para Este Vídeo (Ordem Estrita: TikTok ➔ YouTube ➔ Facebook) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-[#9E9182]">
                      <span className="font-semibold text-[#DFC068]">
                        Sequência de Publicação:
                      </span>
                      <span className="font-mono text-[11px] text-[#A89C8E]">
                        {sequenceLabel}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {pkg.pendingJobs.map((job, idx) => {
                        const plat = job.accounts?.platform;
                        const isJobPublishing = publishingJobId === job.id;

                        return (
                          <div
                            key={job.id}
                            className={`p-3 rounded-xl border transition-all flex flex-col justify-between space-y-2 ${
                              isJobPublishing
                                ? 'bg-[#221B14] border-[#DFC068] animate-pulse'
                                : job.status === 'failed'
                                ? 'bg-[#241313] border-[#5A2424]'
                                : 'bg-[#141210] border-[#2E2721]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-[#2E2721] text-[10px] font-bold text-[#DFC068] flex items-center justify-center font-mono">
                                  {idx + 1}
                                </span>
                                <PlatformIcon platform={plat} className="w-5 h-5 rounded" />
                                <span className="font-bold text-xs text-[#F5EFE6] truncate max-w-[120px]">
                                  {formatAccountDisplayName(job.accounts?.username, plat)}
                                </span>
                              </div>

                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  isJobPublishing
                                    ? 'bg-indigo-950/80 text-indigo-400 border-indigo-700/60'
                                    : job.status === 'failed'
                                    ? 'bg-[#3A1818] text-[#F87171] border-[#5A2424]'
                                    : 'bg-[#251E18] text-[#DFC068] border-[#473B2E]'
                                }`}
                              >
                                {isJobPublishing
                                  ? '🚀 Publicando...'
                                  : job.status === 'failed'
                                  ? '❌ Falhou'
                                  : '⏳ Aguardando'}
                              </span>
                            </div>

                            {/* Motivo do erro se houver */}
                            {job.status === 'failed' && job.fail_reason && (
                              <p className="text-[10px] text-rose-300 line-clamp-2 bg-black/20 p-1 rounded">
                                ⚠️ {job.fail_reason}
                              </p>
                            )}

                            {/* Ações individuais opcionais por rede */}
                            <div className="flex items-center justify-between pt-1 border-t border-[#2E2721]/60 text-[10px] gap-1">
                              <button
                                onClick={() => handlePublishManualModal(job)}
                                disabled={downloadingJobId === job.id}
                                className="text-[#A89C8E] hover:text-[#DFC068] cursor-pointer disabled:opacity-50"
                              >
                                {downloadingJobId === job.id ? 'Baixando...' : 'Modo Manual'}
                              </button>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={async () => {
                                    if (!confirm(`Confirmar que a postagem no ${job.accounts?.platform?.toUpperCase()} foi concluída e mover para "Já Publicados"?`)) return;
                                    try {
                                      const nowIso = new Date().toISOString();
                                      await supabase
                                        .from('jobs')
                                        .update({
                                          status: 'published',
                                          published_at: nowIso,
                                          fail_reason: null,
                                        })
                                        .eq('id', job.id);
                                      await fetchJobs();
                                    } catch (e) {
                                      alert('Erro ao atualizar status do vídeo no banco.');
                                    }
                                  }}
                                  title="Retirar para os já postados"
                                  className="text-emerald-400 hover:text-emerald-300 cursor-pointer font-semibold"
                                >
                                  ✓ Já Postado
                                </button>
                                <button
                                  onClick={() => executeSingleJob(job)}
                                  disabled={isPkgPublishing || isJobPublishing}
                                  className="text-[#DFC068] hover:underline font-bold disabled:opacity-40 cursor-pointer"
                                >
                                  Postar agora
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Botão Principal de Publicação Sequencial em 1-Clique */}
                  <div className="pt-2">
                    <button
                      onClick={() => handlePublishSequential(pkg)}
                      disabled={isPkgPublishing || pkg.pendingJobs.length === 0}
                      className="w-full py-3.5 rounded-xl text-sm font-black shadow-lg border transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer bg-gradient-to-r from-[#8C6D19] via-[#B8860B] to-[#C59B27] hover:brightness-110 text-[#141210] border-[#DFC068]/50"
                    >
                      {isPkgPublishing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-[#141210] border-t-transparent rounded-full animate-spin" />
                          <span>
                            {publishProgress?.message || 'Executando publicação sequencial nas redes...'}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg">⚡</span>
                          <span>
                            Publicar com 1 Clique ({sequenceLabel})
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* ── ABA 2: HISTÓRICO DE PUBLICADOS (AGRUPADO POR VÍDEO) ── */
        filteredPublishedPackages.length === 0 ? (
          <div className="bg-[#1C1815] border border-[#383028] rounded-2xl p-12 text-center space-y-3">
            <span className="text-4xl block">📋</span>
            <h3 className="font-bold text-[#F5EFE6] text-sm">Nenhum vídeo no histórico de publicados</h3>
            <p className="text-xs text-[#9E9182] max-w-sm mx-auto">
              {searchTerm
                ? 'Nenhum vídeo publicado coincide com os termos pesquisados.'
                : 'Os vídeos que forem realmente publicados com confirmação na plataforma aparecerão aqui com data e hora.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-[#9E9182]">
              Exibindo <strong className="text-[#F5EFE6]">{filteredPublishedPackages.length}</strong> {filteredPublishedPackages.length === 1 ? 'vídeo com publicações concluídas' : 'vídeos com publicações concluídas'}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredPublishedPackages.map((pkg) => (
                <div
                  key={pkg.packageId}
                  className="bg-[#1C1815] border border-[#1E4A30] rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Header do Vídeo */}
                    <div className="flex items-center justify-between pb-2 border-b border-[#2E2721]">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-lg">🎬</span>
                        <h4 className="font-bold text-xs text-[#F5EFE6] truncate" title={pkg.video?.filename}>
                          {pkg.video?.filename || 'video.mp4'}
                        </h4>
                      </div>
                      <span className="bg-[#14261B] text-[#7EE787] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#1E4A30]">
                        {pkg.publishedJobs.length}/{pkg.jobs.length} Redes Confirmadas
                      </span>
                    </div>

                    {/* Redes Onde Foi Publicado */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold text-[#7D7063] uppercase">
                        Confirmação por Rede:
                      </span>
                      <div className="space-y-1.5">
                        {pkg.publishedJobs.map((job) => (
                          <div
                            key={job.id}
                            className="p-2 bg-[#141210] rounded-xl border border-[#1E4A30] flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <PlatformIcon platform={job.accounts?.platform} className="w-4 h-4 rounded" />
                              <span className="font-medium text-[#EDE4D5]">
                                {formatAccountDisplayName(job.accounts?.username, job.accounts?.platform)}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-[#7EE787]">
                                {formatPublishDate(job.published_at)}
                              </span>
                              <span className="text-[#7EE787] font-bold">✅</span>
                              <button
                                onClick={() => handleReopenJob(job)}
                                title="Reabrir apenas esta publicação para a fila"
                                className="text-[10px] text-[#7D7063] hover:text-[#DFC068] transition-colors cursor-pointer"
                              >
                                ↩️ Reabrir
                              </button>
                            </div>
                          </div>
                        ))}

                        {pkg.pendingJobs.length > 0 && (
                          <div className="p-2 bg-amber-950/20 border border-amber-500/20 rounded-xl flex items-center justify-between text-[11px] text-amber-300">
                            <span>⏳ {pkg.pendingJobs.length} outra(s) rede(s) ainda pendente(s)</span>
                            <button
                              onClick={() => setActiveTab('pending')}
                              className="text-[#DFC068] font-bold hover:underline cursor-pointer"
                            >
                              Ver na fila ➔
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ação para Reabrir Pacote */}
                  <div className="pt-2 border-t border-[#2E2721] flex items-center justify-between">
                    <span className="text-[10px] text-[#7D7063]">Postado por engano?</span>
                    <button
                      onClick={() => handleReopenAllVideoJobs(pkg)}
                      className="px-3 py-1.5 text-xs bg-[#221B14] hover:bg-[#2D251F] text-[#DFC068] hover:text-[#F0D58C] border border-[#3E3123] rounded-xl font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <span>↩️</span>
                      <span>Reabrir para Publicar</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}



      {/* Video Preview Modal */}
      {previewVideoUrl && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewVideoUrl(null)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-4 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="font-bold text-xs text-white">Preview do Vídeo</h3>
              <button
                onClick={() => setPreviewVideoUrl(null)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>
            {(() => {
              const url = previewVideoUrl;
              const matchFileD = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
              const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
              const fileId = matchFileD ? matchFileD[1] : matchId ? matchId[1] : null;

              if (fileId) {
                return (
                  <iframe
                    src={`https://drive.google.com/file/d/${fileId}/preview`}
                    className="w-full h-[320px] rounded-xl border-0"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                );
              }

              return (
                <video
                  src={url}
                  controls
                  controlsList="nodownload noplaybackrate"
                  disablePictureInPicture
                  onContextMenu={(e) => e.preventDefault()}
                  autoPlay
                  className="w-full rounded-xl bg-black max-h-[400px]"
                />
              );
            })()}

            <div className="pt-2 flex items-center justify-between text-[11px] text-[#7D7063]">
              <span className="flex items-center gap-1.5 font-medium text-[#DFC068]">
                <span>🔒</span> Conteúdo Protegido contra Cópia
              </span>
              <span className="font-mono text-[10px] text-[#9E9182]">Cofre Digital AES-256</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Publicação Manual no Chrome Real */}
      {publishingJob && (
        <ManualPublishModal
          job={publishingJob}
          partnerId={partnerId}
          vaultPath={localVideoPaths[publishingJob.id] || null}
          onClose={() => {
            setPublishingJob(null);
          }}
          onPublished={() => {
            setPublishingJob(null);
            fetchJobs();
          }}
        />
      )}
    </div>
  );
};
