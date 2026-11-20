# Sourced by the release steps: retry <command...> runs it up to five times (GitHub's API has outages).
retry() {
  for i in 1 2 3 4 5; do
    "$@" && return 0
    echo "Failed, retrying in $((i * 15))s"
    sleep $((i * 15))
  done
  return 1
}
