// src/efiPay.js
import EfiPay from 'sdk-node-apis-efi';
import path from 'path';
import fs from 'fs';

// Variáveis de ambiente
const {
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_CERTIFICATE_PATH,
  EFI_SANDBOX,
  CHAVE_PIX,
} = process.env;

// Validações básicas
if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET || !EFI_CERTIFICATE_PATH || !CHAVE_PIX) {
  throw new Error(
    'Variáveis de ambiente da Efí ausentes: verifique EFI_CLIENT_ID, EFI_CLIENT_SECRET, EFI_CERTIFICATE_PATH e CHAVE_PIX.'
  );
}

// Garante caminho absoluto do certificado e existência do arquivo
const certPath = path.resolve(EFI_CERTIFICATE_PATH);
if (!fs.existsSync(certPath)) {
  console.error('ERRO: Arquivo de certificado não encontrado:', certPath);
  process.exit(1);
}

// Instancia o SDK
const efipay = new EfiPay({
  client_id: EFI_CLIENT_ID,
  client_secret: EFI_CLIENT_SECRET,
  certificate: certPath,
  sandbox: String(EFI_SANDBOX).toLowerCase() === 'true',
  timeout: 30000,
});

console.log('SDK da Efí inicializado com sucesso.');

// Cria cobrança imediata Pix
export async function createImmediateCharge(txid, amount, cpf, name) {
  const body = {
    calendario: { expiracao: 3600 },
    devedor: { cpf: String(cpf).replace(/\D/g, ''), nome: name || 'Cliente' },
    valor: { original: Number(amount).toFixed(2) },
    chave: CHAVE_PIX,
    solicitacaoPagador: 'Depósito em plataforma',
  };

  const params = { txid };

  try {
    // ✅ correção: método é de nível superior (não use efipay.pix.*)
    const response = await efipay.pixCreateImmediateCharge(params, body);
    return response;
  } catch (err) {
    console.error('--- ERRO DETALHADO AO CRIAR COBRANÇA NA EFÍ ---');
    console.error(err?.response?.data ?? err?.data ?? err);
    throw new Error('Falha ao criar a cobrança Pix.');
  }
}

// Gera QR Code da cobrança
export async function generateQrCode(locationId) {
  const params = { id: locationId };
  try {
    // ✅ correção: método é de nível superior
    const response = await efipay.pixGenerateQRCode(params);
    return response;
  } catch (err) {
    console.error('--- ERRO DETALHADO AO GERAR QR CODE NA EFÍ ---');
    console.error(err?.response?.data ?? err?.data ?? err);
    throw new Error('Falha ao gerar o QR Code.');
  }
}
