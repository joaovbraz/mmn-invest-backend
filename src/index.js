// Arquivo: src/index.js (do Backend) - VERSÃO CORRIGIDA DO CADASTRO

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
app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

// Rota para CRIAR USUÁRIO (LÓGICA SIMPLIFICADA)
app.post('/criar-usuario', async (req, res) => {
  const { email, name, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 1. Cria o usuário primeiro
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
      },
    });

    // 2. Depois, cria a carteira para ele
    await prisma.wallet.create({
      data: {
        userId: user.id,
      },
    });

    // 3. Se tudo deu certo, envia a resposta
    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);

  } catch (error) {
    if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
      return res.status(409).json({ error: 'Este email já está em uso.' });
    }
    console.error("Erro no cadastro:", error);
    res.status(400).json({ error: 'Não foi possível completar o cadastro.' });
  }
});

// Rota para LOGIN
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'Usuário ou senha inválidos.' });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
    const { password: _, ...userWithoutPassword } = user;
    res.status(200).json({
      message: 'Login bem-sucedido!',
      user: userWithoutPassword,
      token: token
    });
  } catch (error) {
    res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
  }
});

// Rota PROTEGIDA para BUSCAR DADOS DO USUÁRIO LOGADO
app.get('/meus-dados', protect, async (req, res) => {
  res.status(200).json(req.user);
});

// Rota PÚBLICA para LISTAR OS PLANOS DE INVESTIMENTO
app.get('/planos', async (req, res) => {
  try {
    const planos = await prisma.plan.findMany({
      orderBy: {
        price: 'asc'
      }
    });
    res.status(200).json(planos);
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível buscar os planos.' });
  }
});

// Rota PROTEGIDA para CRIAR UM NOVO INVESTIMENTO
app.post('/investimentos', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'O ID do plano é obrigatório.' });
    }

    const novoInvestimento = await prisma.investment.create({
      data: {
        userId: userId,
        planId: planId,
      }
    });

    res.status(201).json(novoInvestimento);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível processar o investimento.' });
  }
});

// Rota PROTEGIDA para LISTAR OS INVESTIMENTOS DO USUÁRIO
app.get('/meus-investimentos', protect, async (req, res) => {
  try {
    const userId = req.user.id;

    const investimentos = await prisma.investment.findMany({
      where: {
        userId: userId,
      },
      include: {
        plan: true,
      },
      orderBy: {
        startDate: 'desc'
      }
    });

    res.status(200).json(investimentos);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível buscar os investimentos.' });
  }
});

// Rota SECRETA para ACIONAR O PAGAMENTO DE RENDIMENTOS
app.post('/processar-rendimentos', async (req, res) => {
    // ... (código existente sem alterações)
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});