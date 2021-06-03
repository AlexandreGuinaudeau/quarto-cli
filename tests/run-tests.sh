#!/bin/bash

# Determine the path to this script (we'll use this to figure out relative positions of other files)
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  SCRIPT_PATH="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE" # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
export SCRIPT_PATH="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"


DENO_DIR="`cd "$SCRIPT_PATH/../package/dist/bin/" > /dev/null 2>&1 && pwd`"

QUARTO_SRC_DIR="`cd "$SCRIPT_PATH/../src" > /dev/null 2>&1 && pwd`"

# Local import map
QUARTO_IMPORT_ARGMAP=--importmap=$QUARTO_SRC_DIR/import_map.json

export QUARTO_BIN_PATH=$DENO_DIR
export QUARTO_SHARE_PATH="`cd "$SCRIPT_PATH/../src/resources/";pwd`"
export QUARTO_DEBUG=true

QUARTO_DENO_OPTIONS="--unstable --allow-read --allow-write --allow-run --allow-env --allow-net"

${DENO_DIR}/deno test ${QUARTO_DENO_OPTIONS} ${QUARTO_IMPORT_ARGMAP} $@

# Generates the coverage report
if [[ $@ == *"--coverage"* ]]; then

  # read the coverage value from the command 
  [[ $@ =~ .*--coverage=(.+) ]] && export COV="${BASH_REMATCH[1]}"

  echo Generating coverage report...
  ${DENO_DIR}/deno coverage --unstable ${COV} --lcov > ${COV}.lcov
  genhtml -o cov_profile/html ${COV}.lcov
  open cov_profile/html/index.html
fi
