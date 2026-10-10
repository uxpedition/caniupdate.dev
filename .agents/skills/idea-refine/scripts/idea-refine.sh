#!/bin/sh
# Optional POSIX helper: create an idea-refine work set under the configured OS temp directory.
# It creates no repository files. Pass the printed absolute path unchanged to later sessions.
set -eu

temp_base=${TMPDIR:-${TMP:-${TEMP:-}}}
if [ -z "$temp_base" ]; then
  printf '%s\n' 'idea-refine: OS temp directory is not configured; create workDir with the runtime filesystem tools.' >&2
  exit 2
fi
if [ ! -d "$temp_base" ]; then
  printf '%s\n' 'idea-refine: configured OS temp directory does not exist.' >&2
  exit 2
fi
# Resolve relative environment values to an absolute path without assuming /tmp.
case "$temp_base" in
  /*) ;;
  *) temp_base="./$temp_base" ;;
esac
temp_base=$(CDPATH= cd "$temp_base" && pwd -P)
# If invoked from inside a Git work tree, refuse a misconfigured temp path beneath it.
repo_root=''
probe=$(pwd -P)
while :; do
  if [ -e "$probe/.git" ]; then
    repo_root=$probe
    break
  fi
  [ "$probe" = / ] && break
  probe=${probe%/*}
  [ -n "$probe" ] || probe=/
done
if [ -n "$repo_root" ]; then
  case "${temp_base%/}/" in
    "$repo_root/"*)
      printf '%s\n' 'idea-refine: configured OS temp directory is inside the repository.' >&2
      exit 2
      ;;
  esac
fi
work_dir=$(mktemp -d "${temp_base%/}/idea-refine.XXXXXX") || {
  printf '%s\n' 'idea-refine: could not create a work set under the configured OS temp directory.' >&2
  exit 2
}
printf '%s\n' "$work_dir"
