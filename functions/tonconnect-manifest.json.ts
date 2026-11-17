import { handleTonManifestRequest } from '../server/edgeEngine';

interface PagesContext {
  request: Request;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  return handleTonManifestRequest(context.request);
};
