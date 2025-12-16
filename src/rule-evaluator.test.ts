import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEvaluator } from './rule-evaluator';
import { SimpleRule, RuleContext } from './types';

describe('RuleEvaluator', () => {
  let evaluator: RuleEvaluator;
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

  describe('Frontmatter Conditions', () => {
    it('should match frontmatter equals condition', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'frontmatter',
          operator: 'equals',
          field: 'status',
          value: 'done',
        },
        action: { type: 'move-file', targetFolder: 'Archive' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: { status: 'done' },
        tags: [],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });

    it('should not match frontmatter equals when values differ', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'frontmatter',
          operator: 'equals',
          field: 'status',
          value: 'done',
        },
        action: { type: 'move-file', targetFolder: 'Archive' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: { status: 'pending' },
        tags: [],
      };

      expect(evaluator.matches(rule, context)).toBe(false);
    });

    it('should match frontmatter not-equals condition', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'frontmatter',
          operator: 'not-equals',
          field: 'status',
          value: 'done',
        },
        action: { type: 'move-file', targetFolder: 'Archive' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: { status: 'pending' },
        tags: [],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });

    it('should match frontmatter contains condition', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'frontmatter',
          operator: 'contains',
          field: 'title',
          value: 'meeting',
        },
        action: { type: 'move-file', targetFolder: 'Meetings' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: { title: 'Team meeting notes' },
        tags: [],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });

    it('should match frontmatter exists condition', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'frontmatter',
          operator: 'exists',
          field: 'status',
        },
        action: { type: 'move-file', targetFolder: 'Archive' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: { status: 'done' },
        tags: [],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });

    it('should match frontmatter not-exists condition', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'frontmatter',
          operator: 'not-exists',
          field: 'archived',
        },
        action: { type: 'move-file', targetFolder: 'Active' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: { status: 'done' },
        tags: [],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });

    it('should match frontmatter equals with array values', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'frontmatter',
          operator: 'equals',
          field: 'tags',
          value: 'important',
        },
        action: { type: 'move-file', targetFolder: 'Important' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: { tags: ['work', 'important', 'urgent'] },
        tags: [],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });
  });

  describe('Tag Conditions', () => {
    it('should match tag has condition', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'tag',
          operator: 'has',
          value: 'inbox',
        },
        action: { type: 'move-file', targetFolder: 'Inbox' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: {},
        tags: ['#inbox', '#todo'],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });

    it('should match tag has condition without # prefix', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'tag',
          operator: 'has',
          value: '#inbox',
        },
        action: { type: 'move-file', targetFolder: 'Inbox' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: {},
        tags: ['#inbox', '#todo'],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });

    it('should match tag does-not-have condition', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: true,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'tag',
          operator: 'does-not-have',
          value: 'archived',
        },
        action: { type: 'move-file', targetFolder: 'Active' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: {},
        tags: ['#inbox', '#todo'],
      };

      expect(evaluator.matches(rule, context)).toBe(true);
    });
  });

  describe('Disabled Rules', () => {
    it('should not match when rule is disabled', () => {
      const rule: SimpleRule = {
        id: '1',
        name: 'Test',
        enabled: false,
        folderPath: '/',
        scopeFolder: '/',
        condition: {
          type: 'frontmatter',
          operator: 'equals',
          field: 'status',
          value: 'done',
        },
        action: { type: 'move-file', targetFolder: 'Archive' },
      };

      const context: RuleContext = {
        file: {} as any,
        frontmatter: { status: 'done' },
        tags: [],
      };

      expect(evaluator.matches(rule, context)).toBe(false);
    });
  });
});
