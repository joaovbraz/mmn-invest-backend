// Arquivo: src/efiPay.js (VERSÃO FINAL COM SDK DA DOCUMENTAÇÃO OFICIAL)

import EfiPay from 'sdk-node-apis-efi'; // MUDANÇA 1: Importa o pacote correto
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
    process.exit(1);
}

// Configuração do SDK da Efi
const options = {
  client_id: EFI_CLIENT_ID,
  client_secret: EFI_CLIENT_SECRET,
  certificate: certPath,
  sandbox: EFI_SANDBOX,
  timeout: 30000
};

let efiPay;
try {
  efiPay = new EfiPay(options);
  console.log('SDK da Efí (novo) inicializado com sucesso.');
} catch (error) {
  console.error('ERRO AO INICIALIZAR O SDK DA EFÍ:', error.message);
  throw new Error('Falha na configuração do SDK de pagamento.');
}

// Função para criar uma cobrança Pix imediata
export const createImmediateCharge = async (txid, amount, cpf, name) => {
    const body = {
        calendario: { expiracao: 3600 },
        devedor: { cpf: cpf.replace(/\D/g, ''), nome: name },
        valor: { original: amount.toFixed(2).toString() },
        chave: process.env.CHAVE_PIX,
        solicitacaoPagador: 'Depósito em plataforma'
    };
    
    const params = { txid };

    try {
        // MUDANÇA 2: As funções da API Pix estão dentro de 'efiPay.pix'
        const chargeResponse = await efiPay.pix.pixCreateImmediateCharge(params, body);
        return chargeResponse;
    } catch (error) {
        console.error('--- ERRO DETALHADO AO CRIAR COBRANÇA NA EFÍ ---');
        // O erro neste SDK vem no formato {nome, mensagem} dentro de error.data
        if (error.data) {
            console.error(error.data);
        } else {
            console.error(error);
        }
        throw new Error('Falha ao criar a cobrança Pix.');
    }
};

// Função para gerar o QR Code da cobrança
export const generateQrCode = async (locationId) => {
    const params = {
        id: locationId
    };

    try {
        // MUDANÇA 3: As funções da API Pix estão dentro de 'efiPay.pix'
        const qrCodeResponse = await efiPay.pix.pixGenerateQRCode(params);
        return qrCodeResponse;
    } catch (error) {
        console.error('--- ERRO DETALHADO AO GERAR QR CODE NA EFÍ ---');
        if (error.data) {
            console.error(error.data);
        } else {
            console.error(error);
        }
        throw new Error('Falha ao gerar o QR Code.');
    }
};