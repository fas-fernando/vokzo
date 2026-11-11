// =========================================================================
// INVOICE PDF GENERATOR - VOKZO B2B (ORDEM DE SERVIÇO & OVERAGE DINÂMICO)
// =========================================================================
// Gera faturas em PDF-1.4 puro com suporte multi-página e WinAnsiEncoding,
// sem dependências externas.
// =========================================================================

function formatBrl(value) {
  const num = Number(value || 0);
  return 'R$ ' + num.toFixed(2).replace('.', ',');
}

function escapePdfText(str) {
  return String(str || '')
    .replace(/[^\x20-\xFF]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function truncateText(str, maxLen) {
  const s = String(str || '').trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 3)) + '...';
}

function buildInvoicePdfFilename(mesReferencia) {
  const raw = String(mesReferencia || '').trim();
  let slug = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\//g, '_')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  if (!slug) {
    const now = new Date();
    const months = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
    slug = `${months[now.getMonth()]}_${now.getFullYear()}`;
  }
  return `fatura_vokzo_${slug}.pdf`;
}

function calculateOverageBilling(partner = {}, stores = [], overageFeeInput) {
  const limiteLojas = Math.max(
    parseInt(partner.limite_lojas || partner.limite_tokens || (partner.plano && partner.plano.limite_lojas) || 50, 10) || 0,
    0
  );
  const valorMensal = parseFloat(
    partner.valor_mensal !== undefined
      ? partner.valor_mensal
      : ((partner.plano && partner.plano.valor_mensal) || 390.00)
  ) || 0;

  const parsedFee = parseFloat(overageFeeInput !== undefined ? overageFeeInput : process.env.OVERAGE_FEE);
  const overageFee = (!isNaN(parsedFee) && parsedFee >= 0) ? parsedFee : 19.90;

  // Conta o TOTAL REAL de lojas ativas vinculadas ao parceiro (sem teto do plano)
  const orderedStores = (Array.isArray(stores) ? stores : []).filter(s => s && (s.status === 'ativo' || !s.status));
  const totalLojasAtivas = orderedStores.length;
  const excedentesQtd = Math.max(0, totalLojasAtivas - limiteLojas);
  const overageTotal = Number((excedentesQtd * overageFee).toFixed(2));
  const valorFinal = Number((valorMensal + overageTotal).toFixed(2));

  const detailedStores = orderedStores.map((st, idx) => {
    const isOverage = idx >= limiteLojas;
    return {
      index: idx + 1,
      tenantId: String(st.id || st.tenant_id || `TEN-${idx + 1}`),
      name: String(st.name || st.nome_loja || 'Loja Parceira'),
      cnpj: String(st.cnpj || ''),
      requisicoesMes: parseInt(st.requisicoesMes || 0, 10) || 0,
      isOverage,
      statusTag: isOverage ? 'Excedente (Cobrado)' : 'Incluído na Franquia'
    };
  });

  return {
    limiteLojas,
    valorMensal,
    overageFee,
    totalLojasAtivas,
    totalLojasUsando: totalLojasAtivas,
    excedentesQtd,
    overageTotal,
    valorFinal,
    detailedStores
  };
}

