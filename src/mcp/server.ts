#!/usr/bin/env node
/**
 * EDID Editor's MCP server, for Claude Code or any other MCP client, over stdio:
 *
 *   claude mcp add edid-editor -- node /path/to/edid-editor/src/mcp/server.ts
 *
 * Runs on Node's own type stripping (Node 22.18 or later), straight from the source: the
 * library is erasable TypeScript with no dependencies of its own, so it needs no build and
 * no `npm install`.
 */

import './stdout.ts'
import { serveStdio } from './protocol.ts'
import { SERVER_INFO, edidTools } from './tools.ts'

await serveStdio(SERVER_INFO, edidTools())
