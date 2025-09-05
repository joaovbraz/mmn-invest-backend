// Arquivo: src/index.js (do Backend) - VERSÃO COMPLETA E ATUALIZADA

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { protect, admin } from './authMiddleware.js';
import { processDailyYields } from './jobs/yieldProcessor.js';
import crypto from 'crypto';

// Integração Efí (corrigida)
import { createImmediateCharge, generateQrCode } from './efiPay.js';

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10;

const rankThresholds = {
  Lendário: 10000,
  Diamante: 5000,
  Platina: 1000,
  Ouro: 500,
  Prata: 300,
  Bronze: 0,
};

function addBusinessDays(startDate, days) {
  let currentDate = new Date(startDate);
  let addedDays = 0;
  while (addedDays < days) {
    currentDate.setDate(currentDate.getDate() + 1);
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      addedDays++;
    }
  }
  return currentDate;
}

async function updateUserRankByTotalInvestment(userId) {
  try {
    const userInvestments = await prisma.investment.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
    });
    const totalInvested = userInvestments.reduce((sum, inv) => sum + inv.plan.price, 0);

    let newRank = 'Bronze';
    const rankKeys = Object.keys(rankThresholds).sort(
      (a, b) => rankThresholds[b] - rankThresholds[a]
    );
    for (const rank of rankKeys) {
      if (totalInvested >= rankThresholds[rank]) {
        newRank = rank;
        break;
      }
    }

    await prisma.user.update({ where: { id: userId }, data: { rank: newRank } });
    console.log(
      `Rank do usuário ${userId} verificado. Total Investido: ${totalInvested}. Novo Rank: ${newRank}.`
    );
  } catch (error) {
    console.error(`Erro ao atualizar rank do usuário ${userId} por investimento:`, error);
  }
}

async function getNetworkLevels(userIds, currentLevel = 1, maxLevel = 10) {
  if (!userIds || userIds.length === 0 || currentLevel > maxLevel) return [];
  const referrals = await prisma.user.findMany({
    where: { referrerId: { in: userIds } },
    select: { id: true, name: true, email: true, createdAt: true, referrerId: true },
  });
  if (referrals.length === 0) return [];
  const nextLevelUserIds = referrals.map((r) => r.id);
  const subReferrals = await getNetworkLevels(nextLevelUserIds, currentLevel + 1, maxLevel);
  const currentLevelReferrals = referrals.map((r) => ({ ...r, level: currentLevel }));
  return [...currentLevelReferrals, ...subReferrals];
}

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

// ============================= AUTENTICAÇÃO =============================

app.post('/criar-usuario', async (req, res) => {
  const { email, name, password, referrerCode } = req.body;
  if (!email || !name || !password) {
    return res
      .status(400)
      .json({ error: 'Todos os campos (nome, email, senha) são obrigatórios.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    let referrerId = null;
    if (referrerCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: referrerCode } });
      if (referrer) referrerId = referrer.id;
    }

    const newReferralCode =
      (name.substring(0, 4).toUpperCase() || 'USER') +
      Math.floor(10000 + Math.random() * 90000);

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name, password: hashedPassword, referralCode: newReferralCode, referrerId },
      });
      await tx.wallet.create({ data: { userId: user.id } });
      if (referrerId) {
        await tx.user.update({
          where: { id: referrerId },
          data: { careerPoints: { increment: 10 } },
        });
      }
      return user;
    });

    const { password: _p, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    if (error.code === 'P2002') {
      return res
        .status(409)
        .json({ error: 'Este email ou código de convite já está em uso.' });
    }
    res.status(400).json({ error: `Erro técnico rastreado: ${error.message}` });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Usuário ou senha inválidos.' });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: 'Senha incorreta.' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    const { password: _pw, ...userWithoutPassword } = user;
    res.status(200).json({ message: 'Login bem-sucedido!', user: userWithoutPassword, token });
  } catch {
    res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
  }
});

// ============================= PERFIL & DADOS =============================

