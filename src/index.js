// Arquivo: src/index.js

import express from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

// Isso permite que nosso servidor entenda JSON nas requisições
app.use(express.json());

// Rota de teste para saber se o servidor está funcionando
app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

// ROTA PARA CRIAR USUÁRIO (O nosso "guichê de atendimento")
app.post('/criar-usuario', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    // Usando o Prisma para criar um novo usuário no banco de dados
    const novoUsuario = await prisma.user.create({
      data: {
        email,
        name,
        password, // ATENÇÃO: No futuro, vamos criptografar isso!
      },
    });

    // Enviando uma resposta de sucesso com os dados do usuário criado
    res.status(201).json(novoUsuario);
  } catch (error) {
    // Se der algum erro (ex: email já existe), envia uma resposta de erro
    res.status(400).json({ error: error.message });
  }
});


const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});