# Upgrading and rollback

## Before upgrading

1. Read `CHANGELOG.md` and verify the target image tag.
2. Make an online SQLite backup and copy assets. Test that the backup can be
   opened before proceeding.
3. Stop additional application instances so only one process performs startup
   migrations.
4. Pull and start the new image with the same persistent `/data` volume.
5. Check `/api/health`, which now performs a database query, then verify login,
   page read, and search.

Schema migrations run automatically and atomically at startup. The
`schema_migrations` table records their version. Search reindexing is also
transactional and preserves the configured tokenizer.

## Rollback

Application rollback is **restore-based**: stop the new image, restore the
pre-upgrade database and assets, then start the previous immutable image tag.
Do not point an older image at a database already migrated by a newer major or
minor release unless that changelog explicitly says it is supported.

Keep the old image and backup until the upgraded wiki has passed normal traffic
and a fresh post-upgrade backup has completed.

For the repository's Compose setup:

```bash
docker compose pull
docker compose up -d
```

The default `:1` tag follows compatible 1.x releases. Set
`KAWAII_WIKI_VERSION` to an exact version when every update must be approved
manually. Never run `docker compose down -v` during an update because `-v`
deletes the wiki data volume.
