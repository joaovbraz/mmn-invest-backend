// Arquivo: src/index.js (do Backend) - VERSÃO FINAL COM CÁLCULO DE DATA

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { protect } from './authMiddleware.js';

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10;

// NOVA FUNÇÃO AUXILIAR PARA CALCULAR DIAS ÚTEIS
function addBusinessDays(startDate, days) {
  let currentDate = new Date(startDate);
  let addedDays = 0;
  while (addedDays < days) {
    currentDate.setDate(currentDate.getDate() + 1);
    const dayOfWeek = currentDate.getDay(); // 0 = Domingo, 6 = Sábado
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      addedDays++;
    }
  }
  return currentDate;
}

// Middlewares
app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

// Rota para CRIAR USUÁRIO
app.post('/criar-usuario', async (req, res) => {
  const { email, name, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUser = await prisma.$transaction(async (prisma) => {
      const user = await prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
        },
      });
      await prisma.wallet.create({
        data: {
          userId: user.id,
        },
      });
      return user;
    });
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
      return res.status(409).json({ error: 'Este email já está em uso.' });
    }
    console.error(error);
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

// ROTA DE INVESTIMENTO ATUALIZADA PARA CALCULAR ENDDATE
app.post('/investimentos', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'O ID do plano é obrigatório.' });
    }

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      return res.status(404).json({ error: 'Plano não encontrado.' });
    }

    // Calcula a data final: hoje + 40 dias úteis
    const startDate = new Date();
    const endDate = addBusinessDays(startDate, plan.durationDays);

    const novoInvestimento = await prisma.investment.create({
      data: {
        userId: userId,
        planId: planId,
        startDate: startDate,
        endDate: endDate, // <-- SALVAMOS A DATA FINAL CALCULADA
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