// Arquivo: src/authMiddleware.js

import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const protect = async (req, res, next) => {
  let token;

  // Verifica se o token foi enviado no cabeçalho da requisição
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Extrai o token do cabeçalho (formato "Bearer TOKEN_LONGO")
      token = req.headers.authorization.split(' ')[1];

      // Verifica se o token é válido usando nossa chave secreta
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Pega o ID do usuário de dentro do token e busca o usuário no banco
      // para garantir que ele ainda existe.
      req.user = await prisma.user.findUnique({ where: { id: decoded.userId }});

      // Se encontrou o usuário, remove a senha dele por segurança
      delete req.user.password;

      // Libera o acesso para a próxima etapa (a rota de verdade)
      next();

    } catch (error) {
      res.status(401).json({ error: 'Token inválido, autorização negada.' });
      return;
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Nenhum token, autorização negada.' });
  }
};

export { protect };