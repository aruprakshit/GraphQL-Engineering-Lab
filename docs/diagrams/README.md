# Architecture diagram sources

The architecture guide embeds committed PNG images so it works in Markdown viewers without Mermaid support. The `.mmd` files are editable source diagrams. Commit source and regenerated images together.

From the repository root in WSL, regenerate the detailed architecture and C4 diagrams entirely in Docker:

```bash
for name in runtime-components posts-query login-flow data-model observability c4-context c4-containers c4-query-components c4-login-components; do
  config=mermaid-config.json
  case "$name" in c4-*) config=c4-config.json ;; esac
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$PWD/docs/diagrams:/data" \
    ghcr.io/mermaid-js/mermaid-cli/mermaid-cli@sha256:2c5d27365df71da06c288beebe531ea3637cf9b422b871239a3b016233591d24 \
    -i "/data/$name.mmd" \
    -o "/data/$name.png" \
    -c "/data/$config" \
    -b white -s 2
done
```

The renderer is a development tool, not an application dependency. No host Node.js installation is needed. The first run downloads the image. `architecture.svg` is the separately authored overview; `architecture.png` is its image preview.



