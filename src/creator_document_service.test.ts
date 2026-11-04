import assert from "node:assert/strict";
import { searchableText, shouldIndex } from "./creator_document_service.ts";

const scannedOutput = "  Subscriber update\n\nApril delivery details  ";
assert.equal(searchableText(scannedOutput), "Subscriber update April delivery details");
assert.equal(shouldIndex(scannedOutput), true);
assert.equal(shouldIndex("short"), false);
console.log("OCR text is indexed only when it contains a useful searchable passage.");
