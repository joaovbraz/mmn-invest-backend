// src/efiPay.js
import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';

const {
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_CERTIFICATE_PATH,     // caminho do .p12 (opção 1)
  EFI_CERTIFICATE_BASE64,   // conteúdo base64 do .p12 (opção 2)
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

// Hosts oficiais
const BASE_URL =
  String(EFI_SANDBOX).toLowerCase() === 'true'
    ? 'https://api-pix-h.gerencianet.com.br'
    : 'https://api-pix.gerencianet.com.br';

// Carrega P12 como Buffer (arquivo OU base64)
function loadP12Buffer() {
  if (EFI_CERTIFICATE_BASE64 && EFI_CERTIFICATE_BASE64.trim()) {
    try {
      return Buffer.from(EFI_CERTIFICATE_BASE64.trim(), 'base64');
    } catch (e) {
      console.error('Falha ao decodificar EFI_CERTIFICATE_BASE64. Verifique se é Base64 válido.');
      throw e;
    }
  }
  const resolved = path.resolve(EFI_CERTIFICATE_PATH);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Certificado .p12 não encontrado em: ${resolved}`);
  }
  return fs.readFileSync(resolved);
}
const pfx = loadP12Buffer();

// Força HTTP/1.1 na camada TLS (ALPN) + mTLS com P12
function makeAgent() {
  return new https.Agent({
    pfx,
    passphrase: EFI_CERTIFICATE_PASSWORD || undefined,
    rejectUnauthorized: true,
    keepAlive: true,
    // 👇 Evita negociação HTTP/2 que causa "header too long" em alguns ambientes
    ALPNProtocols: ['http/1.1'],
    // Garante SNI correto
    servername: new URL(BASE_URL).hostname,
  });
}

function basicAuthHeader(id, secret) {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

// 1) OAuth com mTLS (HTTP/1.1 forçado)
async function getAccessToken() {
  const url = `${BASE_URL}/oauth/token`;
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    Authorization: basicAuthHeader(EFI_CLIENT_ID, EFI_CLIENT_SECRET),
    Host: new URL(BASE_URL).hostname,
  };
  const body =
    'grant_type=client_credentials&scope=' +
    encodeURIComponent('cob.read cob.write pix.read pix.write');

  try {
    const { data } = await axios.post(url, body, {
      httpsAgent: makeAgent(),
      headers,
      timeout: 20000,
      // impede seguir redirects "estranhos"
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 300,
      decompress: true,
    });
    if (!data?.access_token) throw new Error('Resposta de OAuth sem access_token.');
    return data.access_token;
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data ?? err?.message;
    console.error('Falha no OAuth da Efí.', { status, payload });
    throw new Error('Falha na autenticação com o provedor de pagamento.');
  }
}

// 2) Cria cobrança imediata Pix (usando PUT com txid explícito)
export async function createImmediateCharge({ txid, amount, cpf, name }) {
  const token = await getAccessToken();

  const payload = {
    calendario: { expiracao: 3600 },
    devedor: { cpf: String(cpf).replace(/\D/g, ''), nome: name || 'Cliente' },
    valor: { original: Number(amount).toFixed(2) }, // "0.00"
    chave: CHAVE_PIX,
    solicitacaoPagador: 'Depósito em plataforma',
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Host: new URL(BASE_URL).hostname,
  };

  try {
    // A especificação da Efí aceita POST /v2/cob (sem txid) ou PUT /v2/cob/{txid}.
    // Aqui uso PUT para garantir idempotência com o txid gerado por nós.
    const { data } = await axios.put(`${BASE_URL}/v2/cob/${encodeURIComponent(txid)}`, payload, {
      httpsAgent: makeAgent(),
      headers,
      timeout: 20000,
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 300,
      decompress: true,
    });
    return data; // deve conter .loc.id
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data ?? err?.message;
    console.error('--- ERRO AO CRIAR COBRANÇA NA EFÍ ---');
    console.error({ status, payload });
    throw new Error('Falha ao criar a cobrança Pix.');
  }
}

// 3) Gera QR Code do loc.id
export async function generateQrCode({ locId }) {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    Host: new URL(BASE_URL).hostname,
  };

  try {
    const { data } = await axios.get(`${BASE_URL}/v2/loc/${locId}/qrcode`, {
      httpsAgent: makeAgent(),
      headers,
      timeout: 20000,
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 300,
      decompress: true,
    });
    // { qrcode, imagemQrcode (data:image/png;base64,...) }
    return data;
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data ?? err?.message;
    console.error('--- ERRO AO GERAR QR CODE NA EFÍ ---');
    console.error({ status, payload });
    throw new Error('Falha ao gerar o QR Code.');
  }
}
