/**
 * SDK oficial da API AurePay para Node.js / TypeScript.
 */
import { createClient, createConfig } from './generated/client/index.js'
import type { Client } from './generated/client/index.js'
import * as api from './generated/sdk.gen.js'

export type { Client }
export type * from './generated/types.gen.js'
export { api as operations }

/** Configuração do cliente AurePay. */
export type AurePayConfig = {
  apiKey: string
  apiSecret: string
  baseUrl?: string
  maxRetries?: number
}

/** Erro tipado da API (envelope `success: false` ou falha de rede). */
export class AurePayError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly details: unknown,
    public readonly statusCode: number
  ) {
    super(message)
    this.name = 'AurePayError'
  }
}

type JsonObject = Record<string, unknown>

/** Extrai `data` do envelope `{ success, data }` quando presente. */
function unwrapData<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'success' in payload &&
    (payload as { success?: unknown }).success === true &&
    'data' in payload
  ) {
    return (payload as { data: T }).data
  }

  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }

  return payload as T
}

/** Normaliza erros HTTP/JSON para `AurePayError`. */
function toAurePayError(error: unknown, statusCode = 0): AurePayError {
  if (error instanceof AurePayError) {
    return error
  }

  if (error && typeof error === 'object') {
    const record = error as {
      error?: { code?: string; message?: string; details?: unknown }
      message?: string
      code?: string
      details?: unknown
    }
    const nested = record.error

    if (nested?.message) {
      return new AurePayError(
        nested.message,
        nested.code ?? null,
        nested.details ?? null,
        statusCode
      )
    }

    if (typeof record.message === 'string') {
      return new AurePayError(record.message, record.code ?? null, record.details ?? null, statusCode)
    }
  }

  return new AurePayError('Request failed.', null, error, statusCode)
}

/** Transporte HTTP com retry em 429. */
class HttpTransport {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly baseUrl: string,
    private readonly maxRetries: number
  ) {}

  /**
   * Executa uma requisição autenticada.
   * @param method Verbo HTTP
   * @param path Caminho relativo à base URL
   */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: JsonObject | null,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}/${path.replace(/^\//, '')}`
    let attempt = 0

    while (true) {
      attempt += 1

      const headers: Record<string, string> = {
        'X-Api-Key': this.apiKey,
        'X-Api-Secret': this.apiSecret,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...extraHeaders
      }

      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body: body == null ? undefined : JSON.stringify(body)
      })

      const raw = await response.text()
      const retryAfter = response.headers.get('Retry-After') || '1'

      if (response.status === 429 && attempt <= this.maxRetries + 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(retryAfter) || 1) * 1000))
        continue
      }

      let decoded: unknown = null

      if (raw) {
        try {
          decoded = JSON.parse(raw)
        } catch {
          decoded = raw
        }
      }

      if (!response.ok) {
        throw toAurePayError(decoded, response.status)
      }

      return unwrapData<T>(decoded)
    }
  }
}

/** Anexa query string ao path, ignorando `null`/`undefined`. */
function withQuery(path: string, query?: JsonObject): string {
  if (!query || Object.keys(query).length === 0) {
    return path
  }

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue
    }

    params.set(key, String(value))
  }

  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** Recurso CRUD genérico (list/create/get/update/delete). */
class CrudResource {
  constructor(
    private readonly http: HttpTransport,
    private readonly basePath: string
  ) {}

  /** Lista recursos (GET). */
  list(query?: JsonObject) {
    return this.http.request('GET', withQuery(this.basePath, query))
  }

  /** Cria recurso (POST); opcional `Idempotency-Key`. */
  create(body: JsonObject, idempotencyKey?: string) {
    return this.http.request(
      'POST',
      this.basePath,
      body,
      idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
    )
  }

  /** Consulta por ID (GET). */
  get(id: string) {
    return this.http.request('GET', `${this.basePath}/${encodeURIComponent(id)}`)
  }

  /** Atualiza por ID (PUT). */
  update(id: string, body: JsonObject) {
    return this.http.request('PUT', `${this.basePath}/${encodeURIComponent(id)}`, body)
  }

