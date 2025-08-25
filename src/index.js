// Arquivo: src/index.js (do Backend) - VERSÃO SEGURA

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt'; // <-- 1. IMPORTAMOS O BCRYPT

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10; // Fator de segurança para a criptografia

// Middlewares
app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

// Rota para CRIAR USUÁRIO (ATUALIZADA COM CRIPTOGRAFIA)
app.post('/criar-usuario', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    // CRIPTOGRAFA A SENHA ANTES DE SALVAR
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const novoUsuario = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword, // <-- 2. SALVAMOS A SENHA CRIPTOGRAFADA
      },
    });

    const { password: _, ...userWithoutPassword } = novoUsuario;
    res.status(201).json(userWithoutPassword);

  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Rota para LOGIN (ATUALIZADA COM CRIPTOGRAFIA)
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email: email },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário ou senha inválidos.' });
    }

    // COMPARA A SENHA ENVIADA COM A SENHA CRIPTOGRAFADA NO BANCO
    const isPasswordValid = await bcrypt.compare(password, user.password); // <-- 3. USAMOS BCRYPT PARA COMPARAR

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.status(200).json({
      message: 'Login bem-sucedido!',
      user: userWithoutPassword,
    });

  } catch (error) {
    res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
  }
});


const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});