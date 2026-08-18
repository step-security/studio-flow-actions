import { runtime } from "../_lib/runtime";
import { run } from "./action";

run().catch((error: unknown) => {
  runtime.fail(error instanceof Error ? error.message : String(error));
});
