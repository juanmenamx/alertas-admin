# Alertas EFINFO · Configuración

Interfaz web para configurar las alertas de noticias por Telegram sin entrar a Supabase ni a Metabase:
clientes y bots, alertas (fuentes, cobertura, criterios de IA, envío y formato), destinos, bitácora,
prueba en seco y administradores.

- Página estática (HTML + JS) publicada con GitHub Pages; no guarda secretos.
- Los datos viven en Supabase y solo los ven y cambian los correos registrados como administradores (RLS).
- Lo que necesita secretos (tokens de bots, Metabase, pruebas) pasa por la función `alertas-admin`.

El código del servicio está en el repositorio privado `alertas-noticias`.
