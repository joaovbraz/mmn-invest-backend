// Arquivo: src/index.js (do Backend) - COM LÓGICA DE PLANO DE CARREIRA

import express from 'express';
import { PrismaClient } from '@prisma/client';
// ... (resto dos imports)
import { protect } from './authMiddleware.js';
import { processDailyYields } from './jobs/yieldProcessor.js';

const app = express();
const prisma = new PrismaClient();
// ... (resto da configuração inicial)

// =================================================================
// NOVA FUNÇÃO "PROMOTORA" PARA ATUALIZAR O RANK DO USUÁRIO
// =================================================================
async function updateUserRank(userId) {
  try {
    const referralCount = await prisma.user.count({
      where: { referrerId: userId },
    });

    let newRank = "Bronze";
    if (referralCount >= 50) {
      newRank = "Diamante";
    } else if (referralCount >= 20) {
      newRank = "Platina";
    } else if (referralCount >= 10) {
      newRank = "Ouro";
    } else if (referralCount >= 5) {
      newRank = "Prata";
    }

    await prisma.user.update({
      where: { id: userId },
      data: { rank: newRank },
    });

    console.log(`Rank do usuário ${userId} verificado. Indicados: ${referralCount}. Novo Rank: ${newRank}.`);
  } catch (error) {
    console.error(`Erro ao atualizar rank do usuário ${userId}:`, error);
  }
}


app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => { res.json({ message: 'API do TDP INVEST funcionando!' }); });

// Rota para CRIAR USUÁRIO (AGORA COM GATILHO DE PROMOÇÃO)
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
    
    const user = await prisma.user.create({
      data: {
        email, name, password: hashedPassword,
        referralCode: newReferralCode,
        referrerId: referrerId,
      }
    });

    await prisma.wallet.create({ data: { userId: user.id } });

    // SE HOUVE UM PADRINHO, VERIFICA SE ELE MERECE PROMOÇÃO
    if (referrerId) {
      updateUserRank(referrerId); // <-- GATILHO DA PROMOÇÃO
    }

    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    if (error.code === 'P2002' && error.meta?.target?.includes('email')) { return res.status(409).json({ error: 'Este email já está em uso.' }); }
    console.error("Erro no cadastro:", error);
    res.status(400).json({ error: 'Não foi possível completar o cadastro.' });
  }
});

// ... (todas as outras rotas /login, /planos, etc. continuam aqui exatamente como antes) ...
// Rota para LOGIN
app.post('/login', async (req, res) => { /* ...código existente sem alterações... */ });
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
app.post('/saques', async (req, res) => { /* ...código existente sem alterações... */ });
// Rota PROTEGIDA para LISTAR O HISTÓRICO DE SAQUES
app.get('/saques', protect, async (req, res) => { /* ...código existente sem alterações... */ });
// ROTA SECRETA ATUALIZADA PARA NÃO DAR TIMEOUT
app.post('/processar-rendimentos', (req, res) => { /* ...código existente sem alterações... */ });

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});