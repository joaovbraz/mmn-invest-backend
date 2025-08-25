// Arquivo: src/index.js (do Backend) - VERSÃO CORRIGIDA

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { protect } from './authMiddleware.js';
import { processDailyYields } from './jobs/yieldProcessor.js';

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10;

app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => { res.json({ message: 'API do TDP INVEST funcionando!' }); });
// Rota para CRIAR USUÁRIO
app.post('/criar-usuario', async (req, res) => {
  const { email, name, password, referrerCode } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    let referrerId = null;
    if (referrerCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: referrerCode } });
      if (referrer) { referrerId = referrer.id; }
    }
    const newReferralCode = (name.substring(0, 4).toUpperCase() || 'USER') + Math.random().toString().slice(2, 7);
    const user = await prisma.user.create({ data: { email, name, password: hashedPassword, referralCode: newReferralCode, referrerId: referrerId } });
    await prisma.wallet.create({ data: { userId: user.id } });
    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    if (error.code === 'P2002' && error.meta?.target?.includes('email')) { return res.status(409).json({ error: 'Este email já está em uso.' }); }
    console.error("Erro no cadastro:", error);
    res.status(400).json({ error: 'Não foi possível completar o cadastro.' });
  }
});
// Rota para LOGIN
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { return res.status(404).json({ error: 'Usuário ou senha inválidos.' }); }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) { return res.status(401).json({ error: 'Usuário ou senha inválidos.' }); }
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
    const { password: _, ...userWithoutPassword } = user;
    res.status(200).json({ message: 'Login bem-sucedido!', user: userWithoutPassword, token: token });
  } catch (error) { res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' }); }
});
// Rota PROTEGIDA para BUSCAR DADOS DO USUÁRIO LOGADO
app.get('/meus-dados', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const userWithWallet = await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } });
        if (!userWithWallet) { return res.status(404).json({ error: 'Usuário não encontrado.' }); }
        delete userWithWallet.password;
        res.status(200).json(userWithWallet);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Não foi possível buscar os dados do usuário."})
    }
});
// Rota PÚBLICA para LISTAR OS PLANOS DE INVESTIMENTO
app.get('/planos', async (req, res) => {
  try {
    const planos = await prisma.plan.findMany({ orderBy: { price: 'asc' } });
    res.status(200).json(planos);
  } catch (error) { res.status(500).json({ error: 'Não foi possível buscar os planos.' }); }
});
// Rota PROTEGIDA para CRIAR UM NOVO INVESTIMENTO
app.post('/investimentos', protect, async (req, res) => {
  try {
    const investingUser = req.user;
    const { planId } = req.body;
    if (!planId) { return res.status(400).json({ error: 'O ID do plano é obrigatório.' }); }
    const result = await prisma.$transaction(async (prisma) => {
      const novoInvestimento = await prisma.investment.create({ data: { userId: investingUser.id, planId: planId } });
      if (investingUser.referrerId) {
        const plan = await prisma.plan.findUnique({ where: { id: planId } });
        const referrer = await prisma.user.findUnique({ where: { id: investingUser.referrerId }, include: { wallet: true } });
        if (referrer && referrer.wallet) {
          const commissionRate = 0.10;
          const commissionAmount = plan.price * commissionRate;
          await prisma.wallet.update({ where: { id: referrer.wallet.id }, data: { referralBalance: { increment: commissionAmount } } });
          await prisma.transaction.create({ data: { walletId: referrer.wallet.id, amount: commissionAmount, type: 'REFERRAL_BONUS', description: `Bônus de indicação pelo investimento de ${investingUser.name} no ${plan.name}` } });
          console.log(`Bônus de R$ ${commissionAmount} pago para o usuário ${referrer.id}`);
        }
      }
      return novoInvestimento;
    });
    res.status(201).json(result);
  } catch (error) {
    console.error("Erro ao processar investimento e bônus:", error);
    res.status(500).json({ error: 'Não foi possível processar o investimento.' });
  }
});
// Rota PROTEGIDA para LISTAR OS INVESTIMENTOS DO USUÁRIO
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
// Rota PROTEGIDA para CONTAR OS AFILIADOS
app.get('/minha-rede', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const referralCount = await prisma.user.count({
      where: { referrerId: userId, }
    });
    res.status(200).json({ count: referralCount });
  } catch (error) {
    console.error("Erro ao contar afiliados:", error);
    res.status(500).json({ error: "Não foi possível buscar os dados da rede." });
  }
});
// Rota PROTEGIDA para LISTAR OS DETALHES DOS AFILIADOS
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
// Rota PROTEGIDA para BUSCAR O EXTRATO DE TRANSAÇÕES
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
// Rota PROTEGIDA para CRIAR UM PEDIDO DE SAQUE
app.post('/saques', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;
    if (!amount || amount <= 0) { return res.status(400).json({ error: "O valor do saque deve ser positivo." }); }
    const wallet = await prisma.wallet.findUnique({ where: { userId: userId } });
    if (!wallet) { return res.status(404).json({ error: "Carteira não encontrada." }); }
    const totalBalance = wallet.balance + wallet.referralBalance;
    if (amount > totalBalance) { return res.status(400).json({ error: "Saldo insuficiente para realizar o saque." }); }
    const newWithdrawal = await prisma.withdrawal.create({ data: { amount: amount, userId: userId, } });
    res.status(201).json(newWithdrawal);
  } catch (error) {
    console.error("Erro ao criar pedido de saque:", error);
    res.status(500).json({ error: "Não foi possível processar a solicitação de saque." });
  }
});
// Rota PROTEGIDA para LISTAR O HISTÓRICO DE SAQUES
app.get('/saques', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const withdrawals = await prisma.withdrawal.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.status(200).json(withdrawals);
  } catch (error) {
    console.error("Erro ao buscar histórico de saques:", error);
    res.status(500).json({ error: "Não foi possível buscar o histórico de saques." });
  }
});


// ROTA SECRETA ATUALIZADA PARA NÃO DAR TIMEOUT
app.post('/processar-rendimentos', (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.CRON_SECRET) {
    // A LINHA ABAIXO FOI CORRIGIDA
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }
  res.status(202).json({ message: "Processamento de rendimentos iniciado em segundo plano." });
  processDailyYields(); 
});


const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});