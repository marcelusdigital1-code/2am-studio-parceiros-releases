import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import logoImg from '../assets/logo.png';

interface Props {
  onLoginSuccess: (partnerData: { id: string; name: string; partner_code: string }) => void;
}

export const Login: React.FC<Props> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 1. Tentar autenticação via Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });

      if (authError) {
        throw new Error('Credenciais inválidas. Verifique seu email e senha.');
      }

      if (authData.user) {
        const { data: partnerData, error: partnerError } = await supabase
          .from('partners')
          .select('id, name, partner_code, status')
          .eq('auth_user_id', authData.user.id)
          .single();

        if (partnerError || !partnerData) {
          throw new Error('Registo de parceiro não encontrado para este utilizador.');
        }

        if (partnerData.status !== 'active') {
          throw new Error('A sua conta de parceiro não se encontra ativa. Fale com o administrador.');
        }

        onLoginSuccess(partnerData);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao efetuar login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0E0C0A] flex items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Luzes de fundo elegantes */}
      <div className="absolute -top-32 -left-32 w-80 h-80 bg-[#C59B27]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-[#DFC068]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="bg-[#181411] border border-[#DFC068]/40 rounded-3xl max-w-md w-full p-8 shadow-2xl shadow-amber-950/30 space-y-6 relative z-10">
        <div className="text-center space-y-3">
          <div className="w-20 h-20 mx-auto rounded-2xl p-1 bg-gradient-to-br from-[#8C6D19] via-[#B8860B] to-[#C59B27] shadow-lg shadow-amber-950/50 flex items-center justify-center">
            <img
              src={logoImg}
              alt="2AM Studio"
              className="w-full h-full object-cover rounded-xl"
              onError={(e) => {
                // Fallback elegante se a imagem demorar a carregar
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div>
            <h2 className="text-2xl font-black text-[#F5EFE6] tracking-tight">
              2AM STUDIO
            </h2>
            <p className="text-xs text-[#DFC068] font-semibold tracking-wider uppercase mt-0.5">
              Portal do Parceiro
            </p>
          </div>
          <p className="text-[11px] text-[#9E9182]">
            Acesse com as credenciais exclusivas fornecidas pela administração
          </p>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs rounded-xl text-center font-medium animate-in fade-in">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#D5C9B8] mb-1.5">
              Seu E-mail de Parceiro:
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="parceiro@2amstudio.com"
              className="w-full bg-[#120F0D] border border-[#383028] rounded-xl px-4 py-2.5 text-xs text-[#F5EFE6] placeholder-[#6D6356] focus:outline-none focus:border-[#DFC068] focus:ring-1 focus:ring-[#DFC068] transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#D5C9B8] mb-1.5">
              Sua Senha de Acesso:
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-[#120F0D] border border-[#383028] rounded-xl px-4 py-2.5 text-xs text-[#F5EFE6] placeholder-[#6D6356] focus:outline-none focus:border-[#DFC068] focus:ring-1 focus:ring-[#DFC068] transition-all"
            />
          </div>

          <div className="p-3 bg-[#120F0D] border border-[#2E2620] rounded-xl text-[11px] text-[#8C7E70] space-y-1">
            <p className="font-bold text-[#DFC068]">🛡️ Blindagem de Segurança Ativa:</p>
            <p>• Suas credenciais de redes sociais são criptografadas em AES-256 e nunca são expostas.</p>
            <p>• Sessão monitorada e sincronizada em tempo real com os servidores da 2AM Studio.</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-[#8C6D19] via-[#B8860B] to-[#C59B27] hover:from-[#9E7C1D] hover:to-[#D4A72B] disabled:opacity-50 text-[#141210] font-extrabold text-xs rounded-xl shadow-lg shadow-amber-950/40 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-[#141210] border-t-transparent rounded-full animate-spin" />
                <span>Autenticando...</span>
              </>
            ) : (
              <span>Entrar no 2AM Studio</span>
            )}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-[#2E2620]">
          <p className="text-[10px] text-[#7D7063] font-mono">
            2AM Studio Parceiros v1.0.1 • Conexão Criptografada
          </p>
        </div>
      </div>
    </div>
  );
};
