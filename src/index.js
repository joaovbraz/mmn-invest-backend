// Arquivo: src/index.js (do Backend) - VERSÃO COMPLETA E CORRIGIDA

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

// =============================================================
// FUNÇÃO ADICIONADA PARA CALCULAR DIAS ÚTEIS
// =============================================================
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
      if (referrer) { referrerId = referrer.id; }
    }
    const newReferralCode = (name.substring(0, 4).toUpperCase() || 'USER') + Math.floor(10000 + Math.random() * 90000);
    
    const newUser = await prisma.$transaction(async (prisma) => {
        const user = await prisma.user.create({ data: { email, name, password: hashedPassword, referralCode: newReferralCode, referrerId: referrerId } });
        await prisma.wallet.create({ data: { userId: user.id } });
        if(referrerId){
            await prisma.user.update({ where: { id: referrerId }, data: { careerPoints: { increment: 10 } } });
        }
        return user;
    });

    const { password: _, ...userWithoutPassword } = newUser;
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

// =============================================================
// ROTA DE INVESTIMENTOS ATUALIZADA E CORRIGIDA
// =============================================================
app.post('/investimentos', protect, async (req, res) => {
  try {
    const investingUser = await prisma.user.findUnique({ where: { id: req.user.id }, include: { wallet: true }});
    
    // LINHA ADICIONADA PARA CORREÇÃO
    if (!investingUser) { return res.status(404).json({ error: 'Usuário investidor não encontrado.' }); }

    const { planId } = req.body;
    if (!planId) { return res.status(400).json({ error: 'O ID do plano é obrigatório.' }); }
    
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) { return res.status(404).json({ error: 'Plano não encontrado.' }); }
    
    const userWallet = investingUser.wallet;
    if (!userWallet) { return res.status(400).json({ error: 'Carteira do usuário não encontrada.' }); }
    const totalBalance = userWallet.balance + userWallet.referralBalance;
    if (totalBalance < plan.price) { return res.status(400).json({ error: 'Saldo insuficiente para comprar este plano.' }); }

    // CALCULA A DATA FINAL USANDO A NOVA FUNÇÃO
    const startDate = new Date();
    const endDate = addBusinessDays(startDate, plan.durationDays);

    const result = await prisma.$transaction(async (prisma) => {
      let amountToDeductFromBalance = 0;
      let amountToDeductFromReferral = 0;
      if (plan.price <= userWallet.referralBalance) {
          amountToDeductFromReferral = plan.price;
      } else {
          amountToDeductFromReferral = userWallet.referralBalance;
          amountToDeductFromBalance = plan.price - userWallet.referralBalance;
      }
      await prisma.wallet.update({ where: { id: userWallet.id }, data: { balance: { decrement: amountToDeductFromBalance }, referralBalance: { decrement: amountToDeductFromReferral } } });
      await prisma.transaction.create({ data: { walletId: userWallet.id, amount: -plan.price, type: 'PLAN_PURCHASE', description: `Compra do ${plan.name}` } });

      // CRIA O NOVO INVESTIMENTO COM A DATA FINAL
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

app.get('/meus-investimentos', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const investimentos = await prisma.investment.findMany({ where: { userId: userId }, include: { plan: true }, orderBy: { startDate: 'desc' } });
    res.status(200).json(investimentos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível buscar os investimentos.' });
  }
});

app.get('/minha-rede', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const referralCount = await prisma.user.count({ where: { referrerId: userId, } });
    res.status(200).json({ count: referralCount });
  } catch (error) {
    console.error("Erro ao contar afiliados:", error);
    res.status(500).json({ error: "Não foi possível buscar os dados da rede." });
  }
});

app.get('/minha-rede-detalhes', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const referrals = await prisma.user.findMany({ where: { referrerId: userId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true, createdAt: true, } });
    res.status(200).json(referrals);
  } catch (error) {
    console.error("Erro ao buscar detalhes da rede:", error);
    res.status(500).json({ error: "Não foi possível buscar os detalhes da rede." });
  }
});

app.get('/meu-extrato', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const wallet = await prisma.wallet.findUnique({ where: { userId: userId } });
    if (!wallet) { return res.status(404).json({ error: "Carteira do usuário não encontrada." }); }
    const transactions = await prisma.transaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, });
    res.status(200).json(transactions);
  } catch (error) {
    console.error("Erro ao buscar extrato:", error);
    res.status(500).json({ error: "Não foi possível buscar o extrato." });
  }
});