function generateInvoicePdfBuffer(invoice = {}, partner = {}, stores = [], options = {}) {
  const invoiceId = String(invoice.id || 'FAT-2026-11-001');
  const partnerId = String(partner.id || partner.partnerId || partner.parceiro_id || 'PARC-001');
  const partnerName = String(partner.name || partner.nome || 'Parceiro PDV');
  const cnpj = String(partner.cnpj || 'Não informado');
  const email = String(partner.email || 'financeiro@parceiro.com.br');
  const mesRef = String(invoice.mesReferencia || 'Novembro / 2026');
  const nowDate = new Date();
  const dataEmissao = String(
    invoice.dataEmissao ||
    `${String(nowDate.getDate()).padStart(2, '0')}/${String(nowDate.getMonth() + 1).padStart(2, '0')}/${nowDate.getFullYear()}`
  );
  const vencimento = String(invoice.dataVencimento || '15/11/2026');
  const statusFatura = String(invoice.status || 'Pendente/Aberta').toUpperCase();

  const nomePlano = String(invoice.nome_plano || partner.nome_plano || (partner.plano && partner.plano.nome_plano) || 'Starter');
  const resolvedOverageFee = options.overageFee !== undefined
    ? options.overageFee
    : (invoice.overageFee !== undefined ? invoice.overageFee : process.env.OVERAGE_FEE);

  const billing = calculateOverageBilling(
    {
      ...partner,
      limite_lojas: invoice.limite_lojas || partner.limite_lojas || partner.limite_tokens,
      valor_mensal: invoice.valor_mensal !== undefined ? invoice.valor_mensal : partner.valor_mensal
    },
    stores,
    resolvedOverageFee
  );

  const pageStreams = [];
  const p1 = [];

  // =======================================================================
  // 1. CABEÇALHO (LOGO VOKZO B2B, DATA DE EMISSÃO E ID DA FATURA)
  // =======================================================================
  p1.push('0.06 0.09 0.22 rg');
  p1.push('0 754 595 88 re f');

  // Marca gráfica / Logo VOKZO B2B
  p1.push('0.05 0.68 0.45 rg');
  p1.push('40 778 38 38 re f');
  p1.push('1 1 1 rg');
  p1.push('BT /F2 18 Tf 51 790 Td (V) Tj ET');

  p1.push('1 1 1 rg');
  p1.push('BT');
  p1.push('/F2 19 Tf');
  p1.push('88 801 Td');
  p1.push('(VOKZO B2B) Tj');
  p1.push('/F1 9 Tf');
  p1.push('0 -15 Td');
  p1.push('(Ordem de Servico & Faturamento de Franquia PDV) Tj');
  p1.push('ET');

  // Metadados da Fatura (Canto Superior Direito)
  p1.push('0.85 0.92 1.0 rg');
  p1.push('BT');
  p1.push('/F2 11 Tf');
  p1.push('382 806 Td');
  p1.push('(FATURA / ORDEM DE SERVICO) Tj');
  p1.push('/F1 9.5 Tf');
  p1.push('0 -15 Td');
  p1.push(`(ID da Fatura: ${escapePdfText(invoiceId)}) Tj`);
  p1.push('0 -13 Td');
  p1.push(`(Data de Emissao: ${escapePdfText(dataEmissao)}) Tj`);
  p1.push('ET');

  // =======================================================================
  // 2. DADOS DO PARCEIRO (NOME, CNPJ E PARTNER_ID)
  // =======================================================================
  p1.push('0.96 0.97 0.99 rg');
  p1.push('40 672 515 68 re f');
  p1.push('0.84 0.87 0.92 RG');
  p1.push('1 w');
  p1.push('40 672 515 68 re S');

  p1.push('0.12 0.16 0.28 rg');
  p1.push('BT');
  p1.push('/F2 10 Tf');
  p1.push('52 722 Td');
  p1.push('(DADOS DO PARCEIRO INTEGRADOR) Tj');
  p1.push('/F1 9.5 Tf');
  p1.push('0 -16 Td');
  p1.push(`(Nome / Razao Social: ${escapePdfText(truncateText(partnerName, 44))}) Tj`);
  p1.push('0 -14 Td');
  p1.push(`(CNPJ: ${escapePdfText(cnpj)}   |   Partner_ID: ${escapePdfText(partnerId)}) Tj`);
  p1.push('0 -13 Td');
  p1.push(`(E-mail Financeiro: ${escapePdfText(truncateText(email, 45))}) Tj`);
  p1.push('ET');

  p1.push('BT');
  p1.push('/F2 10 Tf');
  p1.push('365 722 Td');
  p1.push('(RESUMO DO CICLO) Tj');
  p1.push('/F1 9.5 Tf');
  p1.push('0 -16 Td');
  p1.push(`(Competencia: ${escapePdfText(mesRef)}) Tj`);
  p1.push('0 -14 Td');
  p1.push(`(Vencimento: ${escapePdfText(vencimento)}) Tj`);
  p1.push('0 -13 Td');
  p1.push(`(Situacao: ${escapePdfText(statusFatura)}) Tj`);
  p1.push('ET');

  // =======================================================================
  // 3. RESUMO DA COBRANÇA (TABELA 1)
  // =======================================================================
  p1.push('0.08 0.12 0.24 rg');
  p1.push('BT /F2 10.5 Tf 40 648 Td (TABELA 1 - RESUMO DA COBRANCA) Tj ET');

  // Cabeçalho Tabela 1
  p1.push('0.14 0.20 0.38 rg');
  p1.push('40 620 515 22 re f');
  p1.push('1 1 1 rg');
  p1.push('BT /F2 8.5 Tf 50 628 Td (DESCRICAO DO ITEM) Tj ET');
  p1.push('BT /F2 8.5 Tf 325 628 Td (QTD) Tj ET');
  p1.push('BT /F2 8.5 Tf 390 628 Td (VALOR UNIT.) Tj ET');
  p1.push('BT /F2 8.5 Tf 478 628 Td (SUBTOTAL) Tj ET');

  // Linha 1: Plano Base Contratado
  p1.push('0.98 0.99 1.0 rg');
  p1.push('40 594 515 26 re f');
  p1.push('0.85 0.88 0.93 RG 0.8 w 40 594 515 26 re S');
  p1.push('0.1 0.1 0.15 rg');
  p1.push(`BT /F2 9 Tf 50 604 Td (${escapePdfText(truncateText(`Plano Base: ${nomePlano} (Franquia ate ${billing.limiteLojas} lojas)`, 48))}) Tj ET`);
  p1.push('BT /F1 9 Tf 330 604 Td (1) Tj ET');
  p1.push(`BT /F1 9 Tf 390 604 Td (${escapePdfText(formatBrl(billing.valorMensal))}) Tj ET`);
  p1.push(`BT /F2 9 Tf 478 604 Td (${escapePdfText(formatBrl(billing.valorMensal))}) Tj ET`);

  // Linha 2: Lojas Excedentes * OVERAGE_FEE
  p1.push('0.99 0.97 0.94 rg');
  p1.push('40 568 515 26 re f');
  p1.push('0.85 0.88 0.93 RG 0.8 w 40 568 515 26 re S');
  p1.push('0.1 0.1 0.15 rg');
  p1.push(`BT /F1 9 Tf 50 578 Td (${escapePdfText(`Lojas Excedentes (Acima da franquia x OVERAGE_FEE)`)}) Tj ET`);
  p1.push(`BT /F2 9 Tf 330 578 Td (${billing.excedentesQtd}) Tj ET`);
  p1.push(`BT /F1 9 Tf 390 578 Td (${escapePdfText(formatBrl(billing.overageFee))}) Tj ET`);
  p1.push(`BT /F2 9 Tf 478 578 Td (${escapePdfText(formatBrl(billing.overageTotal))}) Tj ET`);

  // Linha Totalizador Final
  p1.push('0.91 0.97 0.94 rg');
  p1.push('40 536 515 32 re f');
  p1.push('0.05 0.58 0.38 RG 1.2 w 40 536 515 32 re S');
  p1.push('0.04 0.36 0.22 rg');
  p1.push(`BT /F2 10 Tf 50 548 Td (VALOR FINAL DA FATURA (PLANO BASE + EXCEDENTES):) Tj ET`);
  p1.push(`BT /F2 12 Tf 465 548 Td (${escapePdfText(formatBrl(billing.valorFinal))}) Tj ET`);

  // =======================================================================
  // 4. DETALHAMENTO DE LOJAS (TABELA 2) COM SUPORTE A MÚLTIPLAS PÁGINAS
  // =======================================================================
  function drawStoresTableHeader(buf, topY) {
    buf.push('0.08 0.12 0.24 rg');
    buf.push(`BT /F2 10.5 Tf 40 ${topY} Td (${escapePdfText(`TABELA 2 - DETALHAMENTO DE LOJAS (${billing.totalLojasUsando} ATIVAS / LIMITE ${billing.limiteLojas})`)}) Tj ET`);
    const headerY = topY - 26;
    buf.push('0.14 0.20 0.38 rg');
    buf.push(`40 ${headerY} 515 20 re f`);
    buf.push('1 1 1 rg');
    buf.push(`BT /F2 8 Tf 48 ${headerY + 6} Td (#) Tj ET`);
    buf.push(`BT /F2 8 Tf 72 ${headerY + 6} Td (TENANT_ID) Tj ET`);
    buf.push(`BT /F2 8 Tf 168 ${headerY + 6} Td (NOME DA LOJA) Tj ET`);
    buf.push(`BT /F2 8 Tf 352 ${headerY + 6} Td (REQS API) Tj ET`);
    buf.push(`BT /F2 8 Tf 425 ${headerY + 6} Td (ENQUADRAMENTO) Tj ET`);
    return headerY;
  }

  let curBuf = p1;
  let curY = drawStoresTableHeader(curBuf, 506);

  if (billing.detailedStores.length === 0) {
    curY -= 22;
    curBuf.push('0.98 0.98 0.99 rg');
    curBuf.push(`40 ${curY} 515 22 re f`);
    curBuf.push('0.88 0.90 0.94 RG 0.6 w 40 ' + curY + ' 515 22 re S');
    curBuf.push('0.35 0.4 0.48 rg');
    curBuf.push(`BT /F1 8.5 Tf 50 ${curY + 7} Td (Nenhuma loja utilizou a API neste ciclo. Limite disponivel na franquia: ${billing.limiteLojas} lojas.) Tj ET`);
  } else {
    billing.detailedStores.forEach((st, i) => {
      if (curY < 115) {
        // Rodapé da página atual antes de quebrar
        curBuf.push('0.5 0.54 0.6 rg');
        curBuf.push('BT /F1 8 Tf 40 42 Td (VOKZO B2B - Documento continua na proxima pagina...) Tj ET');
        pageStreams.push(curBuf.join('\n'));
        curBuf = [];
        // Cabeçalho compacto de continuação
        curBuf.push('0.06 0.09 0.22 rg 0 792 595 50 re f');
        curBuf.push('1 1 1 rg');
        curBuf.push(`BT /F2 12 Tf 40 812 Td (VOKZO B2B - Detalhamento de Lojas (Continuacao)) Tj ET`);
        curBuf.push(`BT /F1 8.5 Tf 415 812 Td (${escapePdfText(`Fatura: ${invoiceId}`)}) Tj ET`);
        curY = drawStoresTableHeader(curBuf, 764);
      }

      curY -= 20;
      const bgColor = st.isOverage
        ? '1.0 0.95 0.95'
        : (i % 2 === 0 ? '1.0 1.0 1.0' : '0.97 0.98 1.0');
      curBuf.push(`${bgColor} rg`);
      curBuf.push(`40 ${curY} 515 20 re f`);
      curBuf.push(`0.88 0.90 0.94 RG 0.5 w 40 ${curY} 515 20 re S`);

      curBuf.push('0.12 0.15 0.22 rg');
      curBuf.push(`BT /F1 8 Tf 48 ${curY + 6} Td (${st.index}) Tj ET`);
      curBuf.push(`BT /F1 8 Tf 72 ${curY + 6} Td (${escapePdfText(truncateText(st.tenantId, 16))}) Tj ET`);
      curBuf.push(`BT /F2 8 Tf 168 ${curY + 6} Td (${escapePdfText(truncateText(st.name, 30))}) Tj ET`);
      curBuf.push(`BT /F1 8 Tf 360 ${curY + 6} Td (${st.requisicoesMes}) Tj ET`);

      // Tag de Status na Franquia
      if (st.isOverage) {
        curBuf.push('0.78 0.12 0.18 rg');
      } else {
        curBuf.push('0.04 0.50 0.30 rg');
      }
      curBuf.push(`BT /F2 8 Tf 425 ${curY + 6} Td (${escapePdfText(st.statusTag)}) Tj ET`);
    });
  }

  // Rodapé institucional na última página
  const footerY = Math.min(curY - 34, 72);
  curBuf.push('0.85 0.87 0.92 RG 0.8 w 40 ' + (footerY + 14) + ' 515 ' + (footerY + 14) + ' m 555 ' + (footerY + 14) + ' l S');
  curBuf.push('0.42 0.46 0.54 rg');
  curBuf.push(`BT /F1 8 Tf 40 ${footerY} Td (${escapePdfText(`VOKZO B2B - Plataforma Oficial de Monitoramento de Validade | Fatura ${invoiceId} | Emitida em ${dataEmissao}`)}) Tj ET`);
  pageStreams.push(curBuf.join('\n'));

  // =======================================================================
  // 5. MONTAGEM DO BINÁRIO PDF-1.4 (MULTI-PÁGINA + WINANSIENCODING)
  // =======================================================================
  let out = '%PDF-1.4\n';
  const offsets = [];
  const totalPages = pageStreams.length;
  // IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font F1 (Helvetica + WinAnsiEncoding)
  // 4: Font F2 (Helvetica-Bold + WinAnsiEncoding)
  // 5..(4 + totalPages*2): Page obj & Content stream pairs
  const pageObjIds = [];
  for (let i = 0; i < totalPages; i++) {
    pageObjIds.push(5 + i * 2);
  }

  function addObj(id, bodyStr) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${bodyStr}\nendobj\n`;
  }

  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObj(2, `<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(' ')}] /Count ${totalPages} >>`);
  addObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  addObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  for (let i = 0; i < totalPages; i++) {
    const pageId = 5 + i * 2;
    const contentId = pageId + 1;
    const streamStr = pageStreams[i];
    const streamLen = Buffer.byteLength(streamStr, 'latin1');

    addObj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    );
    addObj(contentId, `<< /Length ${streamLen} >>\nstream\n${streamStr}\nendstream`);
  }

  const totalObjs = 5 + totalPages * 2;
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let id = 1; id < totalObjs; id++) {
    out += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(out, 'latin1');
}

module.exports = {
  generateInvoicePdfBuffer,
  calculateOverageBilling,
  buildInvoicePdfFilename
};
