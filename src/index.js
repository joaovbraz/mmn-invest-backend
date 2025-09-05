// src/index.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import { protect, admin } from './authMiddleware.js';
import { processDailyYields } from './jobs/yieldProcessor.js';
import { createImmediateCharge, generateQrCode, __debugOAuth } from './efiPay.js';

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

// ---------- middlewares base ----------
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Logger simples para ver se a requisição chega e se traz Authorization
app.use((req, _res, next) => {
  if (req.path.startsWith('/depositos')) {
    console.log(`[REQ] ${req.method} ${req.path}`, {
      hasAuth: !!(req.headers.authorization || req.headers.Authorization),
    });
  }
  next();
});

app.get('/', (_req, res) => res.json({ message: 'API do TDP INVEST funcionando!' }));

// ---------- rota de debug do OAuth (proteja com DEBUG_SECRET) ----------
app.get('/debug/efi-oauth', async (req, res) => {
  try {
    const secret = req.query.secret || req.headers['x-debug-secret'];
    if (!process.env.DEBUG_SECRET || secret !== process.env.DEBUG_SECRET) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const token = await __debugOAuth();
    return res.json({ ok: true, tokenPreview: token.slice(0, 16) + '...' });
  } catch (e) {
    console.error('[DEBUG] OAuth falhou:', e?.message);
    return res.status(500).json({ ok: false, error: e?.message || 'erro' });
  }
});

// ---------- helpers ----------
const rankKeys = Object.keys(rankThresholds).sort(
  (a, b) => rankThresholds[b] - rankThresholds[a]
);

async function updateUserRankByTotalInvestment(userId) {
  try {
    const invs = await prisma.investment.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
    });
    const total = invs.reduce((s, i) => s + i.plan.price, 0);
    let newRank = 'Bronze';
    for (const k of rankKeys) {
      if (total >= rankThresholds[k]) {
        newRank = k;
        break;
      }
    }
    await prisma.user.update({ where: { id: userId }, data: { rank: newRank } });
  } catch (e) {
    console.error('Erro ao atualizar rank:', e);
  }
}

// ---------- auth ----------
app.post('/criar-usuario', async (req, res) => {
  const { email, name, password, referrerCode } = req.body;
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Todos os campos (nome, email, senha) são obrigatórios.' });
  }
  try {
    const hashed = await bcrypt.hash(password, saltRounds);
    let referrerId = null;
    if (referrerCode) {
      const ref = await prisma.user.findUnique({ where: { referralCode: referrerCode } });
      if (ref) referrerId = ref.id;
    }
    const newCode =
      (name.substring(0, 4).toUpperCase() || 'USER') +
      Math.floor(10000 + Math.random() * 90000);
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, name, password: hashed, referralCode: newCode, referrerId },
      });
      await tx.wallet.create({ data: { userId: u.id } });
      if (referrerId) {
        await tx.user.update({
          where: { id: referrerId },
          data: { careerPoints: { increment: 10 } },
        });
      }
      return u;
    });
    const { password: _pw, ...safe } = user;
    return res.status(201).json(safe);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Este email ou código de convite já está em uso.' });
    }
    return res.status(400).json({ error: `Erro técnico rastreado: ${error.message}` });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Usuário ou senha inválidos.' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta.' });
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    const { password: _pw, ...safe } = user;
    return res.status(200).json({ message: 'Login bem-sucedido!', user: safe, token });
  } catch {
    return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
  }
});

// ---------- dados do usuário ----------
app.get('/meus-dados', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const u = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true, _count: { select: { referees: true } } },
    });
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const invs = await prisma.investment.findMany({ where: { userId }, include: { plan: true } });
    const totalInvested = invs.reduce((s, i) => s + i.plan.price, 0);
    const { password: _pw, ...safe } = u;
    return res.status(200).json({ ...safe, totalInvested, referralCount: safe._count.referees });
  } catch (e) {
    console.error('[meus-dados] erro:', e);
    return res.status(500).json({ error: 'Não foi possível buscar os dados do usuário.' });
  }
});

app.put('/meus-dados', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'O nome é obrigatório.' });
    const u = await prisma.user.update({ where: { id: userId }, data: { name, phone } });
    const { password: _pw, ...safe } = u;
    return res.status(200).json(safe);
  } catch (e) {
    console.error('[meus-dados PUT] erro:', e);
    return res.status(500).json({ error: 'Não foi possível atualizar os dados do perfil.' });
  }
});

// ---------- DEPÓSITO PIX ----------
app.post('/depositos/pix', protect, async (req, res) => {
  const userId = req.user.id;
  const { amount, cpf } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'O valor do depósito deve ser positivo.' });
  }
  if (!cpf) {
    return res.status(400).json({ error: 'O CPF é obrigatório para gerar a cobrança Pix.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const txid = crypto.randomBytes(16).toString('hex').slice(0, 32);

    const charge = await createImmediateCharge({
      txid,
      amount: Number(amount),
      cpf,
      name: user.name,
    });

    const locId = charge?.loc?.id;
    if (!locId) throw new Error('LOC não retornado pela Efí.');

    const qr = await generateQrCode({ locId });

    await prisma.pixDeposit.create({
      data: {
        userId,
        amount: Number(amount),
        txid,
        status: 'PENDING',
        efilocId: locId,
        payloadQrCode: qr.qrcode,
        imagemQrcode: qr.imagemQrcode,
      },
    });

    return res.status(201).json({
      qrCode: qr.qrcode,
      qrCodeImage: qr.imagemQrcode,
    });
  } catch (error) {
    console.error('[depositos/pix] erro:', error?.message, error);
    return res.status(500).json({ error: 'Não foi possível gerar a cobrança Pix.' });
  }
});

// ---------- Webhook Pix ----------
app.post('/webhooks/pix', async (req, res) => {
  console.log('Webhook PIX recebido!');
  const pixData = req.body.pix;
  if (!Array.isArray(pixData)) return res.status(400).send('Formato inválido.');

  for (const pix of pixData) {
    const { txid, valor } = pix;
    try {
      await prisma.$transaction(async (tx) => {
        const dep = await tx.pixDeposit.findUnique({ where: { txid } });
        if (!dep || dep.status !== 'PENDING') return;
        if (parseFloat(valor) !== dep.amount) return;

        await tx.pixDeposit.update({ where: { id: dep.id }, data: { status: 'COMPLETED' } });

        const wallet = await tx.wallet.findUnique({ where: { userId: dep.userId } });
        if (!wallet) throw new Error(`Carteira do usuário ${dep.userId} não encontrada.`);

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: dep.amount } },
        });

        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            amount: dep.amount,
            type: 'DEPOSIT',
            description: `Depósito via Pix aprovado (txid: ${txid})`,
          },
        });
      });
    } catch (e) {
      console.error(`Erro ao processar webhook txid ${txid}:`, e);
    }
  }

  return res.status(200).send('OK');
});

// ---------- CRON ----------
app.post('/processar-rendimentos', (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }
  res.status(202).json({ message: 'Processamento de rendimentos iniciado.' });
  processDailyYields();
});

// ---------- ERROR HANDLER GLOBAL ----------
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ error: 'Erro interno.' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
