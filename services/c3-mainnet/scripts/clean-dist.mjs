import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Fixed, ignored compiler output only. Never accepts a caller-supplied path.
const destination = fileURLToPath(new URL("../dist/", import.meta.url));
rmSync(destination, { recursive: true, force: true });
