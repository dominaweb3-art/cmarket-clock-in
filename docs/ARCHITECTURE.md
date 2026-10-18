# C Market Architecture

## Arquitectura vigente de esta rama — 17 de octubre de 2026

Inspección de código y configuración en 383dc9d; ejecución externa no reproducida
hoy. [STATUS](STATUS.md) delimita evidencia y pendientes; [DECISIONS](DECISIONS.md)
explica las sustituciones. El contenido inglés al final es arquitectura histórica
del pago a tesorería y se conserva como tal.

### Componentes y flujo implementado

    Seeker / APK de evaluación
      -> MWA / wallet del usuario (conexión, mensaje y firmas explícitas)
      -> HTTPS Vercel /api/evaluation
      -> autenticación + inspección + PostgreSQL c3_eval
      -> programa open-vault y router de prueba en Solana Devnet
      -> lectura finalizada + conciliación de efectos
      -> posición / Actividad / reclamo de USDC de prueba

Flujo económico implementado: depósito -> tres asignaciones de prueba -> emisión
de shares -> solicitud de venta -> tres ventas de prueba -> quema/reclamo. La
validación on-chain y el diario durable condicionan los avances; una firma guardada
no representa liquidación. Las pruebas históricas no acreditan que una operación
pendiente de otra wallet/ronda ya terminó. La custodia de inventario corresponde
a cuentas controladas por PDA (dirección de programa), no a MWA ni a un saldo interno.

### Stack y mapa del repositorio

| Ruta | Responsabilidad y límite |
| --- | --- |
| apps/c3-pilot/src/DevnetEvaluationApp.tsx | Coordinación de sesión, wallet, compra, recuperación y navegación |
| apps/c3-pilot/variants/evaluation | Entrada/configuración Android del APK 0.1.38 |
| apps/c3-pilot/src/EvaluationOnboarding.tsx | Bienvenida inglesa, persistencia local y conexión MWA existente |
| apps/c3-pilot/src/EvaluationIndices.tsx | Gestión C3 y resumen de posición |
| apps/c3-pilot/src/EvaluationActivity.tsx | Historial y comprobantes |
| apps/c3-pilot/src/EvaluationMarketReference.tsx | Precios y valoración informativa; sin autoridad monetaria |
| apps/c3-evaluation-web | Web/descargas y adaptador HTTPS alojado |
| services/c3-mainnet/src/evaluation-* | Servicios específicos Devnet, diarios, efectos, provisión y recuperación |
| programs/c3-pilot-vault | Programa Rust/Anchor y pruebas; separar features y redes |
| packages/c3-pilot-client | Cliente de instrucciones/cuentas del vault |
| apps/mobile | Prototipo anterior y motor Mainnet separado/deshabilitado |
| services/c3-symmetry-builder y research | Trabajo histórico/aislado; no ejecución del APK Devnet |
| archive/mobile-foundation-pre-seeker | Fundación preservada anterior a migración |
| assets/brand y apps/c3-pilot/assets/onboarding | Marca aprobada e ilustraciones activas blancas |
| docs, hackathons, submission | Evidencia, requisitos, procedencia y entregas |

Versiones declaradas: Expo 57.0.26, React 19.2.3, RN 0.86.3, TypeScript 6.0.3,
MWA protocol 2.3.0, AsyncStorage 2.2.0; servicios web3.js 1.99.0 y pg 8.23.0;
Anchor 0.31.1, Rust 2021; Vercel Node 24/esbuild 0.28.2. Son manifiestos, no
una verificación nueva del grafo instalado o de vulnerabilidades.

### Datos y persistencia

- AsyncStorage guarda idioma y bienvenida; las credenciales de sesión del móvil
  son de memoria. Reiniciar puede exigir reconectar/verificar propiedad.
- c3_eval: challenges/proofs/sessions, configuración, wallets/rondas, intents,
  planes, requests/packets/submissions, recibos, eventos, autorizaciones y recuperación.
  Migraciones específicas: scripts/sql/0001–0007. La provisión también reutiliza
  infraestructura de diarios: seguir el script de esquema, no aplicar SQL por intuición.
- c3_open: diario y generaciones del open-vault en las migraciones de
  services/c3-mainnet/pilot-open-local/migrations. El nombre de esa carpeta no
  autoriza importar el harness de pruebas en producción.
- c3: infraestructura histórica de estado/piloto/cotizaciones en
  services/c3-mainnet/migrations. No intercambiar intents entre esquemas.
- evaluation-scope.ts adapta consultas cualificadas del diario a c3_eval y
  verifica configuración de red/programa/router. Conservar CAS (actualización
  condicional por revisión), historial e idempotencia; no borrar para desbloquear UI.
- En Solana están balances, inventario, participaciones y efectos. PostgreSQL
  conserva coordinación/evidencia; no sustituye propiedad on-chain.

No se accedió a la base alojada ni se comprobó su esquema instalado hoy.

### Integraciones, configuración y entornos

Origen fijo de evaluación: https://cmarket-nine.vercel.app; POST /api/evaluation
gestiona challenge, autenticación, preparación, envío y recuperación. GET
/api/health diagnostica conectividad y conserva un registro histórico de aceptación;
su campo physicalAcceptance no acredita el APK más reciente. GET /api/prices
consulta exclusivamente productos públicos BTC-USD, ETH-USD y SOL-USD de Coinbase.

