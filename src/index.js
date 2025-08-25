// Arquivo: src/index.js (do Backend) - COM ROTA DE GATILHO

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { protect } from './authMiddleware.js';
import { processDailyYields } from './jobs/yieldProcessor.js'; // <-- IMPORTAMOS NOSSO ROBÔ

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10;

app.use(cors());
app.use(express.json());

// ... (todas as outras rotas como /login, /planos, etc., continuam aqui sem alteração) ...
// Rota de teste
app.get('/', (req, res) => { res.json({ message: 'API do TDP INVEST funcionando!' }); });
// Rota para CRIAR USUÁRIO
app.post('/criar-usuario', async (req, res) => { /* ...código existente sem alterações... */ });
// Rota para LOGIN
app.post('/login', async (req, res) => { /* ...código existente sem alterações... */ });
// Rota PROTEGIDA para BUSCAR DADOS DO USUÁRIO LOGADO
app.get('/meus-dados', protect, async (req, res) => { res.status(200).json(req.user); });
// Rota PÚBLICA para LISTAR OS PLANOS DE INVESTIMENTO
app.get('/planos', async (req, res) => { /* ...código existente sem alterações... */ });
// Rota PROTEGIDA para CRIAR UM NOVO INVESTIMENTO
app.post('/investimentos', protect, async (req, res) => { /* ...código existente sem alterações... */ });
// Rota PROTEGIDA para LISTAR OS INVESTIMENTOS DO USUÁRIO
app.get('/meus-investimentos', protect, async (req, res) => { /* ...código existente sem alterações... */ });


// =============================================================
// NOVA ROTA SECRETA PARA ACIONAR O PAGAMENTO DE RENDIMENTOS
// =============================================================
app.post('/processar-rendimentos', async (req, res) => {
  // 1. Verificamos a senha secreta enviada na requisição
  const { secret } = req.body;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }

  // 2. Se a senha estiver correta, chamamos a função do nosso robô
  try {
    const result = await processDailyYields();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Ocorreu um erro ao processar os rendimentos.' });
  }
});


const PORT = process.env.PORT || 3333;
app.listen(PORT, () => { console.log(`🚀 Servidor rodando na porta ${PORT}`); });