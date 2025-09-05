// src/efiPay.js
import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';

const {
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_CERTIFICATE_PATH,
  EFI_CERTIFICATE_BASE64,
  EFI_CERTIFICATE_PASSWORD,
  EFI_SANDBOX,
  CHAVE_PIX,
} = process.env;

if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET || !(EFI_CERTIFICATE_PATH || EFI_CERTIFICATE_BASE64) || !CHAVE_PIX) {
  throw new Error(
    'Faltam variáveis da Efí: EFI_CLIENT_ID, EFI_CLIENT_SECRET, (EFI_CERTIFICATE_PATH ou EFI_CERTIFICATE_BASE64) e CHAVE_PIX.'
  );
}

const BASE_URL =
  String(EFI_SANDBOX).toLowerCase() === 'true'
    ? 'https://api-pix-h.gerencianet.com.br'
    : 'https://api-pix.gerencianet.com.br';

// Carrega o certificado P12 (arquivo ou Base64) em Buffer
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
    throw new Error(`Certificado não encontrado em: ${resolved}`);
  }
  return fs.readFileSync(resolved);
}

const pfx = loadP12Buffer();

// Agent TLS com P12
const httpsAgent = new https.Agent({
  pfx,
  passphrase: EFI_CERTIFICATE_PASSWORD || undefined, // se seu .p12 tiver senha
  rejectUnauthorized: true,
});

// Helpers
function basicAuthHeader(id, secret) {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

// 1) OAuth — pega o access_token usando mTLS + Basic
async function getAccessToken() {
  const url = `${BASE_URL}/oauth/token`;
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: basicAuthHeader(EFI_CLIENT_ID, EFI_CLIENT_SECRET),
  };
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'cob.read cob.write pix.read pix.write',
  }).toString();

  try {
    const { data } = await axios.post(url, body, { httpsAgent, headers, timeout: 20000 });
    if (!data?.access_token) {
      throw new Error('Resposta de OAuth sem access_token.');
    }
    return data.access_token;
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data;
    console.error('Falha no OAuth da Efí.', { status, payload: payload ?? err?.message });
    throw new Error('Falha na autenticação com o provedor de pagamento.');
  }
}

// 2) Cria cobrança imediata Pix
export async function createImmediateCharge({ txid, amount, cpf, name }) {
  const token = await getAccessToken();

  const payload = {
    calendario: { expiracao: 3600 },
    devedor: { cpf: String(cpf).replace(/\D/g, ''), nome: name || 'Cliente' },
    valor: { original: Number(amount).toFixed(2) }, // "0.00"
    chave: CHAVE_PIX, // sua chave Pix cadastrada na conta Efí de PRODUÇÃO
    solicitacaoPagador: 'Depósito em plataforma',
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    const { data } = await axios.post(`${BASE_URL}/v2/cob?txid=${encodeURIComponent(txid)}`, payload, {
      httpsAgent,
      headers,
      timeout: 20000,
    });
    return data; // deve conter data.loc.id
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data;
    console.error('--- ERRO AO CRIAR COBRANÇA NA EFÍ ---');
    console.error({ status, payload: payload ?? err?.message });
    throw new Error('Falha ao criar a cobrança Pix.');
  }
}

// 3) Gera QR Code a partir do loc.id
export async function generateQrCode({ locId }) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const { data } = await axios.get(`${BASE_URL}/v2/loc/${locId}/qrcode`, {
      httpsAgent,
      headers,
      timeout: 20000,
    });
    // Retorna { qrcode, imagemQrcode (data:image/png;base64,...) }
    return data;
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data;
    console.error('--- ERRO AO GERAR QR CODE NA EFÍ ---');
    console.error({ status, payload: payload ?? err?.message });
    throw new Error('Falha ao gerar o QR Code.');
  }
}
