const fs = require('fs');
const path = require('path');

const indexHtmlPath = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html';
const brainHtmlPath = 'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html';

const newSettingsHtml = `      <!-- ======================================================== -->
      <!-- ABA: CONFIGURAÇÕES DO SISTEMA (PADRÃO ENTERPRISE EM CARDS) -->
      <!-- ======================================================== -->
      <div id="admin-tab-content-settings" class="hidden space-y-5">
        
        <!-- Header da Seção de Configurações -->
        <div class="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center justify-center font-extrabold text-lg shadow-2xs">
              ⚙️
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-extrabold text-base text-slate-900">Configurações Globais do SaaS</h3>
                <span class="text-[10px] font-black tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full uppercase">Enterprise</span>
              </div>
              <p class="text-xs text-slate-500 mt-0.5">Parâmetros operacionais, regras de negócio, dados bancários e infraestrutura central.</p>
            </div>
          </div>
          <div class="flex items-center gap-2 self-start sm:self-center">
            <span class="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full shadow-2xs">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              QR Code BACEN Integrado
            </span>
          </div>
        </div>

        <form onsubmit="handleSaveGlobalSettings(event); return false;" class="space-y-5 text-xs">
          <!-- Grid 2x2 para os Cards Semânticos -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">

            <!-- CARD 1: IDENTIDADE VISUAL E OPERAÇÃO -->
            <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
              <div>
                <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                  <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center font-black text-sm">🎨</span>
                    <div>
                      <h4 class="font-bold text-sm text-slate-900">1. Identidade Visual e Operação</h4>
                      <p class="text-[11px] text-slate-400">Personalização de marca (White Label) e disponibilidade</p>
                    </div>
                  </div>
                  <span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Operação</span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div class="sm:col-span-2">
                    <label class="block font-bold text-slate-700 mb-1">
                      Nome Oficial do Sistema <span class="text-rose-500">*</span>
                    </label>
                    <input 
                      id="admin-brand-name" 
                      required 
                      type="text" 
                      value="Alerta Vencimento" 
                      placeholder="Ex: Alerta Vencimento" 
                      class="w-full text-xs font-bold border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Consumido dinamicamente em títulos, relatórios e menus.</span>
                  </div>

                  <div class="sm:col-span-2">
                    <label class="block font-bold text-slate-700 mb-1">
                      Link da Logomarca (URL)
                    </label>
                    <input 
                      id="admin-brand-logo" 
                      type="url" 
                      placeholder="https://exemplo.com/logo.png" 
                      class="w-full text-xs font-mono border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">URL pública da imagem oficial (PNG, SVG, JPG).</span>
                  </div>

                  <div>
                    <label class="block font-bold text-slate-700 mb-1">
                      WhatsApp do Suporte <span class="text-rose-500">*</span>
                    </label>
                    <input 
                      id="admin-support-phone" 
                      required 
                      type="tel" 
                      maxlength="15"
                      oninput="applyPhoneMask(this)" 
                      value="(11) 99646-6498" 
                      placeholder="(11) 99999-9999" 
                      class="w-full text-xs font-mono font-bold border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Destino do botão "Ajuda" do painel do lojista.</span>
                  </div>

                  <div>
                    <label class="block font-bold text-slate-700 mb-1">
                      Status Operacional do SaaS <span class="text-rose-500">*</span>
                    </label>
                    <select 
                      id="admin-system-status" 
                      class="w-full text-xs font-bold border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition cursor-pointer"
                    >
                      <option value="online">🟢 Operação Normal (Online)</option>
                      <option value="promocao">⚡ Modo Promoção de Lançamento</option>
                      <option value="manutencao">🛠️ Em Manutenção Programada</option>
                    </select>
                    <span class="text-[10px] text-slate-400 mt-1 block">Disponibilidade geral do sistema.</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- CARD 2: DADOS DE RECEBIMENTO E PREÇOS B2C -->
            <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
              <div>
                <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                  <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center font-black text-sm">💳</span>
                    <div>
                      <h4 class="font-bold text-sm text-slate-900">2. Dados de Recebimento e Preços B2C</h4>
                      <p class="text-[11px] text-slate-400">Chave PIX oficial e valores de mensalidade dos lojistas</p>
                    </div>
                  </div>
                  <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Financeiro B2C</span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div class="sm:col-span-2">
                    <label class="block font-bold text-slate-700 mb-1">
                      Chave PIX Oficial do Negócio <span class="text-rose-500">*</span>
                    </label>
                    <input 
                      id="admin-pix-key" 
                      required 
                      type="text" 
                      value="38032274880" 
                      placeholder="CNPJ, CPF, Celular ou Chave Aleatória"
                      class="w-full text-xs font-mono font-bold border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Chave para onde os lojistas transferem as renovações.</span>
                  </div>

                  <div>
                    <label class="block font-bold text-slate-700 mb-1">
                      Nome do Beneficiário no PIX
                    </label>
                    <input 
                      id="admin-pix-name" 
                      type="text" 
                      value="ALERTA VENCIMENTO" 
                      placeholder="Razão Social ou Nome do Titular"
                      class="w-full text-xs font-bold border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Nome exibido no app do banco do cliente.</span>
                  </div>

                  <div>
                    <label class="block font-bold text-slate-700 mb-1">
                      Cidade do Beneficiário
                    </label>
                    <input 
                      id="admin-pix-city" 
                      type="text" 
                      value="SAO PAULO" 
                      placeholder="Ex: SAO PAULO"
                      class="w-full text-xs font-bold border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Exigido pelo protocolo oficial BACEN.</span>
                  </div>

                  <div>
                    <label class="block font-bold text-slate-700 mb-1">
                      Valor Mensalidade PRO (R$) <span class="text-rose-500">*</span>
                    </label>
                    <input 
                      id="admin-pix-amount" 
                      required 
                      type="number" 
                      step="0.01" 
                      value="49.90" 
                      class="w-full text-xs font-mono font-bold border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Preço da assinatura mensal avulsa do lojista.</span>
                  </div>

                  <div>
                    <label class="block font-bold text-emerald-800 mb-1">
                      Valor Assinatura Anual (R$) <span class="text-rose-500">*</span>
                    </label>
                    <input 
                      id="admin-pix-amount-annual" 
                      required 
                      type="number" 
                      step="0.01" 
                      value="199.00" 
                      class="w-full text-xs font-mono font-bold border border-emerald-300 bg-emerald-50/30 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Cobrança anual com desconto atrativo.</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- CARD 3: REGRAS DE NEGÓCIO E SEMÁFORO -->
            <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
              <div>
                <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                  <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center font-black text-sm">🚦</span>
                    <div>
                      <h4 class="font-bold text-sm text-slate-900">3. Regras de Negócio e Semáforo</h4>
                      <p class="text-[11px] text-slate-400">Prazos de teste, tolerância e dias de corte do semáforo</p>
                    </div>
                  </div>
                  <span class="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Regras</span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label class="block font-bold text-slate-700 mb-1">
                      Duração do Teste Grátis (Dias) <span class="text-rose-500">*</span>
                    </label>
                    <input 
                      id="admin-trial-days" 
                      required 
                      type="number" 
                      min="1" 
                      max="90" 
                      value="14" 
                      class="w-full text-xs font-mono font-bold border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Período de avaliação sem cobrança (padrão: 14).</span>
                  </div>

                  <div>
                    <label class="block font-bold text-amber-900 mb-1">
                      Dias de Tolerância após Vencimento <span class="text-rose-500">*</span>
                    </label>
                    <input 
                      id="admin-tolerance-days" 
                      required 
                      type="number" 
                      min="0" 
                      max="30" 
                      value="3" 
                      class="w-full text-xs font-mono font-bold border border-amber-300 bg-amber-50/30 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Carência com aviso antes do bloqueio (padrão: 3).</span>
                  </div>

                  <div>
                    <label class="block font-bold text-rose-700 mb-1 flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full bg-rose-600 inline-block animate-pulse"></span>
                      <span>Dias para Alerta Vermelho (Crítico) <span class="text-rose-500">*</span></span>
                    </label>
                    <input 
                      id="admin-alert-red-days" 
                      required 
                      type="number" 
                      min="1" 
                      max="90" 
                      value="7" 
                      class="w-full text-xs font-mono font-bold border border-rose-200 bg-rose-50/30 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Entra em urgência máxima (Padrão: 7 dias).</span>
                  </div>

                  <div>
                    <label class="block font-bold text-amber-700 mb-1 flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
                      <span>Dias para Alerta Amarelo (Atenção) <span class="text-rose-500">*</span></span>
                    </label>
                    <input 
                      id="admin-alert-yellow-days" 
                      required 
                      type="number" 
                      min="1" 
                      max="180" 
                      value="30" 
                      class="w-full text-xs font-mono font-bold border border-amber-200 bg-amber-50/30 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition"
                    />
                    <span class="text-[10px] text-slate-400 mt-1 block">Entra em estado preventivo (Padrão: 30 dias).</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- CARD 4: TEMPLATES DE WHATSAPP -->
            <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
              <div>
                <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                  <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 border border-teal-100 flex items-center justify-center font-black text-sm">💬</span>
                    <div>
                      <h4 class="font-bold text-sm text-slate-900">4. Templates de WhatsApp</h4>
                      <p class="text-[11px] text-slate-400">Modelos de mensagens automáticas com tags dinâmicas</p>
                    </div>
                  </div>
                  <span class="text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">Mensageria</span>
                </div>

                <div class="space-y-4">
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="block font-bold text-slate-700">Mensagem de Cobrança</label>
                      <span class="text-[10px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded font-semibold">{nome_loja}, {valor}, {chave_pix}</span>
                    </div>
                    <textarea 
                      id="admin-tpl-billing" 
                      rows="3" 
                      class="w-full text-xs border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-sans leading-relaxed transition" 
                      placeholder="Olá, {nome_loja}! Seu período de teste no Alerta Vencimento expirou..."
                    ></textarea>
                    <span class="text-[10px] text-slate-400 mt-1 block">Texto disparado para avisos de renovação e cobrança aos lojistas.</span>
                  </div>

                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="block font-bold text-slate-700">Mensagem de Alerta de Vencimento</label>
                      <span class="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-semibold">{nome_produto}, {dias_vencer}</span>
                    </div>
                    <textarea 
                      id="admin-tpl-expiry" 
                      rows="3" 
                      class="w-full text-xs border border-slate-300 bg-slate-50/40 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-sans leading-relaxed transition" 
                      placeholder="🚨 ALERTA: O item {nome_produto} está a {dias_vencer} dias do vencimento..."
                    ></textarea>
                    <span class="text-[10px] text-slate-400 mt-1 block">Texto enviado aos operadores com itens que estão vencendo.</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- CARD 5: MANUTENÇÃO E SEGURANÇA (DESTAQUE VISUAL SUTIL) -->
            <div class="lg:col-span-2 bg-gradient-to-br from-slate-900/[0.02] to-slate-900/[0.05] border border-slate-300 rounded-2xl p-5 shadow-xs hover:border-slate-400 transition">
              <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
                <div class="flex items-center gap-2.5">
                  <span class="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center font-black text-sm shadow-xs">🛡️</span>
                  <div>
                    <h4 class="font-bold text-sm text-slate-900">5. Manutenção e Segurança</h4>
                    <p class="text-[11px] text-slate-500">Gestão do ciclo de vida dos dados e salvaguarda do banco SQLite</p>
                  </div>
                </div>
                <span class="text-[10px] font-bold text-slate-700 bg-slate-200/80 px-2.5 py-0.5 rounded-full uppercase tracking-wider">Infraestrutura</span>
              </div>

              <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <!-- Limpeza de Histórico (Data Retention) -->
                <div class="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between mb-2">
                      <span class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                        <span>🩺</span>
                        <span>Retenção e Purga Automática de Histórico</span>
                      </span>
                      <span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">SQLite Auto-Purge</span>
                    </div>
                    <label class="block text-[11px] font-semibold text-slate-600 mb-1.5">
                      Limpar histórico de produtos resolvidos após X dias <span class="text-rose-500">*</span>
                    </label>
                    <div class="flex items-center gap-2">
                      <input 
                        id="admin-retention-days" 
                        required 
                        type="number" 
                        min="7" 
                        max="730" 
                        value="90" 
                        class="w-28 text-xs font-mono font-bold border border-slate-300 bg-slate-50 rounded-xl p-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                      />
                      <span class="text-xs text-slate-600 font-semibold">dias</span>
                      <button 
                        type="button" 
                        onclick="runDataRetentionCleanup()" 
                        class="bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold px-3.5 py-2.5 rounded-xl transition cursor-pointer active:scale-95 ml-auto flex items-center gap-1.5 border border-slate-300/80 shadow-2xs" 
                        title="Executar rotina de retenção imediatamente"
                      >
                        <span>🧹</span>
                        <span>Limpar Agora</span>
                      </button>
                    </div>
                  </div>
                  <p class="text-[11px] text-slate-500 mt-3 leading-relaxed">
                    Remove do banco produtos que já foram vendidos ou descartados além do prazo estipulado, garantindo alta performance e baixo consumo de memória.
                  </p>
                </div>

                <!-- Backup Instantâneo do Banco de Dados -->
                <div class="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-300/80 rounded-xl p-4 shadow-2xs flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                        <span class="font-bold text-xs text-amber-950">Backup Instantâneo do Banco de Dados</span>
                      </div>
                      <span class="text-[10px] font-bold text-amber-800 bg-amber-100/80 border border-amber-200 px-2 py-0.5 rounded-full">Snapshot</span>
                    </div>
                    <p class="text-[11px] text-amber-900/85 leading-relaxed">
                      Gera e descarrega uma cópia integral do banco (lojistas, produtos, parceiros, faturas e credenciais) diretamente para o seu computador.
                    </p>
                  </div>
                  <div class="pt-3">
                    <button 
                      type="button" 
                      onclick="downloadDatabaseBackup()" 
                      class="w-full bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 active:scale-95 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-2"
                    >
                      <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      <span>Fazer Backup do Banco de Dados Agora</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div> <!-- Fim do Grid 2x2 -->

          <!-- RODAPÉ FIXO / CENTRALIZADO DE AÇÕES -->
          <div class="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div class="flex items-center gap-2 text-slate-500 text-xs">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>As regras operacionais atualizadas entram em vigor imediatamente após salvar.</span>
            </div>
            <button 
              type="submit" 
              class="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold text-xs px-7 py-3 rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Salvar Configurações do Sistema</span>
              <span class="font-bold">✓</span>
            </button>
          </div>
        </form>
      </div>`;

function refactorSettingsInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Localiza o bloco admin-tab-content-settings
  const startTarget = '<div id="admin-tab-content-settings"';
  const endTarget = '<!-- ======================================================== -->\r\n      <!-- ABA 2: PARCEIROS DE SOFTWARE PDV';
  const endTargetLf = '<!-- ======================================================== -->\n      <!-- ABA 2: PARCEIROS DE SOFTWARE PDV';

  const startIdx = content.indexOf(startTarget);
  if (startIdx === -1) {
    console.error(`[ERRO]: Não encontrou startTarget em ${filePath}`);
    return;
  }

  let endIdx = content.indexOf(endTarget);
  if (endIdx === -1) {
    endIdx = content.indexOf(endTargetLf);
  }

  if (endIdx === -1) {
    console.error(`[ERRO]: Não encontrou endTarget em ${filePath}`);
    return;
  }

  // Encontra a linha anterior ao startTarget para substituir o bloco inteiro
  const prevComment = content.lastIndexOf('<!-- ======================================================== -->', startIdx);
  const replaceStart = prevComment !== -1 ? prevComment : startIdx;

  content = content.slice(0, replaceStart) + newSettingsHtml + '\n\n      ' + content.slice(endIdx);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[OK] Configurações refatoradas em ${path.basename(filePath)}!`);
}

refactorSettingsInFile(indexHtmlPath);
if (fs.existsSync(brainHtmlPath)) {
  refactorSettingsInFile(brainHtmlPath);
}
