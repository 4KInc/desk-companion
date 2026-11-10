#!/bin/sh
# The four checks every commit must pass (see docs/SUBMISSION.md, "How we work").
set -e
npm test --silent > /dev/null
npm run --silent typecheck
npm run --silent build > /dev/null 2>&1
npm run --silent build:server > /dev/null 2>&1
echo "gate: tests, typecheck, build and server build all pass"
