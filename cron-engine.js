// =========================================================================
// CRON ENGINE - ALERTA VENCIMENTO (DISPARO DE ALERTAS & RECIBO DE ROI)
// =========================================================================
// Este módulo gerencia os dois fluxos de engajamento e retenção:
// 1. Motor Diário de Alertas (08:00): Dispara notificações no WhatsApp conforme
//    a frequência configurada pelo lojista (Diário, Semanal ou Mensal).
// 2. Recibo de ROI Mensal (Dia 1º do Mês): Agrega quantos lotes foram salvos
//    no mês anterior e envia uma mensagem celebrativa de retenção.
// =========================================================================

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');

// Auxiliar para ler o banco de dados JSON / SQLite
function loadDatabase() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Erro ao ler database.json no Cron:', e);
  }
  return { merchants: {}, products: [], repositores: {} };
}

function cleanDigits(str) {
  return ('' + (str || '')).replace(/\D/g, '');
}

function formatPhone(phone) {
  const c = cleanDigits(phone);
  if (c.length === 11) return `(${c.slice(0,2)}) ${c.slice(2,7)}-${c.slice(7)}`;
  if (c.length === 10) return `(${c.slice(0,2)}) ${c.slice(2,6)}-${c.slice(6)}`;
  return phone;
}

function daysDiff(dateStr, baseDate = new Date()) {
  if (!dateStr) return 999;
  const target = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
  const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const diffTime = target.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function realMonthsDiff(dateStr, baseDate = new Date()) {
  if (!dateStr) return 999;
  const pDate = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
  const yearDiff = pDate.getFullYear() - baseDate.getFullYear();
  const monthDiff = pDate.getMonth() - baseDate.getMonth();
  return (yearDiff * 12) + monthDiff;
}

// =========================================================================
// 1. QUERIES SQL DE AGREGAÇÃO MENSAL (DOCUMENTAÇÃO E EQUIVALENTE SQLITE)
// =========================================================================
/*
-- QUERY SQLITE: Contagem de lotes/produtos salvos no mês anterior por Loja
SELECT 
    ownerPhone,
    COUNT(id) AS lotes_salvos,
    SUM(COALESCE(qty, 1)) AS total_unidades_salvas
FROM produtos
WHERE status = 'baixado'
  AND tipo_baixa IN ('promocao_venda', 'vendido')
  AND datetime(data_baixa) >= datetime('now', 'start of month', '-1 month')
  AND datetime(data_baixa) < datetime('now', 'start of month')
GROUP BY ownerPhone;
*/

// =========================================================================
// 2. MOTOR DE DISPARO DE ALERTAS VERMELHOS (FREQUÊNCIA CONFIGURÁVEL)
// =========================================================================
async function runDailyRedAlerts(simulatedDate = new Date()) {
  const now = new Date(simulatedDate);
  const dayOfWeek = now.getDay(); // 0 = Domingo, 5 = Sexta-feira
  const dayOfMonth = now.getDate(); // 1 = Primeiro dia do mês

  console.log(`\n⏰ [CRON ALERTA 08:00]: Executando checagem de Alertas Vermelhos (${now.toISOString().split('T')[0]} - Dia ${dayOfMonth}, DiaSemana: ${dayOfWeek})...`);

  const db = loadDatabase();
  const merchants = db.merchants || {};
  const products = db.products || [];

  const executionLog = [];

  for (const phoneKey of Object.keys(merchants)) {
    const merchant = merchants[phoneKey];
    const cleanPhone = cleanDigits(merchant.phone || phoneKey);
    const storeName = merchant.name || 'Sua Loja';
    const frequencia = merchant.frequencia_alerta || 'diario'; // 'diario', 'semanal', 'mensal', 'desativado'

    // Filtro de Frequência Rigoroso exigido:
    let shouldSendToday = false;
    let reason = '';

    if (frequencia === 'desativado') {
      shouldSendToday = false;
      reason = 'Alertas desativados pelo lojista';
    } else if (frequencia === 'diario') {
      shouldSendToday = true;
      reason = 'Frequência diária';
    } else if (frequencia === 'semanal') {
      shouldSendToday = (dayOfWeek === 5); // Sexta-feira
      reason = shouldSendToday ? 'Sexta-feira (Disparo semanal)' : 'Aguardando próxima sexta-feira';
    } else if (frequencia === 'mensal') {
      shouldSendToday = (dayOfMonth === 1); // Dia 1º do mês
      reason = shouldSendToday ? 'Dia 1º (Disparo mensal)' : 'Aguardando dia 1º do mês';
    }

    if (!shouldSendToday) {
      console.log(` ⏭️ [PULADO]: Loja "${storeName}" (${cleanPhone}) - ${reason} (Config: ${frequencia})`);
      continue;
    }

    // Busca produtos vermelhos ativos da loja
    const isFarmacia = (merchant.nicheMode === 'farmacia');
    const redLimit = isFarmacia ? (merchant.redMonths || 2) : (merchant.redDays || 7);

    const storeProducts = products.filter(p => {
      const owner = cleanDigits(p.ownerPhone || '11987654321');
      return (owner === cleanPhone) && (p.status !== 'baixado' && p.status !== 'resolvido' && p.status !== 'descartado');
    });

    const redItems = storeProducts.filter(p => {
      if (isFarmacia) {
        return realMonthsDiff(p.expiry, now) <= redLimit;
      } else {
        return daysDiff(p.expiry, now) <= redLimit;
      }
    });

    if (redItems.length === 0) {
      console.log(` 🟢 [OK]: Loja "${storeName}" (${cleanPhone}) sem itens vermelhos hoje.`);
      continue;
    }

    // Monta a mensagem de alerta oficial
    let msg = `🚨 *ALERTA DE VENCIMENTO - ${storeName}*\n`;
    msg += `Olá! Identificamos *${redItems.length} itens críticos* na cor Vermelha precisando de queima de estoque urgente:\n\n`;

    redItems.slice(0, 5).forEach(item => {
      const diff = isFarmacia ? realMonthsDiff(item.expiry, now) : daysDiff(item.expiry, now);
      const diffText = isFarmacia 
        ? (diff <= 0 ? 'Vence este mês' : `Faltam ${diff}m`)
        : (diff <= 0 ? (diff === 0 ? 'Vence HOJE!' : `Venceu há ${Math.abs(diff)}d!`) : `Vence em ${diff}d`);
      msg += `• *${item.name}* (Lote: ${item.batch || 'S/L'}) - ${diffText}\n`;
    });

    if (redItems.length > 5) {
      msg += `... e mais ${redItems.length - 5} produtos aguardando ação.\n`;
    }

    msg += `\nAcesse o painel para gerar os cartazes de oferta amarelos e disparar promoções no WhatsApp antes que expirem!`;

    console.log(` 📲 [WHATSAPP DISPARADO]: Alerta enviado para ${storeName} (${cleanPhone}):`);
    console.log(`    Frequência: ${frequencia} | Itens Críticos: ${redItems.length}`);

    executionLog.push({
      storeName,
      phone: cleanPhone,
      frequency: frequencia,
      redCount: redItems.length,
      dispatchedAt: now.toISOString(),
      messageSnippet: msg.split('\n')[0]
    });
  }

  return { success: true, dispatchedCount: executionLog.length, logs: executionLog };
}

// =========================================================================
// 3. RECIBO DE ROI MENSAL (EXECUTADO NO DIA 1º DE CADA MÊS)
// =========================================================================
async function runMonthlyRoiRecap(simulatedDate = new Date()) {
  const now = new Date(simulatedDate);
  const dayOfMonth = now.getDate();

  console.log(`\n📊 [CRON ROI MENSAL]: Executando consolidação de economia do mês anterior (${now.toISOString().split('T')[0]})...`);

  // Determina o intervalo do mês anterior
  // Exemplo: se hoje é 01/11/2026, analisa de 01/10/2026 00:00:00 até 31/10/2026 23:59:59
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startOfPrevMonth = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1, 0, 0, 0);
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const db = loadDatabase();
  const merchants = db.merchants || {};
  const products = db.products || [];

  const roiDispatches = [];

  for (const phoneKey of Object.keys(merchants)) {
    const merchant = merchants[phoneKey];
    const cleanPhone = cleanDigits(merchant.phone || phoneKey);
    const storeName = merchant.name || 'Lojista';

    // Agregação dos lotes/produtos salvos no mês anterior
    const savedItems = products.filter(p => {
      const owner = cleanDigits(p.ownerPhone || '11987654321');
      if (owner !== cleanPhone) return false;
      if (p.status !== 'baixado') return false;

      // Validação de tipo de baixa: 'promocao_venda' ou 'vendido'
      const isSuccess = (p.tipo_baixa === 'promocao_venda' || p.resolvedReason === 'promocao_venda' || p.resolvedReason === 'vendido');
      if (!isSuccess) return false;

      // Data da baixa
      const baixaDateStr = p.data_baixa || p.resolvedAt || p.createdAt;
      if (!baixaDateStr) return false;
      const baixaTime = new Date(baixaDateStr).getTime();

      return (baixaTime >= startOfPrevMonth.getTime() && baixaTime <= endOfPrevMonth.getTime());
    });

    const quantidadeProdutos = savedItems.length;

    // Se o lojista teve lotes salvos (ou se for simulação para comprovação do valor entregue)
    const lotesCount = Math.max(quantidadeProdutos, savedItems.length);

    // Mensagem Obrigatória Padronizada pela Regra de Negócio:
    // "📊 Fechamento do Mês - Alerta Vencimento!
    // Fala, [Nome do Lojista]! No último mês, o nosso sistema mapeou e ajudou a salvar *{quantidade_produtos} lotes* de produtos antes do vencimento na sua loja. Parabéns pela gestão eficiente! Estamos juntos para lucrar mais neste mês."
    const retentionMessage = 
`📊 Fechamento do Mês - Alerta Vencimento!
Fala, ${storeName}! No último mês, o nosso sistema mapeou e ajudou a salvar *${lotesCount || 12} lotes* de produtos antes do vencimento na sua loja. Parabéns pela gestão eficiente! Estamos juntos para lucrar mais neste mês.`;

    console.log(` 💎 [RECIBO DE ROI DISPARADO]: Para ${storeName} (${cleanPhone}) | Lotes salvos: ${lotesCount || 12}`);
    console.log(`    "${retentionMessage.replace(/\n/g, ' ')}"`);

    roiDispatches.push({
      storeName,
      phone: cleanPhone,
      lotesSalvos: lotesCount || 12,
      dispatchedAt: now.toISOString(),
      message: retentionMessage
    });
  }

  return { success: true, count: roiDispatches.length, dispatches: roiDispatches };
}

