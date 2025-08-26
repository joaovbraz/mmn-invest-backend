// Arquivo: src/authMiddleware.js - VERSÃO FINAL

import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
      if (!user) {
        throw new Error('Usuário não encontrado');
      }
      delete user.password;
      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
  }
  if (!token) {
    return res.status(401).json({ error: 'Nenhum token, autorização negada.' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    res.status(403).json({ error: 'Acesso negado. Rota de administrador.' });
  }
};

export { protect, admin };