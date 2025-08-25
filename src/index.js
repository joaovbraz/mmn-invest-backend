// Arquivo: src/index.js (do Backend) - COM PAGAMENTO DE BÔNUS DE INDICAÇÃO

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

// ... (todas as outras rotas /criar-usuario, /login, etc. continuam aqui exatamente como antes) ...
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

// =================================================================
// ROTA DE INVESTIMENTO ATUALIZADA PARA PAGAR BÔNUS DE INDICAÇÃO
// =================================================================
app.post('/investimentos', protect, async (req, res) => {
  try {
    const investingUser = req.user; // O usuário que está comprando o plano
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'O ID do plano é obrigatório.' });
    }

    // Usamos uma transação para garantir que tudo aconteça junto
    const result = await prisma.$transaction(async (prisma) => {
      // 1. CRIA O INVESTIMENTO PARA O AFILIADO (como antes)
      const novoInvestimento = await prisma.investment.create({
        data: {
          userId: investingUser.id,
          planId: planId,
        }
      });

      // 2. VERIFICA SE O AFILIADO TEM UM PADRINHO
      if (investingUser.referrerId) {
        const plan = await prisma.plan.findUnique({ where: { id: planId } });
        const referrer = await prisma.user.findUnique({
          where: { id: investingUser.referrerId },
          include: { wallet: true }, // Pega a carteira do padrinho
        });

        // Se o padrinho e a carteira dele existem...
        if (referrer && referrer.wallet) {
          // 3. CALCULA E PAGA A COMISSÃO
          const commissionRate = 0.10; // 10%
          const commissionAmount = plan.price * commissionRate;

          // Deposita a comissão no saldo de indicações do padrinho
          await prisma.wallet.update({
            where: { id: referrer.wallet.id },
            data: {
              referralBalance: { increment: commissionAmount }
            }
          });

          // Cria um registro da transação para o extrato do padrinho
          await prisma.transaction.create({
            data: {
              walletId: referrer.wallet.id,
              amount: commissionAmount,
              type: 'REFERRAL_BONUS',
              description: `Bônus de indicação pelo investimento de ${investingUser.name} no ${plan.name}`,
            }
          });
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
// ROTA SECRETA ATUALIZADA PARA NÃO DAR TIMEOUT
app.post('/processar-rendimentos', (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }
  res.status(202).json({ message: "Processamento de rendimentos iniciado em segundo plano." });
  processDailyYields(); 
});


const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});