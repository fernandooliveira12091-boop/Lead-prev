#!/usr/bin/env bash
# Aplica as migrações num banco temporário, roda os testes, testa a concorrência e a reversão.
# Uso: PGURL=postgres://usuario:senha@localhost:5432/postgres db/tests/run.sh
# (o usuário precisa poder criar e apagar bancos; nunca aponte para o banco de produção)
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PGURL:?defina PGURL apontando para um PostgreSQL de teste}"
DB="leadprev_teste_$$"
ADMIN="$PGURL"
TESTE="${PGURL%/*}/$DB"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

psql_q "$ADMIN" -c "CREATE DATABASE $DB"
trap 'psql_q "$ADMIN" -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)"' EXIT

for f in db/migrations/*.up.sql; do psql_q "$TESTE" -f "$f"; done
psql_q "$TESTE" -f db/tests/0001_atribuicao.test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'

echo "-- concorrência: 20 webhooks simultâneos do mesmo contato"
for i in $(seq 1 20); do
  psql_q "$TESTE" -c "SET search_path TO leadprev;
    SELECT registrar_origem(lead_id, 'whatsapp', 'link_code', CASE WHEN $i % 2 = 0 THEN 'AR001' ELSE 'AR002' END)
    FROM upsert_lead('whatsapp', '5599900009999', 'whatsapp', now())" >/dev/null &
done
wait
R=$(psql -X -q -At "$TESTE" -c "SET search_path TO leadprev;
  SELECT (SELECT count(*) FROM lead_identidades WHERE id_externo = '5599900009999') || ' ' ||
         (SELECT count(*) FROM lead_origens o JOIN lead_identidades i USING (lead_id) WHERE i.id_externo = '5599900009999') || ' ' ||
         (SELECT count(*) FROM lead_origens o JOIN lead_identidades i USING (lead_id) WHERE i.id_externo = '5599900009999' AND o.eh_primeira)")
[ "$R" = "1 20 1" ] && echo "  ok - T15 concorrência: 1 lead, 20 origens, 1 primeira" || { echo "  FALHOU: T15 ($R)"; exit 1; }

echo "-- reversão"
for f in $(ls -r db/migrations/*.down.sql); do psql_q "$TESTE" -f "$f"; done
N=$(psql -X -At "$TESTE" -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'leadprev'")
[ "$N" = "0" ] && echo "  ok - T16 down remove o esquema" || { echo "  FALHOU: T16"; exit 1; }
for f in db/migrations/*.up.sql; do psql_q "$TESTE" -f "$f"; done
echo "  ok - T17 up reaplicável após down"
echo "Todos os testes passaram."
