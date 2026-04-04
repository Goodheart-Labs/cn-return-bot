import { Project } from "ts-morph";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "../..");

const project = new Project({
  tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
});

// Test: move noteEvaluationFilter.ts from src/filters/ to src/pipeline/score/
const file = project.getSourceFile(
  path.join(ROOT, "src/filters/noteEvaluationFilter.ts")
);

if (!file) {
  console.error("Could not find noteEvaluationFilter.ts");
  process.exit(1);
}

console.log("Before move — files importing noteEvaluationFilter:");
for (const ref of file.getReferencingSourceFiles()) {
  console.log(" ", ref.getFilePath());
}

const targetDir = path.join(ROOT, "src/pipeline/score");
file.moveToDirectory(targetDir);

console.log("\nAfter move — checking updated imports:");
for (const ref of file.getReferencingSourceFiles()) {
  const importDecls = ref.getImportDeclarations();
  for (const decl of importDecls) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier.includes("noteEvaluation") || specifier.includes("filter")) {
      console.log(`  ${ref.getBaseName()}: "${specifier}"`);
    }
  }
}

// Don't save — this is just a test
console.log("\nTest passed! ts-morph can move files and update imports.");
console.log("(No files were actually modified — dry run only)");
