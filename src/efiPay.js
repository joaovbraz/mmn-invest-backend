// Arquivo: src/efiPay.js (VERSÃO CORRIGIDA)

import EfiPay from 'gn-api-sdk-node';
import path from 'path';
import fs from 'fs';

// Carrega as credenciais do .env
const EFI_CLIENT_ID = process.env.EFI_CLIENT_ID;
const EFI_CLIENT_SECRET = process.env.EFI_CLIENT_SECRET;
const EFI_CERTIFICATE_PATH = process.env.EFI_CERTIFICATE_PATH;
const EFI_SANDBOX = process.env.EFI_SANDBOX === 'true';

// Garante que o caminho do certificado seja absoluto
const certPath = path.resolve(EFI_CERTIFICATE_PATH);

// Verifica se o arquivo do certificado existe
if (!fs.existsSync(certPath)) {
    console.error('ERRO: Arquivo de certificado não encontrado no caminho:', certPath);
    // Encerra a aplicação para evitar que o servidor inicie com uma configuração incorreta
    process.exit(1);
}

// Configuração do SDK da Efi
const options = {
  client_id: EFI_CLIENT_ID,
  client_secret: EFI_CLIENT_SECRET,
  certificate: certPath,
  sandbox: EFI_SANDBOX,
  // Opcional: define um tempo limite para as requisições
  timeout: 30000
};

// Inicializa a instância da EfiPay
let efiPay;
try {
  efiPay = new EfiPay(options);
  console.log('SDK da Efi (Gerencianet) inicializado com sucesso.');
} catch (error) {
  console.error('ERRO AO INICIALIZAR O SDK DA EFI:', error.message);
  throw new Error('Falha na configuração do SDK de pagamento.');
}

// Função para criar uma cobrança Pix imediata
export const createImmediateCharge = async (txid, amount, cpf, name) => {
    const params = {
        txid: txid
    };

    const body = {
        calendario: { expiracao: 3600 },
        devedor: { cpf: cpf.replace(/\D/g, ''), nome: name },
        valor: { original: amount.toFixed(2).toString() },
        chave: process.env.CHAVE_PIX,
        solicitacaoPagador: 'Depósito em plataforma'
    };

    try {
        const chargeResponse = await efiPay.pixCreateImmediateCharge(params, body);
        return chargeResponse;
    } catch (error) {
        console.error('Erro ao criar cobrança na Efi:', error.response ? error.response.data : error.message);
        throw new Error('Falha ao criar a cobrança Pix.');
    }
};

// Função para gerar o QR Code da cobrança
export const generateQrCode = async (locationId) => {
    const params = {
        id: locationId
    };

    try {
        const qrCodeResponse = await efiPay.pixGenerateQRCode(params);
        return qrCodeResponse;
    } catch (error) {
        console.error('Erro ao gerar QR Code na Efi:', error.response ? error.response.data : error.message);
        throw new Error('Falha ao gerar o QR Code.');
    }
};