app.post('/saques', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, walletType } = req.body;
    if (!amount || amount <= 0) { return res.status(400).json({ error: "O valor do saque deve ser positivo." }); }
    const wallet = await prisma.wallet.findUnique({ where: { userId: userId } });
    if (!wallet) { return res.status(404).json({ error: "Carteira não encontrada." }); }

    if (walletType === 'referral' && amount > wallet.referralBalance) {
        return res.status(400).json({ error: "Saldo de indicação insuficiente." });
    } else if (walletType === 'balance' && amount > wallet.balance) {
        return res.status(400).json({ error: "Saldo de rendimentos insuficiente." });
    }

    const newWithdrawal = await prisma.withdrawal.create({ data: { amount: amount, userId: userId, walletType: walletType } });
    res.status(201).json(newWithdrawal);
  } catch (error) {
    console.error("Erro ao criar pedido de saque:", error);
    res.status(500).json({ error: "Não foi possível processar a solicitação de saque." });
  }
});

app.get('/saques', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const withdrawals = await prisma.withdrawal.findMany({ where: { userId: userId, }, orderBy: { createdAt: 'desc' }, });
    res.status(200).json(withdrawals);
  } catch (error) {
    console.error("Erro ao buscar histórico de saques:", error);
    res.status(500).json({ error: "Não foi possível buscar o histórico de saques." });
  }
});

app.put('/perfil/alterar-senha', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) { return res.status(400).json({ error: 'Todos os campos são obrigatórios.' }); }
    if (newPassword !== confirmPassword) { return res.status(400).json({ error: 'A nova senha e a confirmação não coincidem.' }); }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) { return res.status(401).json({ error: 'A senha atual está incorreta.' }); }
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
    await prisma.user.update({ where: { id: userId }, data: { password: hashedNewPassword }, });
    res.status(200).json({ message: 'Senha alterada com sucesso!' });
  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    res.status(500).json({ error: 'Não foi possível alterar a senha.' });
  }
});

app.get('/admin/saques', protect, admin, async (req, res) => {
  try {
    const pendingWithdrawals = await prisma.withdrawal.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true, email: true } } } });
    res.status(200).json(pendingWithdrawals);
  } catch (error) { res.status(500).json({ error: 'Erro ao buscar saques pendentes.' }); }
});

app.post('/admin/saques/:id/aprovar', protect, admin, async (req, res) => {
  try {
    const withdrawalId = parseInt(req.params.id);
    const result = await prisma.$transaction(async (prisma) => {
      const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId }, include: { user: { include: { wallet: true } } } });
      if (!withdrawal) throw new Error("Pedido de saque não encontrado.");
      if (withdrawal.status !== 'PENDING') throw new Error("Este saque já foi processado.");
      
      const userWallet = withdrawal.user.wallet;
      if (!userWallet) throw new Error("Carteira do usuário não encontrada.");
      
      let dataToUpdate = {};
      if (withdrawal.walletType === 'referral') {
          if (withdrawal.amount > userWallet.referralBalance) throw new Error("Saldo de indicação insuficiente.");
          dataToUpdate = { referralBalance: { decrement: withdrawal.amount } };
      } else { // 'balance'
          if (withdrawal.amount > userWallet.balance) throw new Error("Saldo de rendimentos insuficiente.");
          dataToUpdate = { balance: { decrement: withdrawal.amount } };
      }

      await prisma.wallet.update({ where: { id: userWallet.id }, data: dataToUpdate });
      await prisma.transaction.create({ data: { walletId: userWallet.id, amount: -withdrawal.amount, type: 'WITHDRAWAL', description: `Saque de ${withdrawal.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (${withdrawal.walletType}) aprovado.` } });
      return prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'APPROVED' }, });
    });
    res.status(200).json(result);
  } catch (error) {
    console.error("Erro ao aprovar saque:", error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/admin/saques/:id/rejeitar', protect, admin, async (req, res) => {
  try {
    const withdrawalId = parseInt(req.params.id);
    const { reason } = req.body;
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) { return res.status(404).json({ error: 'Pedido de saque não encontrado.' }); }
    if (withdrawal.status !== 'PENDING') { return res.status(400).json({ error: 'Este saque já foi processado.' }); }
    const rejectedWithdrawal = await prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'REJECTED', reason: reason } });
    res.status(200).json(rejectedWithdrawal);
  } catch (error) {
    console.error("Erro ao rejeitar saque:", error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/processar-rendimentos', (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }
  res.status(202).json({ message: "Processamento de rendimentos iniciado em segundo plano." });
  processDailyYields(); 
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});