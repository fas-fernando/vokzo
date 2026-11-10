const fs = require('fs');

const serverPath = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/server.js';
let code = fs.readFileSync(serverPath, 'utf8');

const targetRouteRegex = /if\s*\(\s*pathname\s*===\s*'\/api\/payments\/create-pix'[\s\S]*?return true;\s*\}/;

const newControllerCode = `if (pathname === '/api/payments/create-pix' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { amount, description, type, phone, partnerId, planId, invoiceId, payerEmail, payerName } = payload;
        const numAmount = parseFloat(amount || 0);

        if (numAmount <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Valor da cobrança PIX deve ser maior que zero.' }));
          return;
        }

        const db = readDatabase();
        if (!db.payments) db.payments = {};
        const globalSettings = db.globalSettings || {};

        // 1. Obtém dinamicamente o Access Token Oficial configurado (Produção ou Sandbox)
        const activeMp = getActiveMpCredentials(globalSettings);
        const mpToken = (activeMp && activeMp.accessToken ? activeMp.accessToken.trim() : '');

        // Validação rigorosa: Não prossegue com gerador estático local se não houver credenciais
        if (!mpToken || (!mpToken.startsWith('APP_USR-') && !mpToken.startsWith('TEST-'))) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            error: 'Access Token do Mercado Pago não configurado. Acesse o Painel Master > Configurações e insira seu Token oficial (APP_USR-... ou TEST-...) para gerar cobranças PIX dinâmicas registradas no Banco Central.'
          }));
          return;
        }

        const cleanPhone = cleanDigits(phone || '');
        const paymentInternalId = \`mp_\${Date.now()}_\${Math.random().toString(36).substring(2, 7)}\`;
        const descText = (description || 'Assinatura Alerta Vencimento').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').substring(0, 50);

        // 2. Extrai dados do pagador dinamicamente do lojista autenticado / banco de dados
        let merchantRecord = null;
        if (cleanPhone && db.merchants && db.merchants[cleanPhone]) {
          merchantRecord = db.merchants[cleanPhone];
        }

        let email = (payerEmail || (merchantRecord && merchantRecord.email) || '').trim();
        if (!email || !email.includes('@')) {
          email = cleanPhone ? \`loja_\${cleanPhone}@alertavencimento.com.br\` : 'financeiro@alertavencimento.com.br';
        }

        const firstName = (payerName || (merchantRecord && merchantRecord.name) || 'Lojista').trim().split(' ')[0] || 'Cliente';

        // 3. Monta URL de Notificação para Webhook oficial
        const hostHeader = req.headers['host'] || 'localhost:3000';
        const forwardedProto = req.headers['x-forwarded-proto'];
        const isHttps = (forwardedProto === 'https') || (req.connection && req.connection.encrypted) || (hostHeader.includes('.loca.lt') || hostHeader.includes('.ngrok') || hostHeader.includes('.pagekite') || hostHeader.includes('.com') || hostHeader.includes('.br'));
        const webhookUrl = isHttps ? \`https://\${hostHeader}/api/webhooks/mercadopago\` : '';

        // 4. Constrói o Payload JSON Oficial exigido pela API v1/payments do Mercado Pago
        const mpPayload = {
          transaction_amount: parseFloat(numAmount.toFixed(2)),
          description: descText,
          payment_method_id: 'pix',
          payer: {
            email: email,
            first_name: firstName
          },
          metadata: {
            paymentId: paymentInternalId,
            type: type || 'merchant_pro_monthly',
            phone: cleanPhone,
            partnerId: partnerId || '',
            planId: planId || '',
            invoiceId: invoiceId || '',
            environment: activeMp.environment
          },
          ...(webhookUrl && webhookUrl.startsWith('https://') && !hostHeader.includes('localhost') && !hostHeader.includes('127.0.0.1') ? { notification_url: webhookUrl } : {})
        };

        console.log(\`⚡ [MERCADO PAGO PIX]: Enviando requisição oficial para https://api.mercadopago.com/v1/payments (Ambiente: \${activeMp.environment.toUpperCase()}, Valor: R$ \${numAmount.toFixed(2)}, Payer: \${email})\`);

        // 5. Executa a Requisição POST Real para a API Oficial do Mercado Pago
        const mpResult = await callMercadoPagoApi('/v1/payments', 'POST', mpToken, mpPayload);

        // 6. Trata o retorno oficial do Gateway
        if (mpResult.status === 201 && mpResult.data && mpResult.data.point_of_interaction) {
          const mpData = mpResult.data;
          const realMpId = String(mpData.id);
          const txData = mpData.point_of_interaction.transaction_data || {};
          const qrCodeDynamic = txData.qr_code || '';
          const qrCodeBase64 = txData.qr_code_base64 || '';
          const ticketUrl = txData.ticket_url || '';

          if (!qrCodeDynamic) {
            throw new Error('A API do Mercado Pago não retornou o código PIX Copia e Cola na transação.');
          }

          // Salva no banco de dados atrelado ao lojista com o ID oficial para o Webhook
          const paymentRecord = {
            id: realMpId,
            internalId: paymentInternalId,
            gateway: 'mercadopago',
            environment: activeMp.environment,
            method: 'pix',
            amount: numAmount,
            description: descText,
            type: type || 'merchant_pro_monthly',
            phone: cleanPhone,
            partnerId: partnerId || '',
            planId: planId || '',
            invoiceId: invoiceId || '',
            status: mpData.status || 'pending',
            statusDetail: mpData.status_detail || 'pending_waiting_transfer',
            qr_code: qrCodeDynamic,
            qr_code_base64: qrCodeBase64,
            ticket_url: ticketUrl,
            payerEmail: email,
            payerName: firstName,
            createdAt: new Date().toISOString()
          };

          db.payments[realMpId] = paymentRecord;
          if (paymentInternalId !== realMpId) db.payments[paymentInternalId] = paymentRecord;
          writeDatabase(db);

          console.log(\`✅ [MERCADO PAGO PIX 201]: Transação registrada com sucesso! ID: \${realMpId} | Status: \${paymentRecord.status}\`);

          // Envia estritamente as informações oficiais retornadas pela API para o Frontend renderizar
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            paymentId: realMpId,
            status: paymentRecord.status,
            amount: numAmount,
            qr_code: qrCodeDynamic,
            qr_code_base64: qrCodeBase64,
            ticket_url: ticketUrl,
            description: descText,
            environment: activeMp.environment,
            isLiveToken: activeMp.accessToken.startsWith('APP_USR-')
          }));
          return;
        }

        // Caso a API do Mercado Pago recuse ou retorne erro (ex: token inválido, email do pagador idêntico ao recebedor, etc.)
        const errorDetail = (mpResult.data && (mpResult.data.message || (mpResult.data.cause && mpResult.data.cause[0] && mpResult.data.cause[0].description))) || 'Falha ao registrar cobrança no gateway Mercado Pago.';
        console.error('❌ [MERCADO PAGO ERRO HTTP ' + mpResult.status + ']:', JSON.stringify(mpResult.data));

        res.writeHead(mpResult.status && mpResult.status >= 400 && mpResult.status < 600 ? mpResult.status : 502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: \`Mercado Pago: \${errorDetail}\`,
          statusCode: mpResult.status,
          details: mpResult.data
        }));
      } catch (err) {
        console.error('❌ Erro no Controller de Pagamento PIX:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: \`Erro ao processar cobrança via Mercado Pago: \${err.message}\`
        }));
      }
    });
    return true;
  }`;

if (targetRouteRegex.test(code)) {
  code = code.replace(targetRouteRegex, newControllerCode);
  fs.writeFileSync(serverPath, code, 'utf8');
  console.log('✅ Controller de Pagamento PIX refatorado com sucesso no server.js!');
} else {
  console.error('❌ Regex da rota não encontrada no server.js');
}
