import type { CreateClientConfig } from './generated/client/index.js'

/**
 * Config padrão do client gerado (Hey API).
 * Credenciais são aplicadas em runtime pela facade `AurePay`.
 */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: config?.baseUrl ?? 'https://api.aurepay.com.br/v1'
})
