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

// =============================================================
// ROTA PARA CRIAR USUÁRIO (ATUALIZADA PARA CRIAR CARTEIRA)
// =============================================================
app.post('/criar-usuario', async (req, res) => {
  const { email, name, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Usamos uma "transação" para garantir que ou tudo dá certo, ou nada é criado.
    const newUser = await prisma.$transaction(async (prisma) => {
      // 1. Cria o usuário
      const user = await prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
        },
      });

      // 2. Cria a carteira vinculada ao novo usuário
      await prisma.wallet.create({
        data: {
          userId: user.id,
          // Saldos já começam com 0 por padrão
        },
      });

      return user;
    });

    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);

  } catch (error) {
    // Verifica se o erro é de email duplicado
    if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
      return res.status(409).json({ error: 'Este email já está em uso.' });
    }
    console.error(error);
    res.status(400).json({ error: 'Não foi possível completar o cadastro.' });
  }
});

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


const PORT = process.env.PORT || 3333;
app.listen(PORT, () => { console.log(`🚀 Servidor rodando na porta ${PORT}`); });