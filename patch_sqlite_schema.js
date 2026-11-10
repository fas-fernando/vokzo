const fs = require('fs');

const p = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/sqlite-partner-schema.sql';
let c = fs.readFileSync(p, 'utf8');

const queryComment = `
-- =========================================================================
-- QUERY SQL B2B: FATURAMENTO MENSAL TOTAL (SUM DO VALOR_MENSAL DOS PLANOS)
-- Modelo: Soma da franquia mensal dos parceiros homologados e ativos
-- =========================================================================
-- SELECT 
--     COALESCE(SUM(pb.valor_mensal), 0) AS faturamento_mensal_b2b
-- FROM parceiros p
-- INNER JOIN planos_b2b pb ON p.plano_id = pb.id
-- WHERE LOWER(p.status) = 'ativo';
-- =========================================================================
`;

if (!c.includes('faturamento_mensal_b2b')) {
  c = c + '\n' + queryComment;
  fs.writeFileSync(p, c, 'utf8');
  console.log('[OK] sqlite-partner-schema.sql atualizado com query de faturamento!');
}
