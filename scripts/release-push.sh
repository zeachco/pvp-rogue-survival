#!/bin/sh

set -e

git add --all -- ./changelogs
git commit -m "docs(automation): release changelog update"
git push
