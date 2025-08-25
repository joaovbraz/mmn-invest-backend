// Arquivo: src/index.js (do Backend) - VERSÃO FINAL E CORRIGIDA

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const app = express();
const prisma = new PrismaClient();
const saltRounds = 10;

// Middlewares
app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

// Rota para CRIAR USUÁRIO
app.post('/criar-usuario', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const novoUsuario = await prisma.user.create({
      data: { email, name, password: hashedPassword },
    });
    const { password: _, ...userWithoutPassword } = novoUsuario;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Rota para LOGIN (GARANTINDO QUE ENVIA O TOKEN)
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: 'Usuário ou senha inválidos.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    const { password: _, ...userWithoutPassword } = user;
    
    res.status(200).json({
      message: 'Login bem-sucedido!',
      user: userWithoutPassword,
      token: token // <-- A LINHA MAIS IMPORTANTE
    });

  } catch (error) {
    res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
  }
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});