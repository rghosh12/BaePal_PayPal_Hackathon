#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgres://baepal:local_only@127.0.0.1:5432/baepal_test}"
export DATABASE_URL
pnpm --filter @baepal/api test
