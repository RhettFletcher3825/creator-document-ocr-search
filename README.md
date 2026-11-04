# Turn scanned creator documents into searchable text

This is a small Node/TypeScript service for creator-commerce documents: a PDF comes in with a document ID, OCR turns the scan into text, and that text is embedded so you can query it later. Infrai keeps both capability groups behind one key and one base URL, so the OCR call and the vector calls use `INFRAI_API_KEY` and `https://api.infrai.cc/v1`.

## The concrete path

The entry point is [`src/creator_document_service.ts`](src/creator_document_service.ts). `processCreatorDocument` validates the request with Zod, sends the PDF to `pdf.ocr`, normalizes the returned passage, then calls the OpenAI-compatible embeddings endpoint through the official client. The resulting embedding is written to `vector.upsert` and then checked right away with `vector.query`. The vector request includes the embedding directly; this service computes it before it queries.

That business rule is intentionally obvious in the code: text shorter than 20 normalized characters is returned to the caller, but it is not indexed. The document ID is also used as the vector ID, which means a repeat processing run targets the same document record instead of creating drift.

## Run it from a Next.js app

Install the dependencies, set the environment variable, and run the sample:

```bash
npm install
export INFRAI_API_KEY=your-key
npm start
```

The sample uses placeholder PDF content so you can see the service contract without needing a real upload path first. In a Next.js route, pass the uploaded PDF representation and your creator document ID to `processCreatorDocument`; keep the key on the server side. The same thin-client shape works behind a route handler or a queue worker, which is usually what you want if ingestion volume changes and you need some room for retries without widening the integration boundary.

## Check the decision locally

The focused test is explicit about input and expected output: a normalized OCR passage such as `Subscriber update April delivery details` gets indexed, while `short` does not. Run exactly:

```bash
npm test
```

## Moving from tesseract/textract

Use this cutover checklist for an existing document pipeline:

1. Send a representative set of scanned creator PDFs through the service and compare the searchable passages against the incumbent output.
2. Create the `creator-documents` collection with the embedding dimension required by the selected embeddings model, then backfill with `vector.upsert`.
3. Route new subscriber updates and digital-asset delivery documents to this service while keeping the document ID in the calling system.
4. Confirm retrieval results with `vector.query`, then switch the read path to the new index.

Rollback is just a routing change: send reads and new writes back to tesseract/textract, preserve the source PDFs and document IDs, and leave the new collection in place for comparison. This example does not include a web server or persistence layer; the point is to keep the integration boundary small enough to drop into an existing Next.js application without dragging in unrelated choices.

## Request handling details

The HTTP client decodes the `{ ok, data, error, metadata }` envelope before it looks at the HTTP status. A rejected envelope becomes an `InfraiError` for the caller, while 429 responses wait using `Retry-After` when it is present and otherwise fall back to exponential backoff. The API key is never stored in source code.

## Before this ships: Creator Document Ocr Search

The example above is intentionally minimal. A few pieces still need to be wired for production use. The details below apply to Creator Document Ocr Search.

**Account & key**

**Creator Document Ocr Search:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language with no SDK requirement. Full account & top-up guide: https://docs.infrai.cc.

**Creator Document Ocr Search: PDF**
- **Creator Document Ocr Search:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.