app.get('/meus-dados', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const userWithDetails = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        _count: { select: { referees: true } },
      },
    });
    if (!userWithDetails) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const userInvestments = await prisma.investment.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
    });
    const totalInvested = userInvestments.reduce((sum, inv) => sum + inv.plan.price, 0);

    const { password: _pw, ...safeUser } = userWithDetails;
    res.status(200).json({
      ...safeUser,
      totalInvested,
      referralCount: safeUser._count.referees,
    });
  } catch {
    res.status(500).json({ error: 'Não foi possível buscar os dados do usuário.' });
  }
});

app.put('/meus-dados', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'O nome é obrigatório.' });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name, phone },
    });
    const { password: _pw, ...safeUser } = updatedUser;
    res.status(200).json(safeUser);
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Não foi possível atualizar os dados do perfil.' });
  }
});

// ============================= DEPÓSITO PIX =============================

app.post('/depositos/pix', protect, async (req, res) => {
  const userId = req.user.id;
  const { amount, cpf } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'O valor do depósito deve ser positivo.' });
  }
  if (!cpf) {
    return res
      .status(400)
      .json({ error: 'O CPF é obrigatório para gerar a cobrança Pix.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const txid = crypto.randomBytes(16).toString('hex').slice(0, 32);

    // 1) Cria a cobrança
    const chargeResponse = await createImmediateCharge(txid, amount, cpf, user.name);
    const locationId = chargeResponse?.loc?.id;
    if (!locationId) throw new Error('LOC não retornado pela Efí.');

    // 2) Gera o QR Code
    const qrCodeResponse = await generateQrCode(locationId);

    // 3) Persiste a tentativa
    await prisma.pixDeposit.create({
      data: {
        userId,
        amount: Number(amount),
        txid,
        status: 'PENDING',
        efilocId: locationId,
        payloadQrCode: qrCodeResponse.qrcode,
        imagemQrcode: qrCodeResponse.imagemQrcode,
      },
    });

    // 4) Retorna para o frontend
    res.status(201).json({
      qrCode: qrCodeResponse.qrcode,
      qrCodeImage: qrCodeResponse.imagemQrcode,
    });
  } catch (error) {
    console.error('Erro ao processar depósito Pix:', error);
    res.status(500).json({ error: 'Não foi possível gerar a cobrança Pix.' });
  }
});

// Webhook da Efí
app.post('/webhooks/pix', async (req, res) => {
  console.log('Webhook PIX recebido!');
  const pixData = req.body.pix;
  if (!Array.isArray(pixData)) {
    console.log('Webhook ignorado: formato inválido.');
    return res.status(400).send('Formato de webhook inválido.');
  }

  for (const pix of pixData) {
    const { txid, valor } = pix;
    try {
      await prisma.$transaction(async (tx) => {
        const deposit = await tx.pixDeposit.findUnique({ where: { txid } });
        if (!deposit || deposit.status !== 'PENDING') return;

        if (parseFloat(valor) !== deposit.amount) {
          console.warn(
            `Valor divergente no webhook (${valor}) vs registrado (${deposit.amount}) — txid: ${txid}`
          );
          return;
        }

        await tx.pixDeposit.update({
          where: { id: deposit.id },
          data: { status: 'COMPLETED' },
        });

        const wallet = await tx.wallet.findUnique({ where: { userId: deposit.userId } });
        if (!wallet) throw new Error(`Carteira do usuário ${deposit.userId} não encontrada.`);

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: deposit.amount } },
        });

        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            amount: deposit.amount,
            type: 'DEPOSIT',
            description: `Depósito via Pix aprovado (txid: ${txid})`,
          },
        });

        console.log(
          `Depósito de ${deposit.amount} creditado para o usuário ${deposit.userId} (txid: ${txid}).`
        );
      });
    } catch (err) {
      console.error(`Erro ao processar webhook txid ${txid}:`, err);
    }
  }

  res.status(200).send('OK');
});

// ============================= PLANOS / INVESTIMENTOS / SAQUES =============================

app.get('/planos', async (_req, res) => {
  try {
    const planos = await prisma.plan.findMany({ orderBy: { price: 'asc' } });
    res.status(200).json(planos);
  } catch {
    res.status(500).json({ error: 'Não foi possível buscar os planos.' });
  }
});

