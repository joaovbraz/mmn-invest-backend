// Arquivo: src/index.js (do Backend) - COMPLETO E ATUALIZADO

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { protect } from './authMiddleware.js';

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10;

// Middlewares
app.use(cors());
app.use(express.json());

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


// =============================================================
// NOVA ROTA PROTEGIDA PARA LISTAR OS INVESTIMENTOS DO USUÁRIO
// =============================================================
app.get('/meus-investimentos', protect, async (req, res) => {
  try {
    const userId = req.user.id; // ID do usuário logado (vem do middleware 'protect')

    // Busca todos os investimentos do usuário
    const investimentos = await prisma.investment.findMany({
      where: {
        userId: userId, // Filtra para pegar apenas os do usuário logado
      },
      include: {
        plan: true, // Inclui os detalhes do plano (nome, preço, etc.) em cada investimento
      },
      orderBy: {
        startDate: 'desc' // Mostra os investimentos mais recentes primeiro
      }
    });

    res.status(200).json(investimentos);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível buscar os investimentos.' });
  }
});


const PORT = process.env.PORT || 3333;
app.listen(PORT, () => { console.log(`🚀 Servidor rodando na porta ${PORT}`); });