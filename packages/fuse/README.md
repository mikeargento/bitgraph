# @mikeargento/bitgraph-fuse (working name)

The producer side of a BitGraph profile: allocate a slot before an artifact is
finished, write a commitment to that signed allocation into the artifact, hash
the finished bytes, and commit the digest under the same slot. The result is a
Frame: the unchanged bitgraph/1 proof plus an advisory manifest.

Verification is free and lives in the MIT package `@mikeargento/bitgraph-verify`
(`verifyFuse`). Recording through this SDK is licensed. Private; not published.

## Harness command

```
node dist/cli.js fuse photo.jpg --placement trailer/1 --out ./out
node dist/cli.js produce --origin photo.jpg --out ./out
node dist/cli.js check ./out/photo.jpg.bitgraph-fuse.json photo.jpg
```

Against the local enclave harness (`server/commit-service/local-enclave`):
`--base-url http://127.0.0.1:58080 --allocate-path /allocate-slot --commit-path /commit`.
