const fs = require('fs');

const p = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/server.js';
let c = fs.readFileSync(p, 'utf8');

const oldCode = `    // Total de lojas ativas no sistema
    const totalStores = allStores.filter(s => s.status === 'ativo' || !s.status).length;
    // Faturamento MRR dos parceiros ativos
    const totalMrr = partnerList.filter(p => p.status !== 'bloqueado' && p.status !== 'inativo').reduce((sum, p) => sum + (p.faturaEstimada || 0), 0);`;

const newCode = `    // Total de lojas ativas no sistema
    const totalStores = allStores.filter(s => s.status === 'ativo' || !s.status).length;
    
    // Faturamento Mensal B2B: SUM(valor_mensal) dos Planos_B2B vinculados aos Parceiros ATIVOS
    const activePartners = partnerList.filter(p => {
      const st = String(p.status || 'ativo').toLowerCase().trim();
      return st === 'ativo' || st === 'active';
    });

    const totalMrr = activePartners.reduce((sum, p) => {
      const plan = getB2bPlan(p.plano_id || p.planId || 'plano_starter', db);
      const val = parseFloat(plan && plan.valor_mensal !== undefined ? plan.valor_mensal : (p.valor_mensal !== undefined ? p.valor_mensal : (p.faturaEstimada || 0))) || 0;
      return sum + val;
    }, 0);`;

if (c.includes(oldCode.replace(/\n/g, '\r\n'))) {
  c = c.replace(oldCode.replace(/\n/g, '\r\n'), newCode.replace(/\n/g, '\r\n'));
  fs.writeFileSync(p, c, 'utf8');
  console.log('[OK] server.js atualizado com SUM(valor_mensal) dos Planos B2B!');
} else if (c.includes(oldCode)) {
  c = c.replace(oldCode, newCode);
  fs.writeFileSync(p, c, 'utf8');
  console.log('[OK] server.js atualizado com SUM(valor_mensal) dos Planos B2B (LF)!');
} else {
  console.log('[WARN] Não encontrou trecho exato no server.js');
}
