import { absoluteArtifactPath, artifactArguments, ArtifactOperatorError, readPrivateArtifact } from "../src/o-artifact-target.ts";
import { acceptHistoryPackage, historyReceipt, receiveHistory } from "../src/o-history.ts";
import { HISTORY_PACKAGE_BYTES, HISTORY_SOURCE_BYTES } from "../src/o-history-schema.ts";
import { historyText, parseHistoryJson } from "../src/o-history-validation.ts";
import { ValidationError } from "../src/o-validation.ts";

export async function historyCommandMain(args: readonly string[]): Promise<number> {
  try {
    let output: unknown;
    switch (args[0]) {
      case "receive-history": {
        const values = artifactArguments(args, ["--source-comment", "--evidence"]);
        const comment = readPrivateArtifact(absoluteArtifactPath(values.get("--source-comment")), HISTORY_SOURCE_BYTES);
        const evidence = readPrivateArtifact(absoluteArtifactPath(values.get("--evidence")), HISTORY_SOURCE_BYTES);
        output = receiveHistory(comment, evidence);
        break;
      }
      case "history-receipt": {
        const values = artifactArguments(args, ["--artifact"]);
        const bytes = readPrivateArtifact(absoluteArtifactPath(values.get("--artifact")), HISTORY_PACKAGE_BYTES);
        output = historyReceipt(acceptHistoryPackage(parseHistoryJson(historyText(bytes, HISTORY_PACKAGE_BYTES))));
        break;
      }
      default: throw new ArtifactOperatorError("arguments");
    }
    process.stdout.write(JSON.stringify(output) + "\n");
    return 0;
  } catch (error) {
    const code = error instanceof ArtifactOperatorError ? error.code : error instanceof ValidationError ? "invalid-history" : "unavailable";
    process.stderr.write(`History operation failed: ${code}.\n`);
    return 1;
  }
}