  /** Remove por ID (DELETE). */
  delete(id: string) {
    return this.http.request('DELETE', `${this.basePath}/${encodeURIComponent(id)}`)
  }
}

class DepositsResource extends CrudResource {
  constructor(http: HttpTransport) {
    super(http, '/deposits')
  }
}

class WithdrawalsResource extends CrudResource {
  constructor(http: HttpTransport) {
    super(http, '/withdrawals')
  }
}

class WebhooksResource extends CrudResource {
  constructor(http: HttpTransport) {
    super(http, '/webhooks')
  }
}

/** Empresa autenticada e saldo. */
class CompanyResource {
  constructor(private readonly http: HttpTransport) {}

  /** Dados da empresa (GET /company). */
  get() {
    return this.http.request('GET', '/company')
  }

  /** Saldo disponível (GET /company/balance). */
  balance() {
    return this.http.request('GET', '/company/balance')
  }
}

/** Conversões BRL/USDT. */
class ConversionsResource {
  private readonly crud: CrudResource

  constructor(private readonly http: HttpTransport) {
    this.crud = new CrudResource(http, '/conversions')
  }

  list(query?: JsonObject) {
    return this.crud.list(query)
  }

  create(body: JsonObject, idempotencyKey?: string) {
    return this.crud.create(body, idempotencyKey)
  }

  get(id: string) {
    return this.crud.get(id)
  }

  /** Cotação de conversão (POST /conversions/quote). */
  quote(body: JsonObject) {
    return this.http.request('POST', '/conversions/quote', body)
  }
}

/** Infrações / MED. */
class ChargebacksResource {
  constructor(private readonly http: HttpTransport) {}

  list(query?: JsonObject) {
    return this.http.request('GET', withQuery('/chargebacks', query))
  }

  get(id: string) {
    return this.http.request('GET', `/chargebacks/${encodeURIComponent(id)}`)
  }
}

class WalletsResource extends CrudResource {
  constructor(http: HttpTransport) {
    super(http, '/wallets')
  }
}

/**
 * Facade principal da API AurePay.
 *
 * @example
 * const aure = new AurePay({ apiKey, apiSecret })
 * await aure.deposits.create({ method: 'pix', amount: 10000, reference: 'order-1' })
 */
export class AurePay {
  readonly deposits: DepositsResource
  readonly withdrawals: WithdrawalsResource
  readonly webhooks: WebhooksResource
  readonly company: CompanyResource
  readonly conversions: ConversionsResource
  readonly chargebacks: ChargebacksResource
  readonly wallets: WalletsResource

  private readonly client: Client
  private readonly http: HttpTransport

  constructor(config: AurePayConfig) {
    const apiKey = (config.apiKey || '').trim()
    const apiSecret = (config.apiSecret || '').trim()

    if (!apiKey || !apiSecret) {
      throw new AurePayError('apiKey and apiSecret are required.', null, null, 0)
    }

    const baseUrl = (config.baseUrl || 'https://api.aurepay.com.br/v1').replace(/\/$/, '')
    const maxRetries = config.maxRetries ?? 2

    this.http = new HttpTransport(apiKey, apiSecret, baseUrl, maxRetries)
    this.deposits = new DepositsResource(this.http)
    this.withdrawals = new WithdrawalsResource(this.http)
    this.webhooks = new WebhooksResource(this.http)
    this.company = new CompanyResource(this.http)
    this.conversions = new ConversionsResource(this.http)
    this.chargebacks = new ChargebacksResource(this.http)
    this.wallets = new WalletsResource(this.http)

    this.client = createClient(
      createConfig({
        baseUrl,
        throwOnError: true,
        auth: (scheme) => {
          if (scheme?.name === 'X-Api-Key') {
            return apiKey
          }

          if (scheme?.name === 'X-Api-Secret') {
            return apiSecret
          }

          return undefined
        },
        headers: {
          Accept: 'application/json'
        }
      })
    )
  }

  /** Client tipado de baixo nível (operationIds do OpenAPI). */
  get raw(): Client {
    return this.client
  }
}
