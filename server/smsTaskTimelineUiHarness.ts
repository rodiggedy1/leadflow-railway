import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";

// Pure actual-source identity extraction only: no application imports, network or database.
const path = "client/src/components/ClaudeCustomerTasks.tsx";
const source = readFileSync(path, "utf8");
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const anchor = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "customerSmsTaskMessageAnchors");
if (!anchor) throw new Error("Missing actual SMS task identity helper");
const module = { exports: {} as { anchors: (messages: readonly unknown[]) => Array<string | null> } };
runInNewContext(ts.transpileModule(`${anchor.getText(ast)}\nexports.anchors = customerSmsTaskMessageAnchors;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports, Map, Set }, { timeout: 1500 });
export const actualSmsTaskMessageAnchors = module.exports.anchors;

export function expandSmsTaskTimeline(tree: any, seam: (props: any) => React.ReactNode): any {
  if (Array.isArray(tree)) return tree.map(child => expandSmsTaskTimeline(child, seam));
  if (!React.isValidElement<Record<string, any>>(tree)) return tree;
  if (tree.type === seam) return expandSmsTaskTimeline(seam(tree.props), seam);
  return React.cloneElement(tree, {}, expandSmsTaskTimeline(tree.props.children, seam));
}
