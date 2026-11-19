#!/usr/bin/env bash
# Runs the Supabase migrations against a throwaway local PostgreSQL (with a
# small stub for auth/storage) and executes the RLS + integrity tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$DATA"; RUNAS="sudo -u postgres"
  command -v sudo >/dev/null || RUNAS="su postgres -c"
fi
run() { if [ -n "$RUNAS" ]; then $RUNAS "$@"; else "$@"; fi; }
cleanup() { run "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
run "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
run "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" -w start >/dev/null
PSQL=(psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "applying $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls_test.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/sales_test.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/delivery_test.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/cash_sale_test.sql"

# Concurrent document numbering: 25 simultaneous sessions must get 25 unique, consecutive numbers.
ORG_A=$("${PSQL[@]}" -tAc "select id from public.organizations where created_by = '11111111-1111-1111-1111-111111111111'")
BEFORE=$("${PSQL[@]}" -tAc "select coalesce(max(last_number), 0) from public.document_sequences where organization_id = '$ORG_A' and doc_type = 'delivery_order' and seq_date = public.today_kl()")
OUT="$(mktemp)"
for i in $(seq 1 25); do
  "${PSQL[@]}" -tAc "select public.next_document_number('$ORG_A', 'delivery_order', public.today_kl())" >>"$OUT" &
done
wait
TOTAL=$(wc -l <"$OUT"); UNIQUE=$(sort -u "$OUT" | wc -l)
LAST=$("${PSQL[@]}" -tAc "select last_number from public.document_sequences where organization_id = '$ORG_A' and doc_type = 'delivery_order' and seq_date = public.today_kl()")
rm -f "$OUT"
if [ "$TOTAL" != 25 ] || [ "$UNIQUE" != 25 ] || [ "$LAST" != $((BEFORE + 25)) ]; then
  echo "CONCURRENCY TEST FAILED: total=$TOTAL unique=$UNIQUE last=$LAST"; exit 1
fi
echo "CONCURRENT NUMBERING TEST PASSED (25 unique)"
