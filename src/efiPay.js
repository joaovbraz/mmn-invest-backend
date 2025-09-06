// src/efiPay.js (Versão Otimizada com Cache de Token)
// Integração Efí PIX via HTTP/2 + mTLS (P12)

import fs from 'fs';
import path from 'path';
import http2 from 'http2';

// --- INÍCIO DA SEÇÃO DE CONFIGURAÇÃO ---

const {
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_CERTIFICATE_PATH,
  EFI_CERTIFICATE_BASE64,
  EFI_CERTIFICATE_PASSWORD,
  EFI_SANDBOX,
  CHAVE_PIX,
} = process.env;

// Validações de ambiente
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

// --- CARREGAMENTO DO CERTIFICADO ---

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

// --- HELPER DE REQUISIÇÃO HTTP/2 ---

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

// ===================== OAUTH COM CACHE =====================

let cachedToken = {
  token: null,
  expiresAt: 0,
};

async function getAccessToken() {
  if (cachedToken.token && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({ grant_type: 'client_credentials' }).toString();
  
  try {
    const res = await h2Request({
      method: 'POST',
      path: '/oauth/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'authorization': basicAuthHeader(EFI_CLIENT_ID, EFI_CLIENT_SECRET),
      },
      body,
      label: 'POST /oauth/token',
    });

    const tokenData = res.data;
    if (!tokenData?.access_token) {
      throw new Error('[EFI] Resposta de OAuth sem access_token');
    }
    
    const expiresInMs = (tokenData.expires_in - 10) * 1000;
    cachedToken = {
      token: tokenData.access_token,
      expiresAt: Date.now() + expiresInMs,
    };
    
    return cachedToken.token;

  } catch (err) {
    console.error('[EFI] Falha no OAuth (HTTP/2). Status/Payload:', { status: err?.status, data: err?.data });
    cachedToken = { token: null, expiresAt: 0 };
    throw new Error('Falha na autenticação com o provedor de pagamento.');
  }
}

export async function __debugOAuth() {
  return getAccessToken();
}

// ===================== API PIX =====================

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
        'authorization': `Bearer ${token}`,
      },
      body: payload,
      label: 'PUT /v2/cob/{txid}',
    });
    return res.data;
  } catch (err) {
    console.error('--- ERRO AO CRIAR COBRANÇA (HTTP/2) NA EFÍ ---', { status: err?.status, data: err?.data });
    throw new Error('Falha ao criar a cobrança Pix.');
  }
}

export async function generateQrCode({ locId }) {
  const token = await getAccessToken();
  try {
    const res = await h2Request({
      method: 'GET',
      path: `/v2/loc/${locId}/qrcode`,
      headers: { 'authorization': `Bearer ${token}` },
      label: 'GET /v2/loc/{id}/qrcode',
    });
    return res.data;
  } catch (err) {
    console.error('--- ERRO AO GERAR QR CODE (HTTP/2) NA EFÍ ---', { status: err?.status, data: err?.data });
    throw new Error('Falha ao gerar o QR Code.');
  }
}

export async function setWebhookForKey({ key, url }) {
  const token = await getAccessToken();
  const body = JSON.stringify({ webhookUrl: url });
  try {
    const res = await h2Request({
      method: 'PUT',
      path: `/v2/webhook/${encodeURIComponent(key)}`,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
      },
      body,
      label: 'PUT /v2/webhook/{chave}',
    });
    return res.data;
  } catch (err) {
    console.error('--- ERRO AO REGISTRAR WEBHOOK NA EFÍ ---', { status: err?.status, data: err?.data });
    throw new Error('Falha ao registrar webhook na Efí.');
  }
}

export async function getWebhookForKey({ key }) {
  const token = await getAccessToken();
  try {
    const res = await h2Request({
      method: 'GET',
      path: `/v2/webhook/${encodeURIComponent(key)}`,
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${token}`,
        'host': hostname,
      },
      label: 'GET /v2/webhook/{chave}',
    });
    return res.data;
  } catch (err) {
    if (err?.status === 404) return null;
    console.error('--- ERRO AO LER WEBHOOK NA EFÍ ---', { status: err?.status, data: err?.data });
    throw new Error('Falha ao consultar webhook na Efí.');
  }
}

export async function getChargeByTxid({ txid }) {
  const token = await getAccessToken();
  try {
    const res = await h2Request({
      method: 'GET',
      path: `/v2/cob/${encodeURIComponent(txid)}`,
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${token}`,
        'host': hostname,
      },
      label: 'GET /v2/cob/{txid}',
    });
    return res.data;
  } catch (err) {
    console.error('--- ERRO AO CONSULTAR COBRANÇA NA EFÍ ---', { status: err?.status, data: err?.data });
    throw new Error('Falha ao consultar cobrança na Efí.');
  }
}