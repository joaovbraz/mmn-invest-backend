// src/index.js (Sua Versão Final 100% Completa com a correção do CORS)
import express from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import { protect, admin } from './authMiddleware.js';
import { processDailyYields } from './jobs/yieldProcessor.js';
import { createImmediateCharge, generateQrCode } from './efiPay.js';

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10;

// ======================= HELPERS =======================

async function updateUserRankByTotalInvestment(userId) {
  try {
    const investments = await prisma.investment.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
    });

    const totalInvested = investments.reduce(
      (sum, investment) => sum + investment.plan.price.toNumber(),
      0
    );

    let newRank = 'Bronze';
    if (totalInvested >= 10000) newRank = 'Lendário';
    else if (totalInvested >= 5000) newRank = 'Diamante';
    else if (totalInvested >= 1000) newRank = 'Platina';
    else if (totalInvested >= 500) newRank = 'Ouro';
    else if (totalInvested >= 300) newRank = 'Prata';

    await prisma.user.update({ where: { id: userId }, data: { rank: newRank } });
  } catch (e) {
    console.error(`Erro ao atualizar rank para o usuário ${userId}:`, e);
  }
}

// ======================= MIDDLEWARE & SETUP =======================

// ✅ CORREÇÃO CRÍTICA: Configuração do CORS para permitir cookies
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'https://tdp-invest-frontend.vercel.app', 
  credentials: true, // Permite que o navegador envie cookies
};
app.use(cors(corsOptions));
// ✅ FIM DA CORREÇÃO

app.use(express.json());

app.get('/', (_req, res) => res.json({ message: 'API do TDP INVEST funcionando!' }));

// ======================= AUTENTICAÇÃO =======================

app.post('/criar-usuario', async (req, res) => {
  const { email, name, password, referrerCode } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Formato de email inválido.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    let referrerId = null;

    if (referrerCode) {
      const referrerUser = await prisma.user.findUnique({ where: { referralCode } });
      if (referrerUser) {
        referrerId = referrerUser.id;
      }
    }

    const referralCode = (name.substring(0, 4).toUpperCase() || 'USER') + Math.floor(10000 + Math.random() * 90000);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
          referralCode,
          referrerId,
        },
      });

      await tx.wallet.create({ data: { userId: newUser.id } });

      if (referrerId) {
        await tx.user.update({
          where: { id: referrerId },
          data: { careerPoints: { increment: 10 } },
        });
      }
      return newUser;
    });

    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Este email já está em uso.' });
    }
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Ocorreu um erro interno ao criar o usuário.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    const { password: _, ...userWithoutPassword } = user;
    res.status(200).json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
  }
});

// ======================= PERFIL & DADOS =======================

app.get('/meus-dados', protect, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        wallet: true,
        _count: { select: { referees: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const investments = await prisma.investment.findMany({
      where: { userId: req.user.id },
      include: { plan: true },
    });

    const totalInvested = investments.reduce((sum, inv) => sum + inv.plan.price.toNumber(), 0);
    const walletBalance = user.wallet ? user.wallet.balance.toNumber() : 0;

    const { password: _, ...safeUser } = user;

    res.status(200).json({
      ...safeUser,
      wallet: { ...safeUser.wallet, balance: walletBalance },
      totalInvested,
      referralCount: safeUser._count.referees,
    });
  } catch (error) {
    console.error('Erro ao buscar dados do usuário:', error);
    res.status(500).json({ error: 'Não foi possível buscar os dados do usuário.' });
  }
});

// ======================= DEPÓSITO PIX =======================

