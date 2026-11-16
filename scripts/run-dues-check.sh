#!/bin/bash
set -e
cd /Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play
export NODE_PATH=/Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/node_modules
node /Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/scripts/report-match-dues.js "$@"
