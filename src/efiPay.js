// Arquivo: src/efiPay.js (VERSÃO CORRIGIDA E MAIS SEGURA)

import axios from 'axios';
import fs from 'fs';
import https from 'https';
import path from 'path';

// Carrega as credenciais do .env
const EFI_CLIENT_ID = process.env.EFI_CLIENT_ID;
const EFI_CLIENT_SECRET = process.env.EFI_CLIENT_SECRET;
const EFI_CERTIFICATE_PATH = process.env.EFI_CERTIFICATE_PATH;
const EFI_SANDBOX = process.env.EFI_SANDBOX === 'true';

// ======================= NOVA VERIFICAÇÃO =======================
// Verifica se as variáveis de ambiente essenciais foram carregadas
if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET || !EFI_CERTIFICATE_PATH) {
    console.error('ERRO CRÍTICO: As variáveis de ambiente da Efi (EFI_CLIENT_ID, EFI_CLIENT_SECRET, EFI_CERTIFICATE_PATH) não foram configuradas.');
    console.error('Verifique seu arquivo .env ou as configurações de ambiente no painel de hospedagem (Render).');
    // Encerra a aplicação ou impede a continuação para evitar erros inesperados.
    // Em um cenário real, você pode querer lançar um erro que impeça o servidor de iniciar.
}
// =================================================================

// Define o ambiente (produção ou homologação/sandbox)
const API_URL = EFI_SANDBOX ? 'https://api-pix-h.gerencianet.com.br' : 'https://api-pix.gerencianet.com.br';

// Carrega o certificado
let agent;
try {
    const certificate = fs.readFileSync(path.resolve(EFI_CERTIFICATE_PATH));
    agent = new https.Agent({
        pfx: certificate,
        passphrase: ''
    });
    console.log('Certificado da Efi carregado com sucesso.');
} catch (error) {
    console.error('ERRO AO LER O ARQUIVO DE CERTIFICADO:', error.message);
    console.error('Verifique se o caminho em EFI_CERTIFICATE_PATH no arquivo .env está correto e o arquivo existe.');
    agent = null; // Garante que o agent é nulo se o certificado falhar
}


// Função para autenticar e obter o token de acesso
const getAccessToken = async () => {
    // Adicionamos uma verificação para não prosseguir se as credenciais não foram carregadas
    if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET) {
        throw new Error('Client ID ou Client Secret da Efi não estão definidos.');
    }

    const credentials = Buffer.from(`${EFI_CLIENT_ID}:${EFI_CLIENT_SECRET}`).toString('base64');
    
    try {
        const response = await axios({
            method: 'POST',
            url: `${API_URL}/oauth/token`,
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json'
            },
            data: {
                'grant_type': 'client_credentials'
            },
            httpsAgent: agent
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Erro de autenticação com a Efi:', error.response ? error.response.data : error.message);
        throw new Error('Falha na autenticação com o provedor de pagamento.');
    }
};

// Função para criar uma cobrança Pix imediata
export const createImmediateCharge = async (txid, amount, cpf, name) => {
    if (!agent) throw new Error('O certificado da Efi não foi carregado. A operação não pode continuar.');

    const accessToken = await getAccessToken();

    const requestBody = {
        calendario: {
            expiracao: 3600 // Expira em 1 hora (3600 segundos)
        },
        devedor: {
            cpf: cpf.replace(/\D/g, ''), // Remove qualquer formatação do CPF
            nome: name
        },
        valor: {
            original: amount.toFixed(2).toString() // Formata para duas casas decimais
        },
        chave: process.env.CHAVE_PIX,
        solicitacaoPagador: 'Depósito em plataforma'
    };

    try {
        const response = await axios({
            method: 'PUT',
            url: `${API_URL}/v2/cob/${txid}`,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            data: requestBody,
            httpsAgent: agent
        });
        return response.data; // Retorna os dados da cobrança criada
    } catch (error) {
        console.error('Erro ao criar cobrança na Efi:', error.response ? error.response.data : error.message);
        throw new Error('Falha ao criar a cobrança Pix.');
    }
};

// Função para gerar o QR Code da cobrança
export const generateQrCode = async (locationId) => {
    if (!agent) throw new Error('O certificado da Efi não foi carregado. A operação não pode continuar.');

    const accessToken = await getAccessToken();

    try {
        const response = await axios({
            method: 'GET',
            url: `${API_URL}/v2/loc/${locationId}/qrcode`,
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            httpsAgent: agent
        });
        return response.data; // Retorna { qrcode, imagemQrcode }
    } catch (error) {
        console.error('Erro ao gerar QR Code na Efi:', error.response ? error.response.data : error.message);
        throw new Error('Falha ao gerar o QR Code.');
    }
};