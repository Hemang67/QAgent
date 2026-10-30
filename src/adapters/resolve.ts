import fs from 'fs';
import path from 'path';
import { CODE_EXT, readJson, walk } from './common';

/**
 * Turns an import specifier into a file path: relative imports, tsconfig/jsconfig
 * `baseUrl` imports (`pages/orders`) and `paths` aliases (`@/pages/orders`).
 */
export const makeResolver = (root: string) => {
  const cfg = readJson(path.join(root, 'tsconfig.json')) || readJson(path.join(root, 'jsconfig.json')) || {};
  const opts = cfg.compilerOptions || {};
  const baseUrl = opts.baseUrl ? path.resolve(root, opts.baseUrl) : null;
  const aliases: [string, string[]][] = Object.entries(opts.paths || {}).map(([k, v]) => [k, v as string[]]);
  // Common aliases even without tsconfig paths (Vite/Next defaults)
  if (!aliases.some(([k]) => k === '@/*')) aliases.push(['@/*', [fs.existsSync(path.join(root, 'src')) ? 'src/*' : '*']]);

  const tryFile = (p: string): string | null => {
    // .vue and .svelte single-file components are imported by their full name or as folders
    const exts = [...CODE_EXT, '.vue', '.svelte'];
    const candidates = [p, ...exts.map((e) => p + e), ...exts.map((e) => path.join(p, 'index' + e))];
    for (const c of candidates) {
      try {
        if (fs.statSync(c).isFile()) return c;
      } catch {
        // not this one
      }
    }
    return null;
  };

  return (spec: string, fromFile: string): string | null => {
    if (spec.startsWith('.')) return tryFile(path.resolve(path.dirname(fromFile), spec));
    for (const [pattern, targets] of aliases) {
      const prefix = pattern.replace(/\*$/, '');
      if (pattern.endsWith('*') ? spec.startsWith(prefix) : spec === pattern) {
        const rest = spec.slice(prefix.length);
        for (const t of targets) {
          const hit = tryFile(path.resolve(baseUrl ?? root, t.replace(/\*$/, '') + rest));
          if (hit) return hit;
        }
      }
    }
    if (baseUrl) return tryFile(path.resolve(baseUrl, spec));
    return null;
  };
};

/**
 * String constants declared at the top level of the project's files:
 * `const A = '/x'` → A, `export const R = { a: '/x', b: { c: '/y' } }` → R.a, R.b.c.
 * Route paths often use these instead of string literals.
 */
export const collectConstants = (asts: Map<string, any>) => {
  const map = new Map<string, string>();
  const unwrap = (n: any): any => (n && (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TypeCastExpression') ? unwrap(n.expression) : n);
  const add = (prefix: string, node: any) => {
    node = unwrap(node);
    if (!node) return;
    if (node.type === 'StringLiteral') map.has(prefix) || map.set(prefix, node.value);
    else if (node.type === 'TemplateLiteral' && node.expressions.length === 0) map.has(prefix) || map.set(prefix, node.quasis[0].value.cooked);
    else if (node.type === 'ObjectExpression') {
      for (const p of node.properties) {
        if (p.type !== 'ObjectProperty') continue;
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
        if (key) add(`${prefix}.${key}`, p.value);
      }
    }
  };
  for (const ast of asts.values()) {
    for (let stmt of ast.program.body) {
      if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) stmt = stmt.declaration;
      if (stmt.type === 'VariableDeclaration') {
        for (const d of stmt.declarations) if (d.id.type === 'Identifier') add(d.id.name, d.init);
      } else if (stmt.type === 'TSEnumDeclaration') {
        for (const m of stmt.members ?? stmt.body?.members ?? []) {
          const key = m.id.type === 'Identifier' ? m.id.name : m.id.value;
          if (m.initializer?.type === 'StringLiteral') map.set(`${stmt.id.name}.${key}`, m.initializer.value);
        }
      }
    }
  }
  return map;
};

/** Evaluates a path expression made of literals, constants, member access, templates and `+`. */
export const evalString = (node: any, consts: Map<string, string>): string | null => {
  if (!node) return null;
  switch (node.type) {
    case 'StringLiteral':
      return node.value;
    case 'TemplateLiteral': {
      let s = '';
      for (let i = 0; i < node.quasis.length; i++) {
        s += node.quasis[i].value.cooked;
        if (i < node.expressions.length) {
          const v = evalString(node.expressions[i], consts);
          if (v === null) return null;
          s += v;
        }
      }
      return s;
    }
    case 'BinaryExpression': {
      if (node.operator !== '+') return null;
      const l = evalString(node.left, consts);
      const r = evalString(node.right, consts);
      return l === null || r === null ? null : l + r;
    }
    case 'Identifier':
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const name = memberName(node);
      return name ? consts.get(name) ?? null : null;
    }
    case 'TSAsExpression':
    case 'TSNonNullExpression':
      return evalString(node.expression, consts);
    case 'JSXExpressionContainer':
      return evalString(node.expression, consts);
    default:
      return null;
  }
};

const memberName = (node: any): string | null => {
  if (node.type === 'Identifier') return node.name;
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && !node.computed) {
    const obj = memberName(node.object);
    return obj ? `${obj}.${node.property.name}` : null;
  }
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && node.property.type === 'StringLiteral') {
    const obj = memberName(node.object);
    return obj ? `${obj}.${node.property.value}` : null;
  }
  return null;
};

/** Local name → imported file, for `import X from`, `import { X } from` and `const X = lazy(() => import('…'))`. */
export const importsOf = (ast: any, file: string, resolve: (spec: string, from: string) => string | null) => {
  const map = new Map<string, string>();
  for (const stmt of ast.program.body) {
    if (stmt.type === 'ImportDeclaration') {
      const target = resolve(stmt.source.value, file);
      if (!target) continue;
      for (const s of stmt.specifiers) map.set(s.local.name, target);
    }
  }
  walk(ast, (n) => {
    if (n.type !== 'VariableDeclarator' || n.id.type !== 'Identifier' || !n.init) return;
    const spec = dynamicImportIn(n.init);
    if (spec) {
      const target = resolve(spec, file);
      if (target) map.set(n.id.name, target);
    }
  });
  return map;
};

/** The specifier of the first `import('…')` inside a node (lazy routes). */
export const dynamicImportIn = (node: any): string | null => {
  let found: string | null = null;
  walk(node, (n) => {
    if (found) return;
    if (n.type === 'CallExpression' && n.callee.type === 'Import' && n.arguments[0]?.type === 'StringLiteral') found = n.arguments[0].value;
    if (n.type === 'ImportExpression' && n.source?.type === 'StringLiteral') found = n.source.value;
  });
  return found;
};
