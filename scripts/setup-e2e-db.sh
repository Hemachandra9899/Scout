#!/usr/bin/env bash
set -euo pipefail

echo "=== E2E Database Setup ==="

echo ""
echo "Generating Prisma client..."
npm run db:generate

echo ""
echo "Applying database schema..."
if npm run db:migrate 2>/dev/null; then
  echo "Migrations applied successfully."
else
  echo "migrate deploy failed; falling back to db push for local/dev."
  npm run db:push
fi

echo ""
echo "Seeding eval project..."
npm run db:seed:eval

echo ""
echo "Database setup complete."
