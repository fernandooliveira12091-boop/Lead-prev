-- 0001_esquema_inicial.down.sql
-- Reverte 0001_esquema_inicial.up.sql. APAGA TODOS OS DADOS do esquema leadprev.
-- Faça backup antes (pg_dump -n leadprev) se houver dados reais.
BEGIN;
SET LOCAL client_min_messages = warning;
DROP SCHEMA IF EXISTS leadprev CASCADE;
COMMIT;
