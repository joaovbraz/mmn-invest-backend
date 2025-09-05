// src/efiPay.js
// Integração Efí PIX via HTTP/2 + mTLS (P12)
// - Sem axios; usa http2 nativo do Node
// - Exports: createImmediateCharge, generateQrCode, __debugOAuth

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

// ==== validações básicas ====
if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET) {
  throw new Error('Variáveis ausentes: EFI_CLIENT_ID e/ou EFI_CLIENT_SECRET.');
}
if (!(EFI_CERTIFICATE_PATH || EFI_CERTIFICATE_BASE64)) {
  throw new Error('Informe o certificado via EFI_CERTIFICATE_PATH ou EFI_CERTIFICATE_BASE64.');
}
if (!CHAVE_PIX) {
  throw new Error('Variável ausente: CHAVE_PIX (sua chave Pix cadastrada na Efí).');
}

const BASE_URL =
  String(EFI_SANDBOX).toLowerCase() === 'true'
    ? 'https://api-pix-h.gerencianet.com.br'
    : 'https://api-pix.gerencianet.com.br';

const { hostname } = new URL(BASE_URL);

// ---- carrega o .p12 como Buffer
function loadP12Buffer() {
  if (EFI_CERTIFICATE_BASE64 && EFI_CERTIFICATE_BASE64.trim()) {
    return Buffer.from(EFI_CERTIFICATE_BASE64.trim(), 'base64');
  }
  const resolved = path.resolve(EFI_CERTIFICATE_PATH);
  if (!fs.existsSync(resolved)) {
    throw new Error(`[EFI] Certificado .p12 não encontrado em: ${resolved}`);
  }
  return fs.readFileSync(resolved);
}
const pfx = loadP12Buffer();

// ---- helper de request HTTP/2 com mTLS
function h2Request({ method, path: reqPath, headers = {}, body = null, timeoutMs = 20000, label = '' }) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(BASE_URL, {
      pfx,
      passphrase: EFI_CERTIFICATE_PASSWORD || undefined,
      rejectUnauthorized: true,
      servername: hostname,
    });

    const timer = setTimeout(() => {
      try { client.close(); } catch {}
      reject(new Error(`[EFI] Timeout na requisição HTTP/2 (${label})`));
    }, timeoutMs);

    client.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[EFI] Erro no client HTTP/2 (${label}):`, err?.message || err);
      reject(err);
    });

    const req = client.request({
      ':method': method,
      ':path': reqPath,
      ':scheme': 'https',
      ':authority': hostname,
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    });

    let responseHeaders = {};
    const chunks = [];

    req.on('response', (hdrs) => { responseHeaders = hdrs; });
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[EFI] Erro no stream HTTP/2 (${label}):`, err?.message || err);
      try { client.close(); } catch {}
      reject(err);
    });

    req.on('end', () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const text = buf.toString('utf8');
      const status = Number(responseHeaders[':status'] || 0);
      client.close();

      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      if (status >= 200 && status < 300) {
        resolve({ status, headers: responseHeaders, data });
      } else {
        const err = new Error(`[EFI] HTTP/2 falhou (${label})`);
        err.status = status;
        err.data = data;
        reject(err);
      }
    });

    if (body) req.write(body);
    req.end();
  });
}

function basicAuthHeader(id, secret) {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

// ===================== OAuth (HTTP/2 + mTLS) =====================
async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'cob.read cob.write pix.read pix.write',
  }).toString();

  try {
    const res = await h2Request({
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
      label: 'POST /oauth/token',
    });

    if (!res.data?.access_token) {
      throw new Error('[EFI] Resposta de OAuth sem access_token');
    }
    return res.data.access_token;
  } catch (err) {
    console.error('[EFI] Falha no OAuth (HTTP/2). Status/Payload:', { status: err?.status, data: err?.data });
    throw new Error('Falha na autenticação com o provedor de pagamento.');
  }
}

// ==== Export de debug para o /debug/efi-oauth ====
export async function __debugOAuth() {
  return getAccessToken();
}

// ===================== Cobrança imediata =====================
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
    const res = await h2Request({
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
      label: 'PUT /v2/cob/{txid}',
    });
    return res.data; // deve conter .loc.id
  } catch (err) {
    console.error('--- ERRO AO CRIAR COBRANÇA (HTTP/2) NA EFÍ ---', { status: err?.status, data: err?.data });
    throw new Error('Falha ao criar a cobrança Pix.');
  }
}

// ===================== QR Code =====================
export async function generateQrCode({ locId }) {
  const token = await getAccessToken();
  try {
    const res = await h2Request({
      method: 'GET',
      path: `/v2/loc/${locId}/qrcode`,
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${token}`,
        'host': hostname,
      },
      label: 'GET /v2/loc/{id}/qrcode',
    });
    return res.data; // { qrcode, imagemQrcode }
  } catch (err) {
    console.error('--- ERRO AO GERAR QR CODE (HTTP/2) NA EFÍ ---', { status: err?.status, data: err?.data });
    throw new Error('Falha ao gerar o QR Code.');
  }
}
