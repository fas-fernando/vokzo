// =========================================================================
// SEED: CONFIGURAÇÃO DE VENCIMENTO (DIA 15) E FATURA DE TESTE B2B (MYSQL)
// =========================================================================
'use strict';

const { calculateOverageBilling } = require('./invoice-pdf');
const {
  db,
  initMysqlDatabase,
  toMysqlDatetime,
  getSettingJson,
  setSettingJson,
  getSettingValue,
  setSettingValue,
  DEFAULT_GLOBAL_SETTINGS
} = require('./db-mysql');

async function seedPartnerInvoices() {
  await initMysqlDatabase();

  const gs = await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
  gs.dia_vencimento = gs.dia_vencimento || 15;
  await setSettingJson('globalSettings', gs);
  await setSettingValue('dia_vencimento', String(gs.dia_vencimento));

  const feeStr = await getSettingValue('overage_fee', '');
  const overageFee = parseFloat(gs.overageFee || feeStr || process.env.OVERAGE_FEE || 19.90) || 19.90;

  const [partners, partnerStores, existingInvoices, planRows] = await Promise.all([
    db.all('SELECT * FROM parceiros'),
    db.all('SELECT * FROM parceiro_lojas'),
    db.all('SELECT * FROM faturas_parceiros'),
    db.all('SELECT * FROM planos_b2b')
  ]);

  const b2bPlans = {};
  for (const pl of planRows) {
    b2bPlans[pl.id] = pl;
  }

  const now = new Date();
  const monthsPt = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  const currentMonthRef = `${monthsPt[now.getMonth()]} / ${now.getFullYear()}`;
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());

  let seededCount = 0;

  for (const partner of partners) {
    if (!partner) continue;

    const partnerDueDay = Math.min(Math.max(parseInt(partner.dia_vencimento ?? gs.dia_vencimento ?? 15, 10) || 15, 1), 31);
    if (!partner.dia_vencimento) {
      await db.run('UPDATE parceiros SET dia_vencimento = ? WHERE id = ?', [partnerDueDay, partner.id]);
    }

    const pIdNorm = String(partner.id).toUpperCase();
    const pendingInv = existingInvoices.find(
      inv => inv &&
        String(inv.parceiro_id || '').toUpperCase() === pIdNorm &&
        !String(inv.status || '').toLowerCase().includes('paga') &&
        !String(inv.status || '').toLowerCase().includes('cancelada')
    );

    const stores = partnerStores.filter(
      s => String(s.parceiro_id || '').toUpperCase() === pIdNorm
    );
    const planRef = b2bPlans[partner.plano_id] || {};
    const planLimit = parseInt(partner.limite_tokens || planRef.limite_lojas || 50, 10);
    const planPrice = parseFloat(planRef.valor_mensal || 390.00);
    const planName = planRef.nome_plano || 'Starter';

    const billing = calculateOverageBilling(
      { ...partner, limite_lojas: planLimit, valor_mensal: planPrice },
      stores,
      overageFee
    );

    const dueDayStr = String(partnerDueDay).padStart(2, '0');
    const suffix = pIdNorm.replace(/[^A-Z0-9]/g, '').slice(-6);
    const nowMysql = toMysqlDatetime(now);

    if (!pendingInv) {
      const invId = `FAT-${yyyy}-${mm}-${suffix}`;
      await db.run(
        `INSERT INTO faturas_parceiros
         (id, parceiro_id, mes_referencia, lojas_cobradas, valor_unitario, valor_total, status, data_vencimento, created_at, nome_plano, excedentes_qtd, overage_fee, overage_total, valor_mensal, fechada, auto_generated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE
           lojas_cobradas = VALUES(lojas_cobradas),
           valor_unitario = VALUES(valor_unitario),
           valor_total = VALUES(valor_total),
           nome_plano = VALUES(nome_plano),
           excedentes_qtd = VALUES(excedentes_qtd),
           overage_fee = VALUES(overage_fee),
           overage_total = VALUES(overage_total),
           valor_mensal = VALUES(valor_mensal)`,
        [
          invId,
          partner.id,
          currentMonthRef,
          billing.totalLojasAtivas,
          billing.overageFee,
          billing.valorFinal,
          'Pendente',
          `${dueDayStr}/${mm}/${yyyy}`,
          nowMysql,
          planName,
          billing.excedentesQtd,
          billing.overageFee,
          billing.overageTotal,
          billing.valorMensal
        ]
      );
      seededCount++;
    } else {
      await db.run(
        `UPDATE faturas_parceiros
         SET nome_plano = ?, lojas_cobradas = ?, excedentes_qtd = ?, overage_fee = ?, overage_total = ?, valor_unitario = ?, valor_mensal = ?, valor_total = ?
         WHERE id = ?`,
        [
          planName,
          billing.totalLojasAtivas,
          billing.excedentesQtd,
          billing.overageFee,
          billing.overageTotal,
          billing.overageFee,
          billing.valorMensal,
          billing.valorFinal,
          pendingInv.id
        ]
      );
    }
  }

  const countRow = await db.get('SELECT COUNT(id) AS total FROM faturas_parceiros');
  return {
    success: true,
    seededCount,
    totalInvoices: Number((countRow && countRow.total) || 0)
  };
}

if (require.main === module) {
  seedPartnerInvoices()
    .then(result => {
      console.log('✅ Seed de faturas B2B concluído no MySQL:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Erro ao executar seed B2B no MySQL:', err.message);
      process.exit(1);
    });
}

module.exports = { seedPartnerInvoices };
