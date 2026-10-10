# C Market Devnet 0.1.15 — QA visual

Fecha: 10 de octubre de 2026. Clasificación: CLOCKIN_ONLY.
Workspace: `/Users/juantorres/Projects/cmarket-c3-open-vault`.
Rama: `delivery/c3-devnet-evaluation`.
HEAD inicial: `eb036d7fd4743a5a7a13f122a924b55aa93d9b11`.

## Alcance completado

Implementación de la referencia visual suministrada por el propietario, no un
mockup presentado como aplicación: fondo blanco, tarjeta C3 con iconos de los
activos y objetivo 40/30/30, acceso a los controles existentes mediante
«Comprar C3 · prueba Devnet», panel de wallet e idioma y navegación inferior
Inicio / Índices / Actividad fuera del contenido desplazable.

Índices presenta el objetivo y sus limitaciones; Actividad presenta únicamente
los registros de posición cargados desde el servicio, con estado de efectos
verificados y enlaces Explorer Devnet. Sin sesión verificada muestra un estado
vacío explícito, no operaciones ni balances inventados. Los productos futuros
son tarjetas no interactivas marcadas Próximamente.

El sprite cripto del propietario se conserva sin editar y se muestra mediante
ventanas recortadas nativas. La ilustración de actividad vacía fue generada con
imagegen. Procedencia, prompt y uso están en
`apps/c3-pilot/assets/evaluation-ui/README.md`. Los iconos de navegación son
geometría nativa; no se añadieron dependencias. La revisión de componentes React
influyó en la separación de presentación, accesibilidad de pestañas/botones y
ausencia de solicitudes de red al cambiar de pestaña.

## Artefacto exacto instalado

- APK local: `apps/c3-pilot/dist/devnet-evaluation-ui-v16/c-market-c3-devnet-evaluation-0.1.15.apk`.
- Versión 0.1.15; versionCode 16.
- Paquete: `com.dominaweb3.cmarket.c3evaluation`.
- SHA-256: `25fdacd963e41551b48b0f7577f88efe63948bc1a323455cc743efa73e9b1c28`.
- Certificado SHA-256: `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
- Certificado comparado con el APK previamente instalado antes de usar `adb install -r`.
- APK 0.1.14 conservado, SHA-256 `849cff1a4bb5ebf59391353e7c38f91c02c3f1c8e811856b9d9f0e663d438563`.
- APK, capturas y credenciales locales permanecen ignorados por Git.

## Comprobaciones y límites de la evidencia

COMPLETED: TypeScript, lint, formato, nueve pruebas focales de presentación,
transporte y revisión de paquetes de wallet; export Android; compilación release
final firmada; identidad/certificado/hash; instalación conservando datos y
arranque en frío sin Metro ni túneles ADB.

COMPLETED en Seeker: pantalla Inicio, detalle Índices, estado vacío de Actividad,
barra inferior fija durante desplazamiento, tarjetas Próximamente, acceso al
panel de wallet, inglés/español/chino simplificado/portugués brasileño,
persistencia de portugués tras reiniciar y restauración del español del usuario.
La comprobación no monetaria del backend mostró «Base de datos alojada y Solana
Devnet accesibles». Capturas locales: `apps/c3-pilot/dist/ui-v16-qa/`.

Se comparó el bloque de manejadores de conexión, autenticación, preparación,
firma, envío, consulta, procesamiento y recuperación con el HEAD inicial:
sin modificaciones, excluyendo espacios de formato. No cambiaron contratos,
backend, endpoints, mints, importes, políticas ni dependencias.

NOT_EXECUTED: nueva autenticación/firma física y repetición del ciclo económico
en 0.1.15. El recorrido on-chain anterior de 0.1.14 no se atribuye a un nuevo
ensayo en esta versión. El historial autenticado requiere reconectar y verificar
propiedad después de un arranque en frío, igual que antes de este cambio.

Expo Doctor: 17/19; consulta de React Native Directory falló por respuesta del
servidor externo y el SDK recomienda Expo 57.0.27 frente al 57.0.26 conservado.
No se actualizaron dependencias ni ocultaron estos avisos. El build y la
exportación también mantienen avisos previos de resolución/obsolescencia.

## Preservación y estado de publicación

Mainnet sigue deshabilitado; los símbolos BTC/ETH/SOL se identifican como
activos de prueba y asignación objetivo. Ninguna aprobación, firma blockchain,
envío, transferencia o despliegue de programa se realizó en esta ejecución.
Las ramas Mainnet/estables y otros worktrees no se modificaron.

Este cambio de interfaz y APK se entrega localmente. No se desplegó la web,
no se publicó el APK 0.1.15 y no se hizo push; la descarga pública anterior
permanece intacta. No se requiere ninguna decisión para usar el APK ya instalado.
