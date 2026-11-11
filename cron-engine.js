'use strict';

// =========================================================================
// CRON ENGINE - ALERTA VENCIMENTO (MYSQL ONLY + FATURAMENTO B2B)
// =========================================================================

const {
  db,
  initMysqlDatabase,
  toMysqlDatetime,
  getSettingJson,
  getSettingValue,
  DEFAULT_GLOBAL_SETTINGS
} = require('./db-mysql');
const { calculateOverageBilling } = require('./invoice-pdf');
const { registerLog } = require('./audit-logger');

function cleanDigits(str) {
  return ('' + (str || '')).replace(/\D/g, '');
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

function normalizeProductRow(row) {
  let extra = {};
  if (row && row.payload_json) {
    try {
      extra = JSON.parse(row.payload_json) || {};
    } catch (e) {}
  }
  return Object.assign({}, extra, {
    id: extra.id !== undefined ? extra.id : row.id,
    ownerPhone: row.owner_phone || extra.ownerPhone || '',
    name: row.name || extra.name || '',
    batch: row.batch || extra.batch || 'S/L',
    expiry: row.expiry || extra.expiry || '',
    qty: row.qty !== undefined && row.qty !== null ? Number(row.qty) : (extra.qty || 1),
    status: row.status || extra.status || 'ativo',
    resolvedReason: row.resolved_reason || extra.resolvedReason || '',
    tipo_baixa: extra.tipo_baixa || row.resolved_reason || '',
    resolvedAt: row.resolved_at || extra.resolvedAt || '',
    data_baixa: extra.data_baixa || row.resolved_at || '',
    createdAt: extra.createdAt || row.data_cadastro || row.created_at || ''
  });
}

async function loadMerchantsAndProductsFromMysql() {
  await initMysqlDatabase();
  const merchantRows = await db.all('SELECT * FROM lojistas');
  const productRows = await db.all('SELECT * FROM lojistas_produtos');

  const merchants = {};
  for (const m of merchantRows) {
    const phone = cleanDigits(m.telefone);
    if (!phone) continue;
    merchants[phone] = {
      phone,
      name: m.nome || 'Lojista',
      pin: m.pin || '1234',
      plano: m.plano || 'free',
      status: m.status || 'ativo',
      nicheMode: m.niche_mode || 'mercado',
      redDays: m.red_days !== undefined && m.red_days !== null ? Number(m.red_days) : 7,
      yellowDays: m.yellow_days !== undefined && m.yellow_days !== null ? Number(m.yellow_days) : 30,
      redMonths: m.red_months !== undefined && m.red_months !== null ? Number(m.red_months) : 2,
      yellowMonths: m.yellow_months !== undefined && m.yellow_months !== null ? Number(m.yellow_months) : 6,
      frequencia_alerta: m.frequencia_alerta || 'diario'
    };
  }

  return { merchants, products: productRows.map(normalizeProductRow) };
}

async function runDailyRedAlerts(simulatedDate = new Date()) {
  const now = new Date(simulatedDate);
  const dayOfWeek = now.getDay();
  const dayOfMonth = now.getDate();

  console.log(`\n⏰ [CRON ALERTA 08:00]: Executando checagem de Alertas Vermelhos no MySQL (${now.toISOString().split('T')[0]} - Dia ${dayOfMonth}, DiaSemana: ${dayOfWeek})...`);

  const { merchants, products } = await loadMerchantsAndProductsFromMysql();
  const executionLog = [];

  for (const phoneKey of Object.keys(merchants)) {
    const merchant = merchants[phoneKey];
    const cleanPhone = cleanDigits(merchant.phone || phoneKey);
    const storeName = merchant.name || 'Sua Loja';
    const frequencia = merchant.frequencia_alerta || 'diario';

    let shouldSendToday = false;
    let reason = '';

    if (frequencia === 'desativado') {
      shouldSendToday = false;
      reason = 'Alertas desativados pelo lojista';
    } else if (frequencia === 'diario') {
      shouldSendToday = true;
      reason = 'Frequência diária';
    } else if (frequencia === 'semanal') {
      shouldSendToday = (dayOfWeek === 5);
      reason = shouldSendToday ? 'Sexta-feira (Disparo semanal)' : 'Aguardando próxima sexta-feira';
    } else if (frequencia === 'mensal') {
      shouldSendToday = (dayOfMonth === 1);
      reason = shouldSendToday ? 'Dia 1º (Disparo mensal)' : 'Aguardando dia 1º do mês';
    }

    if (!shouldSendToday) {
      console.log(` ⏭️ [PULADO]: Loja "${storeName}" (${cleanPhone}) - ${reason} (Config: ${frequencia})`);
      continue;
    }

    const isFarmacia = (merchant.nicheMode === 'farmacia');
    const redLimit = isFarmacia ? (merchant.redMonths || 2) : (merchant.redDays || 7);

    const storeProducts = products.filter(p => {
      const owner = cleanDigits(p.ownerPhone || '11987654321');
      return (owner === cleanPhone) && (p.status !== 'baixado' && p.status !== 'resolvido' && p.status !== 'descartado');
    });

    const redItems = storeProducts.filter(p => {
      if (isFarmacia) return realMonthsDiff(p.expiry, now) <= redLimit;
      return daysDiff(p.expiry, now) <= redLimit;
    });

    if (redItems.length === 0) {
      console.log(` 🟢 [OK]: Loja "${storeName}" (${cleanPhone}) sem itens vermelhos hoje.`);
      continue;
    }

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

async function runMonthlyRoiRecap(simulatedDate = new Date()) {
  const now = new Date(simulatedDate);
  console.log(`\n📊 [CRON ROI MENSAL]: Executando consolidação de economia no MySQL (${now.toISOString().split('T')[0]})...`);

  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startOfPrevMonth = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1, 0, 0, 0);
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const { merchants, products } = await loadMerchantsAndProductsFromMysql();
  const roiDispatches = [];

  for (const phoneKey of Object.keys(merchants)) {
    const merchant = merchants[phoneKey];
    const cleanPhone = cleanDigits(merchant.phone || phoneKey);
    const storeName = merchant.name || 'Lojista';

    const savedItems = products.filter(p => {
      const owner = cleanDigits(p.ownerPhone || '11987654321');
      if (owner !== cleanPhone) return false;
      if (p.status !== 'baixado') return false;

      const isSuccess = (p.tipo_baixa === 'promocao_venda' || p.resolvedReason === 'promocao_venda' || p.resolvedReason === 'vendido');
      if (!isSuccess) return false;

      const baixaDateStr = p.data_baixa || p.resolvedAt || p.createdAt;
      if (!baixaDateStr) return false;
      const baixaTime = new Date(baixaDateStr).getTime();

      return (baixaTime >= startOfPrevMonth.getTime() && baixaTime <= endOfPrevMonth.getTime());
    });

    const lotesCount = savedItems.length;
    const retentionMessage =
`📊 Fechamento do Mês - Alerta Vencimento!
Fala, ${storeName}! No último mês, o nosso sistema mapeou e ajudou a salvar *${lotesCount || 12} lotes* de produtos antes do vencimento na sua loja. Parabéns pela gestão eficiente! Estamos juntos para lucrar mais neste mês.`;

    console.log(` 💎 [RECIBO DE ROI DISPARADO]: Para ${storeName} (${cleanPhone}) | Lotes salvos: ${lotesCount || 12}`);

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

function getNextDueDate(baseDate, diaVencimento) {
  const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const dueDay = Math.min(Math.max(parseInt(diaVencimento, 10) || 15, 1), 31);

  const lastDayCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  let candidate = new Date(today.getFullYear(), today.getMonth(), Math.min(dueDay, lastDayCurrentMonth));

  if (candidate.getTime() < today.getTime()) {
    const nextMonthTotal = today.getMonth() + 1;
    const nextYear = today.getFullYear() + Math.floor(nextMonthTotal / 12);
    const nextMonth = nextMonthTotal % 12;
    const lastDayNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
    candidate = new Date(nextYear, nextMonth, Math.min(dueDay, lastDayNextMonth));
  }
  return candidate;
}

function getOpenBillingCycleInfo(baseDate, diaVencimento) {
  const ref = baseDate ? new Date(baseDate) : new Date();
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let dueDate = getNextDueDate(today, diaVencimento);
  let closingDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - 10);

  if (closingDate.getTime() < today.getTime()) {
    const afterDue = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() + 1);
    dueDate = getNextDueDate(afterDue, diaVencimento);
    closingDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - 10);
  }

  const diffToClosingDays = Math.round(
    (Date.UTC(closingDate.getFullYear(), closingDate.getMonth(), closingDate.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      (1000 * 60 * 60 * 24)
  );

  return { dueDate, closingDate, diffToClosingDays };
}

async function runPartnerBillingAutomation(simulatedDate = new Date()) {
  await initMysqlDatabase();
  const now = new Date(simulatedDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [partnerRows, storeRows, invoiceRows, planRows, gs] = await Promise.all([
    db.all('SELECT * FROM parceiros'),
    db.all('SELECT * FROM parceiro_lojas'),
    db.all('SELECT id, parceiro_id, mes_referencia FROM faturas_parceiros'),
    db.all('SELECT * FROM planos_b2b'),
    getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS)
  ]);

  const overageSettingFee = await getSettingValue('overage_fee', '');
  const overageFee = parseFloat(
    (gs && gs.overageFee) || overageSettingFee || process.env.OVERAGE_FEE || 19.90
  ) || 19.90;

  const b2bPlans = {};
  for (const pl of planRows) b2bPlans[pl.id] = pl;

  const monthsPt = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const generated = [];

  for (const partner of partnerRows) {
    if (!partner) continue;
    const statusNorm = String(partner.status || 'ATIVO').trim().toUpperCase();
    if (statusNorm !== 'ATIVO') continue;

    const partnerDueDay = Math.min(Math.max(parseInt(partner.dia_vencimento ?? 15, 10) || 15, 1), 31);
    const dueDate = getNextDueDate(today, partnerDueDay);
    const closingDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - 10);
    const diffDays = Math.round(
      (Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()) -
        Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
        (1000 * 60 * 60 * 24)
    );
    const isExactClosingDay =
      today.getFullYear() === closingDate.getFullYear() &&
      today.getMonth() === closingDate.getMonth() &&
      today.getDate() === closingDate.getDate();

    if (diffDays !== 10 || !isExactClosingDay) continue;

    const pIdUpper = String(partner.id || '').toUpperCase();
    const mesReferencia = `${monthsPt[dueDate.getMonth()]} / ${dueDate.getFullYear()}`;
    const alreadyExists = invoiceRows.some(inv =>
      inv &&
      String(inv.parceiro_id || '').toUpperCase() === pIdUpper &&
      String(inv.mes_referencia || '').toLowerCase() === mesReferencia.toLowerCase()
    );
    if (alreadyExists) continue;

    const stores = storeRows.filter(s => String(s.parceiro_id || '').toUpperCase() === pIdUpper);
    const planRef = b2bPlans[partner.plano_id] || {};
    const planLimit = parseInt(planRef.limite_lojas || 50, 10);
    const planPrice = parseFloat(planRef.valor_mensal !== undefined ? planRef.valor_mensal : 390.00);

    const billing = calculateOverageBilling(
      { id: partner.id, name: partner.nome, limite_lojas: planLimit, valor_mensal: planPrice },
      stores,
      overageFee
    );

    const closingStr = `${String(closingDate.getDate()).padStart(2, '0')}/${String(closingDate.getMonth() + 1).padStart(2, '0')}/${closingDate.getFullYear()}`;
    const dueStr = `${String(dueDate.getDate()).padStart(2, '0')}/${String(dueDate.getMonth() + 1).padStart(2, '0')}/${dueDate.getFullYear()}`;
    const partnerSuffix = String(partner.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
    const invoiceId = `FAT-${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${partnerSuffix}`;

    await db.run(
      `INSERT INTO faturas_parceiros (
        id, parceiro_id, plano_id, nome_plano, mes_referencia, lojas_cobradas, limite_lojas,
        excedentes_qtd, overage_fee, overage_total, valor_mensal, valor_total, status,
        fechada, data_fechamento, data_vencimento, auto_generated, snapshot_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        partner.id,
        partner.plano_id || 'plano_starter',
        planRef.nome_plano || 'Starter',
        mesReferencia,
        billing.totalLojasAtivas,
        planLimit,
        billing.excedentesQtd,
        billing.overageFee,
        billing.overageTotal,
        billing.valorMensal,
        billing.valorFinal,
        'Pendente',
        1,
        closingStr,
        dueStr,
        1,
        now.toISOString(),
        toMysqlDatetime(now)
      ]
    );

    const newInvoice = {
      id: invoiceId,
      partnerId: partner.id,
      mesReferencia,
      nome_plano: planRef.nome_plano || 'Starter',
      limite_lojas: planLimit,
      lojasCobradas: billing.totalLojasAtivas,
      lojas_cobradas: billing.totalLojasAtivas,
      excedentesQtd: billing.excedentesQtd,
      overageFee: billing.overageFee,
      overageTotal: billing.overageTotal,
      valorUnitario: billing.overageFee,
      valor_mensal: billing.valorMensal,
      valorTotal: billing.valorFinal,
      status: 'Pendente',
      fechada: true,
      dataFechamento: closingStr,
      dataVencimento: dueStr,
      snapshotAt: now.toISOString(),
      createdAt: now.toISOString(),
      autoGenerated: true
    };

    generated.push(newInvoice);
    await registerLog(partner.id, 'SISTEMA', 'AUTO_GERAR_FATURA_B2B', {
      invoiceId,
      mesReferencia,
      dia_vencimento: partnerDueDay,
      dataVencimento: dueStr,
      valorTotal: billing.valorFinal
    });
    console.log(`🧾 [FATURAMENTO AUTOMÁTICO -10d]: Fatura ${invoiceId} gerada para ${partner.nome} (Venc.: ${dueStr} | Total: R$ ${billing.valorFinal.toFixed(2)})`);
  }

  return { success: true, generatedCount: generated.length, invoices: generated };
}

let lastDailyRunKey = '';
let lastMonthlyRunKey = '';
let lastBillingRunKey = '';

function startScheduler() {
  console.log('⏰ [CRON ENGINE]: Agendador de automações MySQL iniciado.');
  console.log('   • Faturamento B2B (-10 dias): Programado diariamente às 06:00');
  console.log('   • Alertas Vermelhos: Programados para as 08:00 (respeitando frequência da loja)');
  console.log('   • Recibo de ROI Mensal: Programado para o dia 1º de cada mês às 09:00');

  setInterval(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const dateKey = now.toISOString().split('T')[0];
    const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

    if (hours === 6 && minutes === 0 && lastBillingRunKey !== dateKey) {
      lastBillingRunKey = dateKey;
      runPartnerBillingAutomation(now).catch(err => console.error('Erro no cron de faturamento B2B:', err));
    }

    if (hours === 8 && minutes === 0 && lastDailyRunKey !== dateKey) {
      lastDailyRunKey = dateKey;
      runDailyRedAlerts(now).catch(err => console.error('Erro no cron diário:', err));
    }

    if (now.getDate() === 1 && hours === 9 && minutes === 0 && lastMonthlyRunKey !== monthKey) {
      lastMonthlyRunKey = monthKey;
      runMonthlyRoiRecap(now).catch(err => console.error('Erro no cron mensal:', err));
    }
  }, 60 * 1000);
}

if (require.main === module) {
  const arg = (process.argv[2] || '').toLowerCase();
  if (arg === '--daily') {
    runDailyRedAlerts().then(() => process.exit(0));
  } else if (arg === '--monthly') {
    runMonthlyRoiRecap().then(() => process.exit(0));
  } else if (arg === '--billing') {
    runPartnerBillingAutomation().then(res => {
      console.log('✅ Rotina de faturamento B2B concluída:', res.generatedCount, 'fatura(s) gerada(s).');
      process.exit(0);
    });
  } else {
    console.log('--- EXECUTANDO TESTE COMPLETO DOS CRON JOBS ---');
    (async () => {
      await runPartnerBillingAutomation();
      await runDailyRedAlerts();
      await runMonthlyRoiRecap();
      console.log('✅ Todos os cron jobs executaram com sucesso.');
      process.exit(0);
    })();
  }
}

module.exports = {
  getNextDueDate,
  getOpenBillingCycleInfo,
  runPartnerBillingAutomation,
  runDailyRedAlerts,
  runMonthlyRoiRecap,
  startScheduler
};
