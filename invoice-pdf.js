// =========================================================================
// INVOICE PDF GENERATOR - ALERTA VENCIMENTO B2B (PARCEIROS & REVENDEDORES)
// =========================================================================
// Modelo: Pacotes de Franquia Fixa B2B (Starter, Pro, Enterprise)
// Gera faturas em PDF-1.4 puro de alta fidelidade visual, sem dependências externas.
// Compatível com todos os navegadores, leitores de PDF e impressoras térmicas/A4.
// =========================================================================

function generateInvoicePdfBuffer(invoice, partner, stores = []) {
  const invoiceId = invoice.id || 'FAT-2026-11-001';
  const partnerName = partner.name || partner.nome || 'Parceiro PDV';
  const cnpj = partner.cnpj || '12.345.678/0001-90';
  const email = partner.email || 'financeiro@parceiro.com.br';
  const mesRef = invoice.mesReferencia || '11/2026';
  
  // Resolução dos dados do plano B2B
  const nomePlano = invoice.nome_plano || partner.nome_plano || (partner.plano && partner.plano.nome_plano) || 'Starter';
  const limiteLojas = parseInt(invoice.limite_lojas || partner.limite_lojas || (partner.plano && partner.plano.limite_lojas) || 50, 10);
  const valorMensal = parseFloat(invoice.valor_mensal || invoice.valorTotal || partner.valor_mensal || (partner.plano && partner.plano.valor_mensal) || 390.00);
  const valorTotal = valorMensal; // Franquia fixa mensal, sem multiplicação unitária
  const lojasCount = invoice.lojasCobradas !== undefined ? invoice.lojasCobradas : stores.length;
  const status = invoice.status || 'Pendente/Aberta';
  const vencimento = invoice.dataVencimento || '15/11/2026';

  const content = [];

  // 1. Barra Superior Colorida (Azul Escuro / Índigo B2B)
  content.push('0.1 0.15 0.35 rg');
  content.push('0 760 595 82 re f');

  // Título e Logo
  content.push('1 1 1 rg');
  content.push('BT');
  content.push('/F2 20 Tf');
  content.push('40 805 Td');
  content.push('(ALERTA VENCIMENTO B2B) Tj');
  content.push('/F1 10 Tf');
  content.push('0 -18 Td');
  content.push('(Plataforma de Monitoramento de Validade para Sistemas de PDV) Tj');
  content.push('ET');

  // Badge da Fatura no Topo Direito
  content.push('BT');
  content.push('/F2 14 Tf');
  content.push('400 805 Td');
  content.push('(FATURA DE SERVICOS) Tj');
  content.push('/F1 9 Tf');
  content.push('0 -16 Td');
  content.push('(No. ' + invoiceId + ') Tj');
  content.push('ET');

  // 2. Metadados da Fatura e do Parceiro
  content.push('0 0 0 rg');
  content.push('BT');
  content.push('/F2 11 Tf');
  content.push('40 730 Td');
  content.push('(DADOS DO CLIENTE / PARCEIRO PDV) Tj');
  content.push('/F1 10 Tf');
  content.push('0 -16 Td');
  content.push('(Empresa: ' + partnerName + ') Tj');
  content.push('0 -14 Td');
  content.push('(CNPJ: ' + cnpj + '   |   E-mail: ' + email + ') Tj');
  content.push('ET');

  content.push('BT');
  content.push('/F2 11 Tf');
  content.push('340 730 Td');
  content.push('(INFORMACOES DA COBRANCA) Tj');
  content.push('/F1 10 Tf');
  content.push('0 -16 Td');
  content.push('(Competencia: ' + mesRef + ') Tj');
  content.push('0 -14 Td');
  content.push('(Data de Vencimento: ' + vencimento + ') Tj');
  content.push('0 -14 Td');
  content.push('(Situacao: ' + status.toUpperCase() + ') Tj');
  content.push('ET');

  // Linha divisória
  content.push('0.8 0.8 0.85 RG');
  content.push('2 w');
  content.push('40 660 m 555 660 l S');

  // 3. Tabela de Itens Faturados
  // Header da Tabela
  content.push('0.15 0.22 0.42 rg');
  content.push('40 625 515 24 re f');

  content.push('1 1 1 rg');
  content.push('BT');
  content.push('/F2 10 Tf');
  content.push('50 633 Td');
  content.push('(ITEM / DESCRICAO DO SERVICO) Tj');
  content.push('ET');

  // Linha 1 da Tabela (Descrição com Plano, Limite e Valor Fixo)
  content.push('0.97 0.98 1.0 rg');
  content.push('40 590 515 32 re f');
  content.push('0.1 0.1 0.1 rg');
  content.push('BT');
  content.push('/F2 10 Tf');
  content.push('50 602 Td');
  // Exibição solicitada: "Mensalidade SaaS B2B - {nome_plano} (Limite de {limite_lojas} Lojas) - R$ {valor_mensal}"
  const descServico = `Mensalidade SaaS B2B - ${nomePlano} (Limite de ${limiteLojas} Lojas) - R$ ${valorMensal.toFixed(2)}`;
  content.push('(' + descServico + ') Tj');
  content.push('ET');

  // Linhas das Lojas vinculadas (detalhamento de uso da franquia)
  content.push('0 0 0 rg');
  content.push('BT');
  content.push('/F2 10 Tf');
  content.push('40 560 Td');
  content.push('(DETALHAMENTO DE USO DA FRANQUIA: ' + lojasCount + ' / ' + limiteLojas + ' TOKENS ATIVOS) Tj');
  content.push('ET');

  let curY = 540;
  const listStores = Array.isArray(stores) ? stores.slice(0, 8) : [];

  if (listStores.length > 0) {
    listStores.forEach((st, idx) => {
      content.push('BT');
      content.push('/F1 9 Tf');
      content.push('50 ' + curY + ' Td');
      content.push('(' + (idx + 1) + '. ' + (st.name || st.nome_loja || 'Farmacia') + '  -  CNPJ: ' + (st.cnpj || '') + '  [Tenant: ' + (st.id || '') + ']) Tj');
      content.push('ET');
      curY -= 15;
    });
  } else {
    content.push('BT');
    content.push('/F1 9 Tf');
    content.push('50 ' + curY + ' Td');
    content.push('(Nenhuma loja vinculada no periodo. Limite contratado disponivel: ' + limiteLojas + ' tenants.) Tj');
    content.push('ET');
    curY -= 15;
  }

  // 4. Caixa de Totalização em Destaque
  content.push('0.92 0.96 0.94 rg');
  content.push('340 370 215 48 re f');
  content.push('0.1 0.6 0.3 RG');
  content.push('1.5 w');
  content.push('340 370 215 48 re S');

  content.push('0.05 0.45 0.2 rg');
  content.push('BT');
  content.push('/F2 11 Tf');
  content.push('355 400 Td');
  content.push('(TOTAL A PAGAR (FRANQUIA FIXA):) Tj');
  content.push('/F2 18 Tf');
  content.push('0 -20 Td');
  content.push('(R$ ' + valorTotal.toFixed(2) + ') Tj');
  content.push('ET');

  // 5. Instruções de Pagamento (PIX)
  content.push('0.95 0.95 0.98 rg');
  content.push('40 270 515 80 re f');
  content.push('0.8 0.8 0.9 RG');
  content.push('1 w');
  content.push('40 270 515 80 re S');

  content.push('0.1 0.15 0.35 rg');
  content.push('BT');
  content.push('/F2 11 Tf');
  content.push('55 330 Td');
  content.push('(INSTRUCOES DE LIQUIDACAO VIA PIX AUTOMATICO) Tj');
  content.push('/F1 9.5 Tf');
  content.push('0 -16 Td');
  content.push('(Chave PIX Oficial: 38.032.274/0001-80  [CNPJ - Banco Inter S.A.]) Tj');
  content.push('0 -14 Td');
  content.push('(Favorecido: ALERTA VENCIMENTO B2B TECNOLOGIA E SERVICOS DIGITAIS LTDA) Tj');
  content.push('0 -14 Td');
  content.push('(Apos efetuar o PIX, envie o comprovante para: financeiro@alertavencimento.com.br) Tj');
  content.push('ET');

  // Rodapé Institucional
  content.push('0.5 0.5 0.5 rg');
  content.push('BT');
  content.push('/F1 8 Tf');
  content.push('150 180 Td');
  content.push('(Alerta Vencimento B2B - Sistema Integrado de Validade e Inteligencia de Estoque) Tj');
  content.push('0 -12 Td');
  content.push('(Suporte Tecnico / Integracao de APIs: dev@alertavencimento.com.br | WhatsApp: 11 99646-6498) Tj');
  content.push('ET');

  const stream = content.join('\n');
  const streamLen = Buffer.byteLength(stream, 'utf8');

  let out = '%PDF-1.4\n';
  const offsets = [];

  // 1: Catalog
  offsets.push(Buffer.byteLength(out, 'utf8'));
  out += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';

  // 2: Pages
  offsets.push(Buffer.byteLength(out, 'utf8'));
  out += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';

  // 3: Page
  offsets.push(Buffer.byteLength(out, 'utf8'));
  out += '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n';

  // 4: Content stream
  offsets.push(Buffer.byteLength(out, 'utf8'));
  out += '4 0 obj\n<< /Length ' + streamLen + ' >>\nstream\n' + stream + '\nendstream\nendobj\n';

  // 5: Font Helvetica
  offsets.push(Buffer.byteLength(out, 'utf8'));
  out += '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

  // 6: Font Helvetica-Bold
  offsets.push(Buffer.byteLength(out, 'utf8'));
  out += '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n';

  // xref
  const xrefOffset = Buffer.byteLength(out, 'utf8');
  out += 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 0; i < 6; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += 'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF';

  return Buffer.from(out, 'utf8');
}

module.exports = { generateInvoicePdfBuffer };
