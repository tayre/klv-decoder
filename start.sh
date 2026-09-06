#!/bin/sh
set -eu
cd "$(dirname "$0")/app"
exec node scripts/start.js "$@"
