const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 3000;
const PUBLIC_DIR = __dirname;
const DB_FILE = path.join(PUBLIC_DIR, 'database.json');

// Inicializa database.json se não existir
if (!fs.existsSync(DB_FILE)) {
  const initialDb = {
    merchants: {
      "11987654321": {
        "phone": "11987654321",
        "pin": "1234",
        "name": "Mercadinho Silva",
        "plano": "free",
        "createdAt": new Date().toISOString()
      }
    },
    products: [],
    globalSettings: {
      systemName: "Alerta Vencimento",
      systemLogo: "",
      supportPhone: "11996466498",
      retentionDays: 90,
      pixKey: "38032274880",
      pixAmount: "49.90",
      pixAmountAnnual: "199.00",
      toleranceDays: 3,
      pixName: "ALERTA VENCIMENTO",
      pixCity: "SAO PAULO",
      freeLimit: 30,
      systemStatus: "online",
      trialDays: 14,
      alertRedDays: 7,
      alertYellowDays: 30,
      tplBilling: "Olá, {nome_loja}! Seu período de teste no Alerta Vencimento expirou. Para continuar utilizando sem limites, renove por apenas R$ {valor} via Chave PIX: {chave_pix}. Enviamos o comprovante por aqui!",
      tplExpiry: "🚨 *ALERTA DE VENCIMENTO*\nO item *{nome_produto}* está a *{dias_vencer} dias* do vencimento. Acelere a saída para evitar prejuízos!"
    },
    adminCredentials: {
      phone: "11996466498",
      pin: "4546",
      name: "Administrador Master"
    }
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf8');
}

function readDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('❌ Erro ao ler database.json:', e.message);
  }
  return { merchants: {}, products: [], globalSettings: {}, adminCredentials: { phone: "11996466498", pin: "4546" } };
}


function applyDataRetention(db) {
  const retentionDays = parseInt((db.globalSettings && db.globalSettings.retentionDays) || 90, 10);
  if (!Array.isArray(db.products) || retentionDays <= 0) return 0;
  
  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const initialCount = db.products.length;

  db.products = db.products.filter(p => {
    if (p.status !== 'baixado' && p.status !== 'resolvido' && p.status !== 'descartado') {
      return true;
    }
    const recordTime = p.resolvedAt ? new Date(p.resolvedAt).getTime() : 
                      (p.expiry ? new Date(p.expiry).getTime() : (typeof p.id === 'number' && p.id > 1000000000 ? p.id : 0));
    if (!recordTime) return false;
    return (now - recordTime) < maxAgeMs;
  });

  const removed = initialCount - db.products.length;
  if (removed > 0) {
    console.log(`🧹 [DATA RETENTION] ${removed} produto(s) antigo(s) resolvido(s) (> ${retentionDays} dias) purgado(s) do banco.`);
    writeDatabase(db);
  }
  return removed;
}

function writeDatabase(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('❌ Erro ao escrever em database.json:', e.message);
    return false;
  }
}

function cleanDigits(str) {
  return ('' + (str || '')).replace(/\D/g, '');
}

function getLocalIpAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function handleApiRequest(req, res, pathname) {
      // 1c. POST /api/cleanup-retention - Purga dados antigos de acordo com a política de retenção
  if (pathname === '/api/cleanup-retention' && req.method === 'POST') {
    const db = readDatabase();
    const removed = applyDataRetention(db);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, removed }));
    return true;
  }

  // 1b. GET /api/backup - Download do snapshot completo do banco de dados
  if ((pathname === '/api/backup' || pathname === '/api/backup.json') && req.method === 'GET') {
    const db = readDatabase();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `alerta_vencimento_backup_${dateStr}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(JSON.stringify(db, null, 2));
    return true;
  }

  // 1. GET /api/state - Retorna todo o banco atualizado (sem cache)
  if (pathname === '/api/state' && req.method === 'GET') {
    const db = readDatabase();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(JSON.stringify(db));
    return true;
  }

  // 2. POST /api/login - Validação de login centralizada no servidor
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { phone, pin } = JSON.parse(body || '{}');
        const clean = cleanDigits(phone);
        const cleanPin = (pin || '').trim();

        const db = readDatabase();
        const adminPhone = cleanDigits((db.adminCredentials && db.adminCredentials.phone) || '11996466498');
        const adminPin = ((db.adminCredentials && db.adminCredentials.pin) || '4546').trim();

        // Verifica Administrador Master
        if (clean === adminPhone && cleanPin === adminPin) {
          console.log(`🛡️ [LOGIN ADMIN]: Acesso Master autenticado (${clean})`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            user: {
              phone: adminPhone,
              name: (db.adminCredentials && db.adminCredentials.name) || 'Administrador Master',
              role: 'admin',
              plano: 'master'
            }
          }));
          return;
        }

        // Verifica Lojista
        if (db.merchants && db.merchants[clean]) {
          const m = db.merchants[clean];
          if (m.pin === cleanPin) {
            console.log(`🔑 [LOGIN LOJISTA OK]: ${m.name} (${clean}) autenticado com sucesso!`);

            const isPro = (m.plano === 'premium');
            let isBlocked = false;
            let isTolerance = false;
            let daysRemaining = 0;
            let toleranceRemaining = 0;

            if (!isPro) {
              const createdDate = new Date(m.createdAt || '2026-11-05');
              const now = new Date();
              const trialDaysConfig = parseInt((db.globalSettings && db.globalSettings.trialDays) || 14, 10);
              const toleranceDaysConfig = parseInt((db.globalSettings && db.globalSettings.toleranceDays) || 3, 10);
              const trialDurationMs = trialDaysConfig * 24 * 60 * 60 * 1000;
              const expiryDate = new Date(createdDate.getTime() + trialDurationMs);
              const diffMs = expiryDate.getTime() - now.getTime();
              const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

              if (diffDays > 0) {
                daysRemaining = diffDays;
              } else {
                const overdueDays = Math.abs(diffDays);
                toleranceRemaining = toleranceDaysConfig - overdueDays;
                if (toleranceRemaining >= 0) {
                  isTolerance = true;
                } else {
                  isBlocked = true;
                }
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: true,
              user: {
                phone: clean,
                name: m.name || 'Lojista',
                role: 'merchant',
                plano: m.plano || 'free',
                isBlocked: isBlocked,
                isTolerance: isTolerance,
                toleranceRemaining: toleranceRemaining,
                daysRemaining: daysRemaining
              }
            }));
            return;
          } else {
            console.log(`⚠️ [LOGIN RECUSADO]: PIN incorreto para ${m.name} (${clean})`);
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: false,
              error: 'PIN de 4 dígitos incorreto para este WhatsApp. Tente novamente.'
            }));
            return;
          }
        }

        console.log(`❌ [LOGIN RECUSADO]: WhatsApp ${clean} não encontrado no banco de dados.`);
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: 'Número de WhatsApp não cadastrado no sistema. Solicite o cadastro ao Administrador.'
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Dados de login inválidos' }));
      }
    });
    return true;
  }

  // 3. POST /api/register-merchant - Cadastro direto de lojista no banco do servidor
  if (pathname === '/api/register-merchant' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { name, phone, pin, plano } = JSON.parse(body || '{}');
        const clean = cleanDigits(phone);
        const cleanPin = (pin || '').trim();

        if (!name || clean.length < 10 || cleanPin.length !== 4) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Parâmetros incompletos' }));
          return;
        }

        const db = readDatabase();
        if (!db.merchants) db.merchants = {};

        const isUpdate = !!db.merchants[clean];
        db.merchants[clean] = {
          phone: clean,
          name: name.trim(),
          pin: cleanPin,
          plano: plano || 'free',
          createdAt: db.merchants[clean] ? db.merchants[clean].createdAt : new Date().toISOString()
        };

        writeDatabase(db);
        console.log(`🟢 [BANCO DE DADOS] ${isUpdate ? 'Atualizado' : 'Novo'} Lojista cadastrado: ${name} (${clean}) | PIN: ${cleanPin} | Plano: ${plano || 'free'}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, merchant: db.merchants[clean] }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Erro ao processar cadastro' }));
      }
    });
    return true;
  }

  // 4. POST /api/state - Sincronização inteligente com merge
  if (pathname === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const db = readDatabase();

        if (parsed.merchants && typeof parsed.merchants === 'object') {
          if (!db.merchants) db.merchants = {};
          Object.assign(db.merchants, parsed.merchants);
        }

        if (Array.isArray(parsed.products)) {
          if (!Array.isArray(db.products)) db.products = [];
          const prodMap = new Map();
          db.products.forEach(p => prodMap.set(p.id, p));
          parsed.products.forEach(p => prodMap.set(p.id, p));
          db.products = Array.from(prodMap.values());
        }

        if (parsed.globalSettings) {
          db.globalSettings = Object.assign(db.globalSettings || {}, parsed.globalSettings);
        }

        writeDatabase(db);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return true;
  }

  return false;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, *');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (handleApiRequest(req, res, pathname)) {
    return;
  }

  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, reqPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso Negado');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (errIndex, dataIndex) => {
        if (errIndex) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Arquivo index.html não encontrado.');
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          res.end(dataIndex);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Erro interno no servidor.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': (ext === '.html') ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log('====================================================================');
  console.log('   🚀 SERVIDOR MULTI-DISPOSITIVO PRONTO NA PORTA ' + PORT);
  console.log('   💾 BANCO DE DADOS SINCRONIZADO: database.json');
  console.log('   💻 Local:  http://localhost:' + PORT);
  console.log('   📱 Wi-Fi:  http://' + localIp + ':' + PORT);
  console.log('====================================================================');
  console.log('   🌐 Conectando túnel público para acesso externo...');
  console.log('--------------------------------------------------------------------');

  const isWin = process.platform === 'win32';
  const npxCmd = isWin ? 'npx.cmd' : 'npx';
  
  const tunnel = spawn(npxCmd, ['--yes', 'localtunnel', '--port', PORT.toString()], {
    shell: true
  });

  let urlDetected = false;

  tunnel.stdout.on('data', (data) => {
    const output = data.toString();
    const match = output.match(/https:\/\/[^\s]+/i);
    if (match && !urlDetected) {
      urlDetected = true;
      const publicUrl = match[0].trim();
      console.log('');
      console.log('====================================================================');
      console.log('   🎉 LINK EXTERNO GERADO COM SUCESSO!');
      console.log('====================================================================');
      console.log('');
      console.log('   👉 LINK PÚBLICO:  ' + publicUrl);
      console.log('');
      console.log('   Envie este link para qualquer pessoa acessar do celular ou PC!');
      console.log('   (Dica: Se a página solicitar "Tunnel Password", informe seu IP público)');
      console.log('====================================================================');
      console.log('   Pressione Ctrl+C para encerrar o link e o servidor.');
      console.log('');
    } else {
      process.stdout.write(output);
    }
  });

  tunnel.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  tunnel.on('close', (code) => {
    console.log(`\nTúnel encerrado (código ${code}).`);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\nEncerrando servidor e túnel...');
    tunnel.kill();
    server.close(() => {
      process.exit(0);
    });
  });
});
