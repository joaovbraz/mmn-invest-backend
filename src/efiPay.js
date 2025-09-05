// src/efiPay.js
import fs from 'fs';
import path from 'path';
import http2 from 'http2';

const {
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_CERTIFICATE_PATH,     // opção 1: caminho do .p12
  EFI_CERTIFICATE_BASE64,   // opção 2: conteúdo base64 do .p12
  EFI_CERTIFICATE_PASSWORD, // senha do .p12 (se houver)
  EFI_SANDBOX,
  CHAVE_PIX,
} = process.env;

if (
  !EFI_CLIENT_ID ||
  !EFI_CLIENT_SECRET ||
  !(EFI_CERTIFICATE_PATH || EFI_CERTIFICATE_BASE64) ||
  !CHAVE_PIX
) {
  throw new Error(
    'Faltam variáveis da Efí: EFI_CLIENT_ID, EFI_CLIENT_SECRET, (EFI_CERTIFICATE_PATH ou EFI_CERTIFICATE_BASE64) e CHAVE_PIX.'
  );
}

const BASE_URL =
  String(EFI_SANDBOX).toLowerCase() === 'true'
    ? 'https://api-pix-h.gerencianet.com.br'
    : 'https://api-pix.gerencianet.com.br';

const { hostname } = new URL(BASE_URL);

// Carrega o P12 como Buffer
function loadP12Buffer() {
  if (EFI_CERTIFICATE_BASE64 && EFI_CERTIFICATE_BASE64.trim()) {
    return Buffer.from(EFI_CERTIFICATE_BASE64.trim(), 'base64');
  }
  const resolved = path.resolve(EFI_CERTIFICATE_PATH);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Certificado .p12 não encontrado em: ${resolved}`);
  }
  return fs.readFileSync(resolved);
}
const pfx = loadP12Buffer();

// Faz uma requisição HTTP/2 com mTLS
function h2Request({ method, path: reqPath, headers = {}, body = null, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(BASE_URL, {
      // mTLS
      pfx,
      passphrase: EFI_CERTIFICATE_PASSWORD || undefined,
      rejectUnauthorized: true,
      // ALPN do http2 é negociado automaticamente
      servername: hostname,
    });

    const timer = setTimeout(() => {
      try { client.close(); } catch {}
      reject(new Error('Timeout na requisição HTTP/2.'));
    }, timeoutMs);

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    const req = client.request({
      ':method': method,
      ':path': reqPath,
      ':scheme': 'https',
      ':authority': hostname,
      // cabeçalhos “normais”
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    });

    let responseHeaders = {};
    let chunks = [];

    req.on('response', (hdrs) => {
      responseHeaders = hdrs;
    });

    req.on('data', (chunk) => chunks.push(chunk));

    req.on('end', () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const text = buf.toString('utf8');
      const status = Number(responseHeaders[':status'] || 0);
      client.close();

      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (status >= 200 && status < 300) {
        resolve({ status, headers: responseHeaders, data });
      } else {
        reject(Object.assign(new Error('HTTP/2 request failed'), { status, data }));
      }
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      try { client.close(); } catch {}
      reject(err);
    });

    if (body) req.write(body);
    req.end();
  });
}

function basicAuthHeader(id, secret) {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

// 1) OAuth via HTTP/2 + mTLS
async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'cob.read cob.write pix.read pix.write',
  }).toString();

  try {
    const { data } = await h2Request({
      method: 'POST',
      path: '/oauth/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'application/json',
        'authorization': basicAuthHeader(EFI_CLIENT_ID, EFI_CLIENT_SECRET),
        'content-length': Buffer.byteLength(body).toString(),
        'host': hostname,
      },
      body,
    });

    if (!data?.access_token) {
      throw new Error('Resposta de OAuth sem access_token.');
    }
    return data.access_token;
  } catch (err) {
    const status = err?.status;
    const payload = err?.data ?? err?.message;
    console.error('Falha no OAuth (HTTP/2) da Efí.', { status, payload });
    throw new Error('Falha na autenticação com o provedor de pagamento.');
  }
}

// 2) Cria cobrança imediata (PUT /v2/cob/{txid})
export async function createImmediateCharge({ txid, amount, cpf, name }) {
  const token = await getAccessToken();

  const payload = JSON.stringify({
    calendario: { expiracao: 3600 },
    devedor: { cpf: String(cpf).replace(/\D/g, ''), nome: name || 'Cliente' },
    valor: { original: Number(amount).toFixed(2) },
    chave: CHAVE_PIX,
    solicitacaoPagador: 'Depósito em plataforma',
  });

  try {
    const { data } = await h2Request({
      method: 'PUT',
      path: `/v2/cob/${encodeURIComponent(txid)}`,
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'authorization': `Bearer ${token}`,
        'content-length': Buffer.byteLength(payload).toString(),
        'host': hostname,
      },
      body: payload,
    });
    // deve conter .loc.id
    return data;
  } catch (err) {
    const status = err?.status;
    const payload = err?.data ?? err?.message;
    console.error('--- ERRO AO CRIAR COBRANÇA (HTTP/2) NA EFÍ ---');
    console.error({ status, payload });
    throw new Error('Falha ao criar a cobrança Pix.');
  }
}

// 3) Gera QR Code (GET /v2/loc/{id}/qrcode)
export async function generateQrCode({ locId }) {
  const token = await getAccessToken();
  try {
    const { data } = await h2Request({
      method: 'GET',
      path: `/v2/loc/${locId}/qrcode`,
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${token}`,
        'host': hostname,
      },
    });
    // { qrcode, imagemQrcode }
    return data;
  } catch (err) {
    const status = err?.status;
    const payload = err?.data ?? err?.message;
    console.error('--- ERRO AO GERAR QR CODE (HTTP/2) NA EFÍ ---');
    console.error({ status, payload });
    throw new Error('Falha ao gerar o QR Code.');
  }
}
