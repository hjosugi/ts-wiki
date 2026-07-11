# kawaii-wiki.ts

A free, self-hosted wiki for connecting knowledge with Markdown, fast Japanese
search, permissions, revision history, automation, and a typed REST API.

Your wiki is the main character. kawaii-wiki.ts stays in the background as a
small, dependable foundation that people, developers, and AI can improve
together.

[Official documentation](https://kawaii-wiki-ts-docs.up.railway.app/docs/home) ·
[Releases](https://github.com/hjosugi/kawaii-wiki.ts/releases) ·
[Issues](https://github.com/hjosugi/kawaii-wiki.ts/issues)

## Run locally with Docker

No Bun or local build is required.

```bash
docker volume create kawaii-wiki-data
docker run -d --name kawaii-wiki --restart unless-stopped \
  -p 4000:4000 \
  -v kawaii-wiki-data:/data \
  -e KAWAII_WIKI_FTS_TOKENIZER=trigram \
  ghcr.io/hjosugi/kawaii-wiki.ts:1
```

Open <http://localhost:4000/setup>. The container creates a secure JWT secret
inside the persistent volume on first boot.

If you cloned this repository, the same setup is one command:

```bash
docker compose up -d
```

## Update

Back up the `/data` volume, then pull and recreate the container:

```bash
docker compose pull
docker compose up -d
```

The `:1` image follows compatible 1.x releases. Production installations that
require approval before every update should set `KAWAII_WIKI_VERSION=1.0.2` (or
another exact release) before running Compose.

Detailed installation, configuration, backup, restore, Railway, Git mirror,
API, administration, and development guides live in the
[official documentation](https://kawaii-wiki-ts-docs.up.railway.app/docs/home).

## Develop

```bash
bun install
bun run dev
```

See [Contributing](https://kawaii-wiki-ts-docs.up.railway.app/docs/contributing)
before opening a pull request. Security reports follow [SECURITY.md](SECURITY.md).

## License

[0BSD](LICENSE) — use, copy, modify, and distribute it freely.
