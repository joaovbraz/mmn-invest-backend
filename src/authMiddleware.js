// src/authMiddleware.js
import jwt from 'jsonwebtoken';

/**
 * Extrai token do request:
 * - Authorization: Bearer <token>
 * - query string (?token=<token>)  -> útil para SSE/EventSource
 * - cookie "authToken"
 * - header "x-access-token"
 */
function extractToken(req) {
  // Authorization
  const auth = req.headers?.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  // ?token=
  if (req.query && typeof req.query.token === 'string' && req.query.token.length > 0) {
    return req.query.token;
  }

  // Cookie
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

  // x-access-token
  const alt = req.headers['x-access-token'];
  if (typeof alt === 'string' && alt.length > 0) {
    return alt;
  }

  return null;
}

/**
 * Valida o JWT e popula req.user.
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
 * Opcional: se houver token válido, seta req.user; senão segue.
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
    return next();
  }
}

/**
 * Checagem de admin. Pressupõe que protect/autenticate já rodou antes.
 * Se preferir usar isolado, ele tenta autenticar também.
 */
export function admin(req, res, next) {
  if (!req.user) {
    // tenta autenticar se alguém usar admin isolado
    return authenticate(req, res, function afterAuth(err) {
      if (err) return next(err);
      if (!req.user) return res.status(401).json({ ok: false, error: 'unauthorized' });
      if ((req.user.role ?? 'user') !== 'admin') {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      return next();
    });
  }

  if ((req.user.role ?? 'user') !== 'admin') {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  return next();
}

/** Compat com seu código antigo */
export const protect = authenticate;

/** default export opcional */
export default authenticate;
