import React, { useEffect, useState } from 'react';
import { supabase, type PaymentMethod } from '../lib/supabase';

interface Props {
  partnerId: string;
}

export const PaymentSettings: React.FC<Props> = ({ partnerId }) => {
  const [methodType, setMethodType] = useState<'pix' | 'crypto' | 'redotpay' | 'paypal'>('pix');

  // PIX
  const [pixKeyType, setPixKeyType] = useState('cpf');
  const [pixKey, setPixKey] = useState('');
  const [pixHolderName, setPixHolderName] = useState('');

  // Crypto
  const [cryptoNetwork, setCryptoNetwork] = useState('trc20');
  const [cryptoCoin, setCryptoCoin] = useState('usdt');
  const [cryptoAddress, setCryptoAddress] = useState('');

  // RedotPay
  const [redotpayId, setRedotpayId] = useState('');
  const [redotpayEmail, setRedotpayEmail] = useState('');

  // PayPal
  const [paypalEmail, setPaypalEmail] = useState('');

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchPaymentMethod();
  }, [partnerId]);

  const fetchPaymentMethod = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('partner_id', partnerId)
      .maybeSingle();

    if (data) {
      const pm = data as PaymentMethod;
      setMethodType(pm.method_type);

      if (pm.pix_key_type) setPixKeyType(pm.pix_key_type);
      if (pm.pix_key) setPixKey(pm.pix_key);
      if (pm.pix_holder_name) setPixHolderName(pm.pix_holder_name);

      if (pm.crypto_network) setCryptoNetwork(pm.crypto_network);
      if (pm.crypto_coin) setCryptoCoin(pm.crypto_coin);
      if (pm.crypto_address) setCryptoAddress(pm.crypto_address);

      if (pm.redotpay_id) setRedotpayId(pm.redotpay_id);
      if (pm.redotpay_email && pm.method_type === 'redotpay') setRedotpayEmail(pm.redotpay_email);

      if (pm.paypal_email) {
        setPaypalEmail(pm.paypal_email);
      } else if (pm.method_type === 'paypal' && pm.redotpay_email) {
        setPaypalEmail(pm.redotpay_email);
      }
    }
    setLoading(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMessage(null);

    try {
      const payload: any = {
        partner_id: partnerId,
        method_type: methodType,
        pix_key_type: methodType === 'pix' ? pixKeyType : null,
        pix_key: methodType === 'pix' ? pixKey.trim() : null,
        pix_holder_name: methodType === 'pix' ? pixHolderName.trim() : null,
        crypto_network: methodType === 'crypto' ? cryptoNetwork : null,
        crypto_coin: methodType === 'crypto' ? cryptoCoin : null,
        crypto_address: methodType === 'crypto' ? cryptoAddress.trim() : null,
        redotpay_id: methodType === 'redotpay' ? redotpayId.trim() : null,
        redotpay_email: methodType === 'redotpay' ? redotpayEmail.trim() : (methodType === 'paypal' ? paypalEmail.trim() : null),
        paypal_email: methodType === 'paypal' ? paypalEmail.trim() : null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('payment_methods')
        .select('id')
        .eq('partner_id', partnerId)
        .maybeSingle();

      // 1. Tentar salvar normalmente com a coluna paypal_email
      let saveRes = existing
        ? await supabase.from('payment_methods').update(payload).eq('id', existing.id)
        : await supabase.from('payment_methods').insert(payload);

      // 2. Se o banco de dados retornar que paypal_email não existe (código 42703), salva usando fallback transparente sem erro
      if (saveRes.error && (saveRes.error.code === '42703' || saveRes.error.message?.includes('paypal_email'))) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.paypal_email;
        saveRes = existing
          ? await supabase.from('payment_methods').update(fallbackPayload).eq('id', existing.id)
          : await supabase.from('payment_methods').insert(fallbackPayload);
      }

      if (saveRes.error) {
        throw saveRes.error;
      }

      setSuccessMessage('✅ Seus dados de pagamento foram salvos com sucesso!');
    } catch (err: any) {
      console.error('Erro ao salvar pagamento:', err);
      alert('Erro ao salvar pagamento: ' + (err.message || 'Verifique sua conexão.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span>💰</span> Configurações de Pagamento
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Informe os dados onde deseja receber seus pagamentos do Administrador
        </p>
      </div>

      {successMessage && (
        <div className="p-4 bg-emerald-950/80 border border-emerald-800/50 text-emerald-300 text-xs rounded-xl font-medium flex items-center justify-between">
          <span>{successMessage}</span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-400 font-bold text-xs hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-xs italic">
          Carregando seus dados salvos...
        </div>
      ) : (
        <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          {/* Opção do Método */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-3">
              Selecione o Método de Recebimento Preferido:
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setMethodType('pix')}
                className={`p-4 rounded-xl border text-left transition-all ${
                  methodType === 'pix'
                    ? 'bg-blue-600/10 border-blue-500 text-white shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-2xl block mb-1">⚡</span>
                <p className="font-bold text-xs">PIX</p>
                <p className="text-[10px] text-slate-500">Transferência Instantânea</p>
              </button>

              <button
                type="button"
                onClick={() => setMethodType('paypal')}
                className={`p-4 rounded-xl border text-left transition-all ${
                  methodType === 'paypal'
                    ? 'bg-blue-600/10 border-blue-500 text-white shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-2xl block mb-1">🅿️</span>
                <p className="font-bold text-xs">PayPal</p>
                <p className="text-[10px] text-slate-500">Conta PayPal</p>
              </button>

              <button
                type="button"
                onClick={() => setMethodType('crypto')}
                className={`p-4 rounded-xl border text-left transition-all ${
                  methodType === 'crypto'
                    ? 'bg-blue-600/10 border-blue-500 text-white shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-2xl block mb-1">🪙</span>
                <p className="font-bold text-xs">Cripto (USDT/USDC)</p>
                <p className="text-[10px] text-slate-500">TRC20, ERC20, BEP20</p>
              </button>

              <button
                type="button"
                onClick={() => setMethodType('redotpay')}
                className={`p-4 rounded-xl border text-left transition-all ${
                  methodType === 'redotpay'
                    ? 'bg-blue-600/10 border-blue-500 text-white shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-2xl block mb-1">💳</span>
                <p className="font-bold text-xs">RedotPay</p>
                <p className="text-[10px] text-slate-500">Carteira RedotPay</p>
              </button>
            </div>
          </div>

          {/* Form PIX */}
          {methodType === 'pix' && (
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Tipo de Chave PIX:
                  </label>
                  <select
                    value={pixKeyType}
                    onChange={(e) => setPixKeyType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="cpf">CPF</option>
                    <option value="email">Email</option>
                    <option value="phone">Telefone</option>
                    <option value="random">Chave Aleatória</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Chave PIX:
                  </label>
                  <input
                    type="text"
                    required
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    placeholder="Digite sua chave PIX..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome Completo do Titular da Conta:
                </label>
                <input
                  type="text"
                  required
                  value={pixHolderName}
                  onChange={(e) => setPixHolderName(e.target.value)}
                  placeholder="Nome do titular como consta no banco..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Form PayPal */}
          {methodType === 'paypal' && (
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl text-xs text-blue-300">
                💡 O pagamento será enviado para o e-mail associado à sua conta PayPal. Certifique-se de que o e-mail está correto e que a conta aceita pagamentos internacionais.
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  E-mail da Conta PayPal:
                </label>
                <input
                  type="email"
                  required
                  value={paypalEmail}
                  onChange={(e) => setPaypalEmail(e.target.value)}
                  placeholder="seu.email@paypal.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Form Crypto */}
          {methodType === 'crypto' && (
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Rede de Transferência:
                  </label>
                  <select
                    value={cryptoNetwork}
                    onChange={(e) => setCryptoNetwork(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="trc20">TRC20 (TRON)</option>
                    <option value="erc20">ERC20 (Ethereum)</option>
                    <option value="bep20">BEP20 (BNB Chain)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Moeda / Token:
                  </label>
                  <select
                    value={cryptoCoin}
                    onChange={(e) => setCryptoCoin(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="usdt">USDT (Tether)</option>
                    <option value="usdc">USDC (USD Coin)</option>
                    <option value="btc">Bitcoin (BTC)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Endereço da Carteira (Wallet Address):
                </label>
                <input
                  type="text"
                  required
                  value={cryptoAddress}
                  onChange={(e) => setCryptoAddress(e.target.value)}
                  placeholder="Ex: TXqZ7v8k9Lm..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Form RedotPay */}
          {methodType === 'redotpay' && (
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  ID de Utilizador RedotPay:
                </label>
                <input
                  type="text"
                  required
                  value={redotpayId}
                  onChange={(e) => setRedotpayId(e.target.value)}
                  placeholder="Seu ID do app RedotPay..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Email Cadastrado no RedotPay:
                </label>
                <input
                  type="email"
                  required
                  value={redotpayEmail}
                  onChange={(e) => setRedotpayEmail(e.target.value)}
                  placeholder="seu.email@redotpay.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <span>💾</span>
                  <span>Salvar Dados de Pagamento</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
