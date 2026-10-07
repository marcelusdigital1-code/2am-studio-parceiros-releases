import React, { useEffect, useState, useRef } from 'react';
import { supabase, type Job } from '../lib/supabase';
import { PlatformIcon } from './PlatformIcon';

interface Props {
  job: Job;
  partnerId: string;
  vaultPath: string | null;
  onClose: () => void;
  onPublished: () => void;
}

export const ManualPublishModal: React.FC<Props> = ({
  job,
  partnerId,
  vaultPath,
  onClose,
  onPublished,
}) => {
  const [tempVideoPath, setTempVideoPath] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [chromeFocuserText, setChromeFocuserText] = useState('Focar Janela do Chrome');

  const tempPathRef = useRef<string | null>(null);
  tempPathRef.current = tempVideoPath;

  const platform = (job.accounts?.platform as 'tiktok' | 'youtube' | 'facebook' | 'instagram') || 'tiktok';
  const cleanTags = (job.hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  const fullCaption = [job.caption, cleanTags].filter(Boolean).join('\n\n');

  const getTargetUploadUrl = () => {
    switch (platform) {
      case 'tiktok':
        return 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&lang=pt&tab=video';
      case 'youtube':
        return 'https://studio.youtube.com';
      case 'facebook':
        return job.accounts?.profile_url || 'https://www.facebook.com/pages/';
      case 'instagram':
        return 'https://www.instagram.com/';
      default:
        return 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&lang=pt&tab=video';
    }
  };

  const launchOrFocusChrome = (url?: string) => {
    if (!window.electronAPI?.openChromeSignup || !job.accounts?.account_code) return;

    const pageUrl = platform === 'facebook' && job.accounts?.profile_url ? job.accounts.profile_url : '';
    const targetUrl = url || (pageUrl ? pageUrl : getTargetUploadUrl());
    const resolvedEmail = (job.accounts as any)?.controlled_emails?.email || job.accounts?.username || '';
    const resolvedBirth = (job.accounts as any)?.account_profiles?.birth_date || job.accounts.birth_date || '15/06/1998';

    window.electronAPI.openChromeSignup({
      url: targetUrl,
      profileId: job.accounts.account_code,
      email: resolvedEmail,
      pass: job.accounts.password_encrypted || '',
      birthDate: resolvedBirth,
      partnerId,
      accountId: job.accounts.id,
      platform,
      pageUrl: pageUrl || undefined,
    });
  };

  useEffect(() => {
    let isCancelled = false;

    const setupManualSession = async () => {
      setPreparing(true);

      // 1. Copiar legenda e hashtags para a área de transferência de imediato
      if (fullCaption) {
        try {
          await navigator.clipboard.writeText(fullCaption);
          setCaptionCopied(true);
        } catch {}
      }

      // 2. Descriptografar temporariamente o vídeo do cofre para que o parceiro possa carregar no Chrome
      if (vaultPath && window.electronAPI?.prepareManualVideo) {
        try {
          const targetFilename = job.videos?.filename || `${job.title || 'video'}.mp4`;
          const prepRes = await window.electronAPI.prepareManualVideo({ vaultPath, filename: targetFilename });
          if (!isCancelled && prepRes.success && prepRes.tempPath) {
            setTempVideoPath(prepRes.tempPath);
          }
        } catch (e) {
          console.error('[MANUAL PUBLISH] Erro ao preparar vídeo efêmero:', e);
        }
      }

      // 3. Abrir sessão do Chrome Real para a conta logada na página de upload
      launchOrFocusChrome();
      setPreparing(false);
    };

    setupManualSession();

    return () => {
      isCancelled = true;
      // Destruir com segurança qualquer arquivo efêmero temporário ao fechar o modal
      if (tempPathRef.current && window.electronAPI?.cleanupManualVideo) {
        window.electronAPI.cleanupManualVideo({ tempPath: tempPathRef.current }).catch(console.error);
      }
    };
  }, [job.id, vaultPath]);

  const handleCopyPath = () => {
    if (!tempVideoPath) return;
    navigator.clipboard.writeText(tempVideoPath);
    setPathCopied(true);
    setTimeout(() => setPathCopied(false), 3000);
  };

  const handleCopyCaption = () => {
    if (!fullCaption) return;
    navigator.clipboard.writeText(fullCaption);
    setCaptionCopied(true);
    setTimeout(() => setCaptionCopied(false), 3000);
  };

  const handleFocusChrome = () => {
    launchOrFocusChrome();
    setChromeFocuserText('Janela Focada!');
    setTimeout(() => setChromeFocuserText('Focar Janela do Chrome'), 2000);
  };

  const handleConfirmPublished = async () => {
    setSubmitting(true);
    try {
      // 1. Atualizar status no Supabase
      const { error } = await supabase
        .from('jobs')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          fail_reason: null,
        })
        .eq('id', job.id);

      if (error) throw error;

      // 2. Destruir arquivo efêmero
      if (tempVideoPath && window.electronAPI?.cleanupManualVideo) {
        await window.electronAPI.cleanupManualVideo({ tempPath: tempVideoPath });
        setTempVideoPath(null);
      }

      onPublished();
    } catch (err: unknown) {
      console.error('Erro ao marcar publicação como concluída:', err);
      alert('Erro ao marcar como publicado no banco de dados.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#1C1815] border border-[#DFC068]/50 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-0">
        {/* Header */}
        <div className="p-5 border-b border-[#2E2721] bg-[#141210] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PlatformIcon platform={platform} className="w-8 h-8 rounded-lg shadow-sm" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#F5EFE6]">
                  Publicação no Chrome Real
                </h3>
                <span className="text-[10px] font-mono font-bold bg-[#2E2721] text-[#DFC068] px-2 py-0.5 rounded border border-[#473C31]">
                  @{job.accounts?.username || 'conta'}
                </span>
              </div>
              <p className="text-xs text-[#9E9182] mt-0.5">
                Navegador oficial Chrome com perfil isolado, login persistido e limitações de segurança ativas.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9E9182] hover:text-white hover:bg-[#2E2721] transition-all cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Status Banner */}
          <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-center justify-between gap-3 text-emerald-400 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="text-lg animate-pulse">🟢</span>
              <div>
                <p className="font-bold text-emerald-300">Sessão do Chrome Real Aberta</p>
                <p className="text-[11px] text-emerald-400/80">
                  A página de upload do {platform.toUpperCase()} já está aberta na sua conta. As travas de logout continuam ativas.
                </p>
              </div>
            </div>
            <button
              onClick={handleFocusChrome}
              className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-lg text-[11px] font-semibold transition-all shrink-0 cursor-pointer"
            >
              {chromeFocuserText}
            </button>
          </div>

          {/* Passo 1: Arquivo do Vídeo */}
          <div className="bg-[#141210] border border-[#2E2721] rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#F5EFE6] flex items-center gap-1.5">
                <span>📁</span> 1. Arquivo de Vídeo Pronto para Envio
              </span>
              {preparing ? (
                <span className="text-[11px] text-[#DFC068] animate-pulse">
                  Descriptografando temporariamente...
                </span>
              ) : (
                <span className="text-[10px] text-[#9E9182] font-mono">
                  {job.videos?.filename || 'video.mp4'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={tempVideoPath || 'Carregando caminho do arquivo...'}
                className="flex-1 bg-[#1C1815] border border-[#383028] text-[#D5C9B8] font-mono text-[11px] px-3 py-2 rounded-lg truncate select-all focus:outline-none"
              />
              <button
                onClick={handleCopyPath}
                disabled={!tempVideoPath}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  pathCopied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#2E2721] hover:bg-[#3E342B] text-[#DFC068] border border-[#473C31]'
                }`}
              >
                <span>{pathCopied ? '✓' : '📋'}</span>
                <span>{pathCopied ? 'Caminho Copiado!' : 'Copiar Caminho'}</span>
              </button>
            </div>
            <p className="text-[11px] text-[#8C7E70]">
              💡 <strong>Dica:</strong> No Chrome, ao clicar em "Carregar / Selecionar Vídeo", cole o caminho copiado (Ctrl+V) na barra de nome do arquivo ou arraste o arquivo diretamente.
            </p>
          </div>

          {/* Passo 2: Legenda & Tags */}
          <div className="bg-[#141210] border border-[#2E2721] rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#F5EFE6] flex items-center gap-1.5">
                <span>📝</span> 2. Legenda e Hashtags
              </span>
              <button
                onClick={handleCopyCaption}
                className={`text-[11px] font-bold px-2.5 py-1 rounded transition-all cursor-pointer ${
                  captionCopied ? 'text-emerald-400 bg-emerald-950/60' : 'text-[#DFC068] hover:underline'
                }`}
              >
                {captionCopied ? '✓ Já copiado para a área de transferência' : '📋 Copiar Legenda Novamente'}
              </button>
            </div>

            <div className="bg-[#1C1815] border border-[#383028] rounded-lg p-3 text-xs text-[#D5C9B8] whitespace-pre-wrap max-h-32 overflow-y-auto font-sans leading-relaxed">
              {fullCaption || <span className="text-[#6D6356] italic">Sem legenda configurada para este vídeo</span>}
            </div>
          </div>

          {/* Alerta de Segurança e Destruição */}
          <div className="p-3 bg-amber-950/20 border border-amber-500/20 rounded-xl text-[11px] text-amber-300/80 flex items-start gap-2">
            <span className="text-sm">🛡️</span>
            <span>
              Ao concluir a postagem na janela do Chrome Real, clique em <strong>"Marcar como Publicado"</strong> abaixo. O arquivo efêmero temporário será destruído do disco e o status atualizado no painel do administrador.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#141210] border-t border-[#2E2721] flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-[#251F1A] hover:bg-[#2E2721] text-[#A89C8E] hover:text-[#EDE4D5] rounded-xl text-xs font-semibold border border-[#383028] transition-all cursor-pointer"
          >
            Fechar
          </button>

          <button
            onClick={handleConfirmPublished}
            disabled={submitting}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Registrando...</span>
              </>
            ) : (
              <>
                <span>✅</span>
                <span>Concluir e Marcar como Publicado</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
