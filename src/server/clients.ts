// One Apricot client per saved connection, shared by page requests and background runs.

import { ApricotClient } from "./apricot";
import { getConnection, getSecret } from "./store";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const clients = new Map<string, ApricotClient>();

export async function clientFor(connectionId: string): Promise<ApricotClient> {
  const cached = clients.get(connectionId);
  if (cached) return cached;
  const conn = getConnection(connectionId);
  if (!conn) throw new HttpError(404, "This connection no longer exists. Add it again on the Connections page.");
  const secret = await getSecret(connectionId);
  if (!secret) throw new HttpError(400, "The saved secret for this connection is missing. Remove the connection and add it again.");
  const client = new ApricotClient(connectionId, conn.clientId, secret);
  clients.set(connectionId, client);
  return client;
}

export const forgetClient = (connectionId: string) => clients.delete(connectionId);

/** Run async work over items with a fixed number running at once. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
