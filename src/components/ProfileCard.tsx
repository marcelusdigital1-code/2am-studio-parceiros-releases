import React from 'react';
import type { Account, AccountMetrics } from '../lib/supabase';
import { PlatformIcon } from './PlatformIcon';

export type AccountWithMetrics = Account & {
  account_metrics: AccountMetrics | null;
  account_profiles?: {
    first_name?: string | null;
    last_name?: string | null;
    birth_date?: string | null;
    gender?: string | null;
    profile_name?: string | null;
    name?: string | null;
  } | null;
};

export interface GroupedProfile {
  id: string;
  profile_code: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  status: 'active' | 'pending' | 'suspended' | 'banned';
  accounts: AccountWithMetrics[];
}

export type QueueAccountStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

interface Props {
  profile: GroupedProfile;
  runningProfileIds: string[];
  queueStatusMap?: Record<string, { status: QueueAccountStatus; message?: string }>;
  authStatusMap?: Record<string, boolean>;
  onLaunchAccount: (account: AccountWithMetrics) => void;
  onCloseAccount?: (accountCode: string) => void;
}

const platformMeta: Record<
  string,
  { name: string; borderFocus: string }
> = {
  tiktok: {
    name: 'Página do TikTok',
    borderFocus: 'border-pink-500/40',
  },
  youtube: {
    name: 'YouTube Studio',
    borderFocus: 'border-red-500/40',
  },
  facebook: {
    name: 'Página do Facebook',
    borderFocus: 'border-blue-500/40',
  },
  instagram: {
    name: 'Instagram',
    borderFocus: 'border-pink-400/40',
  },
};

