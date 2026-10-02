/**
 * A stand-in for the PostgREST in front of a Supabase project, for tests of the front end's server
 * client (ROADMAP M2.7): an HTTP server on the loopback interface that answers `POST /rest/v1/rpc/<fn>`
 * by running the function on the local test database as the anon role (`TestDb.rpc`, one transaction
 * with the request settings a gateway sets), and turns a failure into the response PostgREST gives: the
 * HTTP status named by a `PT<status>` SQLSTATE (`hb.fail`), the JSON body `{code, message, details,
 * hint}`. It lets the real supabase-js and the real API wrappers run against the real PL/pgSQL, which
 * is what `backend.db.test.ts` is for. It is not a security boundary and never listens beyond 127.0.0.1.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ANON, type TestDb } from './harness'

export interface Shim {
  /** `http://127.0.0.1:<port>` */
  readonly url: string
  /** Every request handled: the function and the JSON text of its body, in order. */
  readonly requests: { readonly fn: string; readonly body: string; readonly ip: string }[]
  close(): Promise<void>
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** The HTTP status PostgREST gives for a Postgres error. */
export function statusOf(code: string | undefined): number {
  const m = /^PT(\d{3})$/u.exec(code ?? '')
  if (m !== null) return Number(m[1])
  if (code === '42501') return 403
  if (code === '42883') return 404
  return 400
}

export async function startShim(db: TestDb): Promise<Shim> {
  const requests: Shim['requests'][number][] = []
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const server = createServer((req, res) => {
    void (async () => {
      const m = /^\/rest\/v1\/rpc\/(\w+)$/u.exec(req.url ?? '')
      if (req.method !== 'POST' || m === null) return send(res, 404, { code: 'PGRST125', message: 'Invalid path specified in request URL', details: null, hint: null })
      const body = await read(req)
      const ip = String(req.headers['x-forwarded-for'] ?? '203.0.113.200')
      requests.push({ fn: m[1]!, body, ip })
      try {
        const data = await db.rpc({ ...ANON, headers: { 'x-forwarded-for': ip } }, m[1]!, body === '' ? {} : (JSON.parse(body) as Record<string, unknown>))
        send(res, 200, data)
      } catch (e) {
        const err = e as { code?: string; message?: string; detail?: string; hint?: string }
        send(res, statusOf(err.code), { code: err.code ?? '', message: err.message ?? 'error', details: err.detail ?? null, hint: err.hint ?? null })
      }
    })().catch((e: unknown) => send(res, 500, { code: '', message: String(e), details: null, hint: null }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
