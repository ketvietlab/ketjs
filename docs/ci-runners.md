# CI runners

CI and npm release jobs default to GitHub-hosted `ubuntu-24.04`.
Set repository variable `CI_RUNNER=self-hosted` to explicitly use the `kv-ci` backup. Restore `CI_RUNNER=github-hosted` after recovery. An unset variable also defaults to GitHub-hosted.

Create a new workflow run after changing workflow source; rerunning an old run retains its original workflow revision. No automatic fallback or duplicate execution is performed.