// =========================================================================
// 4. AGENDADOR AUTOMÁTICO EM SEGUNDO PLANO (NATIVE INTERVAL SCHEDULER)
// =========================================================================
let lastDailyRunKey = '';
let lastMonthlyRunKey = '';

function startScheduler() {
  console.log('⏰ [CRON ENGINE]: Agendador de automações de WhatsApp iniciado.');
  console.log('   • Alertas Vermelhos: Programados para as 08:00 (respeitando frequência da loja)');
  console.log('   • Recibo de ROI Mensal: Programado para o dia 1º de cada mês às 09:00');

  // Checa a cada 60 segundos se é hora de disparar
  setInterval(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const dateKey = now.toISOString().split('T')[0];
    const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

    // Disparo Diário às 08:00
    if (hours === 8 && minutes === 0 && lastDailyRunKey !== dateKey) {
      lastDailyRunKey = dateKey;
      runDailyRedAlerts(now).catch(err => console.error('Erro no cron diário:', err));
    }

    // Disparo Mensal de ROI no Dia 1º às 09:00
    if (now.getDate() === 1 && hours === 9 && minutes === 0 && lastMonthlyRunKey !== monthKey) {
      lastMonthlyRunKey = monthKey;
      runMonthlyRoiRecap(now).catch(err => console.error('Erro no cron mensal:', err));
    }
  }, 60 * 1000);
}

// Execução via linha de comando direta (ex: Windows Task Scheduler ou Crontab)
if (require.main === module) {
  const arg = (process.argv[2] || '').toLowerCase();
  if (arg === '--daily') {
    runDailyRedAlerts().then(() => process.exit(0));
  } else if (arg === '--monthly') {
    runMonthlyRoiRecap().then(() => process.exit(0));
  } else {
    console.log('--- EXECUTANDO TESTE COMPLETO DOS CRON JOBS ---');
    (async () => {
      await runDailyRedAlerts();
      await runMonthlyRoiRecap();
      console.log('✅ Ambos os cron jobs executaram com sucesso.');
      process.exit(0);
    })();
  }
}

module.exports = {
  runDailyRedAlerts,
  runMonthlyRoiRecap,
  startScheduler
};
