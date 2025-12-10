# TypeScript Conventions

## Project Configuration

- **Module System**: ES Modules (`"type": "module"` in package.json)
- **TypeScript Version**: 5.7+
- **Build Tool**: `tsc` for production, `tsx` for development

## Import/Export Patterns

### ES Module Imports

Always use `.js` extensions in import statements (TypeScript ESM requirement):

```typescript
// Correct
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Task } from '../types.js';

// Incorrect
import { Client } from '@modelcontextprotocol/sdk/client/index';
import { Task } from '../types';
```

### Export Patterns

Use named exports for functions and types:

```typescript
// Good
export async function createTasksInPlanner(planId: string, tasks: Task[]) { ... }
export async function closeMCPClient() { ... }

// Avoid default exports
```

## Type Definitions

### Centralized Types

All shared types live in `src/types.ts`. Import with:

```typescript
import type { Task, PlannerTask, TeamsChannel } from '../types.js';
```

### Type-Only Imports

Use `import type` for type imports to avoid runtime overhead:

```typescript
import type { Task } from '../types.js';  // Type-only
import { Client } from '@mcp/sdk';        // Runtime import
```

## Async/Await Patterns

### Always Use Async/Await

Prefer async/await over Promises:

```typescript
// Good
export async function createTasks(tasks: Task[]) {
  const client = await getMCPClient();
  return await client.callTool(...);
}

// Avoid
export function createTasks(tasks: Task[]) {
  return getMCPClient().then(client => ...);
}
```

### Error Handling

Use try-catch blocks for error handling:

```typescript
try {
  const result = await client.callTool({ name: 'create-planner-task', ... });
  return result;
} catch (error) {
  console.error(`[Service] Failed to create task:`, error);
  throw error;  // Re-throw for upstream handling
}
```

## Naming Conventions

### Functions

- Use camelCase
- Prefix with verb (get, create, fetch, post, check)
- Be descriptive but concise

```typescript
getMCPClient()
createTasksInPlanner()
postTaskToChannel()
checkApprovals()
```

### Variables

- Use camelCase
- Boolean variables: prefix with `is`, `has`, `should`

```typescript
const mcpClient = ...;
const isApproved = ...;
const hasReactions = ...;
```

### Constants

- Use SCREAMING_SNAKE_CASE for true constants
- Use camelCase for configuration values from environment

```typescript
const STATE_DIR = path.join(process.cwd(), '.state');
const PORT = process.env.PORT || 3000;
```

## Module-Level Variables

Cache clients at module level (not function level):

```typescript
// Correct - module-level caching
let mcpClient: Client | null = null;

async function getMCPClient(): Promise<Client> {
  if (!mcpClient) {
    mcpClient = new Client(...);
  }
  return mcpClient;
}
```

## Command Scripts

### Development

```bash
npm run dev        # Run with tsx (no build needed)
npm run dev -- post-to-teams --meeting-id abc123
```

### Production

```bash
npm run build      # Compile TypeScript
npm start         # Run compiled JavaScript
```

### Server

```bash
npm run server     # Run webhook server with tsx
```