app.post('/depositos/pix', protect, async (req, res) => {
  const { amount, cpf } = req.body;
  const numericAmount = Number(amount);

  if (!numericAmount || numericAmount <= 0) {
    return res.status(400).json({ error: 'O valor do depósito deve ser positivo.' });
  }
  if (!cpf) {
    return res.status(400).json({ error: 'O CPF é obrigatório.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const txid = crypto.randomBytes(16).toString('hex');
    const charge = await createImmediateCharge({ txid, amount: numericAmount, cpf, name: user.name });
    const locId = charge?.loc?.id;

    if (!locId) {
      console.error('Resposta da Efí sem LOC ID:', charge);
      throw new Error('Localização da cobrança (LOC) não foi retornada pela Efí.');
    }

    const qr = await generateQrCode({ locId: String(locId) });

    await prisma.pixDeposit.create({
      data: {
        userId: req.user.id,
        amount: numericAmount,
        txid,
        status: 'PENDING',
        efilocId: String(locId),
        payloadQrCode: qr.qrcode,
        imagemQrcode: qr.imagemQrcode,
      },
    });

    res.status(201).json({ txid, qrCode: qr.qrcode, qrCodeImage: qr.imagemQrcode });
  } catch (error) {
    console.error('Erro ao processar depósito Pix:', error);
    res.status(500).json({ error: error.message || 'Não foi possível gerar a cobrança Pix.' });
  }
});

app.post('/webhooks/pix', async (req, res) => {
  const { pix } = req.body;
  if (!Array.isArray(pix)) return res.status(200).send('OK');

  for (const p of pix) {
    const { txid, valor } = p;
    try {
      await prisma.$transaction(async (tx) => {
        const deposit = await tx.pixDeposit.findUnique({ where: { txid } });
        if (!deposit || deposit.status !== 'PENDING') return;

        const receivedAmount = new Prisma.Decimal(valor);
        if (receivedAmount.neq(deposit.amount)) {
          console.warn(`Webhook para txid ${txid}: valor recebido (${valor}) diferente do esperado (${deposit.amount}).`);
          return;
        }

        await tx.pixDeposit.update({ where: { id: deposit.id }, data: { status: 'COMPLETED' } });

        await tx.wallet.update({
          where: { userId: deposit.userId },
          data: { balance: { increment: deposit.amount } },
        });

        await tx.transaction.create({
          data: {
            walletId: (await tx.wallet.findUnique({ where: { userId: deposit.userId } })).id,
            amount: deposit.amount,
            type: 'DEPOSIT',
            description: `Depósito Pix aprovado (txid: ${txid})`,
          },
        });
      });
    } catch (e) {
      console.error(`Erro ao processar webhook para txid ${txid}:`, e);
    }
  }
  res.status(200).send('OK');
});

app.get('/depositos/status/:txid', protect, async (req, res) => {
    try {
        const { txid } = req.params;
        const deposit = await prisma.pixDeposit.findFirst({
            where: {
                txid: txid,
                userId: req.user.id,
            },
            select: {
                status: true,
            }
        });

        if (!deposit) {
            return res.status(404).json({ error: 'Depósito não encontrado.' });
        }

        res.status(200).json({ status: deposit.status });

    } catch (error) {
        console.error("Erro ao verificar status do depósito:", error);
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});

// ======================= INVESTIMENTOS =======================

app.get('/planos', protect, async (req, res) => {
  try {
    const plans = await prisma.plan.findMany({ where: { active: true } });
    const safePlans = plans.map(p => ({
      ...p,
      price: p.price.toNumber(),
      dailyYield: p.dailyYield.toNumber(),
    }));
    res.status(200).json(safePlans);
  } catch (error) {
    console.error("Erro ao buscar planos:", error);
    res.status(500).json({ error: "Não foi possível carregar os planos." });
  }
});

app.post('/investimentos/comprar', protect, async (req, res) => {
  const { planId } = req.body;
  if (!planId) {
    return res.status(400).json({ error: 'O ID do plano é obrigatório.' });
  }

  try {
    const plan = await prisma.plan.findUnique({ where: { id: Number(planId) } });
    if (!plan || !plan.active) {
      return res.status(404).json({ error: 'Plano não encontrado ou inativo.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: req.user.id } });
      const wallet = await tx.wallet.findUnique({ where: { userId: req.user.id } });

      if (!wallet || wallet.balance.lt(plan.price)) {
        throw new Error('Saldo insuficiente.');
      }

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: plan.price } },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount: plan.price,
          type: 'PURCHASE',
          description: `Compra do plano "${plan.name}"`,
        },
      });

      const now = new Date();
      const expiresAt = new Date(new Date().setDate(now.getDate() + plan.durationDays));

      await tx.investment.create({
        data: {
          userId: req.user.id,
          planId: plan.id,
          status: 'ACTIVE',
          expiresAt,
        },
      });

      if (user.referrerId) {
        const commission = plan.price.times(0.10);
        await tx.wallet.update({
          where: { userId: user.referrerId },
          data: { balance: { increment: commission } },
        });
        await tx.transaction.create({
          data: {
            walletId: (await tx.wallet.findUnique({ where: { userId: user.referrerId } })).id,
            amount: commission,
            type: 'COMMISSION',
            description: `Comissão de 10% pela compra de ${user.name}`,
          },
        });
      }

      return { newBalance: updatedWallet.balance };
    });

    await updateUserRankByTotalInvestment(req.user.id);

    res.status(201).json({ 
      message: 'Plano comprado com sucesso!',
      newBalance: result.newBalance.toNumber(),
    });

  } catch (error) {
    console.error('Erro na compra do plano:', error);
    res.status(400).json({ error: error.message || 'Não foi possível completar a compra.' });
  }
});


app.get('/minhas-cotas-ativas', protect, async (req, res) => {
  try {
    const investments = await prisma.investment.findMany({
      where: { userId: req.user.id, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    // Convertendo Decimals para numbers antes de enviar
    const safeInvestments = investments.map(inv => ({
        ...inv,
        plan: {
            ...inv.plan,
            price: inv.plan.price.toNumber(),
            dailyYield: inv.plan.dailyYield.toNumber(),
        }
    }));
    res.status(200).json(safeInvestments);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar cotas ativas.' });
  }
});

app.get('/minhas-cotas-finalizadas', protect, async (req, res) => {
  try {
    const investments = await prisma.investment.findMany({
      where: { userId: req.user.id, status: 'COMPLETED' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    // Convertendo Decimals para numbers antes de enviar
    const safeInvestments = investments.map(inv => ({
        ...inv,
        plan: {
            ...inv.plan,
            price: inv.plan.price.toNumber(),
            dailyYield: inv.plan.dailyYield.toNumber(),
        }
    }));
    res.status(200).json(safeInvestments);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar cotas finalizadas.' });
  }
});

app.get('/meu-extrato', protect, async (req, res) => {
    try {
        const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id }});
        if (!wallet) return res.status(404).json({ error: 'Carteira não encontrada.' });

        const transactions = await prisma.transaction.findMany({
            where: { walletId: wallet.id },
            orderBy: { createdAt: 'desc' },
        });
        // Convertendo Decimals para numbers antes de enviar
        const safeTransactions = transactions.map(t => ({
            ...t,
            amount: t.amount.toNumber(),
        }));
        res.status(200).json(safeTransactions);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar extrato.' });
    }
});


// ======================= ROTA DE CRON JOB =======================
app.post('/processar-rendimentos', admin, async (req, res) => {
  try {
    processDailyYields(); 
    res.status(202).json({ message: 'Processamento de rendimentos diários iniciado em segundo plano.' });
  } catch (error) {
    console.error("Erro ao iniciar o job de rendimentos:", error);
    res.status(500).json({ error: "Falha ao iniciar o processamento." });
  }
});

// ======================= START DO SERVIDOR =======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));