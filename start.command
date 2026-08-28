#!/usr/bin/env bash
# macOS の Finder でダブルクリックすると Terminal が開いて start.sh が実行される。
cd "$(dirname "$0")"
exec ./start.sh
