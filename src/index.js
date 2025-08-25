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
app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

// Rota para CRIAR USUÁRIO
app.post('/criar-usuario', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const novoUsuario = await prisma.user.create({
      data: { email, name, password: hashedPassword },
    });
    const { password: _, ...userWithoutPassword } = novoUsuario;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    res.status(400).json({ error: error.message });
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

// =============================================================
// NOVA ROTA PROTEGIDA PARA CRIAR UM NOVO INVESTIMENTO
// =============================================================
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

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});