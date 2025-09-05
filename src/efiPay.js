// Arquivo: src/efiPay.js

import axios from 'axios';
import fs from 'fs';
import https from 'https';
import path from 'path';

// Carrega as credenciais do .env
const EFI_CLIENT_ID = process.env.EFI_CLIENT_ID;
const EFI_CLIENT_SECRET = process.env.EFI_CLIENT_SECRET;
const EFI_CERTIFICATE_PATH = process.env.EFI_CERTIFICATE_PATH;
const EFI_SANDBOX = process.env.EFI_SANDBOX === 'true';

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
    // Lança o erro aqui para interromper a aplicação se o certificado for essencial.
    process.exit(1); 
}

// Configura uma instância do Axios com o agente HTTPS
const api = axios.create({
    baseURL: API_URL,
    httpsAgent: agent,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Variável para armazenar o token de acesso e a data de expiração
let accessToken = null;
let tokenExpiry = null;

// Função para autenticar e obter o token de acesso
const getAccessToken = async () => {
    // Verifica se o token ainda é válido para evitar requisições desnecessárias
    if (accessToken && tokenExpiry && new Date() < tokenExpiry) {
        return accessToken;
    }

    const credentials = Buffer.from(`${EFI_CLIENT_ID}:${EFI_CLIENT_SECRET}`).toString('base64');
    
    try {
        const response = await api.post('/oauth/token', {
            'grant_type': 'client_credentials'
        }, {
            headers: {
                'Authorization': `Basic ${credentials}`
            }
        });

        // Armazena o novo token e a data de expiração
        accessToken = response.data.access_token;
        // Subtrai 60 segundos do tempo de expiração para garantir que o token não expire durante a requisição
        tokenExpiry = new Date(new Date().getTime() + (response.data.expires_in - 60) * 1000);

        return accessToken;
    } catch (error) {
        console.error('Erro de autenticação com a Efi:', error.response ? error.response.data : error.message);
        throw new Error('Falha na autenticação com o provedor de pagamento.');
    }
};

// Função para criar uma cobrança Pix imediata
export const createImmediateCharge = async (txid, amount, cpf, name) => {
    const token = await getAccessToken();

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
        const response = await api.put(`/v2/cob/${txid}`, requestBody, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return response.data; // Retorna os dados da cobrança criada
    } catch (error) {
        console.error('Erro ao criar cobrança na Efi:', error.response ? error.response.data : error.message);
        throw new Error('Falha ao criar a cobrança Pix.');
    }
};

// Função para gerar o QR Code da cobrança
export const generateQrCode = async (locationId) => {
    const token = await getAccessToken();

    try {
        const response = await api.get(`/v2/loc/${locationId}/qrcode`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return response.data; // Retorna { qrcode, imagemQrcode }
    } catch (error) {
        console.error('Erro ao gerar QR Code na Efi:', error.response ? error.response.data : error.message);
        throw new Error('Falha ao gerar o QR Code.');
    }
};