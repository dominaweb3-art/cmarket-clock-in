# PRODUCT — C Market

Actualizado: 17 de octubre de 2026. Alcance: rama de evaluación Devnet;
identidad y objetivos preservados. Estado real: [STATUS](STATUS.md).

## Identidad, problema y usuarios

C Market busca simplificar la compra, consulta y venta de una cesta de
criptoactivos desde Android/Seeker mediante wallet compatible con MWA. C3 es la
cesta inicial; evita gestionar manualmente tres activos en pantallas separadas.
Usuarios de esta entrega: propietario, desarrolladores y evaluadores con wallets
propias y tokens sin valor monetario. No es una oferta Mainnet activa.

## Objetivos y resultados esperados

APROBADO: una experiencia móvil comprensible para conectar/verificar wallet,
obtener tokens Devnet, comprar C3, consultar participaciones on-chain, vender y
reclamar USDC de prueba, conservando Actividad y recuperación tras reinicio.
Resultado de entrega: APK firmado independiente de Metro/Mac, web e instrucciones
coherentes con su evidencia. Implementación y aceptación son estados distintos.

## Alcance y funcionalidades

| Funcionalidad | Comportamiento y regla aprobada | Dependencia / estado |
| --- | --- | --- |
| Wallet | Conectar por MWA y verificar propiedad con mensaje; no custodiar claves | Phantom/wallet compatible, backend; código inspeccionado, QA histórica documentada |
| Tokens | Provisión acotada por wallet/generación, un único USDC Devnet visible | Servicio, mint y diario; no faucet de dólares reales |
| Compra | Elegir importe, revisar y firmar depósito; asignar 40/30/30 y emitir shares tras efectos | Vault, router de prueba, keeper, PostgreSQL; compra reciente pendiente según último registro |
| Posición | Mostrar propiedad confirmada; pendiente no equivale a shares emitidas | Lecturas on-chain y recibos; código presente |
| Venta/reclamo | Redención total, tres ventas, quema y USDC realmente liquidado | Wallet y conciliación; ciclo 0.1.14 documentado |
| Recuperación | Conservar firma/plan/intento; conciliar antes de continuar o renovar | Diario durable y autorización explícita |
| Mercado | Spot BTC/ETH/SOL real y 24 h; referencia orientativa de cesta activa | Coinbase, sin autoridad económica; QA de 0.1.38 documentada |
| Experiencia | Inicio / Índices / Actividad, wallet compartida, acordeones, cuatro idiomas | en, es, zh-CN, pt-BR; bienvenida inglesa de una sola finalización |
| Historial | Recibos y Explorer Devnet; cesta vendida sin saldo activo | Recibos confirmados; conservar depósitos anteriores como historia |

El código está verificado por inspección; no se declara nueva aceptación funcional
el 17 de octubre. Véase [QA histórica](C3_DEVNET_EVALUATION_QA.md).

## Reglas de negocio y fórmulas

- Objetivo estratégico fijo: BTC 4000 bps, ETH 3000 bps, SOL 3000 bps; suma 10000.
  No es índice ponderado por capitalización ni garantía de rentabilidad.
- Evaluación: entre 1 y 1.000.000 USDC de prueba, seis decimales, sujeto al saldo
  y máximo real de cada vault. Conservar caps antiguos de 1/200; no cambiarlos por UI.
- Presupuesto en unidades base: BTC = floor(importe × 4000 / 10000), ETH =
  floor(importe × 3000 / 10000), SOL = importe − BTC − ETH. Usar bigint.
- Una posición activa por wallet, una posición por vida del vault y rondas 1–10
  separadas después del reclamo finalizado. No resetear bóvedas ni borrar historial.
- Shares de evaluación se emiten tras completar compras; redención total y quema
  corresponden al protocolo existente. Ventas parciales y compras adicionales
  simultáneas en un vault financiado siguen fuera de alcance.
- Payout: USDC de prueba efectivamente liquidado y conciliado; no garantizar
  depósito íntegro ni pagar una cifra derivada de la referencia de mercado.
- Referencia orientativa: suma de importe × peso × precio actual / precio de
  entrada, redondeada en enteros por componente. Variación = referencia − depósito.
  Fuente y antigüedad deben verse; falta/contradicción de datos no equivale a cero.
- Estado cerrado: cero shares y recibo de USDC; el depósito histórico no se presenta
  como saldo actual. Depósito confirmado, operación enviada y compra concluida difieren.

## Experiencia y requisitos no funcionales

Comprar/Vender permanecen visibles y guían al siguiente paso permitido; no pueden
eludir estado pendiente, wallet, límites o firmas. Inicio explica y navega; Índices
gestiona; Actividad conserva evidencias. Información extensa en acordeones cerrados,
áreas táctiles accesibles, colores con texto, safe areas y pantallas pequeñas.
Bienvenida: tres páginas en inglés, fondo blanco, marca oficial, conectar o explorar;
se puede repetir desde wallet sin borrar datos.

Precios: consulta cada cinco segundos con Índices visible/en primer plano, no
streaming garantizado; manejar red lenta, límites del proveedor y datos caducados.
Las aprobaciones MWA y finalización de red impiden prometer un swap instantáneo.
Sesiones, idempotencia, firmas originales, custodia y verificación de efectos se
preservan aunque se reduzcan clics. Alojamiento durable, sin dependencia del Mac;
su capacidad o disponibilidad actual queda pendiente de confirmar.

## Futuro y decisiones pendientes

- APROBADO COMO CANDIDATO, NO ACTIVADO: comisión 15 bps compra/venta y descuento
  SKR verificado de 50% a 7,5 bps. Faltan revisión Security y gobierno efectivo.
- PROPUESTO/PENDIENTE: habilitación de piloto Mainnet, autoridades, presupuesto,
  NAV monetario, depósitos agrupados, redención parcial y rebalanceo. No autorizados
  por esta documentación ni por tener código aislado.
- FUTURO INACTIVO: C5/C10/C20/C50, mercados globales y recompensas SKR.
- SUSTITUIDO: composición SOL/USDC/JitoSOL; Symmetry como ejecución de esta
  entrega; tasas 60/10 bps. No se borra su procedencia. Ver [DECISIONS](DECISIONS.md).
