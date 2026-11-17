import { handleApiRequest, type EdgeEnv } from '../../server/edgeEngine';

interface PagesContext {
  request: Request;
  env: EdgeEnv;
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  return handleApiRequest(context.request, context.env);
};