function formatNumber(num?: number | null): string {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function calculateAge(birthDate?: string | null): string {
  if (!birthDate) return '';
  let birth: Date;
  if (birthDate.includes('-')) {
    birth = new Date(birthDate);
  } else if (birthDate.includes('/')) {
    const parts = birthDate.split('/');
    if (parts.length === 3) {
      birth = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    } else {
      return '';
    }
  } else {
    return '';
  }
  if (isNaN(birth.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age > 0 ? `${age} anos` : '';
}

export const ProfileCard: React.FC<Props> = ({
  profile,
  runningProfileIds,
  queueStatusMap,
  authStatusMap,
  onLaunchAccount,
  onCloseAccount,
}) => {
  const initials = profile.name
    .replace(/^Perfil\s+/i, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'P';

  const ageStr = calculateAge(profile.birth_date);

  return (
    <div className="bg-[#1C1815] border border-[#383028] hover:border-[#524538] rounded-2xl p-5 shadow-sm space-y-4 transition-all flex flex-col justify-between">
      <div>
        {/* 1. Topo do Perfil */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#8C6D19] via-[#B8860B] to-[#C59B27] text-[#141210] font-black flex items-center justify-center text-sm shadow-inner shrink-0 tracking-wider border border-[#DFC068]/40">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base text-[#F5EFE6] leading-tight">
                  {profile.name}
                </h3>
                <span className="text-[10px] text-[#D5C9B8] bg-[#141210] border border-[#383028] px-2 py-0.5 rounded-md font-mono font-bold">
                  {profile.profile_code}
                </span>
              </div>
              <p className="text-xs text-[#9E9182] font-medium mt-0.5">
                {profile.first_name ? (
                  <span>
                    Persona: <strong className="text-[#EDE4D5]">{profile.first_name} {profile.last_name || ''}</strong>
                  </span>
                ) : (
                  <span>Dossiê de Criador Atribuído</span>
                )}
              </p>
            </div>
          </div>

          <span
            className={`text-[10px] px-2.5 py-1 rounded-full font-bold border flex items-center gap-1.5 shrink-0 ${
              profile.status === 'active'
                ? 'bg-[#14261B] text-[#7EE787] border-[#1E4A30]'
                : profile.status === 'suspended'
                ? 'bg-[#2D1616] text-[#F87171] border-[#5A2424]'
                : 'bg-[#2E2012] text-[#FBBF24] border-[#5C3F1B]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                profile.status === 'active'
                  ? 'bg-[#7EE787]'
                  : profile.status === 'suspended'
                  ? 'bg-[#F87171]'
                  : 'bg-[#FBBF24]'
              }`}
            />
            <span className="capitalize">{profile.status === 'active' ? 'Ativo' : profile.status}</span>
          </span>
        </div>

        {/* Informações da Persona */}
        <div className="mb-3.5 text-xs">
          <div className="bg-[#141210] border border-[#2E2721] rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-base shrink-0">🎂</span>
              <div className="overflow-hidden">
                <p className="text-[9px] text-[#7D7063] uppercase font-bold tracking-wider">Data de Nascimento & Idade</p>
                <p className="text-[11px] font-semibold text-[#D5C9B8] truncate">
                  {profile.birth_date || '14/08/1998'} {ageStr ? `• ${ageStr}` : ''}
                </p>
              </div>
            </div>
            {profile.gender && (
              <div className="text-right shrink-0">
                <p className="text-[9px] text-[#7D7063] uppercase font-bold tracking-wider">Gênero</p>
                <p className="text-[11px] font-semibold text-[#DFC068] capitalize">
                  {profile.gender === 'female' ? 'Feminino' : profile.gender === 'male' ? 'Masculino' : profile.gender}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 2. Redes do Perfil */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-[#8C7D6D] uppercase tracking-wider px-1">
            Canais Vinculados ({profile.accounts.length})
          </p>

          {profile.accounts.length === 0 ? (
            <div className="text-center py-4 text-xs text-[#7D7063] italic bg-[#141210] rounded-xl border border-[#2E2721]">
              Nenhuma rede associada a este perfil.
            </div>
          ) : (
            profile.accounts.map((acc) => {
              const meta = platformMeta[acc.platform] || {
                name: acc.platform,
                borderFocus: 'border-[#383028]',
              };

              const rawMetrics = acc.account_metrics;
              const metrics = Array.isArray(rawMetrics) ? rawMetrics[0] || null : rawMetrics;
              const isRunning = runningProfileIds.includes(acc.account_code);
              const isBlocked = acc.status !== 'active';
              const isAuth = authStatusMap?.[acc.account_code] === true || queueStatusMap?.[acc.account_code]?.status === 'success';

              return (
                <div
                  key={acc.id}
                  className={`bg-[#141210] border ${
                    isRunning ? 'border-[#C59B27]/60 bg-[#1E1912]' : 'border-[#2E2721] hover:border-[#3E342B]'
                  } rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all`}
                >
                  {/* Identificação da Rede com Logo Oficial */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PlatformIcon platform={acc.platform} className="w-6 h-6 shrink-0 rounded-md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-xs text-[#F5EFE6] truncate">
                          {acc.username || (acc.platform === 'instagram' ? 'Conta Creator' : 'Canal')}
                        </span>
                        <span className="text-[9px] font-mono text-[#A89C8E] bg-[#1C1815] border border-[#2E2721] px-1.5 py-0.2 rounded shrink-0">
                          {acc.account_code}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#9E9182] font-medium block">
                        {meta.name}
                      </span>
                    </div>
                  </div>

                  {/* Métricas e Botão de Ação */}
                  <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                    {/* Resumo de Métricas com Destaque para Views */}
                    {metrics ? (
                      <div className="flex items-center gap-2 text-[10px] text-[#A89C8E] bg-[#1C1815] px-2.5 py-1.5 rounded-lg border border-[#2E2721]">
                        {acc.platform === 'youtube' ? (
                          <>
                            <span>
                              <strong className="text-[#EDE4D5]">{formatNumber(metrics.subscribers)}</strong> insc
                            </span>
                            <span className="text-[#5A4C3D]">•</span>
                            <span className="text-[#DFC068] font-bold">
                              <strong className="text-[#F5EFE6]">{formatNumber(metrics.views)}</strong> views
                            </span>
                          </>
                        ) : acc.platform === 'tiktok' ? (
                          <>
                            <span>
                              <strong className="text-[#EDE4D5]">{formatNumber(metrics.followers)}</strong> seg
                            </span>
                            <span className="text-[#5A4C3D]">•</span>
                            <span className="text-[#DFC068] font-bold">
                              <strong className="text-[#F5EFE6]">{formatNumber(metrics.views || metrics.likes)}</strong>{' '}
                              {metrics.views ? 'views' : 'curtidas'}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>
                              <strong className="text-[#EDE4D5]">{formatNumber(metrics.followers)}</strong> seg
                            </span>
                            <span className="text-[#5A4C3D]">•</span>
                            <span className="text-[#DFC068] font-bold">
                              <strong className="text-[#F5EFE6]">{formatNumber(metrics.views || metrics.likes)}</strong>{' '}
                              {metrics.views ? 'views' : 'alcance'}
                            </span>
                          </>
                        )}
                      </div>
                    ) : null}

                    {/* Status da Fila de Auto-Login */}
                    {(() => {
                      const q = queueStatusMap?.[acc.account_code];
                      if (!q) return null;
                      if (q.status === 'running') {
                        return (
                          <span className="text-[10px] px-2 py-1 rounded-lg font-bold bg-[#142634] text-[#38BDF8] border border-[#1E4968] flex items-center gap-1.5 animate-pulse shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]"></span>
                            <span>Autenticando...</span>
                          </span>
                        );
                      }
                      if (q.status === 'pending') {
                        return (
                          <span className="text-[10px] px-2 py-1 rounded-lg font-bold bg-[#262014] text-[#FBBF24] border border-[#52411E] flex items-center gap-1 shrink-0">
                            <span>⏳</span>
                            <span>Na fila</span>
                          </span>
                        );
                      }
                      if (q.status === 'success') {
                        return (
                          <span className="text-[10px] px-2 py-1 rounded-lg font-bold bg-[#14261B] text-[#7EE787] border border-[#1E4A30] flex items-center gap-1 shrink-0">
                            <span>✅</span>
                            <span>Autenticado</span>
                          </span>
                        );
                      }
                      if (q.status === 'failed') {
                        return (
                          <span className="text-[10px] px-2 py-1 rounded-lg font-bold bg-[#2D1616] text-[#F87171] border border-[#5A2424] flex items-center gap-1 shrink-0" title={q.message || 'Falha no login'}>
                            <span>⚠️</span>
                            <span>{q.message || 'Falha (pulado)'}</span>
                          </span>
                        );
                      }
                      if (q.status === 'skipped') {
                        return (
                          <span className="text-[10px] px-2 py-1 rounded-lg font-bold bg-[#1F1C19] text-[#9E9182] border border-[#3D352E] flex items-center gap-1 shrink-0" title={q.message || 'Sem credenciais'}>
                            <span>⏭️</span>
                            <span>{q.message || 'Pulado'}</span>
                          </span>
                        );
                      }
                      return null;
                    })()}

                    {/* Botão de Lançamento / Status */}
                    {isBlocked ? (
                      <span className="text-[10px] px-2.5 py-1.5 rounded-lg font-bold bg-[#2D1616] text-[#F87171] border border-[#5A2424]">
                        Bloqueado
                      </span>

                    ) : isRunning ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => onLaunchAccount(acc)}
                          className="px-2.5 py-1.5 bg-[#14261B] hover:bg-[#1E3D29] text-[#7EE787] text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer shrink-0 border border-[#1E4A30]"
                          title={`Trazer ${meta.name} para o primeiro plano no Chrome Real`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[#7EE787] animate-pulse"></span>
                          <span>Focar {meta?.name || acc.platform}</span>
                        </button>
                        {onCloseAccount && (
                          <button
                            onClick={() => onCloseAccount(acc.account_code)}
                            className="px-2 py-1.5 bg-[#2A1818] hover:bg-[#3D2020] text-[#F87171] hover:text-[#FFA3A3] text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center cursor-pointer shrink-0 border border-[#522525]"
                            title={`Encerrar janela de ${meta.name}`}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (isAuth) {
                            onLaunchAccount(acc);
                          }
                        }}
                        disabled={!isAuth}
                        className={`px-3 py-1.5 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 shrink-0 border ${
                          isAuth
                            ? 'bg-gradient-to-r from-[#8C6D19] via-[#B8860B] to-[#C59B27] hover:brightness-110 text-[#141210] cursor-pointer border-[#DFC068]/30'
                            : 'bg-[#181512] text-[#6E6356] border-[#2A241F] cursor-not-allowed opacity-50 select-none'
                        }`}
                        title={
                          isAuth
                            ? `Abrir ${meta.name} no Chrome Real com sessão isolada`
                            : `Esta conta ainda não foi autenticada. Realize a autenticação para habilitar o acesso a ${meta.name}.`
                        }
                      >
                        <span>{isAuth ? '🚀' : '🔒'}</span>
                        <span>Abrir {meta?.name || acc.platform}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3. Rodapé Informativo */}
      <div className="pt-3 border-t border-[#2E2721] flex items-center justify-between text-[11px] text-[#7D7063]">
        <span>Sessões isoladas por perfil</span>
        <span className="text-[#DFC068] font-semibold">Publicação 1-Clique na aba Vídeos ⚡</span>
      </div>
    </div>
  );
};
