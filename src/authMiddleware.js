// src/authMiddleware.js
import jwt from 'jsonwebtoken';

/**
 * Extrai o token do request em várias fontes:
 * - Authorization: Bearer <token>
 * - query string (?token=<token>)  -> necessário para EventSource/SSE
 * - cookie "authToken"
 * - header "x-access-token" (fallback)
 */
function extractToken(req) {
  // 1) Authorization: Bearer <token>
  const auth = req.headers?.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  // 2) ?token=<jwt> (SSE não permite custom headers)
  if (req.query && typeof req.query.token === 'string' && req.query.token.length > 0) {
    return req.query.token;
  }

  // 3) Cookie "authToken" (caso você opte usar cookies no front)
  const cookieHeader = req.headers?.cookie || '';
  if (cookieHeader.includes('authToken=')) {
    try {
      const pair = cookieHeader
        .split(';')
        .map(s => s.trim())
        .find(s => s.startsWith('authToken='));
      if (pair) {
        return decodeURIComponent(pair.split('=')[1]);
      }
    } catch {
      // ignore
    }
  }

  // 4) Header alternativo
  const alt = req.headers['x-access-token'];
  if (typeof alt === 'string' && alt.length > 0) {
    return alt;
  }

  return null;
}

/**
 * Valida o JWT e popula req.user.
 * Retorna 401 se não houver ou se for inválido.
 */
export function authenticate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[AUTH] JWT_SECRET ausente no ambiente.');
      return res.status(500).json({ ok: false, error: 'server_misconfigured' });
    }

    const payload = jwt.verify(token, secret);

    // compat: alguns lugares usam userId, outros id
    const userId = payload.userId ?? payload.id ?? payload.sub;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'invalid_token_payload' });
    }

    req.user = {
      id: userId,
      email: payload.email ?? null,
      role: payload.role ?? 'user',
      raw: payload,
    };

    return next();
  } catch (err) {
    console.warn('[AUTH] Token inválido:', err?.message);
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
}

/**
 * Autenticação opcional: se houver token válido, coloca req.user; caso contrário, segue sem 401.
 * Útil se você tiver rotas públicas que se beneficiem de saber o usuário quando disponível.
 */
export function authenticateOptional(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const secret = process.env.JWT_SECRET;
    if (!secret) return next();

    const payload = jwt.verify(token, secret);
    req.user = {
      id: payload.userId ?? payload.id ?? payload.sub,
      email: payload.email ?? null,
      role: payload.role ?? 'user',
      raw: payload,
    };
    return next();
  } catch {
    // ignora erros e segue como não autenticado
    return next();
  }
}

export default authenticate;
