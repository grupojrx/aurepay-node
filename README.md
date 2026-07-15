# @aurepay/sdk

SDK oficial da API AurePay para Node.js / TypeScript.

## Instalação

```bash
npm i @aurepay/sdk
```

## Uso

```ts
import { AurePay } from '@aurepay/sdk'

const aure = new AurePay({
  apiKey: process.env.AUREPAY_API_KEY!,
  apiSecret: process.env.AUREPAY_API_SECRET!
})

await aure.deposits.create({
  amount: 10000,
  method: 'pix'
})

await aure.webhooks.list()
await aure.company.balance()
```

## Mapa de métodos

| SDK | HTTP |
| --- | --- |
| `aure.deposits.*` | `/v1/deposits` |
| `aure.withdrawals.*` | `/v1/withdrawals` |
| `aure.webhooks.*` | `/v1/webhooks` |
| `aure.company.get` / `balance` | `/v1/company`, `/v1/company/balance` |
| `aure.conversions.*` | `/v1/conversions` |
| `aure.chargebacks.*` | `/v1/chargebacks` |
| `aure.wallets.*` | `/v1/wallets` |

Docs: https://api.aurepay.com.br/docs/sdks  
OpenAPI: https://api.aurepay.com.br/openapi.yaml
