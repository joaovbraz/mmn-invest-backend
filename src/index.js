// Arquivo: src/index.js (do Backend) - VERSÃO COMPLETA COM REJEIÇÃO DE SAQUES

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

async function updateUserRank(userId) { /* ...código da função sem alteração... */ }

app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => { res.json({ message: 'API do TDP INVEST funcionando!' }); });

// Rota para CRIAR USUÁRIO
app.post('/criar-usuario', async (req, res) => { /* ...código existente sem alterações... */ });

// Rota para LOGIN
app.post('/login', async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PROTEGIDA para BUSCAR DADOS DO USUÁRIO LOGADO
app.get('/meus-dados', protect, async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PÚBLICA para LISTAR OS PLANOS DE INVESTIMENTO
app.get('/planos', async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PROTEGIDA para CRIAR UM NOVO INVESTIMENTO
app.post('/investimentos', protect, async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PROTEGIDA para LISTAR OS INVESTIMENTOS DO USUÁRIO
app.get('/meus-investimentos', protect, async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PROTEGIDA para CONTAR OS AFILIADOS
app.get('/minha-rede', protect, async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PROTEGIDA para LISTAR OS DETALHES DOS AFILIADOS
app.get('/minha-rede-detalhes', protect, async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PROTEGIDA para BUSCAR O EXTRATO DE TRANSAÇÕES
app.get('/meu-extrato', protect, async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PROTEGIDA para CRIAR UM PEDIDO DE SAQUE
app.post('/saques', protect, async (req, res) => { /* ...código existente sem alterações... */ });

// Rota PROTEGIDA para LISTAR O HISTÓRICO DE SAQUES
app.get('/saques', protect, async (req, res) => { /* ...código existente sem alterações... */ });


// ROTAS DE ADMINISTRAÇÃO

// Lista todos os saques pendentes para o admin
app.get('/admin/saques', protect, admin, async (req, res) => {
  try {
    const pendingWithdrawals = await prisma.withdrawal.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true, email: true } } } });
    res.status(200).json(pendingWithdrawals);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar saques pendentes.' });
  }
});

// Aprova um saque específico
app.post('/admin/saques/:id/aprovar', protect, admin, async (req, res) => {
  try {
    const withdrawalId = parseInt(req.params.id);
    const result = await prisma.$transaction(async (prisma) => {
      const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId }, include: { user: { include: { wallet: true } } } });
      if (!withdrawal) throw new Error("Pedido de saque não encontrado.");
      if (withdrawal.status !== 'PENDING') throw new Error("Este saque já foi processado.");
      const userWallet = withdrawal.user.wallet;
      if (!userWallet) throw new Error("Carteira do usuário não encontrada.");
      const totalBalance = userWallet.balance + userWallet.referralBalance;
      if (withdrawal.amount > totalBalance) throw new Error("Saldo insuficiente no momento da aprovação.");
      let amountToDeductFromBalance = 0;
      let amountToDeductFromReferral = 0;
      if (withdrawal.amount <= userWallet.referralBalance) {
        amountToDeductFromReferral = withdrawal.amount;
      } else {
        amountToDeductFromReferral = userWallet.referralBalance;
        amountToDeductFromBalance = withdrawal.amount - userWallet.referralBalance;
      }
      await prisma.wallet.update({ where: { id: userWallet.id }, data: { balance: { decrement: amountToDeductFromBalance }, referralBalance: { decrement: amountToDeductFromReferral } } });
      await prisma.transaction.create({ data: { walletId: userWallet.id, amount: -withdrawal.amount, type: 'WITHDRAWAL', description: `Saque de ${withdrawal.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} aprovado.` } });
      return prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'APPROVED' }, });
    });
    res.status(200).json(result);
  } catch (error) {
    console.error("Erro ao aprovar saque:", error.message);
    res.status(400).json({ error: error.message });
  }
});

// Rejeita um saque específico
app.post('/admin/saques/:id/rejeitar', protect, admin, async (req, res) => {
  try {
    const withdrawalId = parseInt(req.params.id);
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) { return res.status(404).json({ error: 'Pedido de saque não encontrado.' }); }
    if (withdrawal.status !== 'PENDING') { return res.status(400).json({ error: 'Este saque já foi processado.' }); }
    const rejectedWithdrawal = await prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'REJECTED' } });
    res.status(200).json(rejectedWithdrawal);
  } catch (error) {
    console.error("Erro ao rejeitar saque:", error.message);
    res.status(400).json({ error: error.message });
  }
});


// ROTA SECRETA
app.post('/processar-rendimentos', (req, res) => { /* ...código existente sem alterações... */ });

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});