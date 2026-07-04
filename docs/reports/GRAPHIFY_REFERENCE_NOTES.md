# Graphify Reference Notes — Scout Adaptation Plan

## Graphify Overview

Graphify is a Python CLI tool that builds a deterministic knowledge graph of a code repository
using tree-sitter AST extraction (25 languages). It produces a `graph.json` persisted locally
and optionally runs MCP server for IDE integration.

### Pipeline (7 stages)

```
detect() → extract() → build_graph() → cluster() → analyze() → report() → export()
```

| Stage | Graphify | Scout v3.1 |
|-------|----------|-------------|
| detect | `.gitignore`-aware file discovery, grouped by language | Not needed — files already loaded in `githubRepo()` result |
| extract | Tree-sitter AST parsers (25 langs) + regex fallback | Regex-only (TypeScript/JS/Python focus) |
| build_graph | NetworkX DiGraph → nodes + edges → dedup (3-pass) | Prisma Entity/Relation upsert |
| cluster | Leiden community detection | Skip for v1 |
| analyze | God-nodes, surprising connections, import cycles | Skip for v1 |
| report | GRAPH_REPORT.md generation | Skip for v1, query via `query_graph` tool |
| export | JSON, HTML, SVG, Obsidian, Cypher, GraphML | Skip for v1 |

### Node Schema

| Field | Graphify | Scout Entity |
|-------|----------|--------------|
| id | UUID or slug | UUID (auto) |
| label | e.g. `parseGithubRepo` | `name` |
| type | code/file/concept/mcp/etc | `type` (symbol, file, module, dep) |
| file_type | language family | stored in metadata |
| file_path | relative path | stored in metadata |
| source_location | line ranges | stored in metadata |
| summary | docstring/summary | `description` |
| community | cluster ID | not used in v1 |
| confidence | 0.0–1.0 enum | `confidence` |
| metadata | extra JSON | `metadata` (JSON) |

### Edge Schema

| Field | Graphify | Scout Relation |
|-------|----------|----------------|
| source | node ID | `sourceEntityId` |
| target | node ID | `targetEntityId` |
| type (label) | imports/calls/contains/extends/etc | `relationType` |
| weight | numeric | not used in v1 |
| bidirectional | boolean | not used in v1 |
| metadata | extra JSON | `metadata` (JSON) |

### Extraction Approach (Scout v3.1 regex-based)

Graphify uses tree-sitter AST queries per language. Scout Phase 3.1 uses regex patterns:

#### Symbols (classes, functions, exports)
- TypeScript/JS: `export (class|function|const|interface|type) \w+`, `class \w+`, `function \w+`
- Python: `class \w+`, `def \w+`

#### Imports
- TypeScript/JS: `import .+ from ['"](.+)['"]`, `require\(['"](.+)['"]\)`
- Python: `import (\w+)`, `from (\w+) import`

#### External dependencies
- `package.json`: parse `dependencies` + `devDependencies` keys
- `requirements.txt`: line-by-line package names

### Dedup Strategy (Scout v3.1)

Graphify uses 3-pass dedup. Scout v3.1 uses simpler upsert:
- Before creating an Entity, `findFirst` by `{ projectId, name, type }`
- Before creating a Relation, `findFirst` by `{ projectId, sourceEntityId, targetEntityId, relationType }`
- Only `create` if not found, `update` if found

## Adaptation Plan

### Phase 3.1 Scope (current)

1. `repo-graph-builder.ts` — deterministic regex-based extraction from repo file texts
   - Parse files from `githubRepo()` result (the `files` array with `{ path, text }`)
   - Extract symbols (classes, functions, exports/defs)
   - Extract imports/requires
   - Extract package.json deps
   - Detect file-level module structure (apps/packages dirs)
   - Upsert into Prisma Entity/Relation
   - Return node/edge counts

2. Router integration
   - `isGraphifyRepoQuery()` — detects "graphify this repo" or "build graph for this repo"
   - After `githubRepo()` succeeds and `isGraphifyRepoQuery()` is true, call `buildAndPersistRepoGraph()`
   - `isRepoGraphQuestion()` — detects questions about the repo's code graph
   - `query_graph` branch in `answerWithRouter()`

3. Improved `queryGraph()`
   - Token-aware matching instead of simple contains
   - Relation traversal to depth N
   - Markdown rendering of results

4. Eval cases
   - `phase3-graphify-repo-001`: graphify a repo → expects `graphifyRepoUsed=true`
   - `phase3-query-repo-graph-001`: query persisted graph → expects `repoGraphUsed=true`

### Future Phases (not in v3.1)

- **Phase 3.2**: Cross-file symbol resolution, community detection, graph report
- **Phase 3.3**: MCP server for graph querying
- **Phase 3.4**: Watch mode, incremental updates, multi-repo merge
