#!/bin/bash

# Can only provide a custom --tag when not in prerelease mode
# The prerelease tags come from the `pre.json`` "tag" field
if [ -f ".changeset/pre.json" ];
  echo "Publishing with default changesets tag (pre-release)"
  pnpm exec changeset publish
else
  echo "Publishing with v6 tag (stable release)"
  pnpm exec changeset publish --tag v6
fi
