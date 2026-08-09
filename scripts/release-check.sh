#!/bin/sh

if [ -n "$(git status --porcelain)" ]; then
	echo "cannot check changelogs, unstaged commits"
	exit 1
fi

last_commit=$(git rev-parse HEAD)
last_changelog_commit=$(git log -1 --format=%H -- ./changelogs)

if [ "$last_commit" != "$last_changelog_commit" ]; then
	echo "last hash doesn't match last changelog"
	exit 1
fi

echo "new commits are not in changelogs"
exit 0
