# C3 Mainnet: propuesta de gobernanza y piloto, NO-GO

**SHARED · consulta 2026-09-23 · estado `candidate_disabled`.** Documento de decisión, no instrucciones ejecutadas ni configuración desplegada. La solicitud técnica a Symmetry fue enviada por el propietario el 2026-09-23 y su respuesta está pendiente. La [evidencia pública de M4.2B](C3_SYMMETRY_V3_TRANSACTION_EVIDENCE.md) corresponde a una bóveda que no es C3: no demuestra liquidación BTC/ETH/SOL a USDC. Sin IDL, código desplegado verificable, mapeo de autoridades ni prueba de salida USDC, **no hay bóveda C3, Squads C3 ni permiso para fondos reales**. Mainnet sigue deshabilitado.

## Fuentes y distinción entre hecho y propuesta

- [Squads V4, repositorio oficial](https://github.com/Squads-Protocol/v4), `main` observado en `af94153ff77a28b6effe46b9c94baaa93742b48c` el 2026-09-23. El repositorio publica el programa V4 `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`; **ese ID no es una dirección de multisig C Market**. El repositorio señala `64af7330413d5c85cbbccfd8c27a05d45b6e666f` como último commit plenamente auditado, distinto del HEAD observado. Antes de cualquier ceremonia se debe fijar versión, fuente, auditoría y hash del programa desplegado.
- [Squads: cuentas y config authority](https://docs.squads.so/main/development/reference/accounts): un `config_authority` externo puede controlar cambios de miembros/umbral; proponemos multisig autónomo para evitar una clave unilateral, sujeto a verificación en la versión elegida.
- [Squads: time locks](https://docs.squads.so/main/navigating-your-squad/settings/time-locks): el retardo V4 es **global**. La matriz por acción de abajo **no puede suponerse implementada nativamente en un único multisig**. Una pausa inmediata 2-de-3 y un desbloqueo diferido requieren diseño separado, mapeo Symmetry y revisión de seguridad. Hasta entonces la capacidad de pausa es **no verificada**, no una protección activa.
- [Squads: spending limits](https://docs.squads.so/main/development/reference/spending-limits): permiten a miembros autorizados gastar por debajo del límite sin propuesta; por la regla C3 de no bypass unilateral, permanecen deshabilitados. Los topes propuestos son política del piloto, **no** spending limits on-chain activos.
- [Squads: transacciones de vault y configuración](https://docs.squads.so/main/development/typescript/accounts/transactions), [Solana: PDA](https://solana.com/docs/core/pda): cuentas derivadas y propuestas necesitan verificación independiente. Una dirección derivada no implica que C Market la haya creado.
- Fuentes locales: [AGENTS.md](../AGENTS.md), [modelo de amenazas](C3_THREAT_MODEL.md), [puerta Symmetry](C3_SYMMETRY_V3_EVIDENCE.md). Cada retraso y límite numérico siguiente es **recomendación C Market pendiente de aprobación**, no una propiedad oficial de Squads o Symmetry.

## Modelo propuesto y responsabilidades

Tres miembros con direcciones públicas distintas, todavía `unconfigured`; umbral 2-de-3; ninguna clave privada ni ruta de keypair. Multisig, vault Squads, tesorería y vault Symmetry: **inexistentes para C3**. La [configuración candidata](../config/c3/c3-governance-candidate.v1.json) registra 13 responsabilidades por separado: configuración/vault, activos, pesos, fees, oráculos, keeper, tesorería, pausa, recuperación, upgrade/migración, allowlist, topes y rotación. Cada fila exige 2-de-3, clase de retardo, destinos inicialmente vacíos, prohibiciones, evidencia y mapeo Symmetry `unverified`. Ninguna fila otorga autoridad ejecutable.

La asignación estratégica fija es BTC 4.000 bps, ETH 3.000 bps y SOL 3.000 bps, total 10.000. Un cambio sería **otro producto/versionado**, no un ajuste operativo silencioso. El mínimo funcional objetivo del piloto es 1 USDC; no es el mínimo comercial permanente ni una afirmación de viabilidad económica a ese tamaño.

## Retardos candidatos: requieren aprobación y diseño realizable

| Clase                                    |        Espera propuesta | Motivo                                                  |
| ---------------------------------------- | ----------------------: | ------------------------------------------------------- |
| Pausa de emergencia                      | 0 tras dos aprobaciones | Detener nuevos riesgos; ruta separada aún no verificada |
| Reanudación                              |                    24 h | Incidente documentado, conciliación y Security          |
| Configuración ordinaria / límites keeper |                    24 h | Revisión operativa                                      |
| Fee / oráculo / tesorería / rotación     |                    48 h | Cambio económico o de control                           |
| Pesos / mint / migración / upgrade       |                  7 días | Riesgo sistémico y revisión de fuente                   |

La configuración V4 tiene timelock global. Este cuadro expresa **requisitos de producto**; no se activará hasta que Security pruebe un diseño que cumpla todas las clases sin bypass unilateral. En particular, configurar timelock global 0 para permitir pausa también permitiría ejecución inmediata de otras propuestas una vez aprobadas; no es equivalente a la matriz. La reanudación nunca será automática.

## Límites recomendados para primer piloto supervisado

Todos los valores son `pending_project_manager_approval`, además de Security y Squads. Son techos _candidatos_, no controles activos. Deben ajustarse o descartarse si rutas, costes, share math o redención a 1 USDC no se demuestran. La configuración guarda razón y riesgo mitigado para cada uno.

| Control                         | Recomendación candidata                                   | Riesgo reducido                                   |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| Compra mínima de prueba         | 1 USDC                                                    | Entrada de producto definida, sujeta a viabilidad |
| Compra máxima inicial           | 1 USDC                                                    | Pérdida por intent                                |
| Acumulado por wallet            | 2 USDC                                                    | Concentración                                     |
| TVL total                       | 3 USDC                                                    | Pérdida agregada                                  |
| Depósitos diarios               | 3 USDC                                                    | Ingreso acelerado                                 |
| Retiros diarios                 | 3 USDC                                                    | Presión de liquidación                            |
| Intents simultáneos             | 1                                                         | Incertidumbre concurrente                         |
| Slippage máximo                 | 100 bps                                                   | Pérdida de ejecución                              |
| Desviación de pesos             | 100 bps                                                   | Deriva no observada                               |
| Antigüedad máxima de oráculo    | 60 s                                                      | NAV obsoleto                                      |
| Vida máxima del intent          | 900 s                                                     | Intent obsoleto; soporte Symmetry no verificado   |
| SOL disponible para tasas       | 0,02 SOL                                                  | Falta de SOL; **reserva**, no coste prometido     |
| Pausa                           | Primer efecto de token inexplicado o intent sin conciliar | Pérdida continuada                                |
| Revisión manual                 | Primera firma incierta o descuadre de saldo               | Doble ejecución                                   |
| Wallets allowlisted             | Máximo 3, actualmente 0                                   | Exposición pública                                |
| Ventana piloto                  | 72 h                                                      | Piloto indefinido                                 |
| Ciclos compra/venta finalizados | Mínimo 3                                                  | Falsa confianza en un solo demo                   |

No se inicia siquiera una compra de 1 USDC si bounty, red, ATA/rent, fees, slippage o salida íntegra a USDC vuelven el ensayo antieconómico o inseguro. No se pueden imponer estos topes solo con UI; se requieren controles de servicio y, donde aplique, on-chain, revisados por Security.

## Separación operativa

| Actor                          | Permitido en propuesta futura                                                      | Prohibido hoy y en diseño                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Wallet usuaria vía MWA         | Autorizar explícitamente su propio depósito/retiro                                 | Firmar por backend, autorización oculta                                       |
| Builder C Market               | Preparar y validar instrucciones frente a política aprobada                        | Sustituir mint, destino, monto o autoridad                                    |
| Keeper Symmetry permissionless | Solo etapas oficiales mapeadas y verificadas, para intent y vault permitidos       | Custodia, cambiar configuración, emitir shares arbitrarias, fondos a terceros |
| Monitor C Market               | Leer finality, logs, balances, NAV, outbox y reconciliar                           | Tratar webhook o firma como éxito                                             |
| Squads 2-de-3                  | Propuestas aprobadas de config/tesorería/pausa donde estén técnicamente soportadas | Spending limit unilateral, config authority externa no aprobada               |

El conjunto de llamadas keeper, programas, mints, vault, vencimiento, importe, bounty, idempotencia, límites por transacción y evidencia pos-ejecución está **sin mapeo oficial Symmetry**. Hasta tener IDL y pruebas: llamadas permitidas 0, valor autorizado 0 USDC, bounty autorizado 0 y vaults/mints/programas ejecutables ninguno. Cada etapa futura requerirá hash de intent, expiración, registro idempotente y efectos finalizados; una firma incierta, programa desconocido, coste excesivo, oráculo viejo o efecto inesperado exige revisión manual/pausa futura, nunca auto-reintento o reversión. Un keeper permissionless no obtiene por ello autoridad de custodia o configuración.

## Tesorería propuesta

Se propone una cuenta Squads 2-de-3 **aún no creada**. No tendrá firmante en APK ni custodio hot-wallet de backend. Destinos allowlisted inicialmente vacíos, sin spending limits unilateral. Límites **actuales propuestos mientras no haya aprobación: 0 USDC por operación y 0 USDC diarios**, es decir ninguna transferencia. Cualquier límite no nulo futuro requiere decisión expresa del PM, Security y Squads. Cada transferencia futura requeriría propuesta revisada, retardo y registro de evidencia (propuesta, firmas públicas, firma finalizada, evento/outbox y conciliación). Ante descuadre: bloquear nuevas operaciones mediante mecanismo verificado, conservar firmas e invocar [runbook](C3_EMERGENCY_RUNBOOK.md). Recuperación requiere dos miembros válidos, revisión Security y nuevo retardo; nunca acceso secreto compartido.

## Puerta reproducible

Desde `services/c3-mainnet`: `npm run c3:governance:readiness`. Una configuración candidata bien formada devuelve código 0 y `NO-GO` con insumos faltantes; **código 0 valida el expediente, no autoriza desplegar**. Los tests negativos y el esquema rechazan bypass, evidencia fabricada y campos secretos. Deben faltar hasta nueva fase: tres direcciones, aprobaciones PM/Security, mapeo Symmetry, Squads verificado, timelocks realizables/aprobados, topes y fees aprobados, vault/share mint y firmas de despliegue. Véanse la [ceremonia futura](C3_GOVERNANCE_DEPLOYMENT_CEREMONY.md) y [decisión de fees](C3_FEE_POLICY_DECISION.md).
