#!/bin/bash
# Experiment processes only. Normal reads, pipes and in-memory computation work.
export PYTHONDONTWRITEBYTECODE=1
exec /usr/bin/sandbox-exec -f "$(dirname "$0")/readonly-shell.sb" /bin/bash "$@"
