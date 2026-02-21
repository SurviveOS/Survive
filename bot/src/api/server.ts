import http from 'http';
import { SurviveAgent } from '../core/agent';
import { Logger } from '../utils/logger';

const logger = new Logger('API');

/**
 * Simple HTTP API server for dashboard integration
 */
export function startApiServer(agent: SurviveAgent, port: number = 3001): http.Server {
  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/api/status' && req.method === 'GET') {
      try {
        const data = agent.getDashboardData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data, null, 2));
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    } else if (req.url === '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(port, () => {
    logger.info(`API server running on http://localhost:${port}`);
  });

  return server;
}
