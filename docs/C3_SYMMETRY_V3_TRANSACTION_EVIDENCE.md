# Symmetry V3: evidencia transaccional pública, investigación no ejecutable

**SHARED · 2026-09-23 UTC · `NO_GO_EXTERNAL_EVIDENCE_REQUIRED`.** El propietario informó que envió la solicitud técnica el 2026-09-23 al contacto oficial de operaciones Symmetry; se espera respuesta, sin acuse ni aprobación verificados. C3 Mainnet continúa deshabilitado, sin bóveda desplegada ni política de producción. Las cuatro transacciones son de una bóveda pública que **no es C3**.

## Procedencia y reproducción

Las cuatro firmas completas proceden del [manifiesto candidato](../config/c3/symmetry-v3-production-evidence-candidate.v1.json). El colector de [investigación](../services/c3-mainnet/research/symmetry-v3/collect.mjs) llama solo `getTransaction` (`finalized`, `base64`, `maxSupportedTransactionVersion: 0`, recompensas) y `getSignatureStatuses` con búsqueda histórica. Las respuestas completas de [Solana RPC oficial](https://api.mainnet-beta.solana.com) y `https://solana-rpc.publicnode.com` coincidieron tras canonicalización JSON. Son dos fuentes públicas para comparación, **no** dos operadores certificados para quorum de producción. Los [fixtures](../services/c3-mainnet/research/symmetry-v3/fixtures/) conservan ambos resultados, bytes crudos, metadatos, instrucciones internas, logs, balances, slot, block time, versión, rewards, finality y retrieval UTC; no guardan credenciales. El [registro de observaciones](../config/c3/symmetry-v3-observed-transactions.v1.json) contiene los hashes y detalles. Desde `services/c3-mainnet`, `npm run test:symmetry-research` verifica el corte; `node --experimental-strip-types research/symmetry-v3/report.mjs` reproduce el manifiesto sin red.

| Muestra y firma pública                                                                                                                  |      Slot | SHA-256 de respuesta RPC                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| [Aporte USDC](https://explorer.solana.com/tx/mHStwKXJJmzPVnxFnSJb1PeR7sCTGdqcsa3hCbRcvcnbRjYNKJuNbVccuLZkMbuRPxbBJpHQbgGWGK5vUQ2KN7x)    | 449616384 | `bb72aab59002553fab9a0e1fb3acbcb69e5c80eabe36f714b0049a15bbd703ae` |
| [Emisión share](https://explorer.solana.com/tx/4pNx6EWqdAdz5r68XqVF2xZsHbRThW8KNdog3Mr2qXDuB15uA48i9oVaDs31nEiQG1U7U223uURdfYQXJeFFcKfE) | 449618333 | `5ca61fc16817036ed2014d77016b2ab88fe31a281175ef79b2abc968bfc9b49b` |
| [Quema share](https://explorer.solana.com/tx/5Kn15SfEwkiDoBpBcT7bZ3dCZ8Jr2tkpmS5NLWEyGqdgyBYwFeN1N853id37JXsbDm7Y83pEsfnZzdYBd2w8UQAW)   | 449630630 | `13a1816e92c2d11bba0e7b22cf4d1f561b94a1f4234fcf73a797030fc1677b33` |
| [Entrega USDC](https://explorer.solana.com/tx/FXcx1hLT7fc2wHMvF2GMZQ2V7XdqU3BgDQY54nooCF2ovW5RndwV3eXAgPC5wRWTvGo2EM2axzEPr3pMtuUF1kj)   | 449631412 | `2359425149b96dac5ed3e3a3233ae7205499ae5ce372dc8eb907dfa73e286704` |

## Verificación cruda y límites

El decoder verifica base64 y shortvec canónicos, longitud máxima de 1.232 bytes, mensaje v0, fee payer, número y validez Ed25519 de todas las firmas, índices de programas/cuentas, instrucciones externas/internas, datos crudos, programa SPL, balances exactos `bigint`, conservación de lamports neta de la tarifa y concordancia de los RPC. Bytes por transacción: 1.208, 629, 1.072 y 572. **Las cuatro tienen cero ALT y `loadedAddresses` vacío**; no existe prueba de resolución de ALT histórico no vacío y ese caso se rechaza cerrado. La firma autentica el mensaje crudo, **no** los logs ni los balances reportados por RPC; la doble lectura de fuentes públicas limita, pero no elimina, ese riesgo.

Se observaron seis programas: System, SPL Token, Associated Token Account, Compute Budget, Symmetry `BASKT7…` y `L2TExMFK…` en la quema. La función de `L2TEx…` sigue desconocida. Se registraron **10 instrucciones Symmetry externas**. Sus primeros ocho bytes, en orden por etapa, son:

- Aporte: `7850f57bd495a32f`, `47ccf3b7d1766f5e`, `7fd7296ef4b38307`, `585c9edb5347efa4`, `40eeabc687fd2509`.
- Emisión: `a1cf302d079ce98f`.
- Quema: `7850f57bd495a32f`, `47ccf3b7d1766f5e`, `7fd7296ef4b38307`.
- Entrega: `5331700269c16a7e`.

Los logs asocian esos bytes con `CreateRebalanceIntentHandler`, `ResizeRebalanceIntentHandler`, `InitRebalanceIntentHandler`, `DepositTokensHandler`, `LockDepositsHandler`, `MintBasketHandler` y `RedeemTokensHandler`. **Confianza: `transaction_correlated`, no `official_documented`.** Faltan IDL, layouts y restricciones de cuentas; no se conoce la semántica completa de CPI. El registro conserva hash/data length, índices, pubkeys, flags y efectos a nivel transacción; ningún discriminador observado es una política ejecutable.

## Ciclo observado, sin inventar etapas

| Etapa   | Evidencia comprobable                                                                                                                                                                                                      | Límite                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Aporte  | Wallet `8RZ4…` firma; `transferChecked` debita **20.000.000 unidades USDC** (6 decimales) de `4Pzf…`, propiedad del usuario, y acredita `DzFZ…`, propiedad del vault `AwDF…`. Logs de create/resize/init, depósito y lock. | Sin layout intent, precio, fee, vault multi-activo ni auctions verificadas.            |
| Emisión | Keeper `GLq9…` firma; CPI `mintToChecked` emite **20 unidades base** (6 decimales) del mint `9ihG…` al ATA propiedad de `8RZ4…`; otra emisión observada es de cero.                                                        | Sin supply histórico pre/post, fórmula share/NAV, bounty ni enlace unívoco del intent. |
| Quema   | Wallet `8RZ4…` firma; CPI `burnChecked` destruye **20 unidades base** del share mint desde su ATA. Aparecen tres instrucciones `L2TEx…` no atribuidas.                                                                     | Sin `keep_tokens`, elección de salida, auctions ni prueba de intent común.             |
| Entrega | Keeper `GLq9…` firma; CPI `transferChecked` mueve **20.000.000 unidades USDC** desde cuenta del vault `DzFZ…` a `4Pzf…` del mismo usuario.                                                                                 | No prueba liquidación cbBTC/Portal ETH/SOL ni selección de USDC para C3.               |

Los movimientos WSOL y SOL se informan aparte y no se clasifican como inversión, swap, bounty o fee sin layout. El aporte muestra WSOL usuario −3.750.000 y otro ATA +4.349.997; la quema −3.310.000 y +4.099.997. La tarifa de red fue 30.000, 30.000, 30.000 y 15.000 lamports respectivamente. Los otros deltas de lamports incluyen movimientos de cuentas/intent no atribuibles aún con seguridad. No hay prueba completa de price update, tres ventanas de subasta, flash swap, claim bounty, cierre de cuentas, devolución residual, idempotencia ni cancelación. No se inventa una transacción intermedia. La instrucción ATA externa en redención puede ser idempotente; no se atribuye creación sin evidencia de cambio.

## Rescate C3 solo a USDC: `UNVERIFIED`

En el [corte previo de `getAccountInfo`](C3_SYMMETRY_V3_EVIDENCE.md), el mint público `9ihG…` pertenece al programa SPL Token clásico, tiene seis decimales, autoridad de mint `AwDF…` (el vault) y ninguna autoridad de freeze. El supply observado **en ese corte posterior** era cero; no se cuenta con `getTokenSupply` histórico pre/post de cada etapa. La CPI de emisión y quema vincula esas shares con la muestra, pero **no** determina fórmula NAV ni demuestra que una share represente exactamente 20 USDC de cualquier cesta.

Esta muestra demuestra **un caso** de share burn y entrega posterior de 20 USDC al mismo usuario desde la cuenta del vault. No demuestra que el vault contuviera BTC/ETH/SOL; no demuestra `keep_tokens: []`, cómo se seleccionó el mint de salida, ni que las cuatro firmas correspondan inequívocamente al mismo intent según layout oficial. La [documentación Symmetry](https://docs.symmetry.fi/concepts/rebalancing) describe un flujo general, no garantiza que un vault nuevo 40/30/30 pueda redimir íntegramente a USDC, especialmente por 1 USDC. La clasificación de **C3** permanece `UNVERIFIED`.

## Puerta de promoción

Esperar respuesta oficial con fuente/commit y desplegado reproducibles, IDL/layouts/discriminadores/PDA, auditoría y upgrade governance, ejemplo finalizado de vault **multi-activo** → USDC con intent y subastas completos, salida fijada a USDC, mínimos/oráculos/rutas a 1 USDC, fees/bounty y recuperación. Después se requieren revisión independiente Security y aprobación Squads. Ningún parser o fixture de `research/` se importa a `src/`, móvil o paquete de producción; el expediente no autoriza firma, custodia, despliegue ni fondos reales.
