// Arquivo: src/index.js (do Backend)

import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';

const app = express();
const prisma = new PrismaClient();

// Middlewares
app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

// Rota para CRIAR USUÁRIO (já tínhamos)
app.post('/criar-usuario', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    const novoUsuario = await prisma.user.create({
      data: {
        email,
        name,
        password, // ATENÇÃO: No futuro, vamos criptografar isso!
      },
    });

    res.status(201).json(novoUsuario);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// =============================================================
// NOVA ROTA PARA LOGIN
// =============================================================
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Encontrar o usuário pelo email
    const user = await prisma.user.findUnique({
      where: { email: email },
    });

    // 2. Se o usuário não for encontrado, retornar um erro
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // 3. Se o usuário for encontrado, comparar as senhas
    // ATENÇÃO: Esta é uma comparação simples. O ideal é usar criptografia.
    if (user.password !== password) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    // Por segurança, removemos a senha do objeto antes de enviá-lo de volta
    const { password: _, ...userWithoutPassword } = user;

    // 4. Se as senhas baterem, retornar uma mensagem de sucesso
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