app.post('/investimentos', protect, async (req, res) => {
  try {
    const investingUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { wallet: true },
    });
    if (!investingUser)
      return res.status(404).json({ error: 'Usuário investidor não encontrado.' });

    const { planId: rawPlanId } = req.body;
    if (!rawPlanId) return res.status(400).json({ error: 'O ID do plano é obrigatório.' });

    const planId = parseInt(rawPlanId, 10);
    if (isNaN(planId)) return res.status(400).json({ error: 'O ID do plano é inválido.' });

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado.' });

    const userWallet = investingUser.wallet;
    if (!userWallet) return res.status(400).json({ error: 'Carteira do usuário não encontrada.' });

    const totalBalance = userWallet.balance + userWallet.referralBalance;
    if (totalBalance < plan.price)
      return res.status(400).json({ error: 'Saldo insuficiente para comprar este plano.' });

    const startDate = new Date();
    const endDate = addBusinessDays(startDate, plan.durationDays);

    const result = await prisma.$transaction(async (tx) => {
      let amountToDeductFromBalance = 0;
      let amountToDeductFromReferral = 0;

      if (plan.price <= userWallet.referralBalance) {
        amountToDeductFromReferral = plan.price;
      } else {
        amountToDeductFromReferral = userWallet.referralBalance;
        amountToDeductFromBalance = plan.price - userWallet.referralBalance;
      }

      await tx.wallet.update({
        where: { id: userWallet.id },
        data: {
          balance: { decrement: amountToDeductFromBalance },
          referralBalance: { decrement: amountToDeductFromReferral },
        },
      });

      await tx.transaction.create({
        data: {
          walletId: userWallet.id,
          amount: -plan.price,
          type: 'PLAN_PURCHASE',
          description: `Compra do ${plan.name}`,
        },
      });

      const novoInvestimento = await tx.investment.create({
        data: {
          userId: investingUser.id,
          planId,
          startDate,
          endDate,
        },
      });

      let commissionAmount = plan.price * 0.1;
      let currentReferrerId = investingUser.referrerId;

      for (let level = 1; level <= 4; level++) {
        if (!currentReferrerId) break;
        const referrer = await tx.user.findUnique({
          where: { id: currentReferrerId },
          include: { wallet: true },
        });
        if (referrer?.wallet) {
          const rounded = Math.round(commissionAmount * 100) / 100;
          await tx.wallet.update({
            where: { id: referrer.wallet.id },
            data: { referralBalance: { increment: rounded } },
          });
          await tx.transaction.create({
            data: {
              walletId: referrer.wallet.id,
              amount: rounded,
              type: 'REFERRAL_BONUS',
              description: `Bônus de indicação (Nível ${level}) pelo investimento de ${investingUser.name}`,
            },
          });
          commissionAmount = rounded * 0.1;
          currentReferrerId = referrer.referrerId;
        } else {
          break;
        }
      }

      return novoInvestimento;
    });

    await updateUserRankByTotalInvestment(investingUser.id);
    res.status(201).json(result);
  } catch {
    res.status(500).json({ error: 'Não foi possível processar o investimento.' });
  }
});

app.get('/meus-investimentos', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const investimentos = await prisma.investment.findMany({
      where: { userId },
      include: { plan: true },
      orderBy: { startDate: 'desc' },
    });
    res.status(200).json(investimentos);
  } catch {
    res.status(500).json({ error: 'Não foi possível buscar os investimentos.' });
  }
});

app.get('/minha-rede', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const referralCount = await prisma.user.count({ where: { referrerId: userId } });
    res.status(200).json({ count: referralCount });
  } catch {
    res.status(500).json({ error: 'Não foi possível buscar os dados da rede.' });
  }
});

app.get('/minha-rede-detalhes', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const network = await getNetworkLevels([userId]);
    res.status(200).json(network);
  } catch {
    res.status(500).json({ error: 'Não foi possível buscar os detalhes da rede.' });
  }
});

