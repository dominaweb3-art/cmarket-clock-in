# M5B — frontera aislada de Symmetry: estado verificable

Clasificación: **SHARED**. Fecha de revisión local: 2026-09-26. **No es un permiso para Mainnet.** La capacidad de ejecución permanece en `false`; no existe ruta móvil pública ni autorización MWA conectada a este builder.

## Lo que sí quedó implementado

- `services/c3-symmetry-builder/` tiene lockfile propio. `@symmetry-hq/sdk` está fijado en **1.0.22** y la comprobación local coteja versión, origen del paquete e integridad SHA-512 del lock. La instalación con `npm ci` comprueba el archivo descargado. Este paquete no es dependencia de `apps/mobile` ni del paquete público de servicio.
- El proceso receptor acepta únicamente `intentId`, `configurationVersion`, `operation` y `expectedRevision`. Consulta el intento y la configuración inmutables en PostgreSQL. Sólo el proceso receptor recibe configuración de conexión PostgreSQL; el hijo que carga el SDK no hereda credenciales ni claves. Ambos procesos tienen timeout y límite de salida; stderr no se transmite al llamador. No existe método de firma, envío, simulación o airdrop habilitado.
- La fixture pública **no C3** (`9ihGfs…` como share mint; wallet pública sintética) produjo dos transacciones v0 sin firma. La inspección externa decodifica el wire, verifica firmante/payer, tamaño máximo de 1232 bytes, blockhash/altura declarada, mints, ATA USDC de usuario/vault, monto de 1.000.000 unidades, orden y huellas de instrucciones. Pruebas de mutación rechazan cambio de wallet, vault, share mint, payer, monto, destino USDC, programa, secuencia, firma previa, tamaño y caducidad. Esta es una **inspección estructural de una fixture**, no una validación semántica C3 autorizable.
- La llamada experimental `sellVaultTx` queda limitada a `keep_tokens: []`; sin posición C3 verificada devuelve `C3_REDEMPTION_REQUIRES_DEPLOYED_POSITION`. No se inventa `outputMint` ni `minimumOutput` del SDK.
- La migración `0004_c3_builder.sql` crea tablas inmutables de configuración y manifiesto, y no inserta filas. Pasó en PostgreSQL desechable. Los adaptadores de RPC exigen dos endpoints HTTPS, IDs y operadores distintos y evidencia de revisión; consultan `getTransaction` sin reintentos y nunca convierten resultados en éxito. Ausencia o conflicto queda en `MANUAL_REVIEW`.

## Límites que impiden cerrar M5B o probar fondos

1. Las instrucciones Symmetry del depósito público incluyen transferencia SOL hacia el ATA WSOL del usuario y creación de intent, pero el paquete no trae una política independiente aprobada que pruebe todas sus autoridades, efectos internos, renta/bounty y emisión final de shares. `assertSemanticAuthorizationAvailable()` falla expresamente. No existe aún una validación semántica completa ni una garantía de mínimo de shares. Los dos mensajes construidos **no** incluyen por sí solos lock, rebalanceo, mint y recepción final.
2. La tabla de manifiestos está lista, pero deliberadamente vacía: no se almacenará una “autorización” basada sólo en inspección estructural. Falta el flujo transaccional `draft → builder_requested → built → validation_pending → validated → awaiting_wallet` y su manifest revisado. La API estable de M5A continúa rechazando `buildDepositIntent`, `buildRedeemToUsdcIntent`, MWA y submission.
3. El intake RPC compara respuestas, pero no valida aún todos los efectos/inner CPI, datos históricos de ALT ni share mint/burn y USDC final. Por ello **no** es un reconciliador de producción. No hay proveedores reales configurados.
4. No están configurados C3 vault, share mint, owner wallet, dos RPC independientes ni una posición real de redemption. La fixture pública no se confunde con C3.
5. El árbol aislado del SDK presenta hallazgos de `npm audit --omit=dev` (4 altos, 7 moderados en esta ejecución). Incluye la ruta vulnerable SPL/bigint-buffer. Se tolera sólo como proceso constructor del piloto cerrado y **no** se aprueba para APK ni servicio público. Toda promoción exige remediación o revisión de seguridad específica.
6. El escaneo adicional del Android export encontró el literal público `BASKT7aKd8n7…` ya presente en `apps/mobile/constants/c3-vault-config.ts` (configuración Devnet de sólo lectura anterior a M5B). El SDK y el paquete constructor nuevos **no** están en el bundle. El test existente de aislamiento no prohíbe ese literal; debe revisarse por separado si la política exige ausencia incluso de IDs públicos inactivos.

## Uso seguro

Desde `services/c3-mainnet`: `npm run c3:symmetry:builder-readiness`. Los indicadores de construcción/inspección de fixture pueden ser verdaderos mientras `DEPOSIT_TRANSACTIONS_VALIDATED`, `AUTHORIZATION_MANIFEST_DURABLE`, `RPC_RECONCILIATION_IMPLEMENTED` y `MAINNET_EXECUTION_ENABLED` son falsos. `OVERALL_EXECUTION_GO` debe permanecer falso. No se requiere teléfono para la próxima etapa técnica.
El comando devuelve código no cero hasta que el gate completo pueda aprobarse; es el comportamiento esperado, no un fallo de construcción.

Siguiente trabajo acotado: formalizar y revisar contra evidencia on-chain/IDL cada instrucción y efecto de la secuencia Symmetry; sólo entonces implementar validador semántico, manifiesto atómico y reconciliación completa con pruebas adversariales. La habilitación Mainnet sería una fase y revisión separadas.
