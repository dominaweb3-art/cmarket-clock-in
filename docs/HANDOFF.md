# HANDOFF — TRANSFERENCIA DE CONTEXTO

## Publicación documental autorizada posteriormente

El propietario autorizó después del cierre documental crear un commit y publicar
los siete documentos en origin/delivery/c3-devnet-evaluation como respaldo.
Las referencias siguientes a documentos «sin commit» describen el cierre anterior,
no el estado tras esa publicación. Consultar Git para obtener el commit definitivo.
Esta autorización no incluye integrar ni publicar cambios de otros worktrees,
secretos, material de firma, bases de datos o archivos ignorados.

## 1. Identificación

- Proyecto: C Market, evaluación C3 Android/Seeker con protocolo open-vault.
- Actualización: 17-10-2026, America/Bogota; hora exacta no registrada.
- Worktree: /Users/juantorres/Projects/cmarket-c3-open-vault.
- Rama: delivery/c3-devnet-evaluation.
- Último commit: 383dc9d480cb7b5205630ad7cd868517c39a3bc7, 12-10-2026.
- Repositorio común: /Users/juantorres/Projects/cmarket-integration/.git.
- Entorno: macOS; versiones declaradas y preparación en README, no reinstaladas hoy.
- APK: 0.1.38 / code 39, com.dominaweb3.cmarket.c3evaluation.

## 2. Resumen ejecutivo

Existe una entrega Devnet con tokens y router de prueba, shares on-chain, diarios
PostgreSQL, backend/web y APK separados del candidato Mainnet deshabilitado.
Un ciclo físico completo está documentado para 0.1.14; la versión actual agrega
UX, recuperación y referencias reales de mercado. La compra posterior de 100
test USDC seguía financiada pero sin participaciones en el último registro.
No afirmar que fue resuelta ni que la app actual pasó otro ciclo completo.
La prioridad expresada posterior es preparar World’s Fair preservando CLOCK IN.
Esta etapa implementó únicamente memoria documental local; no reprogramó ni publicó.

## 3. Avances confirmados

VERIFICADO hoy: código/configuración presentes, rama y remota en mismo HEAD,
hash local del APK igual al SHA publicado en Git y estructura real. Tres documentos
existentes se ampliaron conservando contenido; cuatro se crearon. Ver [STATUS](STATUS.md).
DOCUMENTADO previamente: custodia PDA, depósito/asignación/shares/venta/quema/reclamo
Devnet, UI inglesa/española/china/portuguesa, bienvenida blanca con marca oficial,
precios Coinbase y QA física. No extrapolar registro histórico a estado actual.

## 4. Estado de verificación

Esta ejecución solo leyó código/manifiestos/Git, calculó hash, consultó refs
remotas sin fetch, editó documentación y verificó enlaces/alcance. No ejecutó tests
de aplicación, builds, instalaciones, migraciones, DB, wallet ni despliegues.
Las pruebas previas y sus límites están en [QA](C3_DEVNET_EVALUATION_QA.md) y STATUS.
Doctor previo: 18/19, warning Expo. No hay nueva auditoría de seguridad ni QA Mainnet.

## 5. Problemas abiertos

CONT-01: compra de 100 test USDC con depósito finalizado; última sesión expirada,
plan pendiente y shares no emitidas. Requiere lectura actual y conciliación original.
CONT-02: expiración y numerosas aprobaciones afectan UX. CONT-03: warning Expo.
CONT-04: aceptación integral actual pendiente. CONT-05: documentos históricos aún
pueden llamar “current” a versiones antiguas; prevalecen sus fechas/alcance.
CONT-06: salud externa, dependencias, fondos y accesos actuales desconocidos.

## 6. Decisiones y restricciones

Leer [DECISIONS](DECISIONS.md) y el override activo en AGENTS. C3 es 40/30/30;
test assets no equivalen a BTC/ETH/SOL reales ni Jupiter Devnet. MWA no custodia.
Una posición activa por wallet; una por vault; hasta diez rondas, caps reales y
redención total. Precios informativos no autorizan emisión ni cambian payout.
Conservar firmas inciertas, CAS, generaciones, inventario, mínimos y autoridad.
No resetear estado para habilitar botones. Mainnet, real funds, fees y SKR siguen
bloqueados. La propuesta 15/15/7,5 bps es candidata; 60/10 es obsoleta.
No alterar worktrees protegidos, compartir claves ni reescribir historia.

## 7. Estado del repositorio

Árbol de este worktree limpio al inicio. Al cerrar, quedan sin commit exactamente
AGENTS.md, README.md, docs/ARCHITECTURE.md y cuatro documentos nuevos:
docs/PRODUCT.md, docs/DECISIONS.md, docs/STATUS.md, docs/HANDOFF.md.
No crear commit/push por esta solicitud. Esta memoria no está aún respaldada en remoto.