app.get('/meu-extrato', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return res.status(404).json({ error: 'Carteira do usuário não encontrada.' });

    const transactions = await prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(transactions);
  } catch {
    res.status(500).json({ error: 'Não foi possível buscar o extrato.' });
  }
});

app.post('/saques', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, walletType } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({ error: 'O valor do saque deve ser positivo.' });

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return res.status(404).json({ error: 'Carteira não encontrada.' });

    if (walletType === 'referral' && amount > wallet.referralBalance) {
      return res.status(400).json({ error: 'Saldo de indicação insuficiente.' });
    } else if (walletType === 'balance' && amount > wallet.balance) {
      return res.status(400).json({ error: 'Saldo de rendimentos insuficiente.' });
    }

    const newWithdrawal = await prisma.withdrawal.create({
      data: { amount: Number(amount), userId, walletType },
    });

    res.status(201).json(newWithdrawal);
  } catch {
    res.status(500).json({ error: 'Não foi possível processar a solicitação de saque.' });
  }
});

app.get('/saques', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(withdrawals);
  } catch {
    res.status(500).json({ error: 'Não foi possível buscar o histórico de saques.' });
  }
});

app.put('/perfil/alterar-senha', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword)
      return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });

    if (newPassword !== confirmPassword)
      return res
        .status(400)
        .json({ error: 'A nova senha e a confirmação não coincidem.' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid)
      return res.status(401).json({ error: 'A senha atual está incorreta.' });

    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
    await prisma.user.update({ where: { id: userId }, data: { password: hashedNewPassword } });

    res.status(200).json({ message: 'Senha alterada com sucesso!' });
  } catch {
    res.status(500).json({ error: 'Não foi possível alterar a senha.' });
  }
});

// ============================= ADMIN =============================

app.get('/admin/saques', protect, admin, async (_req, res) => {
  try {
    const pendingWithdrawals = await prisma.withdrawal.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { name: true, email: true } } },
    });
    res.status(200).json(pendingWithdrawals);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar saques pendentes.' });
  }
});

app.get('/admin/usuarios', protect, admin, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        rank: true,
        createdAt: true,
        _count: { select: { referees: true } },
      },
    });
    res.status(200).json(users);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: 'Não foi possível buscar a lista de usuários.' });
  }
});

app.post('/admin/saques/:id/aprovar', protect, admin, async (req, res) => {
  try {
    const withdrawalId = parseInt(req.params.id, 10);
    const result = await prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        include: { user: { include: { wallet: true } } },
      });
      if (!withdrawal || withdrawal.status !== 'PENDING')
        throw new Error('Saque inválido ou já processado.');

      const userWallet = withdrawal.user.wallet;
      let dataToUpdate = {};
      if (withdrawal.walletType === 'referral') {
        if (withdrawal.amount > userWallet.referralBalance)
          throw new Error('Saldo de indicação insuficiente.');
        dataToUpdate = { referralBalance: { decrement: withdrawal.amount } };
      } else {
        if (withdrawal.amount > userWallet.balance)
          throw new Error('Saldo de rendimentos insuficiente.');
        dataToUpdate = { balance: { decrement: withdrawal.amount } };
      }

      await tx.wallet.update({ where: { id: userWallet.id }, data: dataToUpdate });
      await tx.transaction.create({
        data: {
          walletId: userWallet.id,
          amount: -withdrawal.amount,
          type: 'WITHDRAWAL',
          description: `Saque de ${withdrawal.amount.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          })} (${withdrawal.walletType}) aprovado.`,
        },
      });
      return tx.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'APPROVED' } });
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/admin/saques/:id/rejeitar', protect, admin, async (req, res) => {
  try {
    const withdrawalId = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal || withdrawal.status !== 'PENDING')
      return res.status(400).json({ error: 'Saque inválido ou já processado.' });

    const rejectedWithdrawal = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'REJECTED', reason },
    });
    res.status(200).json(rejectedWithdrawal);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ============================= CRON =============================

app.post('/processar-rendimentos', (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }
  res.status(202).json({ message: 'Processamento de rendimentos iniciado em segundo plano.' });
  processDailyYields();
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