Vercel proyecto cmarket: funciones y descargas; región declarada iad1 y runtime
Node 24. PostgreSQL Supabase: POSTGRES_URL, TLS con CA verificada, pool máximo 2.
Gobierno, keeper, mint y cotizaciones de evaluación se inyectan mediante variables
de servidor; véanse sus nombres en README. No hay claves privadas en el cliente.
No se revisaron credenciales, consola, costes ni disponibilidad externa hoy.

Devnet fija genesis y cluster exactos. Programa:
2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg; router:
F9yXLAA7tvWSCmXnAT8xRqTMHDuwFsgMbDThrde6uHs7. USDC de prueba admitido:
J4cTKzcwdrkpU1qYxbJ1LpiJivpKcZeHmcyuGj1o1Nza, seis decimales.
No confundir con Circle Devnet, USDT, activos Mainnet ni liquidez Jupiter.
Anchor.toml usa localnet para ensayos; no es la identidad del programa Devnet.

### Precios informativos y límites

api/prices.mjs consulta ticker/stats oficiales, valida positivos y frescura,
coalesce solicitudes y cachea cinco segundos. El móvil consulta cada cinco segundos
solo en Índices/en primer plano, evita solapamientos y retrocede 15 segundos al fallar.
Variación 24 h usa el open reportado por la bolsa; variación desde compra usa la
base histórica de 60 segundos previa al depósito y pesos 4000/3000/3000 con bigint.
El valor de venta solicitado se congela; ninguna cotización autoriza cobros,
emisión o reclamo. Los precios no constituyen NAV monetario ni prueba de exposición real.

### Seguridad, construcción y deuda

MWA inspecciona y firma operaciones del usuario. El servidor valida identidad,
wallet, mensajes, cuentas, red, mínimo, límites y evidencia finalizada. Los diarios
conservan firmas inciertas; nunca reenviar automáticamente ni inferir éxito por UI.
Renovaciones/recuperación son explícitas y preservan generaciones e inventario.
El bundle web excluye mints/política Mainnet, harness local y dependencias prohibidas;
el script de build comprueba ese límite. Es control de construcción, no auditoría externa.
La capacidad Mainnet está deshabilitada en esta variante y requiere otra aprobación.

Deuda conocida: múltiples aprobaciones, sesiones/planes vencidos y compra pendiente;
versiones históricas mezcladas en documentos; warning Expo; límites de una posición
por vault y diez rondas. Mayor detalle y prioridades en STATUS. No ampliar a
depósitos agrupados, ventas parciales, rebalanceo, fees o SKR sin diseño aprobado.

## Arquitectura histórica conservada — prototipo de pago

## Product layers

C Market is organized around four layers:

1. **Mobile experience** — basket discovery, purchase review, wallet state, confirmation, and transaction receipt.
2. **Wallet layer** — Mobile Wallet Adapter and a compatible Solana mobile wallet.
3. **Solana payment layer** — Devnet transactions, token accounts, confirmations, and Explorer evidence.
4. **Methodology layer** — basket definitions, constituent rules, weights, caps, buffers, and rebalance policy.

## Current prototype flow

```text
User
  -> C Market Android UI
  -> Mobile Wallet Adapter
  -> Phantom mobile wallet approval
  -> Solana Devnet transaction
  -> Devnet USDC treasury destination
  -> Confirmation and Explorer link
```

The current prototype proves the payment-routing and confirmation path.

## Target basket flow

The target product flow is:

```text
User selects basket
  -> App loads a versioned basket definition
  -> App displays constituents and methodology
  -> User reviews amount and network
  -> Wallet signs a transaction or approved program interaction
  -> Settlement is confirmed on Solana
  -> App records the verified activity
  -> User can inspect the basket and transaction history
```

The target flow must only be described as complete after it is implemented, tested, and supported by on-chain evidence.

## Network policy

Development and judging prototypes should use Devnet:

- Cluster: Solana Devnet
- Assets: test assets only
- Wallet: a dedicated test wallet
- RPC: configured through environment variables
- Treasury: a dedicated Devnet public address

No private key is needed by the application. The user signs through the mobile wallet.

## Data and trust boundaries

### The mobile application may

- Read public wallet and token-account data.
- Display basket metadata.
- Construct a transaction.
- Ask the wallet to sign.
- Submit a signed transaction to the configured RPC.
- Verify confirmation.
- Display a public signature and Explorer link.

### The mobile application must not

- Request or store seed phrases.
- Request or store private keys.
- Pretend that an unconfirmed transaction is final.
- Hide the destination or network.
- Claim that treasury distribution happened without evidence.
- Use production funds during development.

## Reliability requirements

The release build should handle:

- Wallet not connected.
- Wallet connection rejected.
- Signature rejected.
- Wrong cluster.
- Insufficient USDC.
- Insufficient SOL for fees.
- Missing token account.
- RPC timeout.
- Transaction simulation failure.
- Confirmation timeout.
- Duplicate purchase taps.
- App backgrounding during wallet approval.
- A previously submitted transaction that is still pending.

## Future settlement module

Before any mainnet or real-asset use, the settlement design needs:

- A clearly specified basket methodology.
- Versioned constituent lists and weights.
- A transparent fee policy.
- Slippage and liquidity controls.
- Atomic or otherwise provable settlement behavior.
- Reconciliation between user payment and resulting basket position.
- Tests for partial failure and retries.
- Independent security review appropriate to the implementation.
