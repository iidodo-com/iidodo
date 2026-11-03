#!/usr/bin/env bash
# 単体テスト一式（Node.js 18+ のみ必要。外部パッケージ・ネットワーク不要）
set -u
cd "$(dirname "$0")"
rc=0
for t in adapter.test.js ics.test.js storage.test.js; do
  echo "=================== $t"; node "$t" || rc=1
done
exit $rc
