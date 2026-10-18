# DECISIONS — Registro de decisiones de C Market

Actualizado: 17 de octubre de 2026. Clasificación documental: SHARED.
APROBADO significa requisito expreso registrado, no auditoría externa, permiso
de gasto, publicación ni habilitación económica. Fecha desconocida se conserva
como tal. Cada decisión nueva deberá añadir una entrada; no borrar sustituidas.

## ADR-001 — Migración y procedencia compartida

- Fecha: migración registrada 14-09-2026; aprobación original exacta pendiente de confirmar.
- Estado: aprobada según historial/AGENTS.
- Contexto/decisión: conservar c10-pocket como fuente histórica, migrar la app
  Seeker y mantener un producto con historia Git compartida para dos hackathons.
- Justificación registrada: continuidad y dos entregas transparentes; no atribuir
  a la migración la fecha de creación del código original.
- Alternativas: copia manual entre repositorios prohibida por la política.
- Consecuencias/componentes: apps/mobile, worktrees y ramas de entrega; trabajo
  SHARED se transfiere mediante Git con procedencia, nunca integración automática.
- Evidencia: 6da4cb8, [política](SHARED_WORK_POLICY.md),
  [divulgación World’s Fair](WORLDSFAIR_PREEXISTING_WORK.md). Límite registrado:
  14-09-2026 13:00 UTC; inscripción del día 15 no sustituye ese límite.

## ADR-002 — C3 estratégico y etapa Symmetry

- Fecha: orientación registrada 20-09-2026.
- Estado: composición aprobada; ejecución Symmetry sustituida por ADR-004.
- Contexto/decisión: C3 con exposición objetivo BTC 40%, ETH 30%, SOL 30%;
  activos en vault y participaciones para el usuario, no entrega de tres activos a su wallet.
- Justificación: objetivo de cesta administrada; no ponderación por capitalización.
- Alternativa sustituida: SOL/USDC/JitoSOL; conservar [arquitectura histórica](C3_SETTLEMENT_ARCHITECTURE.md).
- Consecuencias: pesos siempre 4000/3000/3000; Symmetry permanece como investigación,
  no custodio del APK actual. Fuentes: AGENTS y C3_MAINNET_DOLLAR_PILOT.md.

## ADR-003 — Política de fees candidata

- Fecha: registro 23-09-2026; fecha exacta de aprobación original no comprobada aquí.
- Estado: aprobada como candidata; activación pendiente.
- Decisión: 15 bps compra y venta; descuento 50% por SKR oficialmente verificado,
  efectivo 7,5 bps. Cobro/descuento deshabilitados hasta Security y gobierno.
- Contexto/justificación: distinguir propuesta de cobro real; conservar redondeo,
  destinatarios y validación on-chain antes de activar.
- Alternativa sustituida: 60 bps depósito / 10 bps retiro, propuesta obsoleta.
- Consecuencias/componentes: política, manifiesto, UI y contabilidad; no cobrar
  una comisión ni alegar aprobación Squads por este documento.
- Evidencia: [decisión de tarifas](C3_FEE_POLICY_DECISION.md).

## ADR-004 — Programa open-vault sustituye ejecución Symmetry

- Fecha: 28-09-2026, registrada en AGENTS y commit 6c1b60c.
- Estado: aprobada en el alcance registrado; sustituye ejecución de ADR-002.
- Decisión: programa propio Rust/Anchor en programs/c3-pilot-vault, custodia PDA,
  shares reales on-chain, diarios y conciliación; preservar Symmetry congelado.
- Justificación detallada: consultar [arquitectura open-vault](C3_OPEN_VAULT_ARCHITECTURE.md);
  no se inventan aquí motivos históricos adicionales.
- Alternativas: Symmetry queda como posible adaptador futuro, no implementación activa.
- Consecuencias: candidato Mainnet inicialmente restringido a una wallet/1 USDC;
  pruebas clonadas/locales no equivalen a adquisición Mainnet ni revisión profesional.

## ADR-005 — Entrega Devnet aislada

- Fecha: override registrado 05-10-2026; infraestructura continúa en commits posteriores.
- Estado: aprobada para delivery/c3-devnet-evaluation; Mainnet sigue bloqueado.
- Contexto/decisión: evaluar ciclo real on-chain con tokens y router de prueba,
  identidades de evaluación separadas, servicios alojados y APK independiente.
- Justificación registrada: entrega evaluable sin fondos reales ni servicios pagados.
- Alternativa: candidato Mainnet preservado; sus límites/aprobaciones no se heredan.
- Consecuencias/componentes: apps/c3-pilot, web Vercel, c3_eval y programas Devnet;
  aviso permanente de tokens sin valor. No presentar router como Jupiter Devnet.
- Evidencia: AGENTS, evaluation-scope.ts y [QA](C3_DEVNET_EVALUATION_QA.md).

## ADR-006 — Importes variables y pruebas sucesivas

- Fecha: registros 11–12-10-2026; commits baf0310 y d023a16.
- Estado: aprobada exclusivamente para evaluación Devnet.
- Decisión: 1–1.000.000 test USDC según saldo/configuración; rondas separadas
  hasta diez; una posición activa por wallet y una por vida de cada vault.
- Justificación: permitir repetir evaluación sin borrar derechos ni historial.
- Alternativas no aprobadas: cambiar caps antiguos, mezclar posiciones financiadas
  o habilitar ventas parciales mediante botones sin soporte contractual.
- Consecuencias: preservar límites anteriores 1/200, firmas, vaults y rondas;
  nueva compra solo después de reclamo finalizado. Modifica el alcance Devnet de ADR-005,
  no el piloto monetario restringido ni la fórmula de emisión Mainnet.

## ADR-007 — Mercado real informativo y UX vigente

- Fecha: 12-10-2026; commits 7af4f93, 6ed0c60, 6d70e63 y 383dc9d.
- Estado: aprobado/implementado en entrega; aceptación integral actual pendiente.
- Decisión: fondo blanco, marca oficial, bienvenida inglesa y cuatro idiomas de
  app; cesta cerrada sin depósito presentado como saldo; precios spot reales
  BTC/ETH/SOL y variación 24 h consultados cada cinco segundos en Índices.
- Justificación registrada: claridad de estado y fluctuación, sin falsos saldos.
- Alternativa sustituida: mostrar solo referencia cada minuto/ocultarla en compra pendiente.
- Consecuencias: precio/valor orientativo no autoriza emisión ni payout; venta paga
  USDC de prueba conciliado. Fuentes: componentes, api/prices.mjs y QA histórica.

## ADR-008 — Memoria persistente en siete documentos

- Fecha: 17-10-2026, encargo explícito del propietario.
- Estado: aprobada e implementada documentalmente en este worktree; sin commit.
- Decisión: AGENTS, README, PRODUCT, ARCHITECTURE, DECISIONS, STATUS y HANDOFF
  con evidencia, límites y punto de reanudación; sin cambios funcionales.
- Justificación: continuar entre cuentas/modelos sin depender del chat.
- Alternativa: memoria solo conversacional no constituye continuidad verificable.
- Consecuencias: actualización proporcional por futuros agentes; no automatización
  de fondo ni copia de secretos; no commit/push/despliegue en este encargo.
- Integración SHARED a otras ramas: pendiente de autorización y revisión de diferencias.
