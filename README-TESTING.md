# Smart Folders - Testing Guide

## Test Framework

This project uses [Vitest](https://vitest.dev/) for unit and integration testing.

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run tests with UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

## Test Files

Test files follow the pattern `*.test.ts` and are co-located with the source files they test:

- `src/rule-evaluator.test.ts` - Tests for rule condition matching
- `src/manager.test.ts` - Tests for rule execution and management (TODO)
- `src/ui/rule-builder-view.test.ts` - Tests for UI components (TODO)

## Current Test Coverage

### Rule Evaluator (`rule-evaluator.test.ts`)
✅ **Implemented**
- Frontmatter equals condition
- Frontmatter not-equals condition
- Frontmatter contains condition
- Frontmatter exists/not-exists conditions
- Frontmatter with array values
- Tag has condition
- Tag does-not-have condition
- Tag normalization (with/without # prefix)
- Disabled rules skip evaluation

### Manager Tests (TODO)
- [ ] getInheritedRules() with multiple parent levels
- [ ] toggleInheritedRule() enable/disable
- [ ] processFile() respects folder enable/disable
- [ ] processFile() respects disabled inherited rules
- [ ] executeAction() for each action type
- [ ] resolveRelativePath() with ./ and ../
- [ ] Cascading quarantine path inheritance
- [ ] Policy enforcement (files-only, folders-only, locked)
- [ ] Violation detection and storage
- [ ] Exception management (add/remove)

### UI Tests (TODO)
- [ ] View initialization
- [ ] Folder state changes trigger re-render
- [ ] Dirty state tracking
- [ ] Rule CRUD operations
- [ ] Rule reordering

## Writing New Tests

Example test structure:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEvaluator } from './rule-evaluator';
import { SimpleRule, RuleContext } from './types';

describe('Feature Name', () => {
  let evaluator: RuleEvaluator;

  beforeEach(() => {
    // Setup before each test
  });

  it('should do something specific', () => {
    // Arrange
    const rule: SimpleRule = { /* ... */ };
    const context: RuleContext = { /* ... */ };

    // Act
    const result = evaluator.matches(rule, context);

    // Assert
    expect(result).toBe(true);
  });
});
```

## Test Organization

Tests are organized into describe blocks by feature:
- **Unit tests**: Test individual functions/methods in isolation
- **Integration tests**: Test interactions between components
- **End-to-end tests**: Test complete user workflows (manual for now)

## Mocking Obsidian API

Since Obsidian APIs are not available in the test environment, we mock them:

```typescript
let mockCache: any;

beforeEach(() => {
  mockCache = {
    getFileCache: (file: any) => ({
      frontmatter: file.mockFrontmatter,
      tags: file.mockTags || [],
    }),
  };
  evaluator = new RuleEvaluator(mockCache);
});
```

## Known Issues

### Architecture Mismatch
If you see an error about `@rollup/rollup-win32-arm64-msvc` not being a valid Win32 application, this is an architecture mismatch between ARM64 and x64. Tests should be run on a system with matching architecture or use WSL.

### Obsidian API Dependencies
Some components depend heavily on Obsidian APIs (TFile, Vault, etc.) which are difficult to mock. For these, we focus on:
1. Testing pure logic functions separately
2. Manual testing within Obsidian
3. Integration tests with real vault data (future)

## Continuous Integration

TODO: Add GitHub Actions workflow for automated testing on push/PR.

## Manual Testing Checklist

See `Notes/Projects/smart-folders/00_Admin/03-visual-ui.md` for the comprehensive manual testing checklist covering:
- Rule creation and editing
- All condition types and operators
- All action types
- Cascading rules and inheritance
- Folder enable/disable hierarchy
- Content policy enforcement
- Violations and exceptions management
