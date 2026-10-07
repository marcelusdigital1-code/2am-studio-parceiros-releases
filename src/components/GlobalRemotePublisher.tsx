import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  partnerId: string;
}

interface PublishProgressData {
  jobId: string;
  platform: string;
  status: 'uploading' | 'captioning' | 'publishing' | 'done' | 'error';
  progress: number;
  message: string;
  isRemote?: boolean;
  partnerId?: string;
}

const PLATFORM_ORDER: Record<string, number> = {
  tiktok: 1,
  youtube: 2,
  facebook: 3,
};

export const GlobalRemotePublisher: React.FC<Props> = ({ partnerId }) => {
  const isProcessingRef = useRef(false);
  const activeJobIdsRef = useRef<Set<string>>(new Set());
  const isRemoteActiveRef = useRef(false);
  const activeAccountCodeRef = useRef<string | null>(null);

  const [publishProgress, setPublishProgress] = useState<PublishProgressData | null>(null);
  const [showingChrome, setShowingChrome] = useState(false);

  // Broadcast de progresso em tempo real para o Painel Administrativo
  const broadcastProgress = (data: PublishProgressData) => {
    try {
      const channel = supabase.channel('video-publishing-progress');
      channel.send({
        type: 'broadcast',
        event: 'publish-progress',
        payload: {
          ...data,
          partnerId,
        },
      });
    } catch (e) {
      console.warn('[REMOTE PUBLISHER] Falha ao transmitir broadcast de progresso:', e);
    }
  };

  // Auto-limpeza do widget flutuante após conclusão ou erro
  useEffect(() => {
    if (!publishProgress) return;
    if (publishProgress.status === 'done') {
      const timer = setTimeout(() => {
        setPublishProgress(null);
      }, 5000);
      return () => clearTimeout(timer);
    } else if (publishProgress.status === 'error') {
      const timer = setTimeout(() => {
        setPublishProgress(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [publishProgress]);

  // Escutar eventos de progresso de publicação do Electron e eventos internos da aplicação
  useEffect(() => {
    if (!partnerId) return;

    // Escuta eventos IPC do Electron vindos da automação CDP
    if (window.electronAPI?.onPublishProgress) {
      window.electronAPI.onPublishProgress((data) => {
        const fullData: PublishProgressData = {
          ...data,
          partnerId,
          isRemote: isRemoteActiveRef.current,
        };
        setPublishProgress(fullData);
        broadcastProgress(fullData);
      });
    }

    // Escuta eventos internos disparados pela tela de vídeos (publicação manual com 1 clique)
    const handleAppProgress = (e: Event) => {
      const customEvent = e as CustomEvent<PublishProgressData>;
      if (customEvent.detail) {
        setPublishProgress(customEvent.detail);
      }
    };

    window.addEventListener('app-publish-progress', handleAppProgress);
    return () => {
      window.removeEventListener('app-publish-progress', handleAppProgress);
    };
  }, [partnerId]);

  useEffect(() => {
    if (!partnerId) return;

    console.log(`[REMOTE PUBLISHER] Inicializado com sucesso para o parceiro ${partnerId}`);

    // Executa publicação sequencial estrita (1º TikTok -> 2º YouTube -> 3º Facebook)
    const executeRemoteBatch = async (pendingJobs: any[]) => {
      if (isProcessingRef.current) {
        console.log(`[REMOTE PUBLISHER] Publicação já em processamento. Aguardando ciclo atual...`);
        return;
      }

      isProcessingRef.current = true;
      isRemoteActiveRef.current = true;

      try {
        for (let i = 0; i < pendingJobs.length; i++) {
          const job = pendingJobs[i];

          if (activeJobIdsRef.current.has(job.id)) {
            console.log(`[REMOTE PUBLISHER] Job ${job.id} já em processamento ativo. Pulando...`);
            continue;
          }
          activeJobIdsRef.current.add(job.id);

          try {
            const account = Array.isArray(job.accounts) ? job.accounts[0] : job.accounts;
            const video = Array.isArray(job.videos) ? job.videos[0] : job.videos;
            const platform = ((account?.platform || 'tiktok') as 'tiktok' | 'youtube' | 'facebook' | 'instagram').toLowerCase();

            if (!account) {
              console.error(`[REMOTE PUBLISHER] Job ${job.id} sem conta vinculada.`);
              await supabase.from('jobs').update({ status: 'failed', fail_reason: 'Conta não vinculada' }).eq('id', job.id);
              continue;
            }

            if (!video?.storage_url) {
              console.error(`[REMOTE PUBLISHER] Job ${job.id} sem arquivo de vídeo válido.`);
              await supabase.from('jobs').update({ status: 'failed', fail_reason: 'Vídeo sem URL válida' }).eq('id', job.id);
              continue;
            }

            // 1. Marcar status imediatamente como 'publishing' no banco
            await supabase
              .from('jobs')
              .update({
                status: 'publishing',
                fail_reason: null,
              })
              .eq('id', job.id);

            // 2. Notificar início com contagem e etapa
            const stepMsg = `[Etapa ${i + 1}/${pendingJobs.length}] Conectando ao ${platform.toUpperCase()} (@${account.username})...`;
            const initProg: PublishProgressData = {
              jobId: job.id,
              platform,
              status: 'uploading',
              progress: 10,
              message: stepMsg,
              partnerId,
              isRemote: true,
            };
            setPublishProgress(initProg);
            broadcastProgress(initProg);

            if (window.electronAPI?.showNotification) {
              window.electronAPI.showNotification({
                title: `🚀 Publicação Remota Solicitada pelo ADM [${i + 1}/${pendingJobs.length}]`,
                body: `Disparando vídeo "${video.filename}" no ${platform.toUpperCase()} (@${account.username})...`,
              });
            }

            // 3. Descarregar para o cofre seguro criptografado (.agent_vault) caso não exista
            let localPath = '';
            if (window.electronAPI?.downloadVideo) {
              const profileName = account.username || 'Geral';
              const filename = video.filename || `video_${job.id.slice(0, 6)}.mp4`;

              const dlProg: PublishProgressData = {
                jobId: job.id,
                platform,
                status: 'uploading',
                progress: 25,
                message: `[Etapa ${i + 1}/${pendingJobs.length}] Baixando e protegendo vídeo no cofre seguro...`,
                partnerId,
                isRemote: true,
              };
              setPublishProgress(dlProg);
              broadcastProgress(dlProg);

              const dlRes = await window.electronAPI.downloadVideo({
                videoUrl: video.storage_url,
                profileName,
                filename,
              });

              if (!dlRes.success || !dlRes.localPath) {
                throw new Error(dlRes.error || 'Falha ao descarregar vídeo para o cofre do dispositivo');
              }
              localPath = dlRes.localPath;
            }

            // 4. Executar upload automático via Chrome Real / CDP
            if (window.electronAPI?.autoPublishVideo) {
              // Jobs disparados pelo ADM SEMPRE correm em segundo plano no PC do parceiro.
              // O parceiro pode clicar em "👁 Ver" no widget flutuante para trazer o Chrome para frente.
              const runInBackground = true;
              activeAccountCodeRef.current = account.account_code || null;
              console.log(`[REMOTE PUBLISHER] Executando autoPublishVideo via CDP para @${account.account_code} (runInBackground=${runInBackground})...`);
              const pubRes = await window.electronAPI.autoPublishVideo({
                jobId: job.id,
                videoLocalPath: localPath,
                title: job.title || video.filename || 'Vídeo Viral',
                caption: job.caption || '',
                hashtags: job.hashtags || [],
                platforms: [platform as 'tiktok' | 'youtube' | 'facebook' | 'instagram'],
                accountCode: account.account_code,
                partnerId: job.partner_id || partnerId,
                pageUrl: account.profile_url || undefined,
                runInBackground,
              });

              if (pubRes.success) {
                const nowIso = new Date().toISOString();
                await supabase
                  .from('jobs')
                  .update({
                    status: 'published',
                    published_at: nowIso,
                    fail_reason: null,
                  })
                  .eq('id', job.id);

                const doneProg: PublishProgressData = {
                  jobId: job.id,
                  platform,
                  status: 'done',
                  progress: 100,
                  message: `✅ Publicado com sucesso no ${platform.toUpperCase()}!`,
                  partnerId,
                  isRemote: true,
                };
                setPublishProgress(doneProg);
                broadcastProgress(doneProg);

                if (window.electronAPI?.showNotification) {
                  window.electronAPI.showNotification({
                    title: '✅ Publicação Concluída com Sucesso!',
                    body: `O vídeo "${video.filename}" foi postado em @${account.username} (${platform.toUpperCase()}).`,
                  });
                }

                // Se houver próxima rede na sequência, fazer contagem regressiva de 4 segundos
                if (i < pendingJobs.length - 1) {
                  const nextJob = pendingJobs[i + 1];
                  const nextAcc = Array.isArray(nextJob.accounts) ? nextJob.accounts[0] : nextJob.accounts;
                  const nextPlat = (nextAcc?.platform || 'próxima').toUpperCase();

                  for (let sec = 4; sec > 0; sec--) {
                    const countdownProg: PublishProgressData = {
                      jobId: job.id,
                      platform,
                      status: 'done',
                      progress: 100,
                      message: `✅ ${platform.toUpperCase()} concluído! Abrindo ${nextPlat} em ${sec}s...`,
                      partnerId,
                      isRemote: true,
                    };
                    setPublishProgress(countdownProg);
                    broadcastProgress(countdownProg);
                    await new Promise((r) => setTimeout(r, 1000));
                  }
                }
              } else {
                const errDetail = pubRes.results?.[platform]?.error || pubRes.error || 'Erro na automação da plataforma';
                throw new Error(errDetail);
              }
            }
          } catch (jobErr: unknown) {
            const errMsg = jobErr instanceof Error ? jobErr.message : 'Falha na publicação remota';
            console.error(`[REMOTE PUBLISHER ERROR - JOB ${job.id}]:`, errMsg);

            await supabase
              .from('jobs')
              .update({
                status: 'failed',
                fail_reason: errMsg,
              })
              .eq('id', job.id);

            const errorProg: PublishProgressData = {
              jobId: job.id,
              platform: 'geral',
              status: 'error',
              progress: 0,
              message: errMsg,
              partnerId,
              isRemote: true,
            };
            setPublishProgress(errorProg);
            broadcastProgress(errorProg);

            if (window.electronAPI?.showNotification) {
              window.electronAPI.showNotification({
                title: '⚠️ Falha na Publicação Remota',
                body: `Não foi possível postar no ${job.accounts?.platform || 'plataforma'}: ${errMsg}`,
              });
            }
          } finally {
            activeJobIdsRef.current.delete(job.id);
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Falha na publicação remota';
        console.error(`[REMOTE PUBLISHER BATCH ERROR]:`, errMsg);
      } finally {
        isProcessingRef.current = false;
        isRemoteActiveRef.current = false;
      }
    };

    // Checagem de segurança e recuperação de disparos pendentes
    const checkForPendingTriggers = async () => {
      if (isProcessingRef.current) return;

      try {
        const { data: pendingJobs, error } = await supabase
          .from('jobs')
          .select(`
            id,
            video_id,
            account_id,
            partner_id,
            status,
            caption,
            hashtags,
            created_at,
            videos (id, filename, storage_url, video_code),
            accounts (id, username, platform, account_code)
          `)
          .eq('partner_id', partnerId)
          .eq('status', 'trigger_publish');

        if (error) {
          console.error('[REMOTE PUBLISHER QUERY ERROR]:', error);
          return;
        }

        const availableJobs = (pendingJobs || []).filter(
          (j) => !activeJobIdsRef.current.has(j.id)
        );
        if (availableJobs.length === 0) {
          return;
        }

        // Ordenação estrita: 1º TikTok -> 2º YouTube -> 3º Facebook
        const sortedJobs = [...availableJobs].sort((a, b) => {
          const accA = Array.isArray(a.accounts) ? a.accounts[0] : a.accounts;
          const accB = Array.isArray(b.accounts) ? b.accounts[0] : b.accounts;
          const platA = (accA?.platform || 'tiktok').toLowerCase();
          const platB = (accB?.platform || 'tiktok').toLowerCase();
          return (PLATFORM_ORDER[platA] || 99) - (PLATFORM_ORDER[platB] || 99);
        });

        await executeRemoteBatch(sortedJobs);
      } catch (e) {
        console.error('[REMOTE PUBLISHER CHECK ERROR]:', e);
      }
    };

    // Checagem inicial
    checkForPendingTriggers();

    // Polling de segurança a cada 8 segundos
    const pollInterval = setInterval(checkForPendingTriggers, 8000);

    // Conexão Realtime WebSocket para resposta imediata ao disparo do ADM
    const channel = supabase
      .channel(`partner-remote-pub-${partnerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
          filter: `partner_id=eq.${partnerId}`,
        },
        (payload) => {
          const newRow = payload.new as { id?: string; status?: string };
          if (newRow && newRow.status === 'trigger_publish') {
            console.log(`[REMOTE PUBLISHER] Disparo em tempo real recebido via banco! Verificando fila...`);
            setTimeout(() => checkForPendingTriggers(), 200);
          }
        }
      )
      .on(
        'broadcast',
        { event: 'remote-publish' },
        (event) => {
          const payload = event.payload as { jobId?: string; partnerId?: string; videoId?: string };
          if (!payload.partnerId || payload.partnerId === partnerId) {
            console.log(`[REMOTE PUBLISHER] Broadcast de disparo recebido do ADM! Verificando fila...`);
            setTimeout(() => checkForPendingTriggers(), 200);
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [partnerId]);

  // Widget Flutuante Global de Progresso da Publicação (visível em qualquer aba do aplicativo do parceiro)
  if (!publishProgress) return null;

  return (
    <div
      className={`fixed bottom-6 right-6 z-[9999] bg-[#1C1815]/95 rounded-2xl p-4 shadow-2xl max-w-sm w-full space-y-2.5 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 border ${
        publishProgress.status === 'error'
          ? 'border-rose-500/80 shadow-rose-950/40'
          : publishProgress.status === 'done'
          ? 'border-emerald-500/80 shadow-emerald-950/40'
          : 'border-[#C59B27]/80 shadow-amber-950/40'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[#F5EFE6] flex items-center gap-2">
          <span
            className={`text-sm ${
              publishProgress.status === 'uploading' ||
              publishProgress.status === 'publishing' ||
              publishProgress.status === 'captioning'
                ? 'animate-spin'
                : ''
            }`}
          >
            {publishProgress.status === 'error'
              ? '⚠️'
              : publishProgress.status === 'done'
              ? '✅'
              : '⚙️'}
          </span>
          <span>
            {publishProgress.status === 'error'
              ? 'Aviso na Publicação'
              : publishProgress.status === 'done'
              ? 'Publicado com Sucesso'
              : publishProgress.isRemote
              ? 'Publicação Remota (ADM)'
              : 'Publicação em Andamento'}
          </span>
        </span>
        <span className="text-[10px] font-mono font-bold bg-[#141210] text-[#DFC068] px-2 py-0.5 rounded-full border border-[#3E3123] uppercase">
          {publishProgress.platform}
        </span>
      </div>

      <div className="w-full bg-[#141210] rounded-full h-2 overflow-hidden border border-[#2E2721]">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            publishProgress.status === 'error'
              ? 'bg-rose-500'
              : publishProgress.status === 'done'
              ? 'bg-emerald-500'
              : 'bg-gradient-to-r from-[#8C6D19] via-[#B8860B] to-[#C59B27]'
          }`}
          style={{ width: `${Math.max(publishProgress.progress, 5)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-[#D5C9B8]">
        <span className="truncate max-w-[180px]" title={publishProgress.message}>
          {publishProgress.message}
        </span>
        <span className="font-mono font-bold text-[#DFC068]">
          {publishProgress.progress}%
        </span>
      </div>

      {/* Botão "Ver publicação" — só visível para publicações remotas em andamento */}
      {publishProgress.isRemote &&
        publishProgress.status !== 'done' &&
        publishProgress.status !== 'error' &&
        activeAccountCodeRef.current && (
          <button
            onClick={async () => {
              if (showingChrome) return;
              setShowingChrome(true);
              try {
                if (window.electronAPI?.showChromeSession) {
                  const res = await window.electronAPI.showChromeSession(activeAccountCodeRef.current!);
                  if (res && !res.success) {
                    console.warn('[REMOTE PUBLISHER] Não foi possível trazer Chrome para frente:', res.error);
                  }
                }
              } catch (e) {
                console.warn('[REMOTE PUBLISHER] showChromeSession erro:', e);
              } finally {
                setTimeout(() => setShowingChrome(false), 1500);
              }
            }}
            disabled={showingChrome}
            className="w-full flex items-center justify-center gap-2 text-[11px] font-semibold text-[#1C1815] bg-[#C59B27] hover:bg-[#DFC068] disabled:opacity-60 disabled:cursor-not-allowed rounded-lg py-1.5 transition-colors"
          >
            {showingChrome ? (
              <>
                <span className="animate-spin text-xs">⚙️</span>
                A abrir janela…
              </>
            ) : (
              <>
                <span>👁</span>
                Ver publicação
              </>
            )}
          </button>
        )}
    </div>
  );
};

