// Arquivo: src/index.js (do Backend) - CADASTRO COM LÓGICA DE INDICAÇÃO

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

// =================================================================
// ROTA DE CADASTRO ATUALIZADA COM LÓGICA DE MMN
// =================================================================
app.post('/criar-usuario', async (req, res) => {
  // Agora também recebemos o código de quem indicou (se houver)
  const { email, name, password, referrerCode } = req.body;
  
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    let referrerId = null;

    // 1. VERIFICA SE VEIO UM CÓDIGO DE INDICAÇÃO
    if (referrerCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: referrerCode },
      });
      
      // Se encontramos o "padrinho", guardamos o ID dele
      if (referrer) {
        referrerId = referrer.id;
      }
    }

    // 2. GERA UM CÓDIGO DE INDICAÇÃO ÚNICO PARA O NOVO USUÁRIO
    // Pega os 4 primeiros caracteres do nome, coloca em maiúsculo e adiciona 5 números aleatórios
    const newReferralCode = (name.substring(0, 4).toUpperCase() || 'USER') + Math.random().toString().slice(2, 7);

    // 3. CRIA O USUÁRIO E A CARTEIRA
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        referralCode: newReferralCode, // Salva o código de indicação dele
        referrerId: referrerId,       // Salva o ID do padrinho (ou null se não houver)
      },
    });

    await prisma.wallet.create({
      data: { userId: user.id },
    });

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


// ... (todas as outras rotas /login, /planos, etc. continuam aqui exatamente como antes) ...
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
app.get('/meus-dados', async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
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
    const userId = req.user.id;
    const { planId } = req.body;
    if (!planId) { return res.status(400).json({ error: 'O ID do plano é obrigatório.' }); }
    const novoInvestimento = await prisma.investment.create({ data: { userId: userId, planId: planId } });
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