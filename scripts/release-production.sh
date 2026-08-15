#!/bin/sh
set -eu

if [ -n "$(git status --porcelain)" ]; then
	echo "Production release requires a clean working tree." >&2
	exit 1
fi

if [ "$(git branch --show-current)" != "main" ]; then
	echo "Production releases must run from main." >&2
	exit 1
fi

git fetch origin

head_commit=$(git rev-parse HEAD)
main_commit=$(git rev-parse origin/main)

if [ "$head_commit" != "$main_commit" ]; then
	echo "Local HEAD must match origin/main before release." >&2
	exit 1
fi

if git show-ref --verify --quiet refs/remotes/origin/production &&
	[ "$head_commit" = "$(git rev-parse origin/production)" ]; then
	echo "Production already points to $head_commit."
	exit 0
fi

git push origin HEAD:production