El mapa de ocho worktrees y ramas pendientes está en STATUS. Destaca
cmarket-clockin-delivery: diez modificaciones (README, pitch PDF y siete materiales
más submission/README) y seis rutas no rastreadas: .gitattributes,
submission/DELIVERY_HANDOFF.md, submission/LOCAL_VAULT_RECORDING.md,
submission/assets/screenshots/08-qa-c3-details-20260930.png,
submission/assets/screenshots/09-qa-activity-20260930.png y submission/build-pitch-pdf.py.
No se inspeccionó su contenido ni se integró. Los demás worktrees estaban limpios.
Hay dos commits locales de shared y cuatro del piloto Symmetry sin publicar.

Remotos públicos: origin https://github.com/dominaweb3-art/cmarket-clock-in.git;
worldsfair-delivery https://github.com/dominaweb3-art/cmarket-worldsfair.git.
Última copia remota comprobada para esta rama: 383dc9d, consulta del 17-10-2026.
No se comprobó un backup completo, de DB o de material ignorado. Cloud: DESCONOCIDO.

## 8. Servicios externos

Web/API configuradas en Vercel proyecto cmarket, https://cmarket-nine.vercel.app;
PostgreSQL Supabase con esquema c3_eval; Solana Devnet oficial y Phantom/MWA;
Coinbase Exchange para precios. Configuración secreta exclusivamente de servidor;
README enumera nombres de variables sin valores. Accesos, vigencia de secretos,
estado de despliegue/DB/RPC y disponibilidad del teléfono no se comprobaron hoy.
No dar por migrados esos accesos por cambiar de cuenta ChatGPT.

## 9. Trabajo pendiente

P0: recuperar el estado económico original; P1: aceptación física actual y backup
del trabajo sin commit/ignorado; P2: entrega World’s Fair y drift documental restante.
Cada dependencia/criterio está en STATUS. Esta memoria es SHARED local, pero llevarla
a shared/otras ramas requiere Git revisado y autorización; no copiarla manualmente.

## 10. Próxima acción exacta

En un encargo de continuación funcional, comprobar HEAD/dirty tree y revisar
el último intent de la wallet en el diario y Solana Devnet, sin escribir ni repetir
el depósito. Último registro disponible: intent
92116644-6e92-4ccb-8a16-2ad9d74fea81, depósito de 100 test USDC con firma
cGqqVqVfFc8GnwtRkZc6xPP7qGrqnTatgKpKRLS2KdC7saq4VmALRPZDrjXm73J9qoukZFm7bJoh4Ay4DiiJt7p.
Es referencia histórica, no instrucción para enviar. Localizar generación/plan y
estado actual antes de solicitar mensaje MWA. Archivos clave:
services/c3-mainnet/src/evaluation-owner-service.ts,
evaluation-plan-recovery.ts, evaluation-service-journal.ts y
apps/c3-pilot/src/DevnetEvaluationApp.tsx.
Resultado esperado: saber si falta autenticación, conciliación, renovación,
procesamiento o emisión; confirmar efectos finalizados y no asumir éxito por firma.
Solo después ejecutar la continuación ya autorizada con intervención física necesaria.

## 11. Procedimiento para retomar

1. Abrir este worktree real; la carpeta /Users/juantorres/Documents/Codex/C Market
   solo contiene notas antiguas y no tiene .git.
2. Leer AGENTS, HANDOFF y STATUS; después PRODUCT, ARCHITECTURE, DECISIONS y README
   según tarea. Contrastar lo escrito con archivos y fecha actual.
3. Revisar git status, branch, HEAD y worktree list; preservar los siete documentos
   sin commit y el trabajo de otros worktrees. No checkout/reset/clean por defecto.
4. Consultar evidencia enlazada. Si se pide diagnóstico de recuperación, informar
   objetivos, verificado/documentado, decisiones, errores, riesgos y próxima tarea.
5. Instalar/probar/desplegar solo al recibir un encargo que lo incluya y usando
   comandos del paquete correcto; esta documentación no autoriza esas operaciones.

## 12. Referencias

- [Guía operativa](../README.md), [producto](PRODUCT.md), [arquitectura](ARCHITECTURE.md),
  [decisiones](DECISIONS.md), [estado](STATUS.md).
- [QA de evaluación](C3_DEVNET_EVALUATION_QA.md), [open-vault](C3_OPEN_VAULT_ARCHITECTURE.md),
  [seguridad](C3_OPEN_VAULT_SECURITY_MODEL.md), [política compartida](SHARED_WORK_POLICY.md).
- [World’s Fair](../hackathons/worldsfair/requirements.md) y
  [trabajo preexistente](WORLDSFAIR_PREEXISTING_WORK.md). Reglas/plazos del portal
  no se revalidaron; formulario enviado y video/pitch finales: pendiente de confirmar.
- Marca aprobada: assets/brand; bienvenida: apps/c3-pilot/assets/onboarding.
  Diseños del propietario: /Users/juantorres/Documents/Hackaton/CMarket/Contenido de diseño;
  copia externa no inspeccionada hoy. No depender de su disponibilidad en otra máquina.
- APK local/hash/certificado y URL configurada: STATUS. Git no respalda el APK,
  firma, datos PostgreSQL, configuración externa ni todos los archivos ignorados.
