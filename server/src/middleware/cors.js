import { ALLOWED_ORIGINS } from '../constants/http.js';

export function cors(req, res, next) {
  const { origin } = req.headers;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // so caches do not serve one origin's headers to another
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204); 
    return;
  }

  next();
}
