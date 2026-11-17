import { handleApiRequest, handleTonManifestRequest, type EdgeEnv } from './server/edgeEngine';

export interface WorkerEnv extends EdgeEnv {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }

    if (url.pathname === '/tonconnect-manifest.json') {
      return handleTonManifestRequest(request);
    }

    return env.ASSETS.fetch(request);
  },
};
