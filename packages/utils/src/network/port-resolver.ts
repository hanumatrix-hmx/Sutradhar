/**
 * @file packages/utils/src/network/port-resolver.ts
 * @description PortResolver providing dynamic TCP port availability checking and automatic fallback resolution.
 */

import net from 'net';

export class PortResolver {
  public static async isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const server = net.createServer();

        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            resolve(false);
          } else {
            resolve(false);
          }
        });

        server.once('listening', () => {
          server.close(() => resolve(true));
        });

        server.listen(port, host);
      } catch {
        resolve(true);
      }
    });
  }

  public static async findAvailablePort(
    startPort = 3000,
    maxAttempts = 50,
    host = '127.0.0.1',
  ): Promise<number> {
    let currentPort = startPort;
    for (let i = 0; i < maxAttempts; i++) {
      const available = await this.isPortAvailable(currentPort, host);
      if (available) {
        return currentPort;
      }
      currentPort++;
    }
    return startPort + maxAttempts;
  }

  public static getEnvironmentEndpoints(): {
    apiBaseUrl: string;
    wsUrl: string;
    backendPort: number;
    frontendPort: number;
  } {
    const backendPort = parseInt(process.env['PORT'] || process.env['BACKEND_PORT'] || '3000', 10);
    const frontendPort = parseInt(
      process.env['VITE_PORT'] || process.env['FRONTEND_PORT'] || '5173',
      10,
    );
    const host = process.env['HOST'] || 'localhost';

    const apiBaseUrl = process.env['VITE_API_BASE_URL'] || `http://${host}:${backendPort}`;
    const wsUrl = process.env['VITE_WS_URL'] || `ws://${host}:${backendPort}`;

    return {
      apiBaseUrl,
      wsUrl,
      backendPort,
      frontendPort,
    };
  }
}
