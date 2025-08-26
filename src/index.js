// Arquivo: src/index.js (do Backend) - VERSÃO COMPLETA E FINAL

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { protect, admin } from './authMiddleware.js';
import { processDailyYields } from './jobs/yieldProcessor.js';

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10;
const rankThresholds = { Lendário: 10000, Diamante: 5000, Platina: 1000, Ouro: 500, Prata: 300, Bronze: 0 };

// FUNÇÃO AUXILIAR PARA CALCULAR DIAS ÚTEIS
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

async function updateUserRankByTotalInvestment(userId) {
  try {
    const userInvestments = await prisma.investment.findMany({ where: { userId: userId, status: 'ACTIVE' }, include: { plan: true } });
    const totalInvested = userInvestments.reduce((sum, investment) => sum + investment.plan.price, 0);
    let newRank = 'Bronze';
    const rankKeys = Object.keys(rankThresholds).sort((a, b) => rankThresholds[b] - rankThresholds[a]);
    for (const rank of rankKeys) {
      if (totalInvested >= rankThresholds[rank]) {
        newRank = rank;
        break;
      }
    }
    await prisma.user.update({ where: { id: userId }, data: { rank: newRank } });
    console.log(`Rank do usuário ${userId} verificado. Total Investido: ${totalInvested}. Novo Rank: ${newRank}.`);
  } catch (error) {
    console.error(`Erro ao atualizar rank do usuário ${userId} por investimento:`, error);
  }
}

app.use(cors());
app.use(express.json());
app.get('/', (req, res) => { res.json({ message: 'API do TDP INVEST funcionando!' }); });

app.post('/criar-usuario', async (req, res) => {
  const { email, name, password, referrerCode } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    let referrerId = null;
    if (referrerCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: referrerCode } });
      if (referrer) {
        referrerId = referrer.id;
        await prisma.user.update({ where: { id: referrerId }, data: { careerPoints: { increment: 10 } } });
      }
    }
    const newReferralCode = (name.substring(0, 4).toUpperCase() || 'USER') + Math.floor(10000 + Math.random() * 90000);
    const user = await prisma.user.create({ data: { email, name, password: hashedPassword, referralCode: newReferralCode, referrerId: referrerId } });
    await prisma.wallet.create({ data: { userId: user.id } });
    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    if (error.code === 'P2002') { return res.status(409).json({ error: 'Este email ou código de convite já está em uso.' }); }
    console.error("Erro no cadastro:", error);
    res.status(400).json({ error: 'Não foi possível completar o cadastro.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { return res.status(404).json({ error: 'Usuário ou senha inválidos.' }); }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) { return res.status(401).json({ error: 'Senha incorreta.' }); }
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    const { password: _, ...userWithoutPassword } = user;
    res.status(200).json({ message: 'Login bem-sucedido!', user: userWithoutPassword, token: token });
  } catch (error) { res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' }); }
});

app.get('/meus-dados', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const userWithWallet = await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } });
        if (!userWithWallet) { return res.status(404).json({ error: 'Usuário não encontrado.' }); }
        const userInvestments = await prisma.investment.findMany({ where: { userId: userId, status: 'ACTIVE' }, include: { plan: true }, });
        const totalInvested = userInvestments.reduce((sum, investment) => sum + investment.plan.price, 0);
        delete userWithWallet.password;
        const responseData = { ...userWithWallet, totalInvested: totalInvested };
        res.status(200).json(responseData);
    } catch (error) {
        console.error("Erro em /meus-dados:", error);
        res.status(500).json({ error: "Não foi possível buscar os dados do usuário."})
    }
});

app.get('/planos', async (req, res) => {
  try {
    const planos = await prisma.plan.findMany({ orderBy: { price: 'asc' } });
    res.status(200).json(planos);
  } catch (error) { res.status(500).json({ error: 'Não foi possível buscar os planos.' }); }
});

app.post('/investimentos', protect, async (req, res) => {
  try {
    const investingUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    const { planId } = req.body;
    if (!planId) { return res.status(400).json({ error: 'O ID do plano é obrigatório.' }); }
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) { return res.status(404).json({ error: 'Plano não encontrado.' }); }
    const startDate = new Date();
    const endDate = addBusinessDays(startDate, plan.durationDays);
    const result = await prisma.$transaction(async (prisma) => {
      const novoInvestimento = await prisma.investment.create({ data: { userId: investingUser.id, planId: planId, startDate: startDate, endDate: endDate } });
      let commissionAmount = plan.price * 0.10;
      let currentReferrerId = investingUser.referrerId;
      for (let level = 1; level <= 4; level++) {
        if (!currentReferrerId) { break; }
        const referrer = await prisma.user.findUnique({ where: { id: currentReferrerId }, include: { wallet: true }, });
        if (referrer && referrer.wallet) {
          const roundedCommission = Math.round(commissionAmount * 100) / 100;
          await prisma.wallet.update({ where: { id: referrer.wallet.id }, data: { referralBalance: { increment: roundedCommission } }, });
          await prisma.transaction.create({ data: { walletId: referrer.wallet.id, amount: roundedCommission, type: 'REFERRAL_BONUS', description: `Bônus de indicação (Nível ${level}) pelo investimento de ${investingUser.name}`, } });
          commissionAmount = roundedCommission * 0.10;
          currentReferrerId = referrer.referrerId;
        } else { break; }
      }
      return novoInvestimento;
    });
    await updateUserRankByTotalInvestment(investingUser.id);
    res.status(201).json(result);
  } catch (error) {
    console.error("Erro ao processar investimento:", error);
    res.status(500).json({ error: 'Não foi possível processar o investimento.' });
  }
});

// Suas outras rotas (meus-investimentos, minha-rede, etc.) aqui...

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});